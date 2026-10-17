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
    <div className="schema-representative-setting">
      <label className="schema-representative-choice settings-choice-pair">
        <input
          type="radio"
          name="schema-representative"
          aria-label={`${field.title || "새 항목"} 자료 이름으로 사용`}
          checked={schemaPresentation(draft).representative === propertyKey}
          disabled={disabled || !eligible}
          onChange={() => chooseRepresentative(propertyKey)}
        />
        <span>자료 이름으로 사용</span>
      </label>
      {!eligible && (
        <p className="secondary">필수 텍스트 항목만 선택할 수 있습니다. 최소 길이는 1자 이상이어야 합니다.</p>
      )}
    </div>
  );
}
