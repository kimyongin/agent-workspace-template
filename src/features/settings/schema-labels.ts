import { memoDocument } from "./template-memo-document.ts";
import { fieldChoices, fieldChoiceTitle } from "../../lib/schema-document.ts";
import { schemaPresentation } from "../../lib/schema-document.ts";
import type { EntityField } from "@contracts/entity-type.ts";
import type { EntitySchemaChange, SchemaDefinition } from "@contracts/entity-schema-change.ts";
import { fieldType } from "../entity/property-fields.tsx";
import { entityIdentityLabel, splitEntityId } from "@contracts/entity-identity.ts";

/** A readable reference without guessing a current title for a historical result. */
export function schemaEntityLabel(id: string) {
  try {
    return entityIdentityLabel(splitEntityId(id));
  } catch {
    return id;
  }
}
export function schemaOptionLabel(labels: Record<string, string> | undefined, value: string): string {
  return labels && Object.hasOwn(labels, value) ? labels[value] || value : value;
}
export const schemaChangeLabels: Record<EntitySchemaChange["status"], string> = {
  draft: "초안",
  analyzing: "검토 중",
  ready: "검토 완료",
  stale: "현재 상태 확인 필요",
  invalid: "보완 필요",
  applied: "적용됨",
  cancelled: "폐기됨",
};
export function fieldTypeLabel(field: EntityField) {
  const kind = fieldType(field);
  const label = fieldChoices(field)
    ? "단일 선택"
    : field.format === "date"
    ? "날짜"
    : ({ string: "텍스트", integer: "정수", number: "숫자", boolean: "참·거짓" }[kind ?? "string"] ?? "텍스트");
  return label;
}
export function fieldSummary(field: EntityField) {
  const label = fieldTypeLabel(field);
  const constraints = [
    field.minLength !== undefined ? `최소 ${field.minLength}자` : "",
    field.maxLength !== undefined ? `최대 ${field.maxLength}자` : "",
    field.minimum !== undefined ? `${field.minimum} 이상` : "",
    field.maximum !== undefined ? `${field.maximum} 이하` : "",
  ];
  return [label, ...constraints.filter(Boolean)].join(" · ");
}
export function schemaDiffLabel(path: string, target: SchemaDefinition, source: SchemaDefinition) {
  if (path === "recovery") return "자료 값 복구";
  const parts = path.split("."), key = parts.find((part) => /^prop_[0-9]+$/.test(part));
  const name = key
    ? target.schema.properties[key]?.title ?? source.schema.properties[key]?.title ?? "삭제한 입력 항목"
    : "종류 설정";
  const labels: Record<string, string> = {
    title: "이름",
    type: "타입",
    required: "필수 입력",
    minLength: "최소 길이",
    maxLength: "최대 길이",
    minimum: "최소값",
    maximum: "최대값",
    oneOf: "선택 항목",
    "x-order": "입력 순서",
    "x-search-text": "검색에 사용",
    "x-icon": "아이콘",
    "x-title-template": "제목 템플릿",
    deprecated: "사용 중지",
    readOnly: "읽기 전용",
    examples: "입력 예시",
    multipleOf: "배수",
    default: "생성 기본값",
    order: "순서",
    archived: "보관",
    option_labels: "선택 이름",
    description: "설명",
    format: "형식",
  };
  return `${name}${labels[parts.at(-1)!] ? ` · ${labels[parts.at(-1)!]}` : ""}`;
}
/** Supply a definition only when the value is a schema reference, never a stored scalar. */
export function schemaValueLabel(value: unknown, definition?: SchemaDefinition): string {
  if (value === null) return "값 없음";
  if (value === undefined) return "미지정";
  if (typeof value === "boolean") return value ? "예" : "아니오";
  if (Array.isArray(value)) return value.map((item) => schemaValueLabel(item, definition)).join(", ") || "없음";
  if (typeof value === "object") {
    if ("type" in value) return fieldSummary(value as EntityField);
    if ("const" in value) {
      return "title" in value && typeof value.title === "string" ? value.title : schemaValueLabel(value.const);
    }
    return "설정 변경";
  }
  return definition && typeof value === "string" && /^prop_[0-9]+$/.test(value)
    ? definition?.schema.properties[value]?.title ?? "입력 항목"
    : String(value);
}

/** Review values use the input labels rather than schema storage spellings. */
export function schemaDiffValueLabel(path: string, value: unknown, definition: SchemaDefinition): string {
  if (path.endsWith("x-title-template") && typeof value === "string") {
    return memoDocument(value, Object.entries(definition.schema.properties).map(([key, field]) => ({ value: key, label: field.title || key })))
      .map((part) => part.variable ? `$${part.variable.label}$` : part.text).join("");
  }
  if (path.endsWith(".required") && typeof value === "boolean") return value ? "필수" : "선택";
  if (path.endsWith(".type") && (typeof value === "string" || Array.isArray(value))) {
    return fieldTypeLabel({ type: value as EntityField["type"], "x-order": 1 });
  }
  const key = path.split(".").find((part) => /^prop_[0-9]+$/.test(part));
  if (key && /\.(oneOf|default)$/.test(path)) {
    const option = (item: unknown) =>
      fieldChoiceTitle(definition.schema.properties[key], item) ??
        (typeof item === "string"
          ? schemaOptionLabel(schemaPresentation(definition).option_labels[key], item)
          : schemaValueLabel(item));
    return Array.isArray(value)
      ? value.map((item) =>
        item && typeof item === "object" && "const" in item
          ? typeof item.title === "string" ? item.title : option(item.const)
          : option(item)
      ).join(", ") || "없음"
      : option(value);
  }
  return schemaValueLabel(
    value,
    path === "required" || path === "schema.required" ? definition : undefined,
  );
}
