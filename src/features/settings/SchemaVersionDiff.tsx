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
    deprecated: "사용 중지",
    readOnly: "읽기 전용",
    examples: "입력 예시",
    multipleOf: "배수",
    default: "생성 기본값",
  };
  return (
    <section className="schema-version-diff" aria-label="버전 차이">
      <ul>
        {([["title", "종류 이름"], ["description", "종류 설명"], ["x-icon", "종류 아이콘"], [
          "deprecated",
          "종류 보관",
        ]] as const)
          .filter(([name]) => JSON.stringify(before.schema[name]) !== JSON.stringify(after.schema[name]))
          .map(([name, label]) => (
            <li key={name}>
              {label}: {schemaValueLabel(before.schema[name])} → {schemaValueLabel(after.schema[name])}
            </li>
          ))}
        {paths.filter((key) =>
          JSON.stringify(before.schema.properties[key]) !==
            JSON.stringify(after.schema.properties[key]) ||
          before.schema.required.includes(key) !==
            after.schema.required.includes(key)
        ).map((key) => {
          const prior = before.schema.properties[key],
            next = after.schema.properties[key];
          const label = next?.title ?? prior?.title ?? "이름 없는 속성";
          return (
            <li key={key}>
              <span>{label}</span>
              {!prior ? ` · 새 속성 · ${fieldSummary(next)}` : !next ? " · 영구 삭제 (변경안)" : (
                <ul>
                  {Object.entries(names).filter(([name]) =>
                    JSON.stringify(prior[name as keyof EntityField]) !==
                      JSON.stringify(next[name as keyof EntityField])
                  ).map(([name, title]) => (
                    <li key={name}>
                      {title}:{" "}
                      {name === "type" ? fieldSummary(prior) : schemaValueLabel(prior[name as keyof EntityField])} →
                      {" "}
                      {name === "type" ? fieldSummary(next) : schemaValueLabel(next[name as keyof EntityField])}
                    </li>
                  ))}
                </ul>
              )}
              {before.schema.required.includes(key) !==
                  after.schema.required.includes(key) && (
                <p>
                  필수 입력: {before.schema.required.includes(key) ? "필수" : "선택"} →{" "}
                  {after.schema.required.includes(key) ? "필수" : "선택"}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
