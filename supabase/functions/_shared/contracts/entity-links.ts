import { z } from "zod";
import { id, isoDateTime, referenceIds } from "./common.ts";

/** Optional selection, never inferred from memo text. Single-target alias remains until consumer migration. */
export const entitySelection = {
  entity_id: id.nullable().optional(),
  entity_ids: referenceIds.transform((ids) => [...ids].sort()).optional(),
};
export function consistentEntities(value: { entity_id?: string | null; entity_ids?: string[] }) {
  return value.entity_ids === undefined || value.entity_id === undefined ||
    value.entity_id === (value.entity_ids[0] ?? null);
}
export const entitySelectionError = { message: "entity_id와 entity_ids의 조건이 서로 다릅니다", path: ["entity_ids"] };
export const entityContext = z.object({
  id,
  title: z.string(),
  captured_at: isoDateTime,
  source: z.enum(["selection", "legacy_backfill"]),
});
export type EntityContext = z.infer<typeof entityContext>;
