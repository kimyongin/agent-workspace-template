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
    enum: "선택값",
    default: "생성 기본값",
  };
  const displayNames = {
    representative: "대표 속성",
    order: "순서",
    list_columns: "목록 표시",
    archived: "보관 속성",
  };
  return (
    <section className="schema-version-diff" aria-label="버전 차이">
      <h3>버전 {before.schema_version} → {after.schema_version} 차이</h3>
      <ul>
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
              <strong>{label}</strong>
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
        {Object.entries(displayNames).filter(([name]) =>
          JSON.stringify(before.display[name as keyof typeof displayNames]) !==
            JSON.stringify(after.display[name as keyof typeof displayNames])
        ).map(([name, label]) => (
          <li key={name}>
            {label}: {schemaValueLabel(
              before.display[name as keyof typeof displayNames],
              before,
            )} → {schemaValueLabel(
              after.display[name as keyof typeof displayNames],
              after,
            )}
          </li>
        ))}
        {[
          ...new Set([
            ...Object.keys(before.display.option_labels),
            ...Object.keys(after.display.option_labels),
          ]),
        ]
          .filter((key) => JSON.stringify(before.display.option_labels[key]) !==
            JSON.stringify(after.display.option_labels[key])
          ).map((key) => (
            <li key={`options-${key}`}>
              {after.schema.properties[key]?.title ??
                before.schema.properties[key]?.title ?? "선택 속성"} 표시 이름:{" "}
              {Object.entries(before.display.option_labels[key] ?? {}).map((
                [code, label],
              ) => `${code}: ${label}`).join(
                ", ",
              ) || "없음"} → {Object.entries(after.display.option_labels[key] ?? {}).map((
                [code, label],
              ) => `${code}: ${label}`).join(
                ", ",
              ) || "없음"}
            </li>
          ))}
      </ul>
    </section>
  );
}
