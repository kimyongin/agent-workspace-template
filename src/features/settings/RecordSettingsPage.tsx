import { useCallback, useEffect, useState } from "react";
import { useBlocker } from "react-router";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { useEntityTypes } from "../entity/useEntityTypes.ts";
import { RecordTemplateSettings } from "./RecordTemplateSettings.tsx";
import { createMaterialTemplateDraft, createTaskTemplateDraft } from "./material-template-drafts.ts";
import { MaterialSettingsSection, type MaterialSectionState } from "./MaterialSettingsSection.tsx";
import { SettingsHeading } from "./SettingsHeading.tsx";
import "./settings.css";
type Target = { id: string; label: string; model: "entity" | "task"; typeId?: string };
export function RecordSettingsPage() {
  const catalog = useEntityTypes();
  const targets: Target[] = [...(catalog.types ?? []).map(type => ({ id: `type:${type.id}`, label: type.label, model: "entity" as const, typeId: type.id })), { id: "task", label: "할 일", model: "task" }];
  const [selected, setSelected] = useState("task");
  const [visited, setVisited] = useState(["task"]);
  const [states, setStates] = useState<Record<string, MaterialSectionState>>({});
  const report = useCallback((id: string, state: MaterialSectionState) => setStates(current => ({ ...current, [id]: state })), []);
  const busy = Object.values(states).some(state => state.busy);
  const dirty = Object.values(states).some(state => state.dirty || state.uncertain);
  const blocker = useBlocker(dirty || busy);
  useEffect(() => { if (busy && blocker.state === "blocked") blocker.reset(); }, [busy, blocker]);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload);
    return () => window.removeEventListener("beforeunload", unload);
  }, [dirty, busy]);
  return <section className="panel settings" aria-label="기록 설정">
    <SettingsHeading title="기록 설정" description="업무별 기록 메모의 기본 문구와 태그를 설정합니다." />
    <Field label="대상" hideLabel>{props => <select {...props} className="input" value={selected} onChange={event => { const id = event.target.value; setSelected(id); setVisited(current => current.includes(id) ? current : [...current, id]); }}>{targets.map(target => <option key={target.id} value={target.id}>{target.label}{states[target.id]?.uncertain ? " · 결과 확인 필요" : states[target.id]?.dirty ? " · 미저장" : ""}</option>)}</select>}</Field>
    {catalog.error && <Notice kind="error">자료 종류를 읽지 못했습니다. <button type="button" className="btn" onClick={catalog.retry}>다시 시도</button></Notice>}
    {visited.map(id => { const target = targets.find(target => target.id === id); return target && <div key={id} hidden={selected !== id}><TargetEditor target={target} report={report} /></div>; })}
    <ConfirmDialog open={!busy && blocker.state === "blocked"} title="변경을 버릴까요?" message="저장하지 않은 기록 설정이 사라집니다." confirmLabel="변경 버리기" onConfirm={() => { if (blocker.state === "blocked") blocker.proceed(); }} onCancel={() => { if (blocker.state === "blocked") blocker.reset(); }} />
  </section>;
}
function TargetEditor({ target, report }: { target: Target; report: (id: string, state: MaterialSectionState) => void }) {
  const [resource] = useState(() => target.typeId ? createMaterialTemplateDraft(target.typeId) : createTaskTemplateDraft());
  const [state, setState] = useState<MaterialSectionState>({ dirty: false, busy: false });
  const onStateChange = useCallback((next: MaterialSectionState) => { setState(next); report(target.id, next); }, [report, target.id]);
  useEffect(() => {
    const refresh = () => { void resource.read(); };
    window.addEventListener("workspace:tags-changed", refresh);
    window.addEventListener("workspace:record-settings-changed", refresh);
    return () => { window.removeEventListener("workspace:tags-changed", refresh); window.removeEventListener("workspace:record-settings-changed", refresh); resource.dispose(); };
  }, [resource]);
  return <MaterialSettingsSection title="기록 자동 완성" state={state} initialOpen><RecordTemplateSettings materialResource={resource} materialTypeId={target.typeId} selectedModel={target.model} onStateChange={onStateChange} /></MaterialSettingsSection>;
}
