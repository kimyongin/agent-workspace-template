import { entityNumberDraft } from "@contracts/entity-number.ts";
import type { EntityField, EntitySchemaVersion } from "@contracts/entity-type.ts";
import type { EntityProperties } from "@contracts/entity.ts";
import { Field } from "../../components/Field.tsx";
export type PropertyDraft = Record<string, string | boolean | null>;
export function fieldType(field: EntityField | undefined) {
  if (!field) return undefined;
  return Array.isArray(field.type) ? field.type.find((type) => type !== "null") : field.type;
}
export function propertyDraft(values: EntityProperties): PropertyDraft {
  return Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, typeof value === "number" ? String(value) : value]),
  );
}
export class PropertyDraftError extends Error {
  constructor(readonly fields: Record<string, string>) { super(Object.values(fields).join(" · ")); }
}
export function propertyValues(definition: Pick<EntitySchemaVersion, "schema">, values: PropertyDraft): EntityProperties {
  const result: EntityProperties = {}, errors: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const kind = fieldType(definition.schema.properties[key]);
    try { result[key] = value !== null && (kind === "integer" || kind === "number") ? entityNumberDraft(String(value), kind) : value; }
    catch (error) { errors[`properties.${key}`] = error instanceof Error ? error.message : "숫자를 확인하세요"; }
  }
  if (Object.keys(errors).length) throw new PropertyDraftError(errors);
  return result;
}
export function displayedProperty(field: EntityField, value: unknown, labels: Record<string, string> = {}): string {
  if (value === undefined) return "미입력";
  if (value === null) return "값 없음";
  if (typeof value === "boolean") return value ? "참" : "거짓";
  return Object.hasOwn(labels, String(value)) ? labels[String(value)] : String(value);
}
export function PropertyFields(
  { definition, values, onChange, errors }: {
    definition: Pick<EntitySchemaVersion, "schema" | "display">;
    values: PropertyDraft;
    onChange: (values: PropertyDraft) => void;
    errors: Record<string, string>;
  },
) {
  const set = (key: string, value: string | boolean | null | undefined) => {
    const next = { ...values };
    if (value === undefined) delete next[key];
    else next[key] = value;
    onChange(next);
  };
  return (
    <>
      {definition.display.order.map((key) => {
        const field = definition.schema.properties[key],
          value = values[key],
          nullable = Array.isArray(field.type) && field.type.includes("null") &&
            (!field.enum || field.enum.includes(null)),
          required = definition.schema.required.includes(key),
          archived = definition.display.archived.includes(key);
        if (archived) {
          return (
            <p key={key}>
              {field.title ?? key} · 보관: {displayedProperty(field, value, definition.display.option_labels[key])}
            </p>
          );
        }
        return (
          <Field key={key} label={field.title ?? key} required={required} error={errors[`properties.${key}`]}>
            {(props) => (
              <>
                {field.enum || fieldType(field) === "boolean"
                  ? (
                    <select
                      {...props}
                      className="input"
                      value={value === undefined ? "unset" : value === null ? "null" : `value:${String(value)}`}
                      onChange={(e) => {
                        const v = e.target.value;
                        set(
                          key,
                          v === "unset"
                            ? undefined
                            : v === "null"
                            ? null
                            : fieldType(field) === "boolean"
                            ? v === "value:true"
                            : v.slice(6),
                        );
                      }}
                    >
                      <option value="unset">미입력</option>
                      {nullable && <option value="null">값 없음</option>}
                      {fieldType(field) === "boolean"
                        ? (
                          <>
                            <option value="value:true">참</option>
                            <option value="value:false">거짓</option>
                          </>
                        )
                        : field.enum?.filter((code) => code !== null).map((code) => (
                          <option key={code} value={`value:${code}`}>
                            {definition.display.option_labels[key]?.[code!] ?? code}
                          </option>
                        ))}
                    </select>
                  )
                  : (
                    <input
                      {...props}
                      className="input"
                      type={field.format === "date" ? "date" : "text"}
                      inputMode={["integer", "number"].includes(fieldType(field) ?? "") ? "decimal" : undefined}
                      value={typeof value === "string" ? value : ""}
                      onChange={(e) => {
                        const next = e.target.value;
                        set(
                          key,
                          next === "" && ["integer", "number"].includes(fieldType(field) ?? "") ? undefined : next,
                        );
                      }}
                    />
                  )}
                {field.description && <p className="help">{field.description}</p>}
                {required && <p className="help">키 입력 필수{nullable ? " · 값 없음 허용" : ""}</p>}
                {nullable && !field.enum && fieldType(field) !== "boolean" && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => set(key, null)}
                  >
                    값 비우기
                  </button>
                )}
                {!required && value !== undefined && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => set(key, undefined)}
                  >
                    미입력으로 변경
                  </button>
                )}
              </>
            )}
          </Field>
        );
      })}
    </>
  );
}
