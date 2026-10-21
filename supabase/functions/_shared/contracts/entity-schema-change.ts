import { entityReferenceId } from "./entity-identity.ts";
import { ownStringDictionary } from "./option-labels.ts";
import { z } from "zod";
import { type EntityField, type EntitySchemaVersion, propertyKey } from "./entity-type.ts";
const scalar = z.enum(["string", "integer", "number", "boolean"]);
export const entityFieldInput = z.strictObject({
  type: z.union([scalar, z.array(z.union([scalar, z.literal("null")])).min(2).max(2)]),
  title: z.string().max(80).optional(),
  description: z.string().max(1000).optional(),
  format: z.literal("date").optional(),
  minLength: z.number().int().min(0).max(4096).optional(),
  maxLength: z.number().int().min(0).max(4096).optional(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  oneOf: z.array(
    z.strictObject({ const: z.union([z.string().max(4096), z.null()]), title: z.string().max(80).optional() }),
  ).min(1).max(128).optional(),
  deprecated: z.boolean().optional(),
  readOnly: z.boolean().optional(),
  examples: z.array(z.union([z.string(), z.number().finite(), z.boolean(), z.null()])).max(128).optional(),
  multipleOf: z.number().positive().finite().optional(),
  "x-order": z.number().int().positive(),
  "x-search-text": z.boolean().optional(),
  default: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]).optional(),
});
// new_<client_ref> is valid in display/conversion input alongside its add_property.
// Published definitions and all other property-key contracts remain prop_n only.
const propertyInputReference = z.union([propertyKey, z.string().startsWith("new_").min(5).max(84)]);
export const entitySchemaEdit = z.discriminatedUnion("op", [
  z.strictObject({
    op: z.literal("add_property"),
    client_ref: z.string().min(1).max(80).refine(
      (v) => !v.includes("\u0000") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v),
      "추가 참조에 저장할 수 없는 문자가 있습니다",
    ),
    field: entityFieldInput,
    required: z.boolean().default(false),
  }),
  z.strictObject({
    op: z.literal("update_property"),
    key: propertyKey,
    field: entityFieldInput,
    required: z.boolean(),
  }),
  z.strictObject({ op: z.literal("archive_property"), key: propertyKey }),
  z.strictObject({ op: z.literal("restore_property"), key: propertyKey }),
  z.strictObject({ op: z.literal("remove_property"), key: propertyKey }),
  z.strictObject({
    op: z.literal("set_metadata"),
    title: z.string().trim().min(1).max(80).optional(),
    description: z.string().max(1000).nullable().optional(),
    "x-title-template": z.string().refine(
      (value) => Array.from(value).length <= 4096,
      "제목 템플릿은 4096자 이하입니다",
    ).optional(),
    "x-icon": z.enum(["box", "leaf", "package", "book", "tool", "star"]).optional(),
    deprecated: z.boolean().optional(),
  }),
]);
const literal = z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()]);
export const migrationRule = z.discriminatedUnion("op", [
  z.strictObject({ op: z.literal("convert"), key: propertyKey, to: z.enum(["string", "integer", "number", "date"]) }),
  z.strictObject({
    op: z.literal("map"),
    key: propertyKey,
    mapping: ownStringDictionary(z.string().max(4096)),
    identity: z.boolean().default(false),
  }),
  z.strictObject({ op: z.literal("fill"), key: propertyKey, value: literal, include_null: z.boolean().default(false) }),
  z.strictObject({ op: z.literal("remove"), key: propertyKey }),
  z.strictObject({ op: z.literal("replace_failure"), key: propertyKey, value: literal }),
]);
export const migrationOverride = z.strictObject({
  entity_id: entityReferenceId,
  key: propertyKey,
  value: literal,
});
export const migrationPlan = z.strictObject({
  rules: z.array(migrationRule).max(128).default([]),
  overrides: z.array(migrationOverride).max(2000).default([]),
});
export const schemaAnalysisRows = z.strictObject({
  analysis_id: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(20),
  after: entityReferenceId.optional(),
  failures_only: z.boolean().default(false),
});
export type MigrationPlan = z.infer<typeof migrationPlan>;
export type SchemaAnalysisRow = {
  entity_id: string;
  before: Record<string, unknown>;
  after: Record<string, unknown> | null;
  after_bytes: number;
  changed: boolean;
  removed: number;
  replacements: number;
  errors: Array<{ path: string; message: string }>;
};
export type SchemaAnalysisPage = { analysis_id: string; items: SchemaAnalysisRow[]; next_after: string | null };
const migrationInput = z.strictObject({
  rules: z.array(z.discriminatedUnion("op", [
    migrationRule.options[0].extend({ key: propertyInputReference }),
    migrationRule.options[1].extend({ key: propertyInputReference }),
    migrationRule.options[2].extend({ key: propertyInputReference }),
    migrationRule.options[3].extend({ key: propertyInputReference }),
    migrationRule.options[4].extend({ key: propertyInputReference }),
  ])).max(128).default([]),
  overrides: z.array(migrationOverride.extend({ key: propertyInputReference })).max(2000).default([]),
});
export const schemaChangeCreate = z.strictObject({
  expected_schema_version: z.number().int().positive(),
  edits: z.array(entitySchemaEdit).min(1).max(129),
  migration: migrationInput.default({ rules: [], overrides: [] }),
});
export const schemaChangeUpdate = schemaChangeCreate.extend({ expected_change_version: z.number().int().positive() });
export const schemaChangeAction = z.strictObject({ expected_change_version: z.number().int().positive() });
export const schemaChangeApply = schemaChangeAction.extend({ analysis_id: z.string().uuid() });
export const schemaChangeList = z.strictObject({
  limit: z.number().int().min(1).max(100).default(20),
  before: z.string().uuid().optional(),
});
export type SchemaEdit = z.infer<typeof entitySchemaEdit>;
export type SchemaDiff = {
  path: string;
  before: unknown;
  before_present: boolean;
  after_present: boolean;
  after: unknown;
  kind: "compatible" | "migration_required";
  reason: string;
  next_action: string;
};
export type SchemaAnalysis = {
  id: string;
  change_version: number;
  status: "queued" | "running" | "succeeded" | "failed";
  total: number;
  snapshot_fingerprint: string;
  definition_fingerprint: string;
  processed: number;
  failed: number;
  changed: number;
  unchanged: number;
  removed: number;
  replacements: number;
  retryable: boolean;
  failure_reason: string | null;
  errors: Array<{ entity_id: string; fields: Array<{ path: string; message: string }> }>;
  created_at: string;
};
export type EntitySchemaChange = {
  id: string;
  type_id: string;
  source_schema_version: number;
  source_template_fingerprint: string;
  version: number;
  status: "draft" | "analyzing" | "ready" | "stale" | "invalid" | "applied" | "cancelled";
  change_kind: "compatible" | "migration_required";
  edits: SchemaEdit[];
  migration: MigrationPlan;
  recovery?: { source_job_id: string; source_expires_at: string } | null;
  executable: boolean;
  reservations: Record<string, string>;
  target: Pick<EntitySchemaVersion, "schema">;
  diff: SchemaDiff[];
  fingerprint: string;
  analysis: SchemaAnalysis | null;
  created_at: string;
  updated_at: string;
};
export type SchemaDefinition = Pick<EntitySchemaVersion, "schema">;
export type PropertyField = EntityField;

export type SchemaAnalysisAccepted = {
  type_id: string;
  change_id: string;
  change_version: number;
  analysis_id: string;
  status: "queued";
};

export type EntitySchemaChangeSummary = Pick<
  EntitySchemaChange,
  "id" | "type_id" | "source_schema_version" | "version" | "status" | "change_kind" | "created_at" | "updated_at"
>;
