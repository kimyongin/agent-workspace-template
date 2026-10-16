import { z } from "zod";
import { type EntitySchema, type EntityType, propertyKey } from "./entity-type.ts";
import type { EntitySchemaChangeSummary, SchemaDiff } from "./entity-schema-change.ts";
export const entitySchemaImportLimits = { raw_bytes: 2097152, depth: 16 } as const;
const fields = {
  change_id: z.string().uuid().optional(),
  expected_change_version: z.number().int().positive().optional(),
  mode: z.enum(["update", "copy"]),
  document: z.string().min(1).max(entitySchemaImportLimits.raw_bytes),
  type_id: z.string().uuid().optional(),
  expected_schema_version: z.number().int().positive().optional(),
  new_keys: z.array(propertyKey).max(64).default([]),
  remove_keys: z.array(propertyKey).max(64).default([]),
};
function refineScope(
  value: {
    mode: string;
    type_id?: string;
    expected_schema_version?: number;
    change_id?: string;
    expected_change_version?: number;
  },
  ctx: z.RefinementCtx,
) {
  if ((value.change_id === undefined) !== (value.expected_change_version === undefined)) {
    ctx.addIssue({ code: "custom", path: ["change_id"], message: "변경안 ID와 기대 버전을 함께 지정하세요" });
  }
  if (value.mode === "copy" && value.change_id !== undefined) {
    ctx.addIssue({ code: "custom", path: ["change_id"], message: "새 종류 복사는 기존 변경안을 받지 않습니다" });
  }
  if (value.mode === "update" && (!value.type_id || value.expected_schema_version === undefined)) {
    ctx.addIssue({ code: "custom", path: ["type_id"], message: "기존 종류 ID와 검토할 현재 버전이 필요합니다" });
  }
  if (value.mode === "copy" && (value.type_id !== undefined || value.expected_schema_version !== undefined)) {
    ctx.addIssue({
      code: "custom",
      path: ["type_id"],
      message: "새 종류 복사는 기존 대상이나 기대 버전을 받지 않습니다",
    });
  }
}
export const entitySchemaImportPreview = z.strictObject(fields).superRefine(refineScope);
export const entitySchemaImportPrepare = z.strictObject({
  ...fields,
  preview_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
}).superRefine(refineScope);
export type EntitySchemaImportInput = z.infer<typeof entitySchemaImportPreview>;
export type EntitySchemaImportReview = {
  mode: "update" | "copy";
  changed: boolean;
  source_type_id: string;
  source_schema_version: number;
  current_schema_version: number | null;
  source_is_stale: boolean;
  metadata_preserved: boolean;
  key_mapping: Record<string, string>;
  removed_keys: string[];
  diff: SchemaDiff[];
  schema: EntitySchema;
  preview_fingerprint: string;
};
export type EntitySchemaImportResult = Omit<EntitySchemaImportReview, "schema" | "diff"> & {
  schema?: EntitySchema;
  change: EntitySchemaChangeSummary | null;
  type?: EntityType;
};
