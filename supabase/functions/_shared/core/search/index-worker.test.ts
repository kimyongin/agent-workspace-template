import { assertEquals, assertRejects, assertStrictEquals } from "@std/assert";
import {
  type Embedder,
  EmbeddingError,
  indexBatch,
  type IndexQueue,
  type IndexScope,
  type IndexSource,
} from "./index-worker.ts";
import { SEARCH_PIPELINE } from "./config.ts";

// Only outbound replies and calls are stubbed; indexBatch owns every state decision.
function fixture(options: {
  source?: IndexSource | null;
  readCount?: number;
  accepted?: boolean;
  error?: Error;
} = {}) {
  const scope: IndexScope = { limit: 1, owner_id: "owner", kind: "record", id: "record" };
  const vector = [0.25, -0.5];
  const claims: IndexScope[] = [], preparations: [string, string][] = [];
  const finishes: Parameters<IndexQueue["finish"]>[] = [];
  const embeddings: Parameters<Embedder["embed"]>[] = [];
  const queue: IndexQueue = {
    claim: (requested) => {
      claims.push(requested);
      return Promise.resolve([{ msg_id: "job", read_ct: options.readCount ?? 1 }]);
    },
    prepare: (...args) => {
      assertEquals(args, ["job", SEARCH_PIPELINE]);
      preparations.push(args);
      return Promise.resolve(options.source === undefined ? { title: "제목", summary: "요약" } : options.source);
    },
    finish: (...args) => {
      assertEquals(args.slice(0, 2), ["job", SEARCH_PIPELINE]);
      finishes.push(args);
      return Promise.resolve(options.accepted ?? true);
    },
  };
  const embedder: Embedder = {
    embed: (...args) => {
      embeddings.push(args);
      return options.error ? Promise.reject(options.error) : Promise.resolve(vector);
    },
  };
  return { scope, vector, queue, embedder, claims, preparations, finishes, embeddings };
}
function result(state: "indexed" | "excluded" | "failed" | "retry" | "stale") {
  return { claimed: 1, indexed: 0, excluded: 0, failed: 0, retry: 0, stale: 0, [state]: 1 };
}

Deno.test("indexBatch forwards scoped claim, pipeline and title+summary passage vector", async () => {
  const f = fixture({ source: { title: "  제목 😀 ", summary: " 요약\n다음 줄 " } });
  assertEquals(await indexBatch(f.queue, f.embedder, f.scope), result("indexed"));
  assertEquals(f.claims, [f.scope]);
  assertStrictEquals(f.claims[0], f.scope);
  assertEquals(f.preparations, [["job", SEARCH_PIPELINE]]);
  assertEquals(f.embeddings, [["  제목 😀 \n 요약\n다음 줄 ", "passage"]]);
  assertEquals(f.finishes, [["job", SEARCH_PIPELINE, "indexed", null, f.vector, undefined]]);
  assertStrictEquals(f.finishes[0][4], f.vector);
});

for (const category of ["transient", "invalid_response"] as const) {
  for (const [readCount, delay] of [[1, 30], [2, 60], [3, 120], [4, 240]]) {
    Deno.test(`indexBatch ${category} read ${readCount} schedules ${delay}s retry`, async () => {
      const f = fixture({ readCount, error: new EmbeddingError(category) });
      assertEquals(await indexBatch(f.queue, f.embedder, f.scope), result("retry"));
      assertEquals(f.embeddings.length, 1);
      assertEquals(f.finishes, [["job", SEARCH_PIPELINE, "retry", category, undefined, delay]]);
    });
  }
  Deno.test(`indexBatch ${category} on fifth read fails after the embedding attempt`, async () => {
    const f = fixture({ readCount: 5, error: new EmbeddingError(category) });
    assertEquals(await indexBatch(f.queue, f.embedder, f.scope), result("failed"));
    assertEquals(f.embeddings.length, 1);
    assertEquals(f.finishes, [["job", SEARCH_PIPELINE, "failed", "retry_exhausted", undefined, undefined]]);
  });
}

Deno.test("indexBatch fifth read may succeed, sixth read fails before embedding", async () => {
  const fifth = fixture({ readCount: 5 });
  assertEquals(await indexBatch(fifth.queue, fifth.embedder, fifth.scope), result("indexed"));
  assertEquals(fifth.embeddings.length, 1);
  const sixth = fixture({ readCount: 6 });
  assertEquals(await indexBatch(sixth.queue, sixth.embedder, sixth.scope), result("failed"));
  assertEquals(sixth.embeddings, []);
  assertEquals(sixth.finishes, [["job", SEARCH_PIPELINE, "failed", "retry_exhausted", undefined, undefined]]);
});

