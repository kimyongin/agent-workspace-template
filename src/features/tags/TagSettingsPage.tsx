import { usePageNavigationBlocker } from "../details/workspace-context.ts";
import { SettingsHeading } from "../settings/SettingsHeading.tsx";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ConfirmationSurface, ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { type SurfaceAction, SurfaceActionContext } from "../../components/Modal.tsx";
import { Field } from "../../components/Field.tsx";
import { type MaterialSectionState, MaterialSettingsSection } from "../settings/MaterialSettingsSection.tsx";
import { type TagScope, tagScopeLabels } from "./TagPicker.tsx";
import { TagManagement } from "./TagsPage.tsx";
import "../settings/settings.css";

/** One settings surface; each target keeps its independent tag dictionary. */
export function TagSettingsPage() {
  const [params] = useSearchParams(), navigate = useNavigate();
  const rawScope = params.get("scope");
  const scope: TagScope = rawScope === "task" || rawScope === "record" ? rawScope : "entity";
  const [state, setState] = useState<MaterialSectionState>({ dirty: false, busy: false });
  const [action, setAction] = useState<SurfaceAction | null>(null);
  const selector = useRef<HTMLSelectElement>(null);
  const blocker = usePageNavigationBlocker(state.dirty, state.busy);
  useEffect(() => {
    if (state.busy && blocker.state === "blocked") blocker.reset();
  }, [state.busy, blocker]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (state.dirty || state.busy) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [state.dirty, state.busy]);
  return (
    <section className="panel settings" aria-labelledby="tag-heading">
      <SettingsHeading title="태그 설정" description="자료·할 일·기록에 사용할 태그를 한곳에서 관리합니다." id="tag-heading" tabIndex={-1} />

      <div className="material-settings-toolbar">
        <Field label="관리 대상" hideLabel>
          {(props) => (
            <select
              {...props}
              ref={selector}
              className="input"
              value={scope}
              disabled={state.busy}
              onChange={(event) => navigate(`/settings/tags?scope=${event.target.value}`)}
            >
              {Object.entries(tagScopeLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select>
          )}
        </Field>
      </div>
      <MaterialSettingsSection title="태그" initialOpen state={state}>
        <SurfaceActionContext.Provider value={setAction}>
          <TagManagement key={scope} scope={scope} inline onStateChange={setState} />
        </SurfaceActionContext.Provider>
      </MaterialSettingsSection>
      {action && (
        <ConfirmationSurface
          open
          title={action.title}
          busy={action.busy}
          onCancel={action.onCancel}
          closeButton
          footer={action.footer}
        >
          <div className="surface-action">{action.body}</div>
        </ConfirmationSurface>
      )}
      <ConfirmDialog
        open={!state.busy && blocker.state === "blocked"}
        title="변경을 버릴까요?"
        message="저장하지 않은 태그 변경이 사라집니다."
        confirmLabel="변경 버리기"
        onCancel={() => {
          if (blocker.state === "blocked") blocker.reset();
          selector.current?.focus();
        }}
        onConfirm={() => {
          if (blocker.state === "blocked") blocker.proceed();
        }}
      />
    </section>
  );
}
