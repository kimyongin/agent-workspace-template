import { decodeIdentifierReference } from "../../contracts/entity-identifiers.ts";
import { renderEntityTitle } from "../../contracts/entity-title-template.ts";
import { invalidInput } from "../shared/errors.ts";
import { compileMigration } from "./conversions.ts";
import { effectiveEntityTemplateFingerprint } from "./template-references.ts";
import { changeDefaults } from "../settings/change-defaults.ts";
import { searchInputHash } from "../shared/operations.ts";
import type { MigrationPlan, SchemaDefinition } from "../../contracts/entity-schema-change.ts";
import type { EntityTemplateSnapshot } from "../../contracts/record-template.ts";
import type { EntityTypeRef } from "../../contracts/entity-type.ts";
import type { ChangeFacts, ChangeInput } from "../shared/changes.ts";
import { canonical } from "./evolution.ts";
export type MigrationWorkerBatch = {
  id: string;
  workspace_id: string;
  initiated_by: string;
  workspace_generation: number;
  type_id: string;
  fence: number;
  status: string;
  source_schema_version: number;
  target: SchemaDefinition;
  source_definition: SchemaDefinition;
  migration: MigrationPlan;
  recovery_keys?: string[] | null;
  source_template_fingerprint: string;
  templates: EntityTemplateSnapshot;
  available_tags: string[];
  type: EntityTypeRef;
  rows: Array<
    {
      entity_id: string;
      properties: Record<string, string | number | boolean | null>;
      after: Record<string, string | number | boolean | null>;
      tag_ids: string[];
      changed: boolean;
      recovery_properties?: Record<string, unknown> | null;
    }
  >;
};
export function migrationRecordRenderer(
  batch: Pick<
    MigrationWorkerBatch,
    "type_id" | "source_schema_version" | "target" | "source_definition" | "templates" | "available_tags" | "type"
  >,
  now: Date,
) {
  const labels = (definition: SchemaDefinition) =>
    Object.fromEntries(Object.entries(definition.schema.properties).map(([key, field]) => [key, field.title ?? key]));
  const beforeLabels = labels(batch.source_definition), afterLabels = labels(batch.target);
  return (row: MigrationWorkerBatch["rows"][number]) => {
    const facts = (properties: typeof row.properties, definition: SchemaDefinition): ChangeFacts => ({
      entity_type_id: batch.type_id,
      properties,
      tag_ids: row.tag_ids,
      title: renderEntityTitle(definition.schema, properties, decodeIdentifierReference(row.entity_id).raw),
      property_labels: definition === batch.source_definition ? beforeLabels : afterLabels,
    });
    const title = renderEntityTitle(batch.target.schema, row.after, decodeIdentifierReference(row.entity_id).raw);
    const context = [{
      id: row.entity_id,
      title,
      type: batch.type,
      schema_version: batch.source_schema_version + 1,
      captured_at: now.toISOString(),
      source: "selection" as const,
    }];
    const input: ChangeInput = {
      target_kind: "entity",
      action: "update",
      target: { id: row.entity_id, title },
      before: facts(row.properties, batch.source_definition),
      after: facts(row.after, batch.target),
    };
    const memo = row.changed
      ? changeDefaults(
        input,
        { record_templates: { entity_types: { [batch.type_id]: batch.templates.entity } } },
        batch.available_tags,
      )
      : null;
    return { record_body: memo?.change_note ?? null, record_context: context, record_tags: memo?.change_tag_ids ?? [] };
  };
}
/** This public preparation boundary shares conversion, memo and index-hash semantics with ordinary writes. */
export async function prepareMigrationBatch(batch: MigrationWorkerBatch, now: Date, budgetMs = 2000) {
  const started = performance.now();
  const fingerprint = await effectiveEntityTemplateFingerprint({
    entity_types: { [batch.type_id]: batch.templates.entity },
  }, batch.type_id);
  if (fingerprint !== batch.source_template_fingerprint) return { stale: true as const, results: [] };
  const convert = compileMigration(batch.target, batch.migration, batch.recovery_keys);
  const renderRecord = migrationRecordRenderer(batch, now);
  const results = [];
  let bytes = 2;
  for (const row of batch.rows.slice(0, 50)) {
    if (results.length && performance.now() - started >= budgetMs) break;
    const value = convert(row.entity_id, row.properties, row.recovery_properties);
    if (value.errors.length || canonical(value.after) !== canonical(row.after) || value.changed !== row.changed) {
      throw new Error("Migration analysis disagrees with preparation");
    }
    const record = renderRecord(row);
    const result = {
      entity_id: row.entity_id,
      after: row.after,
      changed: row.changed,
      ...record,
      record_hash: record.record_body !== null ? await searchInputHash(record.record_body) : null,
      record_path: `/entities/${encodeURIComponent(row.entity_id)}`,
    };
    const size = new TextEncoder().encode(JSON.stringify(result)).length + (results.length ? 1 : 0);
    if (bytes + size > 524288) {
      if (!results.length) throw invalidInput("값 변환 준비 결과의 배치 한도를 넘었습니다");
      break;
    }
    results.push(result);
    bytes += size;
  }
  return { stale: false as const, results };
}
