import { assertEquals } from "@std/assert";
import { EmbeddingError, indexBatch, type IndexQueue } from "./index-worker.ts";

Deno.test("indexBatch sends the entire record body as bounded passages and publishes one generation", async () => {
  const body = "# 첫 문단\n\n" + "긴한국어😀내용".repeat(500) + "\n\n마지막 검색 근거.";
  const sent: string[] = [];
  const finishes: Parameters<IndexQueue["finish"]>[] = [];
  const queue: IndexQueue = {
    claim: () => Promise.resolve([{ msg_id: "1", read_ct: 1 }]),
    prepare: () => Promise.resolve({ body }),
    finish: (...args) => {
      finishes.push(args);
      return Promise.resolve(true);
    },
  };
  const result = await indexBatch(queue, {
    embed: (text) => {
      sent.push(text);
      return Promise.resolve([1]);
    },
  }, { limit: 1 });
  assertEquals(result.indexed, 1);
  assertEquals(sent.length > 1, true);
  assertEquals(sent.at(-1)?.endsWith("마지막 검색 근거."), true);
  assertEquals(finishes.length, 1);
  const chunks = finishes[0][4]!;
  const points = [...body];
  const covered = new Set<number>();
  for (const chunk of chunks) {
    assertEquals(chunk.text, points.slice(chunk.start, chunk.end).join(""));
    assertEquals(new TextEncoder().encode(chunk.text).length <= 1800, true);
    for (let i = chunk.start; i < chunk.end; i++) covered.add(i);
  }
  assertEquals(covered.size, points.length);
});

Deno.test("provider input limit splits automatically without losing either end of a record", async () => {
  const body = "처음😀가운데끝";
  const finishes: Parameters<IndexQueue["finish"]>[] = [];
  const queue: IndexQueue = {
    claim: () => Promise.resolve([{ msg_id: "1", read_ct: 1 }]),
    prepare: () => Promise.resolve({ body }),
    finish: (...args) => {
      finishes.push(args);
      return Promise.resolve(true);
    },
  };
  const result = await indexBatch(queue, {
    embed: (text) => [...text].length > 3 ? Promise.reject(new EmbeddingError("input_limit")) : Promise.resolve([1]),
  }, { limit: 1 });
  assertEquals(result.indexed, 1);
  assertEquals(finishes[0][4]!.map((c) => c.text).join(""), body);
});

for (const category of ["transient", "invalid_response", "configuration", "input_limit"] as const) {
  Deno.test(`partial generation with ${category} failure never publishes generated chunks`, async () => {
    const finishes: Parameters<IndexQueue["finish"]>[] = [];
    let calls = 0;
    const queue: IndexQueue = {
      claim: () => Promise.resolve([{ msg_id: "1", read_ct: 1 }]),
      prepare: () => Promise.resolve({ body: "가".repeat(900) }),
      finish: (...args) => {
        finishes.push(args);
        return Promise.resolve(true);
      },
    };
    const result = await indexBatch(queue, {
      embed: () => ++calls === 1 ? Promise.resolve([1]) : Promise.reject(new EmbeddingError(category)),
    }, { limit: 1 });
    assertEquals(category === "configuration" || category === "input_limit" ? result.failed : result.retry, 1);
    assertEquals(finishes.length, 1);
    assertEquals(finishes[0][4], undefined);
  });
}

Deno.test("a generation finishing after a body edit is stale", async () => {
  const queue: IndexQueue = {
    claim: () => Promise.resolve([{ msg_id: "1", read_ct: 1 }]),
    prepare: () => Promise.resolve({ body: "현재 원문" }),
    finish: () => Promise.resolve(false),
  };
  assertEquals((await indexBatch(queue, { embed: () => Promise.resolve([1]) }, { limit: 1 })).stale, 1);
});
