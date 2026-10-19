import { entityReferenceId } from "./entity-identity.ts";
import { entityContext } from "./entity-links.ts";
import { z } from "zod";
import { tagIds } from "./tag.ts";
import { codePointLength, id, TEXT_LIMITS } from "./common.ts";

export const changeNote = z.string().refine((value) => codePointLength(value) <= TEXT_LIMITS.body.max, {
  message: `${TEXT_LIMITS.body.max}자 이하여야 합니다`,
});
export const mutationMeta = { change_note: changeNote.optional(), change_tag_ids: tagIds.optional() };
export const businessMeta = mutationMeta;
export const changeMetadata = z.object({
  event_id: id,
  target_kind: z.enum(["entity", "task", "record"]),
  target_id: z.union([id, entityReferenceId]),
  target_title: z.string(),
  action: z.enum(["create", "update", "delete", "restore", "stop", "resume"]),
  source: z.enum(["http", "mcp"]),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  path: z.string().nullable(),
  /** Historic display only; the record's singular stored parent controls authorization. */
  target_snapshot: entityContext.optional(),
});
export type ChangeMetadata = z.infer<typeof changeMetadata>;
