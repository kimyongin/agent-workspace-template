import { assertEquals, assertRejects } from "@std/assert";
import { previewDataModel } from "./application.ts";
import type { DataModelDeps } from "./application.ts";
const actor = { userId: "10000000-0000-4000-8000-000000000001", source: "http" as const };
const empty = {
  format: "workspace-data-model",
  format_version: 1,
  title: "빈 모델",
  entity_types: [],
  relations: [],
  identity_definitions: { issuers: [], rules: [] },
};
const deps = {
  uow: {
    run: (_a: unknown, fn: (s: unknown) => unknown) =>
      fn({ snapshot: () => Promise.resolve({ document: empty, types: {} }) }),
  },
} as unknown as DataModelDeps;
Deno.test("whole model preview rejects duplicate JSON keys before object construction", async () => {
  await assertRejects(
    async () =>
      await previewDataModel(deps, actor, {
        mode: "update",
        document: '{"format":"workspace-data-model","format":"other"}',
      }),
    Error,
    "JSON",
  );
});
Deno.test("whole model preview accepts a no-op empty model without publishing", async () => {
  const result = await previewDataModel(deps, actor, { mode: "update", document: JSON.stringify(empty) });
  assertEquals(result.items, []);
  assertEquals(result.can_apply, true);
});

import { initialEntityDefinition } from "../../contracts/entity-type.ts";
import type { DataModelDocument } from "../../contracts/data-model.ts";
import { APP_IDENTIFIER_RULE_ID } from "../../contracts/entity-issuer.ts";
function example(): DataModelDocument {
  const schema = {
    ...initialEntityDefinition("이름").schema,
    "x-type-id": "10000000-0000-4000-8000-000000000011",
    "x-version": 1,
    title: "재료",
    "x-icon": "leaf",
    deprecated: true,
  };
  return {
    format: "workspace-data-model",
    format_version: 1,
    title: "요리",
    entity_types: [{
      ref: "ingredient",
      schema,
      identity: {
        version: 1,
        label: "번호",
        default_source: "app",
        sources: [{ code: "app", rule_id: APP_IDENTIFIER_RULE_ID, active: true }],
      },
    }],
    relations: [{
      id: "10000000-0000-4000-8000-000000000012",
      version: 1,
      archived: false,
      ends: [{ type_ref: "ingredient", label: "대체재", cardinality: "many" }, {
        type_ref: "ingredient",
        label: "대체되는 재료",
        cardinality: "one",
      }],
    }],
    identity_definitions: {
      issuers: [{ code: "app", label: "앱", active: true, system: true, version: 1 }],
      rules: [{
        id: APP_IDENTIFIER_RULE_ID,
        source: "app",
        label: "자동 발급",
        meaning: "앱이 발급한 자료 번호",
        generation: "automatic",
        active: true,
        version: 1,
      }],
    },
  };
}
Deno.test("whole model rejects unresolved relation references with an actionable location", async () => {
  const d = example();
  d.relations[0].ends[1].type_ref = "missing";
  await assertRejects(
    async () => await previewDataModel(deps, actor, { mode: "copy", document: JSON.stringify(d) }),
    Error,
    "참조",
  );
});
Deno.test("copy reviews both roles of a same-kind relationship and remaps IDs without publishing", async () => {
  const r = await previewDataModel(deps, actor, { mode: "copy", document: JSON.stringify(example()) });
  assertEquals(r.items.find((i) => i.ref === "ingredient")?.kind, "new");
  assertEquals(r.mapping.types.ingredient === "10000000-0000-4000-8000-000000000011", false);
  assertEquals(r.mapping.rules[APP_IDENTIFIER_RULE_ID], APP_IDENTIFIER_RULE_ID);
  assertEquals(r.can_apply, true);
});
