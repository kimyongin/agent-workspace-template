import type { SchemaDefinition } from "@contracts/entity-schema-change.ts";
import { Field } from "../../components/Field.tsx";

/** Representative selection edits the same draft as input and list settings. */
export function SchemaRepresentativeSetting({ draft, disabled, chooseRepresentative }: {
  draft: SchemaDefinition;
  disabled: boolean;
  chooseRepresentative: (key: string) => void;
}) {
  const label = (key: string) => draft.schema.properties[key].title || "이름 없는 항목";
  const canRepresent = (key: string) => {
    const field = draft.schema.properties[key];
    return !key.startsWith("new_") && !draft.display.archived.includes(key) && field.type === "string" &&
      !field.format && !field.enum && draft.schema.required.includes(key) && (field.minLength ?? 0) >= 1;
  };
  return (
    <div className="schema-display-settings">
      <fieldset className="settings-fields" disabled={disabled}>
        <Field label="자료 이름으로 사용할 항목" help="필수 텍스트이며 빈 문자열을 허용하지 않는 항목을 선택하세요.">
          {(props) => (
            <select
              {...props}
              className="input"
              value={draft.display.representative}
              onChange={(event) => chooseRepresentative(event.target.value)}
            >
              {draft.display.order.map((key) => (
                <option key={key} value={key} disabled={!canRepresent(key)}>
                  {label(key)}
                  {key.startsWith("new_")
                    ? " (검토 후 선택)"
                    : draft.display.archived.includes(key)
                    ? " (사용 중지)"
                    : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
      </fieldset>
    </div>
  );
}
