import { z } from "zod";
import { codePointLength } from "./common.ts";

export const identifierKindId = z.string().uuid().transform((value) => value.toLowerCase());
export const identifierFieldSettings = z.strictObject({
  allowed_kind_ids: z.array(identifierKindId).min(1).refine((ids) => new Set(ids).size === ids.length, {
    message: "허용 식별자 종류는 중복될 수 없습니다",
  }),
  default_kind_id: identifierKindId,
}).refine((settings) => settings.allowed_kind_ids.includes(settings.default_kind_id), {
  path: ["default_kind_id"],
  message: "기본 식별자 종류는 허용 종류 중에서 선택하세요",
});
export type IdentifierFieldSettings = z.infer<typeof identifierFieldSettings>;
export const identifierRawValue = z.string().refine(
  (value) =>
    codePointLength(value) >= 1 && codePointLength(value) <= 200 && value.trim() === value &&
    [...value].every((character) => {
      const point = character.codePointAt(0)!;
      return point >= 32 && !(point >= 127 && point <= 159) && !(point >= 0xd800 && point <= 0xdfff);
    }),
  { message: "식별자는 앞뒤 공백·제어문자 없이 원본 문자열 1~200자로 입력하세요" },
);

export type IdentifierValue = { kind_id: string; raw: string };
export type IdentifierReference = IdentifierValue & { entity_type_id: string };

/** A validated UUID has exactly 36 characters; the raw suffix is never split or escaped. */
export function encodeIdentifierValue(kindId: string, raw: string): string {
  return `${identifierKindId.parse(kindId)}:${identifierRawValue.parse(raw)}`;
}

export function decodeIdentifierValue(value: string): IdentifierValue {
  if (value[36] !== ":") throw new TypeError("식별자 종류와 원본 값을 확인하세요");
  const kind_id = identifierKindId.parse(value.slice(0, 36));
  const raw = identifierRawValue.parse(value.slice(37));
  if (encodeIdentifierValue(kind_id, raw) !== value) throw new TypeError("정규 식별자 값이 아닙니다");
  return { kind_id, raw };
}

export function encodeIdentifierReference(typeId: string, kindId: string, raw: string): string {
  return `${identifierKindId.parse(typeId)}:${encodeIdentifierValue(kindId, raw)}`;
}

export function decodeIdentifierReference(value: string): IdentifierReference {
  if (value[36] !== ":") throw new TypeError("자료 종류와 식별자를 확인하세요");
  const entity_type_id = identifierKindId.parse(value.slice(0, 36));
  const pair = decodeIdentifierValue(value.slice(37));
  if (encodeIdentifierReference(entity_type_id, pair.kind_id, pair.raw) !== value) {
    throw new TypeError("정규 자료 참조가 아닙니다");
  }
  return { entity_type_id, ...pair };
}

export const identifierValue = z.string().refine((value) => {
  try {
    decodeIdentifierValue(value);
    return true;
  } catch {
    return false;
  }
}, { message: "식별자 종류와 원본 문자열의 올바른 조합이어야 합니다" });

export const identifierReference = z.string().refine((value) => {
  try {
    decodeIdentifierReference(value);
    return true;
  } catch {
    return false;
  }
}, { message: "자료 종류·식별자 종류·원본 문자열의 올바른 조합이어야 합니다" });
