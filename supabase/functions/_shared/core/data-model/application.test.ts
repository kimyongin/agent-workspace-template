import { assertEquals, assertRejects } from "@std/assert";
import { previewDataModel } from "./application.ts";
import type { DataModelDeps } from "./application.ts";
const actor = {
  userId: "10000000-0000-4000-8000-000000000001",
  workspaceId: "20000000-0000-4000-8000-000000000001",
  source: "http" as const,
};
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
Deno.test("whole model accepts a valid multi-kind bundle larger than the retired single-document 2 MiB limit", async () => {
  const d = example();
  d.relations = [];
  const template = d.entity_types[0];
  d.entity_types = Array.from({ length: 12 }, (_, n) => {
    const t = structuredClone(template);
    t.ref = `kind_${n}`;
    t.schema["x-type-id"] = `60000000-0000-4000-8000-${String(n + 1).padStart(12, "0")}`;
    t.schema.title = `종류 ${n}`;
    t.schema.properties.prop_3 = {
      type: "string",
      "x-order": 30,
      examples: Array.from({ length: 45 }, () => "x".repeat(4096)),
    };
    return t;
  });
  const document = JSON.stringify(d);
  assertEquals(new TextEncoder().encode(document).length > 2 * 1024 * 1024, true);
  const r = await previewDataModel(deps, actor, { mode: "copy", document });
  assertEquals(r.items.filter((i) => i.kind === "new" && i.ref.startsWith("kind_")).length, 12);
  assertEquals(r.can_apply, true);
});

import { parseModel, resolveModel } from "./application.ts";
Deno.test("the original update file reapplies without losing immutable kind, property, rule or relation identities", async () => {
  const doc = example();
  doc.entity_types[0].schema.properties.prop_9 = { type: "string", "x-order": 2, title: "원본 키" };
  doc.identity_definitions.issuers.push({ code: "seller", label: "판매자", active: true, system: false, version: 1 });
  doc.identity_definitions.rules.push({
    id: "20000000-0000-4000-8000-000000000001",
    source: "seller",
    label: "SKU",
    meaning: "판매자 코드",
    generation: "direct",
    active: true,
    version: 1,
  });
  doc.entity_types[0].identity.sources.push({
    code: "seller",
    rule_id: "20000000-0000-4000-8000-000000000001",
    active: true,
  });
  const first = await resolveModel({ document: empty as DataModelDocument, types: {} }, doc, "update", actor.userId);
  const types = Object.fromEntries(
    first.target.entity_types.map(
      (t) => [t.schema["x-type-id"], { next_property_number: 10, count: 0, locked: false }],
    ),
  );
  const second = await resolveModel({ document: first.target, types }, doc, "update", actor.userId);
  assertEquals(second.review.items.every((i) => i.kind === "unchanged"), true);
  assertEquals(second.review.mapping.types.ingredient, first.review.mapping.types.ingredient);
  assertEquals(second.review.mapping.properties.ingredient.prop_9, "prop_9");
  assertEquals(
    second.review.mapping.relations[doc.relations[0].id],
    first.review.mapping.relations[doc.relations[0].id],
  );
});
Deno.test("whole model review surfaces existing typed link cardinality and endpoint conflicts", async () => {
  const doc = example();
  const snapshot = {
    document: doc,
    types: { [doc.entity_types[0].schema["x-type-id"]]: { next_property_number: 2, count: 0, locked: false } },
    relation_usage: { [doc.relations[0].id]: { links: 2, left_many: true, right_many: false } },
  };
  const target = structuredClone(doc);
  target.relations[0].ends[0].cardinality = "one";
  const review = (await resolveModel(snapshot, target, "update", actor.userId)).review;
  assertEquals(review.items.find((i) => i.ref === `relation:${doc.relations[0].id}`)?.kind, "conflict");
  assertEquals(review.can_apply, false);
});

Deno.test("whole model review rejects changing a used relationship endpoint kind before publication", async () => {
  const doc = example(), other = structuredClone(doc.entity_types[0]);
  other.ref = "other";
  other.schema["x-type-id"] = "10000000-0000-4000-8000-000000000013";
  other.schema.title = "다른 종류";
  doc.entity_types.push(other);
  const types = Object.fromEntries(
    doc.entity_types.map((t) => [t.schema["x-type-id"], { next_property_number: 2, count: 0, locked: false }]),
  );
  const changed = structuredClone(doc);
  changed.relations[0].ends[1].type_ref = "other";
  const plan = await resolveModel(
    {
      document: doc,
      types,
      relation_usage: { [doc.relations[0].id]: { links: 1, left_many: false, right_many: false } },
    },
    changed,
    "update",
    actor.userId,
  );
  assertEquals(plan.review.items.find((i) => i.ref === `relation:${doc.relations[0].id}`)?.kind, "conflict");
  assertEquals(plan.review.can_apply, false);
});

