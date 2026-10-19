import { z } from "zod";
import { expectedVersion, id, isoDateTime } from "./common.ts";
import { mutationMeta } from "./change.ts";
import { entityReferenceId } from "./entity-identity.ts";
import { tagIds } from "./tag.ts";

/** Only the links on an already saved target are replaced by this command. */
export const tagConnectionSelection = z.strictObject({ tag_ids: tagIds });
const saved = { expected_version: expectedVersion, ...tagConnectionSelection.shape };
export const tagConnectionInput = z.discriminatedUnion("target_kind", [
  z.strictObject({ target_kind: z.literal("entity"), target_id: entityReferenceId, ...saved, ...mutationMeta }),
  z.strictObject({ target_kind: z.literal("task"), target_id: id, ...saved, ...mutationMeta }),
  z.strictObject({ target_kind: z.literal("record"), target_id: id, ...saved }),
]);
export const tagConnectionResult = z.strictObject({
  tag_ids: tagIds,
  version: expectedVersion,
  updated_at: isoDateTime,
});
export type TagConnectionInput = z.infer<typeof tagConnectionInput>;
export type TagConnectionResult = z.infer<typeof tagConnectionResult>;
