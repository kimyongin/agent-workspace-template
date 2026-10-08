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
  captured_at: isoDateTime,
  source: z.enum(["selection", "legacy_backfill"]),
});
export type EntityContext = z.infer<typeof entityContext>;
