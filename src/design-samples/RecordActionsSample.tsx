import { TemplateMemoEditor } from "../features/settings/TemplateMemoEditor.tsx";
import { useState } from "react";
import { Field } from "../components/Field.tsx";
import { BodyAction } from "../components/BodyAction.tsx";
import {
  modelActions,
  type RecordTemplates,
  recordTemplates,
  type TemplateAction,
  templateActionNames,
  templateVariables,
} from "@contracts/record-template.ts";
import { changedTemplateActions, templateFieldTarget } from "../features/settings/record-template-actions.ts";

/** The same action/error meanings as the real editor, with memory-only saving. */
export function RecordActionsSample() {
  const [saved, setSaved] = useState<RecordTemplates>({});
  const [draft, setDraft] = useState<RecordTemplates>({});
  const [action, setAction] = useState<TemplateAction>("create");
  const [message, setMessage] = useState("");
  const changes = changedTemplateActions(draft, saved, "task", "");
  const result = recordTemplates.safeParse(draft);
  const errors = result.success ? [] : result.error.issues.flatMap((issue) => {
    const target = templateFieldTarget(issue.path.join("."));
    return target ? [{ action: target.action, message: issue.message }] : [];
  });
  return (
    <section className="settings-section" aria-label="액션별 저장 샘플">
      <h2 className="settings-section-title">기록 자동 완성</h2>
      <form
        className="key-value-grid"
        onSubmit={(event) => {
          event.preventDefault();
          if (!result.success) return;
          setSaved(structuredClone(draft));
          setMessage("예시 변경을 저장했습니다.");
        }}
      >
        <Field pair label="액션">
          {(props) => (
            <select
              {...props}
              className="input"
              value={action}
              onChange={(event) => setAction(event.target.value as TemplateAction)}
            >
              {modelActions("task").map((key) => (
                <option key={key} value={key}>
                  {templateActionNames[key]}
                  {errors.some((error) => error.action === key) ? " · 오류" : changes.includes(key) ? " · 미저장" : ""}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field pair fullWidth label="메모 템플릿" error={errors.find((error) => error.action === action)?.message}>
          {(props) => (
            <TemplateMemoEditor
              key={action}
              {...props}
              variables={templateVariables("task", action).map((value) => ({ value, label: value }))}
              value={draft.task?.[action]?.memo ?? "$대상$ $액션$"}
              onChange={(memo) => {
                setDraft({ task: { ...draft.task, [action]: { memo, tag_ids: [] } } });
                setMessage("");
              }}
            />
          )}
        </Field>
        {errors.filter((error) => error.action !== action).map((error, index) => (
          <p className="error-text" key={index}>
            {templateActionNames[error.action]}: {error.message}{" "}
            <BodyAction icon="view" onClick={() => setAction(error.action)}>오류 항목 보기</BodyAction>
          </p>
        ))}
        {message && <p role="status">{message}</p>}
        <div className="settings-section-footer">
          {changes.length > 0 && (
            <p className="secondary" aria-label="저장할 변경">
              변경: {changes.map((key) => templateActionNames[key]).join(" · ")}
            </p>
          )}
          <div className="actions">
            <button
              className="btn"
              type="button"
              disabled={!changes.length}
              onClick={() => {
                setDraft(structuredClone(saved));
                setMessage("");
              }}
            >
              취소
            </button>
            <button className="btn btn-primary" type="submit" disabled={!changes.length || !result.success}>
              저장
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}
