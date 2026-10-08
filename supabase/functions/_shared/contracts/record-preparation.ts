import { z } from "zod";
import { changeNote } from "./change.ts";
import { tagIds } from "./tag.ts";
import { TEMPLATE_ACTIONS, TEMPLATE_MODELS } from "./record-template.ts";
export const prepareRecordMemo = z.strictObject({
  model: z.enum(TEMPLATE_MODELS),
  operation: z.literal("identity").optional(),
  action: z.enum(TEMPLATE_ACTIONS),
  target_id: z.string().min(1).max(600).optional(),
  expected_version: z.number().int().positive().optional(),
  input: z.record(z.string(), z.unknown()).default({}),
  change_note: changeNote.optional(),
  change_tag_ids: tagIds.optional(),
});
export type PrepareRecordMemo = z.infer<typeof prepareRecordMemo>;
export interface PreparedRecordMemo {
  prepared_input: Record<string, unknown>;
  change_note: string;
  change_tag_ids: string[];
  missing_tag_ids: string[];
  settings_version: number;
}
