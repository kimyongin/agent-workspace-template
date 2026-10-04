import { z } from "zod";
import { id, requestId, text } from "./common.ts";

export const changeNote = text(1, 1000);
export const mutationMeta = { change_note: changeNote.optional(), request_id: requestId.optional() };
export const editMeta = { change_note: changeNote, request_id: requestId.optional() };
export const changeMetadata = z.object({
  event_id: id,
  target_kind: z.enum(["entity", "task", "record", "principle"]),
  target_id: id,
  target_title: z.string(),
  action: z.enum(["create", "update", "delete", "stop", "resume"]),
  source: z.enum(["http", "mcp"]),
  before: z.record(z.string(), z.unknown()).nullable(),
  after: z.record(z.string(), z.unknown()).nullable(),
  path: z.string().nullable(),
});
export type ChangeMetadata = z.infer<typeof changeMetadata>;
