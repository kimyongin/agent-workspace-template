import { assert, assertEquals } from "@std/assert";
import {
  migrationRecordRenderer,
  type MigrationWorkerBatch,
  prepareMigrationBatch,
} from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { effectiveEntityTemplateFingerprint } from "../../functions/_shared/core/entity-types/template-references.ts";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
Deno.test("migration preparation preserves explicit values, shared template/hash semantics and bounded output", async () => {
  const source = initialEntityDefinition("Name"), target = structuredClone(source);
  target.schema.properties.prop_2 = { type: "integer", title: "수량" };
  target.schema.required.push("prop_2");
  target.display.order.push("prop_2");
  const templates = {
    entity: { update: { memo: "$엔터티.이후.prop_2$ · $엔터티.이전.제목$", tag_ids: ["one", "missing"] } },
  };
  const batch: MigrationWorkerBatch = {
    id: crypto.randomUUID(),
    owner_id: crypto.randomUUID(),
    type_id: crypto.randomUUID(),
    fence: 1,
    status: "preparing",
    source_schema_version: 1,
    target,
    source_definition: source,
    migration: { rules: [{ op: "fill", key: "prop_2", value: 0, include_null: false }], overrides: [] },
    source_template_fingerprint: "",
    templates,
    available_tags: ["one"],
    type: { id: "type", label: "材料", icon_id: "leaf", archived: false },
    rows: [{
      entity_id: "app:😀/?",
      properties: { prop_1: "원본" },
      after: { prop_1: "원본", prop_2: 0 },
      source: "app",
      external_id: "😀/?",
      tag_ids: [],
      changed: true,
    }],
  };
  batch.source_template_fingerprint = await effectiveEntityTemplateFingerprint(templates, batch.type_id);
  const output = await prepareMigrationBatch(batch, new Date("2026-10-12T00:00:00Z"));
  assert(!output.stale);
  assertEquals(output.results[0].record_body, "0 · 원본");
  assertEquals(output.results[0].record_tags, ["one"]);
  assertEquals(output.results[0].record_path, "/entities/app%3A%F0%9F%98%80%2F%3F");
  assertEquals(output.results[0].record_context[0].schema_version, 2);
  assertEquals(output.results[0].record_context[0].title, "원본");
  assertEquals(output.results[0].after, { prop_1: "원본", prop_2: 0 });
  const unchanged = migrationRecordRenderer(batch, new Date("2026-10-12T00:00:00Z"))({
    ...batch.rows[0],
    changed: false,
  });
  assertEquals(unchanged.record_body, null);
  assertEquals(unchanged.record_tags, []);
  assertEquals(unchanged.record_context, [{
    id: "app:😀/?",
    title: "원본",
    type: batch.type,
    schema_version: 2,
    captured_at: "2026-10-12T00:00:00.000Z",
    source: "selection",
  }]);
  const stale = await prepareMigrationBatch({ ...batch, source_template_fingerprint: "not the same" });
  assert(stale.stale);
  assertEquals(stale.results, []);
  const large = { entity: { update: { memo: "한".repeat(18000), tag_ids: [] } } },
    largeBatch = {
      ...batch,
      templates: large,
      source_template_fingerprint: await effectiveEntityTemplateFingerprint(large, batch.type_id),
      rows: Array.from({ length: 50 }, (_, i) => ({ ...batch.rows[0], entity_id: `app:${i}` })),
    };
  const bounded = await prepareMigrationBatch(largeBatch);
  assert(!bounded.stale);
  assert(bounded.results.length > 0 && bounded.results.length < 50);
  assert(new TextEncoder().encode(JSON.stringify(bounded.results)).length <= 524288);
});
