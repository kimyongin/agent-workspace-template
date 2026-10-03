import { z } from "zod";
import { body, expectedVersion, id, isoDateTime, page, pageInput, requestId, summary, text, title } from "./common.ts";

export const principleCreate = z.strictObject({
  title,
  summary,
  body: body.default(""),
  applies_when: text(0, 300).default(""),
  request_id: requestId.optional(),
});
export type PrincipleCreate = z.infer<typeof principleCreate>;
export const principleUpdate = z.strictObject({
  expected_version: expectedVersion,
  title: title.optional(),
  summary: summary.optional(),
  body: body.optional(),
  applies_when: text(0, 300).optional(),
}).refine((v) => Object.keys(v).some((k) => k !== "expected_version"), { message: "바꿀 필드가 없습니다" });
export type PrincipleUpdate = z.infer<typeof principleUpdate>;
export const principleStatus = z.strictObject({
  expected_version: expectedVersion,
  status: z.enum(["active", "inactive"]),
  replaced_by_id: id.nullable().optional(),
}).refine((v) => v.status !== "active" || !v.replaced_by_id, {
  message: "활성 원칙에는 대체 원칙을 지정할 수 없습니다",
  path: ["replaced_by_id"],
});
export type PrincipleStatus = z.infer<typeof principleStatus>;
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
