import { effectiveEntityTitleTemplate } from "@contracts/entity-title-template.ts";
import { DataFields } from "@/components/DataFields";
import { BusinessTable, BusinessRow, BusinessCell } from "../../components/BusinessTable.tsx";
import { entityTypeIcons } from "@contracts/entity-type.ts";
import { fieldChoices, fieldChoiceTitle } from "../../lib/schema-document.ts";
import { schemaPresentation } from "../../lib/schema-document.ts";
import type { SchemaDefinition } from "@contracts/entity-schema-change.ts";
import { fieldTypeLabel, schemaOptionLabel, schemaValueLabel, schemaDiffValueLabel } from "./schema-labels.ts";

/** Definition values, never material values or the mutable editor draft. */
export function SchemaDefinitionRead(
  { definition }: { definition: SchemaDefinition },
) {
  const keys = [
    ...new Set([
      ...schemaPresentation(definition).order,
      ...Object.keys(definition.schema.properties),
    ]),
  ];
  const rows = keys.flatMap((key) => {
        const field = definition.schema.properties[key];
        if (!field) {
          return [];
        }
        const optionLabel = (value: string | null) =>
          fieldChoiceTitle(field, value) ??
            (value === null
              ? "비워 두기"
              : schemaOptionLabel(schemaPresentation(definition).option_labels[key], value));
        const values: Array<[string, string]> = [
          ["항목 이름", field.title || "이름 없는 항목"],
          ["데이터 타입", fieldTypeLabel(field)],
        ];
        if (fieldChoices(field)) {
          values.push(["선택 항목", fieldChoices(field)!.map(optionLabel).join(", ")]);
        }
        values.push(
          ["자료 이름으로 사용", key === schemaPresentation(definition).representative ? "사용" : "사용 안 함"],
          ["필수 입력", definition.schema.required.includes(key) ? "예" : "아니요"],
          ["목록에 표시", schemaPresentation(definition).list_columns.includes(key) ? "예" : "아니요"],
          ["읽기 전용", field.readOnly ? "예" : "아니요"],
          ["검색에 사용", field["x-search-text"] ? "예" : "아니요"],
        );
        if (schemaPresentation(definition).archived.includes(key)) values.push(["사용 상태", "사용 중지"]);
        if (field.examples?.length) {
          values.push([
            "입력 예시",
            field.examples.map((value) =>
              fieldChoices(field) && (typeof value === "string" || value === null)
                ? optionLabel(value)
                : schemaValueLabel(value)
            ).join(", "),
          ]);
        }
        if (field.description) {
          values.push(["설명", field.description]);
        }
        for (
          const [setting, label] of [
            ["minLength", "최소 길이"],
            ["maxLength", "최대 길이"],
            ["minimum", "최소값"],
            ["multipleOf", "배수"],
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
            field.default === null
              ? optionLabel(null)
              : typeof field.default === "string" && fieldChoices(field)
              ? optionLabel(field.default)
              : schemaValueLabel(field.default),
          ]);
        }
    return [{ key, title: field.title || "이름 없는 항목", values: new Map(values) }];
  });
  const columns = [...new Set(rows.flatMap((row) => [...row.values.keys()]))];
  return (
    <section aria-label="입력 항목 정의" className="flex min-w-0 flex-col gap-4">
      <h3 className="text-base font-semibold">
        입력 항목 <span className="text-sm text-muted-foreground">읽기 전용</span>
      </h3>
      <DataFields>
        <div><dt>제목 템플릿</dt><dd>{schemaDiffValueLabel("x-title-template", effectiveEntityTitleTemplate(definition.schema), definition)}</dd></div>
        <div>
          <dt>종류 이름</dt>
          <dd>{definition.schema.title ?? "당시 이름 기록 없음"}</dd>
        </div>
        <div>
          <dt>아이콘</dt>
          <dd>
            {definition.schema["x-icon"]
              ? entityTypeIcons.find((icon) => icon.id === definition.schema["x-icon"])?.label ?? "기본 아이콘"
              : "당시 아이콘 기록 없음"}
          </dd>
        </div>
        <div>
          <dt>보관 상태</dt>
          <dd>
            {definition.schema.deprecated === undefined && !definition.schema.title
              ? "당시 상태 기록 없음"
              : definition.schema.deprecated
              ? "보관"
              : "사용 중"}
          </dd>
        </div>
        {definition.schema.description && (
          <div className="col-span-full">
            <dt>종류 설명</dt>
            <dd>{definition.schema.description}</dd>
          </div>
        )}
      </DataFields>
      {!definition.schema.title && (
        <p className="text-sm text-muted-foreground">이 과거 버전에는 당시 종류 이름·아이콘·보관 상태가 기록되지 않았습니다.</p>
      )}
      <BusinessTable label="입력 항목 정의 목록" columns={columns} disclosureColumn={false}>
        {rows.map((row) => (
          <BusinessRow key={row.key} aria-label={`${row.title} 정의`}>
            {columns.map((column, index) => (
              <BusinessCell key={column} index={index}>{row.values.get(column) ?? (column === "사용 상태" ? "사용 중" : "설정 안 함")}</BusinessCell>
            ))}
          </BusinessRow>
        ))}
      </BusinessTable>
    </section>
  );
}
