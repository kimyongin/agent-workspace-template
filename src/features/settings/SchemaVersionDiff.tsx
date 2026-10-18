import { BusinessTable, BusinessRow, BusinessCell } from "../../components/BusinessTable.tsx";
import type { EntityField, EntitySchemaVersion } from "@contracts/entity-type.ts";
import { fieldSummary, schemaValueLabel } from "./schema-labels.ts";
export function SchemaVersionDiff(
  { before, after }: {
    before: EntitySchemaVersion;
    after: EntitySchemaVersion;
  },
) {
  const paths = [
    ...new Set([
      ...Object.keys(before.schema.properties),
      ...Object.keys(after.schema.properties),
    ]),
  ];
  const names: Record<string, string> = {
    title: "이름",
    description: "설명",
    type: "타입",
    format: "형식",
    minLength: "최소 길이",
    maxLength: "최대 길이",
    minimum: "최소값",
    maximum: "최대값",
    oneOf: "선택 항목",
    "x-order": "입력 순서",
    "x-list-order": "목록 순서",
    "x-representative": "자료 이름",
    "x-show-in-list": "목록 표시",
    "x-search-text": "검색에 사용",
    deprecated: "사용 중지",
    readOnly: "읽기 전용",
    examples: "입력 예시",
    multipleOf: "배수",
    default: "생성 기본값",
  };
  const rows: Array<{ id: string; target: string; setting: string; value: string }> = [];
  for (const [name, label] of [["title", "종류 이름"], ["description", "종류 설명"], ["x-icon", "종류 아이콘"], ["deprecated", "종류 보관"]] as const) {
    if (JSON.stringify(before.schema[name]) !== JSON.stringify(after.schema[name])) {
      rows.push({ id: `type:${name}`, target: "자료 종류", setting: label, value: `${schemaValueLabel(before.schema[name])} → ${schemaValueLabel(after.schema[name])}` });
    }
  }
  for (const key of paths) {
    const prior = before.schema.properties[key], next = after.schema.properties[key];
    const label = next?.title ?? prior?.title ?? "이름 없는 입력 항목";
    if (!prior || !next) {
      rows.push({ id: key, target: label, setting: "변경", value: !prior ? `새 입력 항목 · ${fieldSummary(next)}` : "영구 삭제 (변경안)" });
      continue;
    }
    for (const [name, title] of Object.entries(names)) {
      const setting = name as keyof EntityField;
      if (JSON.stringify(prior[setting]) !== JSON.stringify(next[setting])) {
        rows.push({ id: `${key}:${name}`, target: label, setting: title, value: `${name === "type" ? fieldSummary(prior) : schemaValueLabel(prior[setting])} → ${name === "type" ? fieldSummary(next) : schemaValueLabel(next[setting])}` });
      }
    }
    if (before.schema.required.includes(key) !== after.schema.required.includes(key)) {
      rows.push({ id: `${key}:required`, target: label, setting: "필수 입력", value: `${before.schema.required.includes(key) ? "필수" : "선택"} → ${after.schema.required.includes(key) ? "필수" : "선택"}` });
    }
  }
  return (
    <section className="flex min-w-0 flex-col gap-4" aria-label="버전 차이">
      <BusinessTable label="버전 변경 목록" columns={["대상", "설정", "변경"]} disclosureColumn={false}>
        {rows.map(row => <BusinessRow key={row.id}>
          <BusinessCell index={0}>{row.target}</BusinessCell>
          <BusinessCell index={1}>{row.setting}</BusinessCell>
          <BusinessCell index={2}>{row.value}</BusinessCell>
        </BusinessRow>)}
      </BusinessTable>
    </section>
  );
}
