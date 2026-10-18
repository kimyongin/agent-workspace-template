import { FieldSet, FieldLegend } from "../../components/ui/field.tsx";
import { Button } from "../../components/ui/button.tsx";
import { XIcon, PlusIcon } from "lucide-react";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { Input } from "../../components/ui/input.tsx";
import { fieldChoices } from "../../lib/schema-document.ts";
import { schemaPresentation } from "../../lib/schema-document.ts";
import { isoDate } from "@contracts/common.ts";
import { entityNumberDraft } from "@contracts/entity-number.ts";
import type { EntitySchemaResult } from "@contracts/entity-type.ts";
import { entityPropertyFilter } from "@contracts/entity.ts";
import { Field, Notice } from "../../components/Field.tsx";

import { displayedProperty, fieldType } from "./property-fields.tsx";
import { z } from "zod";
const labels: Record<string, string> = {
  eq: "같음",
  gt: "초과",
  gte: "이상",
  lt: "미만",
  lte: "이하",
  contains: "포함",
  unset: "미지정 (null·미입력)",
};
export function TypedEntityFilters(
  { schema, raw, sort, onChange }: {
    schema: EntitySchemaResult | null;
    raw: string | null;
    sort: string;
    onChange: (filters: string, sort: string) => void;
  },
) {
  let draft: Array<z.infer<typeof entityPropertyFilter>> = [], error = "";
  try {
    draft = raw ? z.array(entityPropertyFilter).parse(JSON.parse(raw)) : [];
  } catch {
    error = "속성 조건이 잘못되었습니다. 조건을 초기화하세요.";
  }
  const setDraft = (
    change: (rows: Array<z.infer<typeof entityPropertyFilter>>) => Array<z.infer<typeof entityPropertyFilter>>,
  ) => {
    const next = change(draft);
    onChange(next.length ? JSON.stringify(next) : "", sort);
  };
  const keys = schema
    ? schemaPresentation(schema).order.filter((key) => !schema.schema.properties[key].deprecated)
    : [];
  const update = (index: number, patch: Record<string, unknown>) =>
    setDraft((rows) =>
      rows.map((row, n) =>
        n === index
          ? patch.operator === "unset" ? { key: row.key, operator: "unset" } : {
            ...row,
            ...patch,
            ...(patch.operator && patch.operator !== "unset" && !("value" in row)
              ? { value: fieldType(schema?.schema.properties[row.key]) === "boolean" ? false : "" }
              : {}),
          } as z.infer<typeof entityPropertyFilter>
          : row
      )
    );
  return (
    <>
      <Field label="정렬">
        {(props) => (
          <NativeSelect
            {...props}

            value={sort}
            onChange={(event) => onChange(raw ?? "", event.target.value)}
          >
            <NativeSelectOption value="updated_at">최근 수정순</NativeSelectOption>
            <NativeSelectOption value="title">이름순</NativeSelectOption>
            {keys.flatMap((key) =>
              ["asc", "desc"].map((direction) => (
                <NativeSelectOption key={key + direction} value={JSON.stringify({ key, direction })}>
                  {schema!.schema.properties[key].title ?? key} · {direction === "asc" ? "오름차순" : "내림차순"}
                </NativeSelectOption>
              ))
            )}
          </NativeSelect>
        )}
      </Field>
      {schema && (
        <FieldSet className="flex flex-col gap-5 border-0 p-0 min-w-0">
          <FieldLegend className="text-sm font-medium">속성 조건 · 모두 충족</FieldLegend>
          {draft.length > 0 && (
            <div className="hidden text-sm font-medium" aria-hidden="true">
              <span>속성</span>
              <span>비교</span>
              <span className="min-w-0">값</span>
              <span />
            </div>
          )}
          {draft.map((row, index) => {
            const field = schema.schema.properties[row.key], kind = field ? fieldType(field) : null;
            const operators = fieldChoices(field) || kind === "boolean"
              ? ["eq"]
              : kind === "string" && !field?.format
              ? ["eq", "contains"]
              : ["eq", "gt", "gte", "lt", "lte"];
            return (
              <div className="grid min-w-0 grid-cols-2 items-end gap-3 @xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]" key={index}>
                <Field hideLabel label={`조건 ${index + 1} 속성`}>
                  {(props) => (
                    <NativeSelect
                      {...props}

                      value={row.key}
                      onChange={(event) => {
                        const next = schema.schema.properties[event.target.value];
                        setDraft((rows) =>
                          rows.map((value, n) =>
                            n === index
                              ? {
                                key: event.target.value,
                                operator: "eq",
                                value: fieldType(next) === "boolean"
                                  ? false
                                  : ["integer", "number"].includes(fieldType(next) ?? "")
                                  ? ""
                                  : "",
                              }
                              : value
                          )
                        );
                      }}
                    >
                      {keys.map((key) => (
                        <NativeSelectOption key={key} value={key}>{schema.schema.properties[key].title ?? key}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                <Field hideLabel label={`조건 ${index + 1} 비교`}>
                  {(props) => (
                    <NativeSelect
                      {...props}

                      value={row.operator}
                      onChange={(event) => update(index, { operator: event.target.value })}
                    >
                      {[...operators, "unset"].map((operator) => (
                        <NativeSelectOption key={operator} value={operator}>{labels[operator]}</NativeSelectOption>
                      ))}
                    </NativeSelect>
                  )}
                </Field>
                {"value" in row && (
                  <Field hideLabel label={`조건 ${index + 1} 값`}>
                    {(props) =>
                      kind === "boolean"
                        ? (
                          <NativeSelect
                            {...props}

                            value={String(row.value)}
                            onChange={(event) => update(index, { value: event.target.value === "true" })}
                          >
                            <NativeSelectOption value="true">참</NativeSelectOption>
                            <NativeSelectOption value="false">거짓</NativeSelectOption>
                          </NativeSelect>
                        )
                        : fieldChoices(field)
                        ? (
                          <NativeSelect
                            {...props}

                            value={String(row.value)}
                            onChange={(event) => update(index, { value: event.target.value })}
                          >
                            <NativeSelectOption value="">선택하세요</NativeSelectOption>
                            {fieldChoices(field)!.filter((value) => value !== null).map((value) => (
                              <NativeSelectOption key={value!} value={value!}>
                                {displayedProperty(field, value, schemaPresentation(schema).option_labels[row.key])}
                              </NativeSelectOption>
                            ))}
                          </NativeSelect>
                        )
                        : (
                          <Input
                            {...props}

                            type={field?.format === "date" ? "date" : "text"}
                            placeholder="값 입력"
                            inputMode={kind === "integer" || kind === "number" ? "decimal" : undefined}
                            value={String(row.value)}
                            onChange={(event) => update(index, { value: event.target.value })}
                          />
                        )}
                  </Field>
                )}
                <Button variant="ghost"

                  type="button"
                  className="justify-self-end"
                  aria-label={`조건 ${index + 1} 제거`}
                  onClick={() => setDraft((rows) => rows.filter((_, n) => n !== index))}
                ><XIcon data-icon="inline-start" />
                  {null}
                </Button>
              </div>
            );
          })}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost"

              type="button"
              className="justify-self-start"
              disabled={!keys.length || draft.length >= 32}
              onClick={() => {
                const key = keys[0];
                setDraft((rows) => [...rows, { key, operator: "eq", value: "" }]);
              }}
            ><PlusIcon data-icon="inline-start" />
              속성 조건 추가
            </Button>
          </div>
        </FieldSet>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </>
  );
}

export function validatePropertyFilters(raw: string | null, schema: EntitySchemaResult | null) {
  if (!raw) return "";
  if (!schema) throw Error("속성 정의를 확인한 뒤 적용하세요.");
  const rows = z.array(entityPropertyFilter).parse(JSON.parse(raw));
  const parsed = rows.map((row) => {
    const field = schema.schema.properties[row.key];
    if (!field || field.deprecated) throw Error("속성 조건을 확인하세요.");
    if (row.operator === "unset") return { key: row.key, operator: row.operator };
    const kind = fieldType(field), value = "value" in row ? row.value : undefined;
    const normalized = kind === "integer" || kind === "number" ? entityNumberDraft(String(value ?? ""), kind) : value;
    const allowed = fieldChoices(field) || kind === "boolean"
      ? ["eq"]
      : kind === "string" && !field.format
      ? ["eq", "contains"]
      : ["eq", "gt", "gte", "lt", "lte"];
    if (
      !allowed.includes(row.operator) || kind === "boolean" && typeof normalized !== "boolean" ||
      fieldChoices(field) && !fieldChoices(field)!.includes(normalized as string) ||
      kind === "string" && (typeof normalized !== "string" || normalized.includes("\u0000") ||
          field.format === "date" && (normalized.startsWith("0000-") || !isoDate.safeParse(normalized).success))
    ) throw Error("속성 조건을 확인하세요.");
    return { ...row, value: normalized };
  });
  const checked = z.array(entityPropertyFilter).max(32).parse(parsed);
  const groups = new Map<string, typeof checked>();
  for (const row of checked) groups.set(row.key, [...(groups.get(row.key) ?? []), row]);
  for (const group of groups.values()) {
    if (
      new Set(group.map((row) => row.operator)).size !== group.length ||
      group.length > 1 && group.some((row) => row.operator === "unset")
    ) throw Error("조건이 중복됩니다.");
    for (const left of group) {
      for (const right of group) {
        if (!("value" in left) || !("value" in right)) continue;
        if (
          (left.operator === "gt" || left.operator === "gte") &&
          (right.operator === "lt" || right.operator === "lte") &&
          (left.value > right.value ||
            left.value === right.value && (left.operator === "gt" || right.operator === "lt"))
        ) throw Error("범위 조건을 확인하세요.");
        if (
          left.operator === "eq" && (
            right.operator === "gt" && left.value <= right.value ||
            right.operator === "gte" && left.value < right.value ||
            right.operator === "lt" && left.value >= right.value ||
            right.operator === "lte" && left.value > right.value ||
            right.operator === "contains" && typeof left.value === "string" && typeof right.value === "string" &&
              !left.value.includes(right.value)
          )
        ) throw Error("조건을 확인하세요.");
      }
    }
  }
  return checked.length ? JSON.stringify(checked) : "";
}
