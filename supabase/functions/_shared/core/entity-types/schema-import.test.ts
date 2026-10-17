import { assertEquals, assertRejects } from "@std/assert";
import { replayEntitySchemaImport } from "./schema-import.ts";
import type { EntityTypeDeps } from "./application.ts";
const actor = { userId: crypto.randomUUID(), request: { key: crypto.randomUUID() } };
const input = { mode: "copy", document: "{}", preview_fingerprint: "a".repeat(64) };
Deno.test("retired single-kind import only replays an exact retained completed request", async () => {
  const deps = {
    uow: {
      run: (_a: unknown, fn: (s: unknown) => unknown) =>
        fn({ replayRetainedRequest: () => Promise.resolve({ found: true, result: { changed: true } }) }),
    },
  } as unknown as EntityTypeDeps;
  assertEquals((await replayEntitySchemaImport(deps, actor, input)).changed, true);
});
Deno.test("retired single-kind import refuses a new legacy request", async () => {
  const deps = {
    uow: {
      run: (_a: unknown, fn: (s: unknown) => unknown) =>
        fn({ replayRetainedRequest: () => Promise.resolve({ found: false }) }),
    },
  } as unknown as EntityTypeDeps;
  await assertRejects(() => replayEntitySchemaImport(deps, actor, input), Error, "전체 자료 모델");
});
