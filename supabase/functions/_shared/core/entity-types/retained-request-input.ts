import {
  retainedTitleTypeCreate,
  schemaChangeCreate as retainedTitleChangeCreate,
  schemaChangeUpdate as retainedTitleChangeUpdate,
} from "./retained-title-input.ts";
import { entityReferenceId } from "../../contracts/entity-identity.ts";
import { optionLabelDictionary, ownStringDictionary } from "../../contracts/option-labels.ts";
import { z } from "zod";
import { entityTypeCreate, entityTypeIcon, propertyKey } from "../../contracts/entity-type.ts";
const scalar = z.enum(["string", "integer", "number", "boolean"]);
const entityFieldInput = z.strictObject({
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
// new_<client_ref> is valid in display/conversion input alongside its add_property.
// Published definitions and all other property-key contracts remain prop_n only.
const propertyInputReference = z.union([propertyKey, z.string().startsWith("new_").min(5).max(84)]);
const displayInput = z.strictObject({
  representative: propertyInputReference,
  order: z.array(propertyInputReference).max(64),
  list_columns: z.array(propertyInputReference).max(64),
  archived: z.array(propertyInputReference).max(64),
  option_labels: z.record(propertyInputReference, optionLabelDictionary),
});
const entitySchemaEdit = z.discriminatedUnion("op", [
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
const literal = z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()]);
const migrationRule = z.discriminatedUnion("op", [
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
const migrationOverride = z.strictObject({
  entity_id: entityReferenceId,
  key: propertyKey,
  value: literal,
});
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
const schemaChangeCreate = z.strictObject({
  expected_type_version: z.number().int().positive(),
  expected_schema_version: z.number().int().positive(),
  edits: z.array(entitySchemaEdit).min(1).max(128),
  migration: migrationInput.default({ rules: [], overrides: [] }),
});
const schemaChangeUpdate = schemaChangeCreate.extend({ expected_change_version: z.number().int().positive() });
const retainedTypeUpdate = z.strictObject({
  expected_type_version: z.number().int().positive(),
  expected_schema_version: z.number().int().positive().optional(),
  label: entityTypeCreate.shape.label.optional(),
  icon_id: entityTypeIcon.optional(),
  archived: z.boolean().optional(),
}).refine((v) => v.label !== undefined || v.icon_id !== undefined || v.archived !== undefined);
const retainedMigrationStart = z.strictObject({
  expected_change_version: z.number().int().positive(),
  expected_type_version: z.number().int().positive(),
  expected_schema_version: z.number().int().positive(),
  analysis_id: z.string().uuid(),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
const retainedRecovery = z.strictObject({
  expected_job_version: z.number().int().positive(),
  expected_type_version: z.number().int().positive(),
  expected_schema_version: z.number().int().positive(),
});
/** Only a decoder for the exact fingerprints of retained completed requests. Never execute this input. */
export function retainedSchemaRequestInput(operation: string, raw: unknown) {
  const parsers: Record<string, z.ZodType> = {
    "entity-type.update": retainedTypeUpdate,
    "entity-schema-change.create": schemaChangeCreate,
    "entity-schema-change.update": schemaChangeUpdate,
    "entity-schema-migration.start": retainedMigrationStart,
    "entity-schema-migration.recovery": retainedRecovery,
  };
  return parsers[operation]?.safeParse(raw);
}

/** Distinct input generations retain their own normalization and defaults. */
export function retainedSchemaRequestInputs(operation: string, raw: unknown): unknown[] {
  const candidates = [retainedSchemaRequestInput(operation, raw)];
  const titleParsers: Record<string, z.ZodType> = {
    "entity-type.create": retainedTitleTypeCreate,
    "entity-schema-change.create": retainedTitleChangeCreate,
    "entity-schema-change.update": retainedTitleChangeUpdate,
  };
  candidates.push(titleParsers[operation]?.safeParse(raw));
  return candidates.flatMap((result) => result?.success ? [result.data] : []);
}
