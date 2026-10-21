import { useState } from "react";
import type { EntityField } from "@contracts/entity-type.ts";
import type { IdentifierKindMetadata } from "@contracts/entity-issuer.ts";
import { decodeIdentifierValue, encodeIdentifierValue, identifierRawValue } from "@contracts/entity-identifiers.ts";
import { FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "../../components/Field.tsx";

/** Edit annotations in the owning schema draft; no independent identity write exists. */
export function IdentifierFieldSettings(
  { field, kinds, selected = false, disabled = false, onChange, onAddKind }: {
    field: EntityField;
    kinds: IdentifierKindMetadata[];
    selected?: boolean;
    disabled?: boolean;
    onChange: (field: EntityField) => void;
    onAddKind?: () => void;
  },
) {
  const settings = field["x-identifier"]!;
  let decoded: ReturnType<typeof decodeIdentifierValue> | null = null;
  try {
    if (typeof field.default === "string") decoded = decodeIdentifierValue(field.default);
  } catch { /* Keep an invalid input visible for correction. */ }
  const [valueDraft, setValueDraft] = useState({
    stored: field.default,
    kind: decoded?.kind_id ?? settings.default_kind_id,
    raw: decoded?.raw ?? "",
  });
  const sameDraft = valueDraft.stored === field.default;
  const raw = sameDraft ? valueDraft.raw : decoded?.raw ?? "";
  const defaultKind = sameDraft ? valueDraft.kind : decoded?.kind_id ?? settings.default_kind_id;
  const name = (kind: IdentifierKindMetadata) => `${kind.source_label} · ${kind.label}`;
  const referenced = settings.allowed_kind_ids.filter((id) => !kinds.some((kind) => kind.id === id));
  const defaultError = field.default !== undefined && field.default !== null &&
      (!identifierRawValue.safeParse(raw).success || !settings.allowed_kind_ids.includes(defaultKind) ||
        !kinds.some((kind) => kind.id === defaultKind && kind.active))
    ? "허용된 활성 종류와 원본 문자열 1~200자를 입력하세요."
    : undefined;
  const setDefault = (kind: string, value: string) => {
    let next = "";
    try {
      next = encodeIdentifierValue(kind, value);
    } catch { /* An invalid raw draft never becomes an encoded stored value. */ }
    setValueDraft({ stored: next, kind, raw: value });
    onChange({ ...field, default: next });
  };
  return (
    <FieldGroup className="min-w-0 col-span-full">
      {selected && (
        <p className="text-sm text-muted-foreground">
          <Badge variant="secondary">자료 식별자</Badge> 등록 후 값은 변경할 수 없습니다.
        </p>
      )}
      <FieldSet disabled={disabled} className="min-w-0">
        <FieldLegend className="text-sm">허용 식별자 종류</FieldLegend>
        {onAddKind && (
          <Button variant="outline" type="button" disabled={disabled} onClick={onAddKind}>식별자 종류 추가</Button>
        )}
        <div className="flex min-w-0 flex-col gap-2">
          {kinds.map((kind) => {
            const allowed = settings.allowed_kind_ids.includes(kind.id),
              isDefault = settings.default_kind_id === kind.id;
            return (
              <FieldLabel key={kind.id} className="flex min-h-11 cursor-pointer items-center gap-3">
                <Checkbox
                  value={kind.id}
                  checked={allowed}
                  disabled={disabled || isDefault || !kind.active && !allowed}
                  onCheckedChange={(checked) =>
                    onChange({
                      ...field,
                      "x-identifier": {
                        ...settings,
                        allowed_kind_ids: checked === true
                          ? [...settings.allowed_kind_ids, kind.id]
                          : settings.allowed_kind_ids.filter((id) => id !== kind.id),
                      },
                    })}
                />
                <span className="min-w-0 wrap-anywhere">{name(kind)}{!kind.active && " · 중지"}</span>
              </FieldLabel>
            );
          })}
          {referenced.map((id) => <p key={id} className="text-sm text-destructive">조회할 수 없는 허용 종류: {id}</p>)}
        </div>
      </FieldSet>
      <Field label="기본 식별자 종류" help="신규 입력에서 먼저 선택할 종류입니다. 기존 값은 바뀌지 않습니다.">
        {(props) => (
          <NativeSelect
            {...props}
            aria-label="기본 식별자 종류"
            disabled={disabled}
            value={settings.default_kind_id}
            onChange={(e) => onChange({ ...field, "x-identifier": { ...settings, default_kind_id: e.target.value } })}
          >
            {kinds.filter((kind) => settings.allowed_kind_ids.includes(kind.id)).map((kind) => (
              <NativeSelectOption key={kind.id} value={kind.id} disabled={!kind.active}>
                {name(kind)}
                {!kind.active && " · 중지"}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        )}
      </Field>
      {!selected && (
        <>
          <Field label="식별자 생성 기본값" help="선택 항목을 비워 두면 자동 발급하지 않습니다.">
            {(props) => (
              <NativeSelect
                {...props}
                aria-label="식별자 생성 기본값"
                disabled={disabled}
                value={field.default === undefined ? "unset" : field.default === null ? "null" : "value"}
                onChange={(e) =>
                  onChange({
                    ...field,
                    default: e.target.value === "unset" ? undefined : e.target.value === "null" ? null : "",
                  })}
              >
                <NativeSelectOption value="unset">설정 안 함</NativeSelectOption>
                {Array.isArray(field.type) && field.type.includes("null") && (
                  <NativeSelectOption value="null">비워 두기</NativeSelectOption>
                )}
                <NativeSelectOption value="value">값 지정</NativeSelectOption>
              </NativeSelect>
            )}
          </Field>
          {field.default !== undefined && field.default !== null && (
            <>
              <Field label="기본값의 식별자 종류">
                {(props) => (
                  <NativeSelect
                    {...props}
                    aria-label="기본값의 식별자 종류"
                    disabled={disabled}
                    value={defaultKind}
                    onChange={(e) => setDefault(e.target.value, raw)}
                  >
                    {kinds.filter((kind) => settings.allowed_kind_ids.includes(kind.id)).map((kind) => (
                      <NativeSelectOption key={kind.id} value={kind.id} disabled={!kind.active}>
                        {name(kind)}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                )}
              </Field>
              <Field label="식별자 기본 원본 값" error={defaultError}>
                {(props) => (
                  <Input
                    {...props}
                    aria-label="식별자 기본 원본 값"
                    disabled={disabled}
                    value={raw}
                    onChange={(e) => setDefault(defaultKind, e.target.value)}
                  />
                )}
              </Field>
            </>
          )}
        </>
      )}
    </FieldGroup>
  );
}
