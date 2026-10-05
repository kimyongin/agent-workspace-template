import { z } from "zod";
import { body, expectedVersion, id, isoDateTime, page, pageInput, summary, title } from "./common.ts";
import { changeMemo, editMeta, mutationMeta } from "./change.ts";
export const principleCreate = z.strictObject({
  title,
  summary,
  body: body.default(""),
  ...mutationMeta,
  change_memo: changeMemo.optional(),
});
export type PrincipleCreate = z.infer<typeof principleCreate>;
export const principleSave = principleCreate.extend({ expected_version: expectedVersion.optional() });
export type PrincipleSave = z.infer<typeof principleSave>;
export const principleDelete = z.strictObject({
  expected_version: expectedVersion,
  ...mutationMeta,
  change_memo: changeMemo.optional(),
});
export const principlePreview = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), input: principleCreate }),
  z.strictObject({
    action: z.literal("update"),
    id,
    input: principleSave.extend({ expected_version: expectedVersion }),
  }),
  z.strictObject({ action: z.literal("delete"), id, input: principleDelete }),
]);
export type PrinciplePreview = z.infer<typeof principlePreview>;
export const principleCorrection = z.strictObject({
  expected_version: expectedVersion,
  title: title.optional(),
  summary: summary.optional(),
  body: body.optional(),
  ...editMeta,
});
export type PrincipleCorrection = z.infer<typeof principleCorrection>;
export const principleUpdate = principleCorrection.extend({
  change_note: mutationMeta.change_note,
  change_memo: changeMemo.optional(),
}).refine(
  (v) => v.title !== undefined || v.summary !== undefined || v.body !== undefined,
  {
    message: "바꿀 필드가 없습니다",
  },
);
export type PrincipleUpdate = z.infer<typeof principleUpdate>;
export const principleStatus = z.strictObject({
  expected_version: expectedVersion,
  status: z.enum(["active", "inactive"]),
  replaced_by_id: id.nullable().optional(),
});
export type PrincipleStatus = z.infer<typeof principleStatus>;
export const principleListQuery = z.strictObject({
  view: z.enum(["current", "history", "all"]).default("current"),
  ...pageInput,
});
export type PrincipleListQuery = z.infer<typeof principleListQuery>;
export const principleResult = z.object({
  id,
  title: z.string(),
  summary: z.string(),
  body: z.string(),
  is_current: z.boolean(),
  saved_at: isoDateTime,
  change_note: z.string().nullable(),
  origin: z.enum(["saved", "legacy"]),
  legacy_context: z.record(z.string(), z.unknown()).nullable(),
  entity_id: id.nullable(),
  tag_ids: z.array(id),
  applies_when: z.string(),
  status: z.enum(["active", "inactive"]),
  replaced_by_id: id.nullable(),
  version: z.number().int(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});
export type PrincipleResult = z.infer<typeof principleResult>;
export const principlePage = page(principleResult);
export const principleLabels = {
  title: "제목",
  summary: "요약",
  body: "본문",
  applies_when: "적용 조건",
  active: "현재",
  inactive: "과거",
} as const;
