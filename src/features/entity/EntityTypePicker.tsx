import { useMemo } from "react";
import type { EntityType } from "@contracts/entity-type.ts";
import { Field } from "../../components/Field.tsx";
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from "../../components/ui/combobox.tsx";

export function EntityTypePicker({ types, value, onChange, all = false, disabled = false, error, compact = false }: {
  types: EntityType[]; value: string; onChange: (id: string) => void; all?: boolean;
  disabled?: boolean; error?: string; compact?: boolean;
}) {
  const options = useMemo(() => [
    { id: "", label: all ? "전체 자료" : "자료 종류 선택" },
    ...types.map(type => ({ id: type.id, label: `${type.label}${type.archived ? " · 보관" : ""}` })),
    ...(value && !types.some(type => type.id === value) ? [{ id: value, label: "찾을 수 없는 자료 종류" }] : []),
  ], [types, value, all]);
  return <Field label="자료 종류" hideLabel={compact} error={error}>
    {props => <Combobox items={options} value={options.find(option => option.id === value) ?? null}
      disabled={disabled} itemToStringLabel={option => option.label} itemToStringValue={option => option.id}
      onValueChange={option => onChange(option?.id ?? "")}>
      <ComboboxInput {...props} disabled={disabled} aria-required={!all || undefined} placeholder={all ? "전체 자료" : "자료 종류 선택"} />
      <ComboboxContent><ComboboxEmpty>조건에 맞는 자료 종류가 없습니다.</ComboboxEmpty>
        <ComboboxList>{(option: { id: string; label: string }) => <ComboboxItem key={option.id} value={option}>{option.label}</ComboboxItem>}</ComboboxList>
      </ComboboxContent>
    </Combobox>}
  </Field>;
}
