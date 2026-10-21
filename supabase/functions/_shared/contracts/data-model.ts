import { type EntitySchemaChange, migrationPlan, type SchemaDefinition } from "./entity-schema-change.ts";
import type { EntitySchemaMigration } from "./entity-schema-migration.ts";
import { z } from "zod";
import type { EntitySchema } from "./entity-type.ts";
import type { SchemaDiff } from "./entity-schema-change.ts";
import { issuerCode } from "./entity-issuer.ts";
import { relationEnd } from "./entity-relation.ts";
const version = z.number().int().positive();
export const modelIssuer = z.strictObject({
  code: issuerCode,
  label: z.string().min(1).max(100),
  active: z.boolean(),
  system: z.boolean(),
  version,
});
export const modelRule = z.strictObject({
  id: z.string().uuid(),
  source: issuerCode,
  label: z.string().min(1).max(100),
  meaning: z.string().min(1).max(500),
  generation: z.enum(["automatic", "direct"]),
  active: z.boolean(),
  version,
});
export const modelRelation = z.strictObject({
  id: z.string().uuid(),
  version,
  archived: z.boolean().default(false),
  ends: z.tuple([
    relationEnd.omit({ type_id: true }).extend({ type_ref: z.string().min(1) }),
    relationEnd.omit({ type_id: true }).extend({ type_ref: z.string().min(1) }),
  ]),
});
export const dataModelDocument = z.strictObject({
  format: z.literal("workspace-data-model"),
  format_version: z.literal(1),
  title: z.string().min(1).max(100),
  description: z.string().optional(),
  entity_types: z.array(
    z.strictObject({
      ref: z.string().min(1),
      schema: z.custom<EntitySchema>((v) => !!v && typeof v === "object" && !Array.isArray(v)),
    }),
  ).max(64),
  relations: z.array(modelRelation),
  identity_definitions: z.strictObject({ issuers: z.array(modelIssuer), rules: z.array(modelRule) }),
});
export type DataModelDocument = z.infer<typeof dataModelDocument>;
export const dataModelInput = z.strictObject({ document: z.string().min(1), mode: z.enum(["update", "copy"]) });
export const dataModelPrepare = dataModelInput.extend({
  preview_fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  remove_keys: z.record(z.string(), z.array(z.string().regex(/^prop_[1-9][0-9]*$/))).default({}),
});
export const dataModelAction = z.strictObject({ expected_version: version });
export type ModelItem = {
  ref: string;
  label: string;
  kind: "new" | "unchanged" | "compatible" | "migration_required" | "conflict";
  diff: SchemaDiff[];
  source_type_id?: string;
  source_schema_version?: number;
  source_is_stale?: boolean;
  removed_keys?: string[];
  current_schema_version?: number;
  target_schema_version?: number;
  message?: string;
  schema?: EntitySchema;
  current_schema?: EntitySchema;
  relation_impact?: { links: number; left_many: boolean; right_many: boolean };
};
export type ModelReview = {
  fingerprint: string;
  mode: "update" | "copy";
  title: string;
  items: ModelItem[];
  mapping: {
    types: Record<string, string>;
    rules: Record<string, string>;
    relations: Record<string, string>;
    properties: Record<string, Record<string, string>>;
  };
  can_apply: boolean;
};
export type ModelChange = {
  id: string;
  version: number;
  status:
    | "ready"
    | "needs_conversion"
    | "applied"
    | "cancelled"
    | "analyzing"
    | "queued"
    | "preparing"
    | "ready_to_commit"
    | "committing"
    | "failed";
  group?: {
    children: Array<
      { type_ref: string; change: EntitySchemaChange; source: SchemaDefinition; job?: EntitySchemaMigration | null }
    >;
    total: number;
    processed: number;
    failed: number;
    retryable: boolean;
    failure_reason: string | null;
  };
  review: ModelReview;
  created_at: string;
  result: null | {
    type_ids: string[];
    relation_ids: string[];
    changed?: boolean;
    counts?: {
      types: { added: number; updated: number; unchanged: number };
      relations: { added: number; updated: number; unchanged: number };
      issuers: { added: number; updated: number; unchanged: number };
      rules: { added: number; updated: number; unchanged: number };
    };
  };
};

export const modelGroupAnalyze = dataModelAction.extend({
  conversions: z.array(z.strictObject({ type_ref: z.string().min(1), migration: migrationPlan })).default([]),
});
export type ModelGroupAnalyze = z.infer<typeof modelGroupAnalyze>;
