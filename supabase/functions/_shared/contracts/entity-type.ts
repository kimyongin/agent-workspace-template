import type { IdentifierKindMetadata } from "./entity-issuer.ts";
import type { IdentifierFieldSettings } from "./entity-identifiers.ts";
import { z } from "zod";
export const ENTITY_SCHEMA_DIALECT = "https://json-schema.org/draft/2020-12/schema";
export const entityTypeIcons = [
  { id: "box", label: "상자" },
  { id: "leaf", label: "잎" },
  { id: "package", label: "포장" },
  { id: "book", label: "책" },
  { id: "tool", label: "도구" },
  { id: "star", label: "별" },
] as const;
export const defaultEntityTypeIcon = "box";
export function resolvedEntityTypeIcon(id: string) {
  return entityTypeIcons.find((icon) => icon.id === id)?.id ?? defaultEntityTypeIcon;
}
export const entityTypeIcon = z.enum(["box", "leaf", "package", "book", "tool", "star"]);
export const entitySchemaLimits = {
  types: 64,
  fields: 64,
  definition_bytes: 262144,
  properties_bytes: 65536,
  string_length: 4096,
  enum_values: 128,
  integer_abs: Number.MAX_SAFE_INTEGER,
  number_abs: 1e9,
  decimal_places: 6,
  migration_targets: 2000,
  preparation_bytes: 8388608,
  preview_page: 100,
  preview_samples: 20,
  active_jobs_per_type: 1,
  recovery_days: 30,
} as const;
export const entityMigrationStates = [
  "queued",
  "preparing",
  "ready_to_commit",
  "committing",
  "succeeded",
  "failed",
  "cancelled",
] as const;
export const entitySchemaErrorCodes = [
  "schema_changed",
  "schema_plan_stale",
  "schema_migration_required",
  "entity_type_archived",
  "schema_migration_in_progress",
  "entity_type_immutable",
  "migration_source_expired",
] as const;
export const propertyKey = z.string().regex(/^prop_[1-9][0-9]*$/);
const version = z.number().int().positive();
const safeText = (v: string) =>
  !v.includes("\u0000") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(v);
export const entityTypeCreate = z.strictObject({
  label: z.string().trim().min(1).max(80).refine(safeText, "텍스트에 저장할 수 없는 문자가 있습니다"),
  icon_id: entityTypeIcon.default("box"),
  initial_property_label: z.string().trim().min(1).max(80).refine(safeText, "텍스트에 저장할 수 없는 문자가 있습니다")
    .default("이름"),
});
export const entityTypeUpdate = z.strictObject({
  expected_schema_version: version,
  label: entityTypeCreate.shape.label.optional(),
  icon_id: entityTypeIcon.optional(),
  archived: z.boolean().optional(),
}).refine(
  (v) => v.label !== undefined || v.icon_id !== undefined || v.archived !== undefined,
  "변경할 항목이 필요합니다",
);
export const entityTypeList = z.strictObject({
  include_archived: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(100),
  cursor: z.string().max(80).optional(),
});
export const entitySchemaRead = z.strictObject({ type_id: z.string().uuid(), schema_version: version.optional() });
export const entitySchemaHistory = z.strictObject({
  type_id: z.string().uuid(),
  limit: z.number().int().min(1).max(100).default(100),
  before: version.optional(),
});
export type EntityField = {
  type: "string" | "integer" | "number" | "boolean" | Array<"string" | "integer" | "number" | "boolean" | "null">;
  title?: string;
  description?: string;
  format?: "date";
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  oneOf?: Array<{ const: string | null; title?: string }>;
  deprecated?: boolean;
  readOnly?: boolean;
  examples?: Array<string | number | boolean | null>;
  multipleOf?: number;
  "x-order": number;
  "x-search-text"?: boolean;
  "x-identifier"?: IdentifierFieldSettings;
  default?: string | number | boolean | null;
};
/** Search accepts active free text only, including nullable text. */
export function supportsEntitySearchText(field: EntityField): boolean {
  const type = Array.isArray(field.type) ? field.type.find((value) => value !== "null") : field.type;
  return type === "string" && !field.format && !field.oneOf && !field.deprecated && !field["x-identifier"];
}
export type EntitySchema = {
  $schema: typeof ENTITY_SCHEMA_DIALECT;
  "x-type-id": string;
  "x-version": number;
  "x-title-template": string;
  "x-identity-property"?: string;
  /** Absent only on retained historical documents that never captured this metadata. */
  title?: string;
  description?: string;
  "x-icon"?: string;
  deprecated?: boolean;
  type: "object";
  additionalProperties: false;
  properties: Record<string, EntityField>;
  required: string[];
};
export type EntityType = {
  identifier_kinds?: IdentifierKindMetadata[];
  id: string;
  label: string;
  icon_id: string;
  archived: boolean;
  schema_version: number;
  next_property_number: number;
  created_at: string;
  updated_at: string;
};
export type EntitySchemaVersion = {
  identifier_kinds?: IdentifierKindMetadata[];
  type_id: string;
  schema_version: number;
  schema: EntitySchema;
  metadata_missing?: boolean;
  created_at: string;
};
export type EntityTypeRef = Pick<EntityType, "id" | "label" | "icon_id" | "archived">;
export type EntitySchemaRefs = { type_id: string; schema_version: number };
export type EntitySchemaChangeBinding = EntitySchemaRefs & {
  change_id: string;
  change_version: number;
  fingerprint: string;
  reservations: Record<string, string>;
};
export type EntityMigrationBinding = EntitySchemaChangeBinding & {
  preview_id: string;
  target_count: number;
  target_fingerprint: string;
  preparation_bytes: number;
  expires_at: string;
};
export function initialEntityDefinition(
  label: string,
  metadata: { id?: string; title?: string; icon?: string } = {},
): Pick<EntitySchemaVersion, "schema"> {
  return {
    schema: {
      $schema: ENTITY_SCHEMA_DIALECT,
      "x-type-id": metadata.id ?? "00000000-0000-4000-8000-000000000001",
      "x-version": 1,
      "x-title-template": "$prop_1$",
      "x-identity-property": "prop_2",
      title: metadata.title ?? label,
      "x-icon": metadata.icon ?? "box",
      deprecated: false,
      type: "object",
      additionalProperties: false,
      properties: {
        prop_1: {
          type: "string",
          title: label,
          minLength: 1,
          maxLength: 4096,
          "x-order": 10,
        },
        prop_2: {
          type: "string",
          title: "식별자",
          "x-order": 20,
          "x-identifier": {
            allowed_kind_ids: ["00000000-0000-4000-8000-000000000001"],
            default_kind_id: "00000000-0000-4000-8000-000000000001",
          },
        },
      },
      required: ["prop_1", "prop_2"],
    },
  };
}

