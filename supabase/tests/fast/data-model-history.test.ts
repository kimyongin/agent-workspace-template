import { assertEquals, assertRejects } from "@std/assert";
import type postgres from "postgres";
import { SqlDataModelStore } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
const a = { userId: "10000000-0000-4000-8000-000000000001" };
const b = { userId: "10000000-0000-4000-8000-000000000002" };
function store(rows: unknown[][], actor = a) {
  return new SqlDataModelStore(
    (() => Promise.resolve(rows.shift() ?? [])) as unknown as postgres.TransactionSql,
    actor,
  );
}
function row(id: string) {
  return {
    id,
    version: 1,
    status: "ready",
    created_at: new Date(),
    result: null,
    plan: {
      review: {
        items: [{
          ref: "type",
          diff: [{ path: "large" }],
          schema: { properties: { prop_1: { title: "원문" } } },
          current_schema: {},
          identity: { sources: [] },
          current_identity: { sources: [] },
        }],
      },
    },
  };
}
Deno.test("model history uses a scoped cursor and summary payload rather than full definition copies", async () => {
  const first = await store([[
    row("10000000-0000-4000-8000-000000000011"),
    row("10000000-0000-4000-8000-000000000012"),
  ]]).list(1);
  assertEquals(first.items[0].review.items[0].schema, undefined);
  assertEquals(first.items[0].review.items[0].current_schema, undefined);
  assertEquals(first.items[0].review.items[0].identity, undefined);
  assertEquals(first.items[0].review.items[0].diff, []);
  await assertRejects(() => store([], b).list(1, first.next_cursor!), Error, "cursor");
});
Deno.test("model history rejects a scoped cursor whose owner anchor no longer exists", async () => {
  const first = await store([[
    row("10000000-0000-4000-8000-000000000011"),
    row("10000000-0000-4000-8000-000000000012"),
  ]]).list(1);
  await assertRejects(() => store([[]]).list(1, first.next_cursor!), Error, "cursor");
});
