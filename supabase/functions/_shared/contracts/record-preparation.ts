import { tagConnectionSelection } from "./tag-connection.ts";
import { z } from "zod";
import { changeNote } from "./change.ts";
import { tagIds } from "./tag.ts";
import { TEMPLATE_ACTIONS, TEMPLATE_MODELS } from "./record-template.ts";
export const prepareRecordMemo = z.strictObject({
  intent: z.enum(["content", "tag-connections"]).default("content"),
  model: z.enum(TEMPLATE_MODELS),
  action: z.enum(TEMPLATE_ACTIONS),
  target_id: z.string().min(1).max(600).optional(),
  expected_version: z.number().int().positive().optional(),
  input: z.record(z.string(), z.unknown()).default({}),
  change_note: changeNote.optional(),
  change_tag_ids: tagIds.optional(),
}).superRefine((value, ctx) => {
  if (value.intent !== "tag-connections") return;
  if (value.action !== "update" || !value.target_id || !value.expected_version) {
    ctx.addIssue({ code: "custom", message: "저장된 자료나 할 일의 태그 연결만 준비할 수 있습니다" });
  }
  const selection = tagConnectionSelection.safeParse(value.input);
  if (!selection.success) {
    for (const issue of selection.error.issues) ctx.addIssue({ ...issue, path: ["input", ...issue.path] });
  }
});
export type PrepareRecordMemo = z.input<typeof prepareRecordMemo>;
export interface PreparedRecordMemo {
  prepared_input: Record<string, unknown>;
  /** Preview includes pending identifier issuance; render the untouched memo again after saving. */
  pending_entity_id?: true;
  change_note: string;
  change_tag_ids: string[];
  missing_tag_ids: string[];
  settings_version: number;
}
