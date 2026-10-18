import { cn } from "../../lib/utils.ts";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { Input } from "../../components/ui/input.tsx";
import { DateInput } from "../../components/DateInput.tsx";
import { fieldChoiceLabels, fieldChoices, fieldChoiceTitle } from "../../lib/schema-document.ts";
import { schemaPresentation } from "../../lib/schema-document.ts";
import { codePointLength, isoDate } from "@contracts/common.ts";
import { entityNumberDraft } from "@contracts/entity-number.ts";
import type { EntityField, EntitySchemaVersion } from "@contracts/entity-type.ts";
import type { EntityProperties } from "@contracts/entity.ts";
import { DetailTitle } from "../../components/Modal.tsx";
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
  constructor(readonly fields: Record<string, string>) {
    super(Object.values(fields).join(" · "));
  }
}
export function propertyValues(
  definition: Pick<EntitySchemaVersion, "schema">,
  values: PropertyDraft,
): EntityProperties {
  const result: EntityProperties = {}, errors: Record<string, string> = {};
  for (const [key, value] of Object.entries(values)) {
    const kind = fieldType(definition.schema.properties[key]);
    if (
      schemaPresentation(definition).representative === key &&
      (value === null || value === "" ||
        typeof value === "string" && !value.trim())
    ) {
      errors[`properties.${key}`] = "필수 항목을 입력하세요";
      continue;
    }
    try {
      const field = definition.schema.properties[key];
      const parsed = value !== null && (kind === "integer" || kind === "number")
        ? entityNumberDraft(String(value), kind)
        : value;
      if (field) {
        if (parsed === null && !(Array.isArray(field.type) && field.type.includes("null"))) {
          throw new Error("값을 입력하세요");
        }
        if (fieldChoices(field) && !fieldChoices(field)!.includes(parsed as string | null)) {
          throw new Error("현재 선택 항목에서 값을 선택하세요");
        }
        if (typeof parsed === "number") {
          if (field.minimum !== undefined && parsed < field.minimum) {
            throw new Error(`${field.minimum} 이상이어야 합니다`);
          }
          if (field.maximum !== undefined && parsed > field.maximum) {
            throw new Error(`${field.maximum} 이하여야 합니다`);
          }
        }
        if (typeof parsed === "string") {
          if (field.minLength !== undefined && codePointLength(parsed) < field.minLength) {
            throw new Error(`${field.minLength}자 이상이어야 합니다`);
          }
          if (field.maxLength !== undefined && codePointLength(parsed) > field.maxLength) {
            throw new Error(`${field.maxLength}자 이하여야 합니다`);
          }
          if (field.format === "date" && (parsed.startsWith("0000-") || !isoDate.safeParse(parsed).success)) {
            throw new Error("실제로 존재하는 날짜를 입력하세요");
          }
        }
      }
      result[key] = parsed;
    } catch (error) {
      errors[`properties.${key}`] = error instanceof Error ? error.message : "값을 확인하세요";
    }
  }
  if (Object.keys(errors).length) throw new PropertyDraftError(errors);
  return result;
}
export function displayedProperty(field: EntityField, value: unknown, labels: Record<string, string> = {}): string {
  if (value === undefined) return "미입력";
  if (value === null) return fieldChoiceTitle(field, null) ?? "값 없음";
  if (typeof value === "boolean") return value ? "참" : "거짓";
  const choices = { ...fieldChoiceLabels(field), ...labels };
  if (Object.hasOwn(choices, String(value))) return choices[String(value)];
  if (typeof value === "number" && ["integer", "number"].includes(fieldType(field) ?? "")) {
    return new Intl.NumberFormat("ko-KR", { maximumSignificantDigits: 21 }).format(value);
  }
  return String(value);
}
export function PropertyFields(
  { definition, values, onChange, errors, disabled = false, part = "all" }: {
    disabled?: boolean;
    part?: "all" | "representative" | "remaining";
    definition: Pick<EntitySchemaVersion, "schema">;
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
      {[
        schemaPresentation(definition).representative,
        ...schemaPresentation(definition).order.filter((key) => key !== schemaPresentation(definition).representative),
      ].filter((key) =>
        part === "all" || (part === "representative") === (key === schemaPresentation(definition).representative)
      ).map((key) => {
        const field = definition.schema.properties[key],
          value = values[key],
          nullable = Array.isArray(field.type) && field.type.includes("null") &&
            (!fieldChoices(field) || fieldChoices(field)!.includes(null)),
          required = definition.schema.required.includes(key),
          archived = schemaPresentation(definition).archived.includes(key);
        if (archived || field.readOnly) {
          return (
            <dl
              key={key}
              className={cn("min-w-0 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:wrap-anywhere", key === schemaPresentation(definition).representative ? " col-span-full" : "")}
            >
              <div>
                <dt>
                  {field.title ?? key} <span className="text-sm text-muted-foreground">· {archived ? "보관" : "읽기 전용"}</span>
                </dt>
                <dd>
                  {key === schemaPresentation(definition).representative
                    ? (
                      <DetailTitle>
                        {displayedProperty(field, value, schemaPresentation(definition).option_labels[key])}
                      </DetailTitle>
                    )
                    : displayedProperty(field, value, schemaPresentation(definition).option_labels[key])}
                </dd>
              </div>
            </dl>
          );
        }
        return (
          <Field
            fullWidth={key === schemaPresentation(definition).representative}
            className={cn(key === schemaPresentation(definition).representative ? "col-span-full" : undefined)}
            key={key}
            label={field.title ?? key}
            required={required}
            error={errors[`properties.${key}`]}
          >
            {(props) => (
              <>
                {fieldChoices(field) || fieldType(field) === "boolean"
                  ? (
                    <NativeSelect
                      {...props}
                      disabled={disabled}

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
                      <NativeSelectOption value="unset">미입력</NativeSelectOption>
                      {fieldType(field) === "boolean"
                        ? (
                          <>
                            <NativeSelectOption value="value:true">참</NativeSelectOption>
                            <NativeSelectOption value="value:false">거짓</NativeSelectOption>
                            {nullable && <NativeSelectOption value="null">값 없음</NativeSelectOption>}
                          </>
                        )
                        : field.oneOf?.map((option) => (
                          <NativeSelectOption
                            key={option.const === null ? "null" : `value:${option.const}`}
                            value={option.const === null ? "null" : `value:${option.const}`}
                          >
                            {displayedProperty(field, option.const, schemaPresentation(definition).option_labels[key])}
                          </NativeSelectOption>
                        ))}
                    </NativeSelect>
                  )
                  : field.format === "date" ? (
                    <DateInput
                      {...props}
                      label={field.title ?? key}
                      disabled={disabled}
                      value={typeof value === "string" ? value : ""}
                      onValueChange={(next) => set(key, next === "" ? nullable ? null : required ? "" : undefined : next)}
                    />
                  ) : (
                    <Input
                      {...props}
                      disabled={disabled}

                      type="text"
                      inputMode={["integer", "number"].includes(fieldType(field) ?? "") ? "decimal" : undefined}
                      value={typeof value === "string" ? value : ""}
                      onChange={(e) => {
                        const next = e.target.value;
                        set(
                          key,
                          next === "" ? nullable ? null : required ? "" : undefined : next,
                        );
                      }}
                    />
                  )}
                {!!field.examples?.length && (
                  <p className="text-sm text-muted-foreground">
                    예: {field.examples.map((example) => displayedProperty(field, example)).join(", ")}
                  </p>
                )}
                {field.description && <p className="text-sm text-muted-foreground">{field.description}</p>}
              </>
            )}
          </Field>
        );
      })}
    </>
  );
}
