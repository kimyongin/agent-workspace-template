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
    <section className="flex min-w-0 flex-col gap-4" aria-label="버전 차이">
      <dl className="grid min-w-0 gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] gap-3">
        {([["title", "종류 이름"], ["description", "종류 설명"], ["x-icon", "종류 아이콘"], [
          "deprecated",
          "종류 보관",
        ]] as const)
          .filter(([name]) => JSON.stringify(before.schema[name]) !== JSON.stringify(after.schema[name]))
          .map(([name, label]) => (
            <div className={name === "description" ? "col-span-full" : undefined} key={name}>
              <dt>{label}</dt>
              <dd>{schemaValueLabel(before.schema[name])} → {schemaValueLabel(after.schema[name])}</dd>
            </div>
          ))}
      </dl>
      {paths.filter((key) =>
        JSON.stringify(before.schema.properties[key]) !== JSON.stringify(after.schema.properties[key]) ||
        before.schema.required.includes(key) !== after.schema.required.includes(key)
      ).map((key) => {
        const prior = before.schema.properties[key], next = after.schema.properties[key];
        const label = next?.title ?? prior?.title ?? "이름 없는 입력 항목";
        return (
          <dl className="grid min-w-0 gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere] gap-3" key={key}>
            <div>
              <dt>항목 이름</dt>
              <dd>{label}</dd>
            </div>
            {!prior
              ? (
                <div>
                  <dt>변경</dt>
                  <dd>새 입력 항목 · {fieldSummary(next)}</dd>
                </div>
              )
              : !next
              ? (
                <div>
                  <dt>변경</dt>
                  <dd>영구 삭제 (변경안)</dd>
                </div>
              )
              : Object.entries(names).filter(([name]) =>
                JSON.stringify(prior[name as keyof EntityField]) !== JSON.stringify(next[name as keyof EntityField])
              ).map(([name, title]) => (
                <div
                  key={name}
                  className={["description", "oneOf", "examples"].includes(name) ? "col-span-full" : undefined}
                >
                  <dt>{title}</dt>
                  <dd>
                    {name === "type" ? fieldSummary(prior) : schemaValueLabel(prior[name as keyof EntityField])} →{" "}
                    {name === "type" ? fieldSummary(next) : schemaValueLabel(next[name as keyof EntityField])}
                  </dd>
                </div>
              ))}
            {before.schema.required.includes(key) !== after.schema.required.includes(key) && (
              <div>
                <dt>필수 입력</dt>
                <dd>
                  {before.schema.required.includes(key) ? "필수" : "선택"} →{" "}
                  {after.schema.required.includes(key) ? "필수" : "선택"}
                </dd>
              </div>
            )}
          </dl>
        );
      })}
    </section>
  );
}
