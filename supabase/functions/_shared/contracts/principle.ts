import { z } from "zod";
import { body, expectedVersion, id, isoDateTime, title } from "./common.ts";
import { mutationMeta } from "./change.ts";
export const principleCreate = z.strictObject({
  title,
  body: body.default(""),
  ...mutationMeta,
});
export type PrincipleCreate = z.infer<typeof principleCreate>;
export const principleDelete = z.strictObject({
  expected_version: expectedVersion,
  ...mutationMeta,
});
export const principleUpdate = z.strictObject({
  expected_version: expectedVersion,
  title: title.optional(),
  body: body.optional(),
  ...mutationMeta,
}).refine(
  (v) => v.title !== undefined || v.body !== undefined,
  {
    message: "바꿀 필드가 없습니다",
  },
);
export type PrincipleUpdate = z.infer<typeof principleUpdate>;
export const principleResult = z.object({
  id,
  title: z.string(),
  body: z.string(),
  is_current: z.boolean(),
  saved_at: isoDateTime,
  origin: z.enum(["saved", "legacy"]),
  legacy_context: z.record(z.string(), z.unknown()).nullable(),
  version: z.number().int(),
  created_at: isoDateTime,
  updated_at: isoDateTime,
});
export type PrincipleResult = z.infer<typeof principleResult>;
export const principleLabels = {
  title: "제목",
  body: "본문",
} as const;
