import { z } from "zod";
import { type EntityDisplay, type EntityField, type EntitySchemaVersion, propertyKey } from "./entity-type.ts";
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
  enum: z.array(z.union([z.string().max(4096), z.null()])).min(1).max(128).optional(),
  default: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]).optional(),
});
const displayInput = z.strictObject({
  representative: propertyKey,
  order: z.array(propertyKey).max(64),
  list_columns: z.array(propertyKey).max(64),
  archived: z.array(propertyKey).max(64),
  option_labels: z.record(propertyKey, z.record(z.string(), z.string().min(1).max(80))),
});
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
  z.strictObject({ op: z.literal("set_display"), display: displayInput }),
]);
export const schemaChangeCreate = z.strictObject({
  expected_type_version: z.number().int().positive(),
  expected_schema_version: z.number().int().positive(),
  edits: z.array(entitySchemaEdit).min(1).max(128),
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
  processed: number;
  failed: number;
  errors: Array<{ entity_id: string; fields: Array<{ path: string; message: string }> }>;
  created_at: string;
};
export type EntitySchemaChange = {
  id: string;
  type_id: string;
  source_type_version: number;
  source_schema_version: number;
  source_template_version: number;
  version: number;
  status: "draft" | "analyzing" | "ready" | "stale" | "invalid" | "applied" | "cancelled";
  change_kind: "compatible" | "migration_required";
  edits: SchemaEdit[];
  reservations: Record<string, string>;
  target: Pick<EntitySchemaVersion, "schema" | "display">;
  diff: SchemaDiff[];
  fingerprint: string;
  analysis: SchemaAnalysis | null;
  created_at: string;
  updated_at: string;
};
export type SchemaDefinition = Pick<EntitySchemaVersion, "schema" | "display">;
export type PropertyField = EntityField;
export type PropertyDisplay = EntityDisplay;

export type SchemaAnalysisAccepted = {
  type_id: string;
  change_id: string;
  change_version: number;
  analysis_id: string;
  status: "queued";
};

export type EntitySchemaChangeSummary = Pick<
  EntitySchemaChange,
  "id" | "type_id" | "version" | "status" | "change_kind" | "created_at" | "updated_at"
>;
