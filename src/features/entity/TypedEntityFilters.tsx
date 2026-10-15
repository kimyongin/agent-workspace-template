import { isoDate } from "@contracts/common.ts";
import { entityNumberDraft } from "@contracts/entity-number.ts";
import type { EntitySchemaResult } from "@contracts/entity-type.ts";
import { entityPropertyFilter } from "@contracts/entity.ts";
import { Field, Notice } from "../../components/Field.tsx";
import { BodyAction } from "../../components/BodyAction.tsx";
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
  const keys = schema?.display.order.filter((key) => !schema.display.archived.includes(key)) ?? [];
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
          <select
            {...props}
            className="input"
            value={sort}
            onChange={(event) => onChange(raw ?? "", event.target.value)}
          >
            <option value="updated_at">최근 수정순</option>
            <option value="title">이름순</option>
            {keys.flatMap((key) =>
              ["asc", "desc"].map((direction) => (
                <option key={key + direction} value={JSON.stringify({ key, direction })}>
                  {schema!.schema.properties[key].title ?? key} · {direction === "asc" ? "오름차순" : "내림차순"}
                </option>
              ))
            )}
          </select>
        )}
      </Field>
      {schema && (
        <fieldset className="form plain-fieldset entity-property-conditions">
          <legend className="label">속성 조건 · 모두 충족</legend>
          {draft.map((row, index) => {
            const field = schema.schema.properties[row.key], kind = field ? fieldType(field) : null;
            const operators = field?.enum || kind === "boolean"
              ? ["eq"]
              : kind === "string" && !field?.format
              ? ["eq", "contains"]
              : ["eq", "gt", "gte", "lt", "lte"];
            return (
              <div className="entity-property-condition" key={index}>
                <Field hideLabel label={`조건 ${index + 1} 속성`}>
                  {(props) => (
                    <select
                      {...props}
                      className="input"
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
                        <option key={key} value={key}>{schema.schema.properties[key].title ?? key}</option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field hideLabel label={`조건 ${index + 1} 비교`}>
                  {(props) => (
                    <select
                      {...props}
                      className="input"
                      value={row.operator}
                      onChange={(event) => update(index, { operator: event.target.value })}
                    >
                      {[...operators, "unset"].map((operator) => (
                        <option key={operator} value={operator}>{labels[operator]}</option>
                      ))}
                    </select>
                  )}
                </Field>
                {"value" in row && (
                  <Field hideLabel label={`조건 ${index + 1} 값`}>
                    {(props) =>
                      kind === "boolean"
                        ? (
                          <select
                            {...props}
                            className="input"
                            value={String(row.value)}
                            onChange={(event) => update(index, { value: event.target.value === "true" })}
                          >
                            <option value="true">참</option>
                            <option value="false">거짓</option>
                          </select>
                        )
                        : field?.enum
                        ? (
                          <select
                            {...props}
                            className="input"
                            value={String(row.value)}
                            onChange={(event) => update(index, { value: event.target.value })}
                          >
                            <option value="">선택하세요</option>
                            {field.enum.filter((value) => value !== null).map((value) => (
                              <option key={value!} value={value!}>
                                {displayedProperty(field, value, schema.display.option_labels[row.key])}
                              </option>
                            ))}
                          </select>
                        )
                        : (
                          <input
                            {...props}
                            className="input"
                            type={field?.format === "date" ? "date" : "text"}
                            inputMode={kind === "integer" || kind === "number" ? "decimal" : undefined}
                            value={String(row.value)}
                            onChange={(event) => update(index, { value: event.target.value })}
                          />
                        )}
                  </Field>
                )}
                <BodyAction
                  icon="close"
                  type="button"
                  className="condition-remove"
                  aria-label={`조건 ${index + 1} 제거`}
                  onClick={() => setDraft((rows) => rows.filter((_, n) => n !== index))}
                >
                  {null}
                </BodyAction>
              </div>
            );
          })}
          <div className="actions">
            <BodyAction
              icon="create"
              type="button"
              className="condition-add"
              disabled={!keys.length || draft.length >= 32}
              onClick={() => {
                const key = keys[0];
                setDraft((rows) => [...rows, { key, operator: "eq", value: "" }]);
              }}
            >
              속성 조건 추가
            </BodyAction>
          </div>
        </fieldset>
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
    if (!field || schema.display.archived.includes(row.key)) throw Error("속성 조건을 확인하세요.");
    if (row.operator === "unset") return { key: row.key, operator: row.operator };
    const kind = fieldType(field), value = "value" in row ? row.value : undefined;
    const normalized = kind === "integer" || kind === "number" ? entityNumberDraft(String(value ?? ""), kind) : value;
    const allowed = field.enum || kind === "boolean"
      ? ["eq"]
      : kind === "string" && !field.format
      ? ["eq", "contains"]
      : ["eq", "gt", "gte", "lt", "lte"];
    if (
      !allowed.includes(row.operator) || kind === "boolean" && typeof normalized !== "boolean" ||
      field.enum && !field.enum.includes(normalized as string) ||
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
