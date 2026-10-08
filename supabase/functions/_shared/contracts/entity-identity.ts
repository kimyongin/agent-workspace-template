import { z } from "zod";
import { codePointLength, text } from "./common.ts";

export const entitySourceCode = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/, {
  message: "발급처 코드는 영문 소문자로 시작하는 영문·숫자·_·- 1~32자입니다",
});
export const entityExternalId = z.string().refine((v) => codePointLength(v) >= 1 && codePointLength(v) <= 200, {
  message: "식별자는 1~200자입니다",
}).refine((v) =>
  [...v].every((character) => {
    const point = character.codePointAt(0)!;
    return point >= 32 && !(point >= 127 && point <= 159) && !(point >= 0xd800 && point <= 0xdfff);
  }), {
  message: "식별자에 제어문자나 잘못된 Unicode를 사용할 수 없습니다",
});
export const entityIdentity = z.strictObject({ source: entitySourceCode, external_id: entityExternalId });
/** The restricted source has no colon; splitting at its first colon preserves every external character. */
export function entityId(source: string, external_id: string): string {
  const identity = entityIdentity.parse({ source, external_id });
  return `${identity.source}:${identity.external_id}`;
}
export function splitEntityId(value: string) {
  const colon = value.indexOf(":");
  return entityIdentity.parse({ source: value.slice(0, colon), external_id: value.slice(colon + 1) });
}
export const entityReferenceId = z.string().refine((v) => {
  try {
    const tuple = splitEntityId(v);
    return entityId(tuple.source, tuple.external_id) === v;
  } catch {
    return false;
  }
}, { message: "발급처:식별자 조합이어야 합니다" });
export const entityReferenceIds = z.array(entityReferenceId).max(100).refine(
  (ids) => new Set(ids).size === ids.length,
  {
    message: "중복된 엔터티 참조가 있습니다",
  },
);
export const entityIdentitySettings = z.strictObject({
  generation: z.enum(["manual", "uuid"]),
  default_source: entitySourceCode,
  sources: z.array(z.strictObject({ code: entitySourceCode, label: text(1, 100) })).min(1).max(32),
}).superRefine((v, ctx) => {
  if (new Set(v.sources.map((s) => s.code)).size !== v.sources.length) {
    ctx.addIssue({ code: "custom", path: ["sources"], message: "발급처 코드가 중복되었습니다" });
  }
  if (!v.sources.some((s) => s.code === "app")) {
    ctx.addIssue({ code: "custom", path: ["sources"], message: "앱 발급처는 유지해야 합니다" });
  }
  if (!v.sources.some((s) => s.code === v.default_source)) {
    ctx.addIssue({ code: "custom", path: ["default_source"], message: "등록된 발급처를 선택하세요" });
  }
});
export type EntityIdentitySettings = z.infer<typeof entityIdentitySettings>;
export const defaultEntityIdentitySettings: EntityIdentitySettings = {
  generation: "uuid",
  default_source: "app",
  sources: [{ code: "app", label: "앱" }],
};
export function entityPath(id: string): string {
  return `/entities/${encodeURIComponent(id)}`;
}
export function entityIdentityLabel(value: { source: string; external_id: string; source_label?: string }): string {
  return `${value.source_label ?? value.source} · ${value.external_id}`;
}
