import { z } from "zod";
import { isoDateTime } from "./common.ts";

/** Optional explicit selection, never inferred from memo text. */
import { entityReferenceId, entityReferenceIds } from "./entity-identity.ts";

export const entitySelection = {
  entity_ids: entityReferenceIds.transform((ids) => [...ids].sort()).optional(),
};
export const entityContext = z.object({
  id: entityReferenceId,
  title: z.string(),
  type: z.object({ id: z.string().uuid(), label: z.string(), icon_id: z.string(), archived: z.boolean() }).optional(),
  schema_version: z.number().int().positive().optional(),
  captured_at: isoDateTime,
  source: z.enum(["selection", "legacy_backfill"]),
});
export type EntityContext = z.infer<typeof entityContext>;
