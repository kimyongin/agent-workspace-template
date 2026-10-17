import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FieldLabel } from "@/components/ui/field";
import { fieldChoices } from "../../lib/schema-document.ts";
import { schemaPresentation } from "../../lib/schema-document.ts";
import type { SchemaDefinition } from "@contracts/entity-schema-change.ts";

/** Each property edits the representative in the same schema draft. */
export function SchemaRepresentativeSetting({ draft, propertyKey, disabled, chooseRepresentative }: {
  draft: SchemaDefinition;
  propertyKey: string;
  disabled: boolean;
  chooseRepresentative: (key: string) => void;
}) {
  const field = draft.schema.properties[propertyKey];
  const eligible = !schemaPresentation(draft).archived.includes(propertyKey) &&
    field.type === "string" && !field.format && !fieldChoices(field) && draft.schema.required.includes(propertyKey) &&
    (field.minLength ?? 0) >= 1;
  return (
    <div className="flex flex-col gap-2">
      <RadioGroup value={schemaPresentation(draft).representative} onValueChange={chooseRepresentative} disabled={disabled || !eligible} aria-label={`${field.title || "새 항목"} 대표 항목 선택`}>
        <FieldLabel className="flex min-h-11 cursor-pointer items-center gap-3"><RadioGroupItem value={propertyKey} aria-label={`${field.title || "새 항목"} 자료 이름으로 사용`} />자료 이름으로 사용</FieldLabel>
      </RadioGroup>
      {!eligible && (
        <p className="text-sm text-muted-foreground">필수 텍스트 항목만 선택할 수 있습니다. 최소 길이는 1자 이상이어야 합니다.</p>
      )}
    </div>
  );
}
