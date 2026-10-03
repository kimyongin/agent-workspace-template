import { z } from "zod";
import { body, id, isoDateTime, page, pageInput, requestId, summary, text, title } from "./common.ts";

export const principleCreate = z.strictObject({
  title,
  summary,
  body: body.default(""),
  applies_when: text(0, 300).default(""),
  request_id: requestId.optional(),
});
export type PrincipleCreate = z.infer<typeof principleCreate>;
export const principleListQuery = z.strictObject({
  status: z.enum(["active", "inactive"]).default("active"),
  ...pageInput,
});
export type PrincipleListQuery = z.infer<typeof principleListQuery>;
export const principleResult = z.object({
  id,
  title: z.string(),
  summary: z.string(),
  body: z.string(),
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
  active: "활성",
  inactive: "비활성",
} as const;