for (const [category, state] of [["input_limit", "excluded"], ["configuration", "failed"]] as const) {
  for (const readCount of [1, 5]) {
    Deno.test(`indexBatch ${category} read ${readCount} finishes ${state} without retry`, async () => {
      const f = fixture({ readCount, error: new EmbeddingError(category) });
      assertEquals(await indexBatch(f.queue, f.embedder, f.scope), result(state));
      assertEquals(f.embeddings.length, 1);
      assertEquals(f.finishes, [["job", SEARCH_PIPELINE, state, category, undefined, undefined]]);
    });
  }
}

const invalidSources: [string, IndexSource][] = [
  ["empty title", { title: "", summary: "요약" }],
  ["blank title", { title: " \n\t", summary: "요약" }],
  ["missing summary", { title: "제목", summary: null }],
  ["empty summary", { title: "제목", summary: "" }],
  ["blank summary", { title: "제목", summary: " \n\t" }],
  ["101 code point title", { title: "😀".repeat(101), summary: "요약" }],
  ["301 code point summary", { title: "제목", summary: "😀".repeat(301) }],
];
for (const [name, source] of invalidSources) {
  Deno.test(`indexBatch excludes ${name} before embedding`, async () => {
    const f = fixture({ source });
    assertEquals(await indexBatch(f.queue, f.embedder, f.scope), result("excluded"));
    assertEquals(f.embeddings, []);
    assertEquals(f.finishes, [["job", SEARCH_PIPELINE, "excluded", "invalid_input", undefined, undefined]]);
  });
}
Deno.test("indexBatch accepts exactly 100/300 Unicode code points without truncation", async () => {
  const source = { title: "😀".repeat(100), summary: "😀".repeat(300) };
  const f = fixture({ source });
  assertEquals(await indexBatch(f.queue, f.embedder, f.scope), result("indexed"));
  assertEquals(f.embeddings, [[`${source.title}\n${source.summary}`, "passage"]]);
});

Deno.test("indexBatch stale preparation neither embeds nor finishes", async () => {
  const f = fixture({ source: null, readCount: 6 });
  assertEquals(await indexBatch(f.queue, f.embedder, f.scope), result("stale"));
  assertEquals(f.preparations.length, 1);
  assertEquals(f.embeddings, []);
  assertEquals(f.finishes, []);
});
for (const category of [undefined, "input_limit", "configuration", "transient", "invalid_response"] as const) {
  Deno.test(`indexBatch rejected ${category ?? "successful"} finish counts stale with one finish call`, async () => {
    const f = fixture({ accepted: false, error: category ? new EmbeddingError(category) : undefined });
    assertEquals(await indexBatch(f.queue, f.embedder, f.scope), result("stale"));
    assertEquals(f.embeddings.length, 1);
    assertEquals(f.finishes.length, 1);
  });
}

for (const boundary of ["claim", "prepare", "embed", "finish"] as const) {
  Deno.test(`indexBatch unknown ${boundary} error propagates without provider retry`, async () => {
    const error = new Error(`unexpected ${boundary}`), f = fixture(boundary === "embed" ? { error } : {});
    if (boundary !== "embed") f.queue[boundary] = (): Promise<never> => Promise.reject(error);
    assertStrictEquals(await assertRejects(() => indexBatch(f.queue, f.embedder, f.scope)), error);
    assertEquals(f.finishes, []);
    assertEquals(f.embeddings.length, boundary === "embed" || boundary === "finish" ? 1 : 0);
  });
}

Deno.test("indexBatch summarizes mixed claims by accepted outcome", async () => {
  const cases = [
    fixture({ source: { title: "0", summary: "요약" } }),
    fixture({ source: { title: "1", summary: "요약" }, error: new EmbeddingError("input_limit") }),
    fixture({ source: { title: "2", summary: "요약" }, error: new EmbeddingError("configuration") }),
    fixture({ source: { title: "3", summary: "요약" }, error: new EmbeddingError("transient") }),
    fixture({ source: null }),
    fixture({ source: { title: "5", summary: "요약" }, accepted: false }),
  ];
  const queue: IndexQueue = {
    claim: () => Promise.resolve(cases.map((_, i) => ({ msg_id: String(i), read_ct: 1 }))),
    prepare: (id, pipeline) => cases[Number(id)].queue.prepare("job", pipeline),
    finish: (id, ...args) => cases[Number(id)].queue.finish("job", ...args),
  };
  const embedder: Embedder = {
    embed: (text, type) => cases[Number(text.split("\n")[0])].embedder.embed(text, type),
  };
  assertEquals(await indexBatch(queue, embedder, { limit: 6 }), {
    claimed: 6,
    indexed: 1,
    excluded: 1,
    failed: 1,
    retry: 1,
    stale: 2,
  });
});
