import type { SchemaDefinition } from "@contracts/entity-schema-change.ts";
import { fieldTypeLabel, schemaValueLabel } from "./schema-labels.ts";

/** Definition values, never material values or the mutable editor draft. */
export function SchemaDefinitionRead(
  { definition }: { definition: SchemaDefinition },
) {
  const keys = [
    ...new Set([
      ...definition.display.order,
      ...Object.keys(definition.schema.properties),
    ]),
  ];
  return (
    <section aria-label="입력 항목 정의" className="schema-definition-read">
      <h3>
        입력 항목 <span className="secondary">읽기 전용</span>
      </h3>
      {keys.map((key) => {
        const field = definition.schema.properties[key];
        if (!field) {
          return null;
        }
        const values: Array<[string, string]> = [
          ["데이터 타입", fieldTypeLabel(field)],
          [
            "필수 입력",
            definition.schema.required.includes(key) ? "예" : "아니요",
          ],
          [
            "목록에 표시",
            definition.display.list_columns.includes(key) ? "예" : "아니요",
          ],
        ];
        if (key === definition.display.representative) {
          values.push(["자료 이름", "사용"]);
        }
        if (definition.display.archived.includes(key)) {
          values.push(["사용 상태", "사용 중지"]);
        }
        if (field.description) {
          values.push(["설명", field.description]);
        }
        for (
          const [setting, label] of [
            ["minLength", "최소 길이"],
            ["maxLength", "최대 길이"],
            ["minimum", "최소값"],
            [
              "maximum",
              "최대값",
            ],
          ] as const
        ) {
          if (field[setting] !== undefined) {
            values.push([
              label,
              `${field[setting]}${setting.endsWith("Length") ? "자" : ""}`,
            ]);
          }
        }
        if (Object.hasOwn(field, "default")) {
          values.push([
            "생성 기본값",
            field.default === null ? "비워 두기" : schemaValueLabel(field.default),
          ]);
        }
        if (field.enum) {
          values.push([
            "선택 항목",
            field.enum.map((value) =>
              value === null ? "비워 두기" : definition.display.option_labels[key]?.[value] ?? value
            ).join(", "),
          ]);
        }
        return (
          <section
            key={key}
            aria-label={`${field.title || "이름 없는 항목"} 정의`}
          >
            <h4>{field.title || "이름 없는 항목"}</h4>
            <dl className="props schema-definition-values">
              {values.map(([label, value]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        );
      })}
    </section>
  );
}
