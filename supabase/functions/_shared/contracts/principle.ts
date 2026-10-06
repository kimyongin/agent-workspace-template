import { z } from "zod";
import { body, expectedVersion, id, isoDateTime, summary, title } from "./common.ts";
import { changeMemo, mutationMeta } from "./change.ts";
export const principleCreate = z.strictObject({
  id,
  title,
  summary,
  body: body.default(""),
  ...mutationMeta,
  change_memo: changeMemo.optional(),
});
export type PrincipleCreate = z.infer<typeof principleCreate>;
export const principleDelete = z.strictObject({
  expected_version: expectedVersion,
  ...mutationMeta,
  change_memo: changeMemo.optional(),
});
export const principlePreview = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("create"), input: principleCreate.omit({ id: true }) }),
  z.strictObject({
    action: z.literal("update"),
    id,
    input: principleCreate.omit({ id: true }).extend({ expected_version: expectedVersion }),
  }),
  z.strictObject({ action: z.literal("delete"), id, input: principleDelete }),
]);
export type PrinciplePreview = z.infer<typeof principlePreview>;
export const principleUpdate = z.strictObject({
  expected_version: expectedVersion,
  title: title.optional(),
  summary: summary.optional(),
  body: body.optional(),
  ...mutationMeta,
  change_memo: changeMemo.optional(),
}).refine(
  (v) => v.title !== undefined || v.summary !== undefined || v.body !== undefined,
  {
    message: "바꿀 필드가 없습니다",
  },
);
export type PrincipleUpdate = z.infer<typeof principleUpdate>;
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
  version: z.number().int(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});
export type PrincipleResult = z.infer<typeof principleResult>;
export const principleLabels = {
  title: "제목",
  summary: "요약",
  body: "본문",
} as const;
