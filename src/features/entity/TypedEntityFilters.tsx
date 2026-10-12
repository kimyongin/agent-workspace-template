import { useEffect, useState } from "react";
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
  const [draft, setDraft] = useState<Array<z.infer<typeof entityPropertyFilter>>>([]), [error, setError] = useState("");
  useEffect(() => {
    try {
      setDraft(raw ? z.array(entityPropertyFilter).parse(JSON.parse(raw)) : []);
      setError("");
    } catch {
      setError("속성 조건이 잘못되었습니다. 조건을 초기화하세요.");
    }
  }, [raw]);
  const keys = schema?.display.order.filter((key) => !schema.display.archived.includes(key)) ?? [];
  const update = (index: number, patch: Record<string, unknown>) =>
    setDraft((rows) =>
      rows.map((row, n) =>
        n === index
          ? {
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
        <fieldset className="form plain-fieldset">
          <legend className="label">속성 조건 · 모두 충족</legend>
          {draft.map((row, index) => {
            const field = schema.schema.properties[row.key], kind = field ? fieldType(field) : null;
            const operators = field?.enum || kind === "boolean"
              ? ["eq"]
              : kind === "string" && !field?.format
              ? ["eq", "contains"]
              : ["eq", "gt", "gte", "lt", "lte"];
            return (
              <div className="form" key={index}>
                <Field label={`조건 ${index + 1} 속성`}>
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
                <Field label={`조건 ${index + 1} 비교`}>
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
                {"value" in row && row.operator !== "unset" && (
                  <Field label={`조건 ${index + 1} 값`}>
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
                <button
                  type="button"
                  className="btn"
                  onClick={() => setDraft((rows) => rows.filter((_, n) => n !== index))}
                >
                  조건 {index + 1} 제거
                </button>
              </div>
            );
          })}
          <div className="actions">
            <button
              type="button"
              className="btn"
              disabled={!keys.length || draft.length >= 32}
              onClick={() => {
                const key = keys[0];
                setDraft((rows) => [...rows, { key, operator: "eq", value: "" }]);
              }}
            >
              속성 조건 추가
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                try {
                  const filters = draft.map((row) => {
                    if (row.operator === "unset") return { key: row.key, operator: row.operator };
                    const field = schema.schema.properties[row.key], kind = fieldType(field);
                    const value = "value" in row ? row.value : undefined;
                    if (
                      (kind === "integer" || kind === "number") && (typeof value !== "string" || !value.trim()) &&
                      typeof value !== "number"
                    ) throw Error("숫자를 입력하세요");
                    return { ...row, value: kind === "integer" || kind === "number" ? Number(value) : value };
                  });
                  const parsed = z.array(entityPropertyFilter).parse(filters);
                  setError("");
                  onChange(parsed.length ? JSON.stringify(parsed) : "", sort);
                } catch {
                  setError("조건 값과 비교를 확인하세요. 빈 숫자는 0으로 처리하지 않습니다.");
                }
              }}
            >
              속성 조건 적용
            </button>
          </div>
        </fieldset>
      )}
      {error && <Notice kind="error">{error}</Notice>}
    </>
  );
}