Deno.test("identical empty-workspace previews bind copy IDs and review fingerprints to their workspace namespace", async () => {
  const snapshot = { document: empty as DataModelDocument, types: {} };
  const a = await resolveModel(snapshot, example(), "copy", actor.userId);
  const b = await resolveModel(snapshot, example(), "copy", "10000000-0000-4000-8000-000000000002");
  assertEquals(a.review.fingerprint === b.review.fingerprint, false);
  assertEquals(a.review.mapping.types.ingredient === b.review.mapping.types.ingredient, false);
});

Deno.test("referenced per-kind identity sources cannot be removed or rebound during whole-model review", async () => {
  const source = example(), type = source.entity_types[0], ruleId = "20000000-0000-4000-8000-000000000001";
  source.identity_definitions.issuers.push({
    code: "seller",
    label: "Seller",
    active: true,
    system: false,
    version: 1,
  });
  source.identity_definitions.rules.push({
    id: ruleId,
    source: "seller",
    label: "SKU",
    meaning: "Seller SKU",
    generation: "direct",
    active: true,
    version: 1,
  });
  type.identity.sources.push({ code: "seller", rule_id: ruleId, active: true });
  const snapshot = {
    document: source,
    types: { [type.schema["x-type-id"]]: { next_property_number: 2, count: 1, locked: false } },
    identity_usage: { [type.schema["x-type-id"]]: { seller: ruleId } },
  };
  for (const replacement of [false, true]) {
    const target = structuredClone(source);
    if (replacement) {
      const other = {
        ...source.identity_definitions.rules[1],
        id: "20000000-0000-4000-8000-000000000002",
        label: "Other SKU",
      };
      target.identity_definitions.rules.push(other);
      target.entity_types[0].identity.sources[1].rule_id = other.id;
    } else {target.entity_types[0].identity.sources = target.entity_types[0].identity.sources.filter((s) =>
        s.code !== "seller"
      );}
    const review = (await resolveModel(snapshot, target, "update", actor.userId)).review;
    assertEquals(review.items.find((i) => i.ref === type.ref)?.kind, "conflict");
    assertEquals(review.can_apply, false);
  }
  const suspended = structuredClone(source);
  suspended.entity_types[0].identity.sources[1].active = false;
  assertEquals((await resolveModel(snapshot, suspended, "update", actor.userId)).review.can_apply, true);
});

Deno.test("whole model exchange retains selected text annotations on stable properties", async () => {
  const doc = example();
  doc.entity_types[0].schema.properties.prop_1["x-search-text"] = true;
  doc.entity_types[0].schema.properties.prop_3 = {
    type: ["string", "null"],
    "x-order": 30,
    title: "설명",
    "x-search-text": false,
  };
  const first = await resolveModel({ document: empty as DataModelDocument, types: {} }, doc, "update", actor.userId);
  const schema = first.target.entity_types[0].schema;
  assertEquals(schema.properties.prop_1["x-search-text"], true);
  assertEquals(schema.properties.prop_3["x-search-text"], false);
  const imported = parseModel(JSON.stringify(first.target));
  imported.entity_types[0].schema.properties.prop_1.title = "새 이름";
  const types = { [schema["x-type-id"]]: { next_property_number: 4, count: 0, locked: false } };
  const second = await resolveModel({ document: first.target, types }, imported, "update", actor.userId);
  assertEquals(second.target.entity_types[0].schema.properties.prop_1["x-search-text"], true);
  assertEquals(second.target.entity_types[0].schema.properties.prop_1.title, "새 이름");
  assertEquals(second.review.mapping.properties[imported.entity_types[0].ref].prop_1, "prop_1");
});

Deno.test("model copy remaps composed title variables with property keys while preserving literals", async () => {
  const d = example();
  const schema = d.entity_types[0].schema;
  schema.properties = {
    prop_7: schema.properties.prop_1,
    prop_8: schema.properties.prop_2,
    prop_9: { type: "number", "x-order": 30 },
  };
  schema.required = ["prop_7", "prop_8"];
  schema["x-identity-property"] = "prop_8";
  schema["x-title-template"] = "$prop_9$ / ${prop_7$} $$";
  const r = await previewDataModel(deps, actor, { mode: "copy", document: JSON.stringify(d) });
  const copied = r.items.find((i) => i.ref === "ingredient")!.schema!;
  assertEquals(copied["x-title-template"], "$prop_3$ / $prop_1$ $$");
  assertEquals(Object.keys(copied.properties), ["prop_1", "prop_2", "prop_3"]);
});
