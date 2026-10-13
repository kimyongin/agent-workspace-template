import type { SchemaDefinition } from "@contracts/entity-schema-change.ts";
import { Field } from "../../components/Field.tsx";

/** Display controls share the property editor’s draft and review. */
export function SchemaDisplaySettings({ draft, disabled, chooseRepresentative, editFlag, moveField }: {
  draft: SchemaDefinition;
  disabled: boolean;
  chooseRepresentative: (key: string) => void;
  editFlag: (key: string, name: "list_columns", value: boolean) => void;
  moveField: (key: string, offset: number) => void;
},
) {
  const active = draft.display.order.filter((key) => !draft.display.archived.includes(key));
  const label = (key: string) => draft.schema.properties[key].title || "이름 없는 속성";
  const canRepresent = (key: string) => {
    const field = draft.schema.properties[key];
    return !key.startsWith("new_") && !draft.display.archived.includes(key) && field.type === "string" &&
      !field.format && !field.enum && draft.schema.required.includes(key) && (field.minLength ?? 0) >= 1;
  };
  return (
    <div className="schema-display-settings">
      <p className="secondary">자료 이름과 목록 구성을 설정하세요.</p>
      <fieldset className="settings-fields" disabled={disabled}>
        <Field label="자료 이름으로 사용할 속성" help="필수 텍스트이며 빈 문자열을 허용하지 않는 속성을 선택하세요.">
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
                  {key.startsWith("new_") ? " (검토 후 선택)" : draft.display.archived.includes(key) ? " (사용 중지)"
                    : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
        <div>
          <h4>목록에 표시할 항목</h4>
          <p className="secondary">순서는 입력·상세 화면에도 함께 반영됩니다.</p>
          <ul className="schema-display-fields">
            {draft.display.order.map((key, index) => (
              <li key={key}>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`${label(key)} 목록에 표시`}
                    checked={draft.display.list_columns.includes(key)}
                    disabled={key.startsWith("new_") || draft.display.archived.includes(key)}
                    onChange={(event) => editFlag(key, "list_columns", event.target.checked)}
                  />
                  <span>{label(key)}{draft.display.archived.includes(key) ? " · 사용 중지" : ""}</span>
                </label>
                <div className="schema-order-actions">
                  <button
                    type="button"
                    className="btn"
                    aria-label={`${label(key)} 위로`}
                    disabled={index === 0}
                    onClick={() => moveField(key, -1)}
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    className="btn"
                    aria-label={`${label(key)} 아래로`}
                    disabled={index === draft.display.order.length - 1}
                    onClick={() => moveField(key, 1)}
                  >
                    ↓
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {active.some((key) => key.startsWith("new_")) && (
            <p className="secondary">새 속성은 변경 검토로 키를 발급받은 뒤 이름·목록 표시를 선택할 수 있습니다.</p>
          )}
        </div>
      </fieldset>
      </div>
  );
}
