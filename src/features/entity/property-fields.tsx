import { DataFields } from "../../components/DataFields.tsx";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { Input } from "../../components/ui/input.tsx";
import { DateInput } from "../../components/DateInput.tsx";
import { fieldChoiceLabels, fieldChoices, fieldChoiceTitle } from "../../lib/schema-document.ts";
import { schemaPresentation } from "../../lib/schema-document.ts";
import { codePointLength, isoDate } from "@contracts/common.ts";
import { entityNumberDraft } from "@contracts/entity-number.ts";
import type { EntityField, EntitySchemaVersion } from "@contracts/entity-type.ts";
import type { EntityProperties } from "@contracts/entity.ts";
import { Field } from "../../components/Field.tsx";
import { Button } from "../../components/ui/button.tsx";
import { decodeIdentifierValue, identifierKindId } from "@contracts/entity-identifiers.ts";
import type { IdentifierKindMetadata } from "@contracts/entity-issuer.ts";
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
          if (field["x-identifier"]) {
            let pair;
            try { pair = decodeIdentifierValue(parsed); }
            catch { throw new Error("식별자 종류와 원본 문자열 1~200자를 확인하세요"); }
            if (!field["x-identifier"].allowed_kind_ids.includes(pair.kind_id)) throw new Error("이 항목에 허용된 식별자 종류를 선택하세요");
          }
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
export function displayedProperty(field: EntityField, value: unknown, labels: Record<string, string> = {}, kinds: IdentifierKindMetadata[] = []): string {
  if (value === undefined) return "미입력";
  if (value === null) return fieldChoiceTitle(field, null) ?? "값 없음";
  if (typeof value === "boolean") return value ? "참" : "거짓";
  if (field["x-identifier"] && typeof value === "string") {
    try {
      const pair = decodeIdentifierValue(value), kind = kinds.find((kind) => kind.id === pair.kind_id);
      return kind ? `${kind.source_label} · ${kind.label} · ${pair.raw}` : pair.raw;
    } catch { return "식별자 확인 필요"; }
  }
  const choices = { ...fieldChoiceLabels(field), ...labels };
  if (Object.hasOwn(choices, String(value))) return choices[String(value)];
  if (typeof value === "number" && ["integer", "number"].includes(fieldType(field) ?? "")) {
    return new Intl.NumberFormat("ko-KR", { maximumSignificantDigits: 21 }).format(value);
  }
  return String(value);
}
export function PropertyFields(
  { definition, values, initialValues, onChange, errors, disabled = false, identityLocked = false, generations = {}, onGenerate }: {
    disabled?: boolean;
    definition: Pick<EntitySchemaVersion, "schema" | "identifier_kinds">;
    identityLocked?: boolean;
    generations?: Record<string, string>;
    onGenerate?: (key: string, kind: string | undefined) => void;
    values: PropertyDraft;
    initialValues?: PropertyDraft;
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
      {schemaPresentation(definition).order.map((key) => {
        const field = definition.schema.properties[key],
          value = values[key],
          nullable = Array.isArray(field.type) && field.type.includes("null") &&
            (!fieldChoices(field) || fieldChoices(field)!.includes(null)),
          required = definition.schema.required.includes(key),
          archived = schemaPresentation(definition).archived.includes(key);
        const selected = definition.schema["x-identity-property"] === key;
        if (archived || field.readOnly || selected && identityLocked) {
          return (
            <DataFields key={key} className="col-span-full">
              <div>
                <dt>
                  {field.title ?? key} <span className="text-sm text-muted-foreground">· {archived ? "보관" : selected && identityLocked ? "자료 식별자" : "읽기 전용"}</span>
                </dt>
                <dd>
                  {displayedProperty(field, value, schemaPresentation(definition).option_labels[key], definition.identifier_kinds)}
                </dd>
              </div>
            </DataFields>
          );
        }
        return (
          <Field
            key={key}
            label={field.title ?? key}
            changed={initialValues !== undefined && initialValues[key] !== value}
            required={required}
            error={errors[`properties.${key}`]}
          >
            {(props) => (
              <>
                {field["x-identifier"] ? (() => {
                  const settings = field["x-identifier"];
                  // Editing may temporarily contain an empty/invalid raw suffix.
                  // Stored values still go through the shared strict codec on submit.
                  const prefix = typeof value === "string" && value[36] === ":" && identifierKindId.safeParse(value.slice(0, 36)).success;
                  const kindId = generations[key] ?? (prefix ? String(value).slice(0, 36) : settings.default_kind_id);
                  const kind = definition.identifier_kinds?.find((kind) => kind.id === kindId);
                  const raw = prefix ? String(value).slice(37) : "";
                  const automatic = !!generations[key] || selected && value === undefined && kind?.generation === "automatic";
                  const choice = value === null ? "null" : value === undefined && !automatic && !selected ? "unset" : kindId;
                  const rawEditable = !automatic && choice !== "unset" && choice !== "null";
                  return <>
                    <NativeSelect {...(!rawEditable ? props : {})} id={!rawEditable ? props.id : `${props.id}-kind`} aria-label={`${field.title ?? key} 종류`} disabled={disabled} value={choice} onChange={event => {
                      const next = event.target.value;
                      onGenerate?.(key, undefined);
                      if (next === "unset" || next === "null") { set(key, next === "unset" ? undefined : null); return; }
                      const nextKind = definition.identifier_kinds?.find(kind => kind.id === next);
                      if (nextKind?.generation === "automatic" && onGenerate) { set(key, undefined); onGenerate(key, next); }
                      else set(key, `${next}:${raw}`);
                    }}>
                      {!required && <NativeSelectOption value="unset">미입력</NativeSelectOption>}
                      {nullable && <NativeSelectOption value="null">값 없음</NativeSelectOption>}
                      {settings.allowed_kind_ids.map(id => {
                        const option = definition.identifier_kinds?.find(kind => kind.id === id);
                        return <NativeSelectOption key={id} value={id} disabled={!!option && !option.active && !(prefix && id === kindId)}>
                          {option ? `${option.source_label} · ${option.label}${option.active ? "" : " · 중지"}` : "식별자 종류 확인 필요"}
                        </NativeSelectOption>;
                      })}
                    </NativeSelect>
                    {automatic && <p role="status" className="text-sm text-muted-foreground">저장 시 자동 발급</p>}
                    {automatic && onGenerate && <Button type="button" variant="outline" disabled={disabled} onClick={() => {
                      set(key, `${kindId}:`);
                      onGenerate(key, undefined);
                    }}>기존 번호 입력</Button>}
                    {rawEditable && <Input {...props} disabled={disabled} value={raw} autoComplete="off" onChange={event => {
                        onGenerate?.(key, undefined);
                        const next = event.target.value;
                        set(key, next === "" && !required ? nullable ? null : undefined : `${kindId}:${next}`);
                      }} />}
                    {kind?.generation === "automatic" && rawEditable && onGenerate &&
                      <Button type="button" variant="outline" disabled={disabled || !kind.active} onClick={() => { set(key, undefined); onGenerate(key, kindId); }}>새 번호 발급</Button>}
                  </>;
                })() : fieldChoices(field) || fieldType(field) === "boolean"
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
