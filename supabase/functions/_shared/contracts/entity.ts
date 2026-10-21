import { z } from "zod";
import { businessMeta } from "./change.ts";
import { recordResult } from "./record.ts";
import { codePointLength, expectedVersion, id, isoDateTime, page, pageInput, text } from "./common.ts";
import {
  entityReferenceId,
  entityTypeKey,
} from "./entity-identity.ts";
import { identifierKindId, identifierValue } from "./entity-identifiers.ts";
import { propertyKey } from "./entity-type.ts";
export const entityProperties = z.record(
  propertyKey,
  z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
);
const schemaVersion = z.number().int().positive();
export const entityCreate = z.strictObject({
  entity_type_id: entityTypeKey,
  schema_version: schemaVersion,
  properties: entityProperties,
  generate_identifiers: z.record(propertyKey, identifierKindId).optional(),
  ...businessMeta,
});
export const entityUpdate = z.strictObject({
  schema_version: schemaVersion,
  properties: entityProperties.optional(),
  generate_identifiers: z.record(propertyKey, identifierKindId).optional(),
  ...businessMeta,
  expected_version: expectedVersion,
}).refine(
  (v) =>
    Object.keys(v).some((k) => !["schema_version", "expected_version", "change_note", "change_tag_ids"].includes(k)),
  { message: "바꿀 필드가 없습니다" },
);
export const entityRestore = z.strictObject({
  schema_version: schemaVersion,
  expected_version: expectedVersion,
  properties: entityProperties.optional(),
  ...businessMeta,
});
export const entityLookup = z.strictObject({ entity_type_id: entityTypeKey, identifier: identifierValue });
export type EntityRestore = z.infer<typeof entityRestore>;
export const entityPropertyFilter = z.union([
  z.strictObject({
    key: propertyKey,
    operator: z.enum(["eq", "gt", "gte", "lt", "lte", "contains"]),
    value: z.union([
      z.string().refine((value) => codePointLength(value) <= 4096, "텍스트는 4096자 이하입니다"),
      z.number().finite(),
      z.boolean(),
    ]),
  }),
  z.strictObject({ key: propertyKey, operator: z.literal("unset") }),
]);
export const entityPropertySort = z.strictObject({ key: propertyKey, direction: z.enum(["asc", "desc"]) });
export const entityListQuery = z.strictObject({
  entity_type_id: z.string().uuid().optional(),
  tag_id: id.optional(),
  ...pageInput,
  cursor: z.string().min(1).max(24576).optional(),
  keyword: text(1, 100).optional(),
  filters: z.array(entityPropertyFilter).max(32).optional(),
  sort: z.union([z.enum(["updated_at", "title"]), entityPropertySort]).default("updated_at"),
});
export const entitySummary = z.object({
  tag_ids: z.array(id),
  id: entityReferenceId,
  deleted_at: isoDateTime.nullable(),
  entity_type_id: z.string().uuid(),
  type: z.object({ id: z.string().uuid(), label: z.string(), icon_id: z.string(), archived: z.boolean() }),
  schema_version: schemaVersion,
  current_schema_version: schemaVersion,
  title: z.string(),
  version: z.number().int(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});
const relatedItem = z.object({ id, title: z.string(), updated_at: isoDateTime });
const related = z.object({ count: z.number().int().nonnegative(), items: z.array(relatedItem) });
export const entityDetail = entitySummary.extend({
  properties: entityProperties,
  tasks: related,
  records: related.extend({
    items: z.array(z.object({
      id: recordResult.shape.id,
      body: recordResult.shape.body,
      updated_at: recordResult.shape.updated_at,
      record_kind: recordResult.shape.record_kind,
      occurred_at: recordResult.shape.occurred_at,
    })),
  }),
});
export const entityPage = page(entitySummary);
export type EntityProperties = z.infer<typeof entityProperties>;
export type EntityCreate = z.infer<typeof entityCreate>;
export type EntityUpdate = z.infer<typeof entityUpdate>;
export type EntityQuery = z.infer<typeof entityListQuery>;
export type EntitySummary = z.infer<typeof entitySummary>;
export type EntityDetail = z.infer<typeof entityDetail>;
/** Full write/read values before related previews are loaded. */
export type EntityValues = EntitySummary & { properties: EntityProperties };
