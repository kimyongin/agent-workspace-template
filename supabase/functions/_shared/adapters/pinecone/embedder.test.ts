import { assertEquals, assertRejects } from "@std/assert";
import { PineconeEmbedder } from "./embedder.ts";
import { EmbeddingError, indexBatch, type IndexQueue } from "../../core/search/index-worker.ts";
const values = Array.from({ length: 1024 }, (_, i) => i === 0 ? 1 : 0);
const good = { model: "llama-text-embed-v2", vector_type: "dense", data: [{ vector_type: "dense", values }] };
Deno.test("임베딩 경계: 본문 구간·query 종류·NONE·고정 목적지·벡터 응답 검증", async () => {
  const embedder = new PineconeEmbedder("test-key", (url, init) => {
    assertEquals(url, "https://api.pinecone.io/embed");
    assertEquals(init?.redirect, "error");
    assertEquals(JSON.parse(init!.body as string), {
      model: "llama-text-embed-v2",
      inputs: [{ text: "제목\n요약" }],
      parameters: { input_type: "passage", dimension: 1024, truncate: "NONE" },
    });
    return Promise.resolve(Response.json(good));
  });
  assertEquals(await embedder.embed("제목\n요약", "passage"), values);
  for (
    const data of [{ ...good, model: "other" }, { ...good, data: [] }, {
      ...good,
      data: [{ vector_type: "dense", values: [1] }],
    }, { ...good, data: [{ vector_type: "dense", values: Array(1024).fill(0) }] }]
  ) {
    await assertRejects(
      () => new PineconeEmbedder("key", () => Promise.resolve(Response.json(data))).embed("질의", "query"),
      EmbeddingError,
      "invalid_response",
    );
  }
  const errors = [[400, "tokens were truncated", "input_limit"], [401, "bad key", "configuration"], [
    429,
    "rate limit",
    "transient",
  ], [503, "unavailable", "transient"]] as const;
  for (const [status, message, category] of errors) {
    await assertRejects(
      () =>
        new PineconeEmbedder("key", () => Promise.resolve(Response.json({ message }, { status }))).embed(
          "질의",
          "query",
        ),
      EmbeddingError,
      category,
    );
  }
  await assertRejects(
    () => new PineconeEmbedder("key", () => Promise.resolve(new Response("x".repeat(128001)))).embed("질의", "query"),
    EmbeddingError,
    "invalid_response",
  );
});
Deno.test("worker 빈 본문은 공급자 무호출로 제외", async () => {
  for (const body of ["", " "]) {
    const queue: IndexQueue = {
      claim: () => Promise.resolve([{ msg_id: "1", read_ct: 1 }]),
      prepare: () => Promise.resolve({ body }),
      finish: (_id, _pipeline, state, reason) => {
        assertEquals(state, "excluded");
        assertEquals(reason, "invalid_input");
        return Promise.resolve(true);
      },
    };
    assertEquals(
      (await indexBatch(queue, {
        embed: () => {
          throw new Error("호출하면 안 됨");
        },
      }, { limit: 1 })).excluded,
      1,
    );
  }
});

Deno.test("passage provider declares no recovery capability or invented key header", async () => {
  const headers: Headers[] = [];
  const provider = new PineconeEmbedder("credential", (_url, init) => {
    headers.push(new Headers(init?.headers));
    return Promise.resolve(Response.json({ message: "rate limit" }, { status: 429 }));
  });
  assertEquals(provider.capabilities, { idempotency: null, lookup: false });
  assertEquals(await provider.send("passage"), { state: "failed", reason: "transient" });
  assertEquals([...headers[0].keys()].sort(), ["api-key", "content-type", "x-pinecone-api-version"]);
  const uncertain = new PineconeEmbedder("credential", () => Promise.reject(new TypeError("lost response")));
  assertEquals(await uncertain.send("passage"), { state: "unknown", reason: "provider_unknown" });
});