export const entitySchemaChangeStates = [
  "draft",
  "analyzing",
  "ready",
  "stale",
  "invalid",
  "applied",
  "cancelled",
] as const;
export const entitySchemaChangeKinds = ["compatible", "migration_required", "invalid"] as const;
export const entitySchemaPolicy = {
  compatible: [
    "label",
    "description",
    "order",
    "optional_property",
    "required_to_optional",
    "expand_constraints",
    "add_options",
    "integer_to_number",
  ],
  migration_required: [
    "required_property",
    "type_conversion",
    "shrink_constraints",
    "remove_options",
    "remove_property",
  ],
  forbidden: ["rename_key", "reuse_key", "unsupported_keywords", "change_entity_type"],
} as const;
export type EntitySchemaVersionSummary = Pick<EntitySchemaVersion, "type_id" | "schema_version" | "created_at">;
export type EntitySchemaResult = EntitySchemaVersion & {
  type: EntityTypeRef;
  constraints: typeof entitySchemaLimits;
  policy: typeof entitySchemaPolicy;
};
export type EntityLinkWrite = {
  entity_id: string;
  other_id: string;
  expected_version: number;
  expected_other_version: number;
};
export type EntityLinkResult = { changed: boolean; pair: [string, string]; versions: [number, number] };

/** A view derived from annotations; never a second stored or public definition. */
export function entitySchemaPresentation(schema: EntitySchema) {
  const keys = Object.keys(schema.properties);
  const order = [...keys].sort((a, b) => schema.properties[a]["x-order"] - schema.properties[b]["x-order"]);
  return {
    order,
    archived: keys.filter((k) => schema.properties[k].deprecated),
    option_labels: Object.fromEntries(
      keys.filter((k) => schema.properties[k].oneOf).map(
        (k) => [
          k,
          Object.fromEntries(
            schema.properties[k].oneOf!.filter((o) => o.const !== null).map((o) => [o.const!, o.title ?? o.const!]),
          ),
        ],
      ),
    ),
  };
}
export function entityFieldChoices(field: EntityField): Array<string | null> | undefined {
  return field.oneOf?.map((option) => option.const);
}
