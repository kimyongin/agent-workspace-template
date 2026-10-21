import { decodeIdentifierReference } from "./entity-identifiers.ts";
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
export { identifierReference as entityReferenceId } from "./entity-identifiers.ts";
import { identifierReference as entityReferenceId } from "./entity-identifiers.ts";
export const entityReferenceIds = z.array(entityReferenceId).max(100).refine(
  (ids) => new Set(ids).size === ids.length,
  {
    message: "중복된 엔터티 참조가 있습니다",
  },
);
export function entityPath(id: string): string {
  return `/entities/${encodeURIComponent(id)}`;
}
export function entityIdentityLabel(value: { id: string; identity_label?: string }): string {
  if (value.identity_label) return value.identity_label;
  const pair = decodeIdentifierReference(value.id);
  return `${pair.kind_id.slice(0, 8)} · ${pair.raw}`;
}
