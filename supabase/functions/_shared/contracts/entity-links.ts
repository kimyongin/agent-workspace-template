import { z } from "zod";
import { id, isoDateTime, referenceIds } from "./common.ts";

/** Optional explicit selection, never inferred from memo text. */
export const entitySelection = {
  entity_ids: referenceIds.transform((ids) => [...ids].sort()).optional(),
};
export const entityContext = z.object({
  id,
  title: z.string(),
  captured_at: isoDateTime,
  source: z.enum(["selection", "legacy_backfill"]),
});
export type EntityContext = z.infer<typeof entityContext>;
