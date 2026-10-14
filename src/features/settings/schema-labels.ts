import type { EntityField } from "@contracts/entity-type.ts";
import type { EntitySchemaChange, SchemaDefinition } from "@contracts/entity-schema-change.ts";
import { fieldType } from "../entity/property-fields.tsx";
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
  const label = field.enum
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
  const parts = path.split("."), key = parts.find((part) => /^prop_[0-9]+$/.test(part));
  const name = key
    ? target.schema.properties[key]?.title ?? source.schema.properties[key]?.title ?? "삭제한 속성"
    : "표시 설정";
  const labels: Record<string, string> = {
    title: "이름",
    type: "타입",
    required: "필수 입력",
    minLength: "최소 길이",
    maxLength: "최대 길이",
    minimum: "최소값",
    maximum: "최대값",
    enum: "선택값",
    default: "생성 기본값",
    representative: "대표 속성",
    order: "순서",
    archived: "보관",
    list_columns: "목록 표시",
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
    return "설정 변경";
  }
  return definition && typeof value === "string" && /^prop_[0-9]+$/.test(value)
    ? definition?.schema.properties[value]?.title ?? "속성"
    : String(value);
}

/** Review values use the input labels rather than schema storage spellings. */
export function schemaDiffValueLabel(path: string, value: unknown, definition: SchemaDefinition): string {
  if (path.endsWith(".required") && typeof value === "boolean") return value ? "필수" : "선택";
  if (path.endsWith(".type") && (typeof value === "string" || Array.isArray(value))) {
    return fieldTypeLabel({ type: value as EntityField["type"] });
  }
  return schemaValueLabel(
    value,
    /^(?:display\.)?(representative|order|list_columns|archived)$/.test(path) ? definition : undefined,
  );
}
