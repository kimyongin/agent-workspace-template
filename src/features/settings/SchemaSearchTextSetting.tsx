import { supportsEntitySearchText, type EntityField } from "@contracts/entity-type.ts";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldLabel } from "@/components/ui/field";

/** Selection belongs to the same draft as the property's stable key and label. */
export function SchemaSearchTextSetting({ field, disabled, onChange }: {
  field: EntityField;
  disabled: boolean;
  onChange: (field: EntityField) => void;
}) {
  const unavailable = disabled || !supportsEntitySearchText(field);
  return (
    <Field orientation="horizontal" data-disabled={unavailable || undefined}>
      <FieldLabel className="min-h-11 cursor-pointer gap-3">
        <Checkbox
          aria-label={`${field.title || "새 항목"} 검색에 사용`}
          checked={field["x-search-text"] === true}
          disabled={unavailable}
          onCheckedChange={(checked) => onChange({ ...field, "x-search-text": checked === true })}
        />
        검색에 사용
      </FieldLabel>
    </Field>
  );
}
