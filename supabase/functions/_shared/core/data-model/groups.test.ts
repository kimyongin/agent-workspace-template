import { assertRejects } from "@std/assert";
import { analyzeDataModel } from "./groups.ts";
Deno.test("a model group never accepts conversions for a kind outside the reviewed model", async () => {
  const deps = {
    uow: {
      run: (_a: unknown, fn: (s: unknown) => unknown) =>
        fn({
          executeRequest: (_r: unknown, execute: () => Promise<unknown>) => execute(),
          get: () =>
            Promise.resolve({
              id: "10000000-0000-4000-8000-000000000001",
              version: 1,
              status: "needs_conversion",
              plan: { target: { entity_types: [] } },
            }),
        }),
    },
  };
  await assertRejects(
    () =>
      analyzeDataModel(
        deps as never,
        { userId: crypto.randomUUID(), request: { key: crypto.randomUUID() } },
        "10000000-0000-4000-8000-000000000001",
        { expected_version: 1, conversions: [{ type_ref: "foreign", migration: { rules: [], overrides: [] } }] },
      ),
    Error,
    "검토한 모델",
  );
});

import { assertEquals } from "@std/assert";
import { initialEntityDefinition } from "../../contracts/entity-type.ts";
import type { DataModelDeps, ModelPlan } from "./application.ts";
const changeId = "10000000-0000-4000-8000-000000000001";
function harness(status = "needs_conversion") {
  const schema = initialEntityDefinition("이름").schema;
  const plan = {
    target: { entity_types: [{ ref: "ingredient", schema }] },
    source: { entity_types: [{ ref: "ingredient", schema }] },
    remove_keys: {},
  } as unknown as ModelPlan;
  let calls = 0;
  const d = {
    uow: {
      run: (_a: unknown, fn: (s: unknown) => unknown) =>
        fn({
          executeRequest: (_r: unknown, execute: () => Promise<unknown>) => execute(),
          get: () => Promise.resolve({ id: changeId, version: 1, status, plan }),
          analyzeGroup: () => {
            calls++;
            return Promise.resolve({ id: changeId });
          },
        }),
    },
  } as unknown as DataModelDeps;
  return { d, plan, calls: () => calls };
}
const actor = { userId: crypto.randomUUID(), request: { key: crypto.randomUUID() } };
Deno.test("group analysis validates target property before accepting durable work", async () => {
  const h = harness();
  await assertRejects(
    () =>
      analyzeDataModel(h.d, actor, changeId, {
        expected_version: 1,
        conversions: [{
          type_ref: "ingredient",
          migration: { rules: [{ op: "fill", key: "prop_999", value: "x" }], overrides: [] },
        }],
      }),
    Error,
    "변환 대상 속성",
  );
  assertEquals(h.calls(), 0);
});
Deno.test("group removal rules require the explicitly confirmed source property", async () => {
  const h = harness();
  await assertRejects(
    () =>
      analyzeDataModel(h.d, actor, changeId, {
        expected_version: 1,
        conversions: [{
          type_ref: "ingredient",
          migration: { rules: [{ op: "remove", key: "prop_999" }], overrides: [] },
        }],
      }),
    Error,
    "확인한 속성",
  );
  assertEquals(h.calls(), 0);
});
Deno.test("group ready_to_commit is worker-owned and cannot be reanalyzed", async () => {
  const h = harness("ready_to_commit");
  await assertRejects(() => analyzeDataModel(h.d, actor, changeId, { expected_version: 1 }), Error, "진행 중");
  assertEquals(h.calls(), 0);
});
Deno.test("group rules reuse existing scalar validation for corrective values", async () => {
  const h = harness();
  await assertRejects(
    () =>
      analyzeDataModel(h.d, actor, changeId, {
        expected_version: 1,
        conversions: [{
          type_ref: "ingredient",
          migration: {
            rules: [],
            overrides: [{ entity_id: "app:10000000-0000-4000-8000-000000000001:one", key: "prop_1", value: 123 }],
          },
        }],
      }),
    Error,
  );
  assertEquals(h.calls(), 0);
});

import { applyDataModel } from "./application.ts";
Deno.test("a prepared conversion group cannot fall through to direct definition publication", async () => {
  let published = false;
  const d = {
    uow: {
      run: (_a: unknown, fn: (s: unknown) => unknown) =>
        fn({
          executeRequest: (_r: unknown, execute: () => Promise<unknown>) => execute(),
          get: () =>
            Promise.resolve({
              id: changeId,
              version: 1,
              status: "ready",
              review: { can_apply: true },
              group: { children: [{}] },
              plan: { baseline: "invalid" },
            }),
          snapshot: () => Promise.resolve({}),
          publishPreparedModel: () => {
            published = true;
            return Promise.resolve({});
          },
        }),
    },
  } as unknown as DataModelDeps;
  await assertRejects(() => applyDataModel(d, actor, changeId, { expected_version: 1 }), Error, "전체 작업 실행");
  assertEquals(published, false);
});
