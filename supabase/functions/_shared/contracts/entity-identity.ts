import { z } from "zod";
import { codePointLength } from "./common.ts";

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
export const entityTypeKey = z.string().uuid().transform((v) => v.toLowerCase());
export const entityNumberInput = entityExternalId.refine((v) => v.trim() === v, {
  message: "번호 앞뒤에 공백을 사용할 수 없습니다",
});
export const entityIdentity = z.strictObject({
  source: entitySourceCode,
  entity_type_id: entityTypeKey,
  external_id: entityExternalId,
});
/** Fixed source/type segments precede the entire unchanged raw number. */
export function entityId(source: string, entity_type_id: string, external_id: string): string {
  const identity = entityIdentity.parse({ source, entity_type_id, external_id });
  return `${identity.source}:${identity.entity_type_id}:${identity.external_id}`;
}
export function splitEntityId(value: string) {
  const first = value.indexOf(":"), second = value.indexOf(":", first + 1);
  return entityIdentity.parse({
    source: value.slice(0, first),
    entity_type_id: value.slice(first + 1, second),
    external_id: value.slice(second + 1),
  });
}
export const entityReferenceId = z.string().refine((v) => {
  try {
    const tuple = splitEntityId(v);
    return entityId(tuple.source, tuple.entity_type_id, tuple.external_id) === v;
  } catch {
    return false;
  }
}, { message: "발급처:자료 종류:번호 조합이어야 합니다" });
export const entityReferenceIds = z.array(entityReferenceId).max(100).refine(
  (ids) => new Set(ids).size === ids.length,
  {
    message: "중복된 엔터티 참조가 있습니다",
  },
);
export function entityPath(id: string): string {
  return `/entities/${encodeURIComponent(id)}`;
}
export function entityIdentityLabel(value: { source: string; external_id: string; source_label?: string }): string {
  return `${value.source_label ?? value.source} · ${value.external_id}`;
}
