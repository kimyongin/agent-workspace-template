import { z } from "zod";
import { businessMeta } from "./change.ts";
import { tagIds } from "./tag.ts";
import { recordResult } from "./record.ts";
import { expectedVersion, id, isoDateTime, page, pageInput, text } from "./common.ts";
import { entityExternalId, entityReferenceId, entitySourceCode } from "./entity-identity.ts";
import { propertyKey } from "./entity-type.ts";
export const entityProperties = z.record(
  propertyKey,
  z.union([z.string(), z.number().finite(), z.boolean(), z.null()]),
);
const schemaVersion = z.number().int().positive();
export const entityCreate = z.strictObject({
  entity_type_id: z.string().uuid(),
  schema_version: schemaVersion,
  properties: entityProperties,
  settings_version: z.number().int().nonnegative().optional(),
  source: entitySourceCode.optional(),
  external_id: entityExternalId.optional(),
  expected_version: expectedVersion.optional(),
  ...businessMeta,
  tag_ids: tagIds.optional(),
});
export const entityUpdate = z.strictObject({
  schema_version: schemaVersion,
  properties: entityProperties.optional(),
  source: entitySourceCode.optional(),
  external_id: entityExternalId.optional(),
  ...businessMeta,
  tag_ids: tagIds.optional(),
  expected_version: expectedVersion,
}).refine(
  (v) =>
    Object.keys(v).some((k) => !["schema_version", "expected_version", "change_note", "change_tag_ids"].includes(k)),
  { message: "바꿀 필드가 없습니다" },
);
export const entityListQuery = z.strictObject({
  entity_type_id: z.string().uuid().optional(),
  tag_id: id.optional(),
  ...pageInput,
  cursor: z.string().min(1).max(2000).optional(),
  keyword: text(1, 100).optional(),
  sort: z.enum(["updated_at", "title"]).default("updated_at"),
});
export const entitySummary = z.object({
  tag_ids: z.array(id),
  id: entityReferenceId,
  source: entitySourceCode,
  external_id: entityExternalId,
  source_label: z.string(),
  deleted_at: isoDateTime.nullable(),
  entity_type_id: z.string().uuid(),
  type: z.object({ id: z.string().uuid(), label: z.string(), icon_id: z.string(), archived: z.boolean() }),
  schema_version: schemaVersion,
  current_schema_version: schemaVersion,
  title: z.string(),
  display_properties: entityProperties,
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
    items: z.array(recordResult.pick({ id: true, body: true, updated_at: true, record_kind: true, occurred_at: true })),
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
