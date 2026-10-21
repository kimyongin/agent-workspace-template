import { assertEquals, assertRejects } from "@std/assert";
import type postgres from "postgres";
import { receiptChange, SqlDataModelStore } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
const a = { userId: "10000000-0000-4000-8000-000000000001", workspaceId: "20000000-0000-4000-8000-000000000001" };
const b = { ...a, userId: "10000000-0000-4000-8000-000000000002" };
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
        }],
      },
    },
  };
}
function historyPage() {
  const rows = [row("10000000-0000-4000-8000-000000000011"), row("10000000-0000-4000-8000-000000000012")];
  return [rows.map(({ id }) => ({ id, requirements: [] })), rows];
}
Deno.test("model history uses a scoped cursor and summary payload rather than full definition copies", async () => {
  const first = await store(historyPage()).list(1);
  assertEquals(first.items[0].review.items[0].schema, undefined);
  assertEquals(first.items[0].review.items[0].current_schema, undefined);
  assertEquals(Object.hasOwn(first.items[0].review.items[0], "identity"), false);
  assertEquals(first.items[0].review.items[0].diff, []);
  await assertRejects(() => store([], b).list(1, first.next_cursor!), Error, "cursor");
  await assertRejects(
    () => store([], { ...a, workspaceId: "20000000-0000-4000-8000-000000000002" }).list(1, first.next_cursor!),
    Error,
    "cursor",
  );
});
Deno.test("model history rejects a scoped cursor whose workspace history anchor no longer exists", async () => {
  const first = await store(historyPage()).list(1);
  await assertRejects(() => store([[]]).list(1, first.next_cursor!), Error, "cursor");
});

Deno.test("every compact group receipt removes its internal multi-model plan and child definitions", () => {
  for (const status of ["analyzing", "queued", "cancelled", "failed"] as const) {
    const value = row("10000000-0000-4000-8000-000000000011");
    const plan = { ...value.plan, source: "x".repeat(600000), target: "y".repeat(600000) };
    const receipt = receiptChange(
      {
        ...value,
        status,
        review: value.plan.review,
        plan,
        group: {
          children: [{ source: plan.source }],
          total: 2,
          processed: 0,
          failed: 0,
          retryable: false,
          failure_reason: null,
        },
      } as unknown as Parameters<typeof receiptChange>[0],
    );
    assertEquals(Object.hasOwn(receipt, "plan"), false);
    assertEquals(receipt.group?.children, []);
    assertEquals(new TextEncoder().encode(JSON.stringify(receipt)).length < 100000, true);
  }
});
