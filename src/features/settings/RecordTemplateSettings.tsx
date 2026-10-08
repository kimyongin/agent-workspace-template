import { useEffect, useRef, useState } from "react";
import type { BusinessSettingsResult } from "@contracts/business-settings.ts";
import { modelActions, recordTemplates, renderTemplate, TEMPLATE_MODELS, templateActionNames, templateFields, templateModelNames, templateVariables, type RecordTemplates, type TemplateAction, type TemplateModel } from "@contracts/record-template.ts";
import { Field, Notice } from "../../components/Field.tsx";
import { TagPicker } from "../tags/TagPicker.tsx";
import { api, ApiError } from "../../lib/api.ts";

const examples: Record<TemplateModel, Record<string, unknown>> = {
  entity: { prop1: "예시 엔터티", prop2: 0, prop3: null, prop4: "a", tag_ids: [], source: "app", external_id: "001" },
  task: { title: "예시 할 일", body: "", kind: "once", status: "open", due_on: null, recurrence: null, timezone: null, tag_ids: [], entity_ids: [], pauses: [] },
  principle: { title: "예시 원칙", body: "" },
};
export function RecordTemplateSettings() {
  const [saved, setSaved] = useState<BusinessSettingsResult | null>(null);
  const [draft, setDraft] = useState<RecordTemplates>({});
  const [model, setModel] = useState<TemplateModel>("entity");
  const [action, setAction] = useState<TemplateAction>("create");
  const [sample, setSample] = useState(examples.entity);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [missing, setMissing] = useState<string[]>([]);
  const text = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all([
      api<BusinessSettingsResult>("GET", "/settings/business", undefined, controller.signal),
      api<{ items: { id: string }[] }>("GET", "/tags?scope=record&limit=100", undefined, controller.signal),
    ]).then(([settings, tags]) => {
      setSaved(settings); setDraft(settings.settings.record_templates ?? {});
      const available = new Set(tags.items.map(tag => tag.id));
      setMissing([...new Set(Object.values(settings.settings.record_templates ?? {}).flatMap(group => Object.values(group).flatMap(value => value?.tag_ids ?? [])))].filter(id => !available.has(id)));
    }).catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "설정을 읽지 못했습니다."); });
    return () => controller.abort();
  }, []);
  const value = draft[model]?.[action] ?? { memo: "", tag_ids: [] };
  const setValue = (patch: Partial<typeof value>) => { setDraft(current => ({ ...current, [model]: { ...current[model], [action]: { ...value, ...patch } } })); setMessage(""); setFields({}); };
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved?.settings.record_templates ?? {});
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", unload); return () => window.removeEventListener("beforeunload", unload);
  }, [dirty]);
  const parse = recordTemplates.safeParse(draft);
  const currentError = parse.success ? null : parse.error.issues.find(issue => issue.path[0] === model && issue.path[1] === action)?.message;
  const preview = currentError ? "" : renderTemplate(value.memo, { model, action, target: String(sample.prop1 ?? sample.title), changes: `${String(sample.prop1 ?? sample.title)} ${templateActionNames[action]}`, before: action === "create" ? null : sample, after: action === "delete" ? null : sample });
  return <section className="settings-group" aria-labelledby="record-template-title">
    <h2 className="section-title" id="record-template-title">변경 기록 기본값</h2>
    <p className="secondary">엔터티·할 일·원칙의 메모와 기록 태그를 정합니다. 이미 저장한 기록은 바뀌지 않습니다. 빈 메모는 변경 내용을 설명합니다.</p>
    {!saved && <p role="status">{message || "설정을 읽는 중…"}</p>}
    {saved && <form className="form" aria-label="변경 기록 기본값" onSubmit={async event => {
      event.preventDefault(); if (busy || !dirty) return;
      if (!parse.success) { setFields(Object.fromEntries(parse.error.issues.map(issue => [issue.path.join("."), issue.message]))); setMessage("템플릿 오류를 확인하세요."); return; }
      setBusy(true); setMessage("");
      try {
        const result = await api<BusinessSettingsResult>("PATCH", "/settings/business", { expected_version: saved.version, sections: { record_templates: parse.data } });
        setSaved(result); setDraft(result.settings.record_templates ?? {}); setMessage("기록 기본값을 저장했습니다."); setMissing([]);
      } catch (error) { setMessage(error instanceof Error ? error.message : "저장하지 못했습니다."); if (error instanceof ApiError) setFields(Object.fromEntries(error.fields.map(field => [field.path.replace(/^sections.record_templates\./, ""), field.message]))); }
      finally { setBusy(false); }
    }}>
      {missing.length > 0 && <Notice kind="error">삭제된 기본 기록 태그 {missing.length}개를 정리해야 합니다. <button type="button" className="btn" onClick={() => { setDraft(current => Object.fromEntries(Object.entries(current).map(([key, group]) => [key, Object.fromEntries(Object.entries(group).map(([name, template]) => [name, template && { ...template, tag_ids: template.tag_ids.filter(id => !missing.includes(id)) }]))]))); setMissing([]); }}>삭제된 태그 정리</button></Notice>}
      <fieldset disabled={busy} className="form plain-fieldset">
        <div className="field-row">
          <Field label="모델">{props => <select {...props} className="input" value={model} onChange={event => { const next = event.target.value as TemplateModel; setModel(next); setSample(examples[next]); if (!modelActions(next).includes(action)) setAction("create"); }}>{TEMPLATE_MODELS.map(key => <option key={key} value={key}>{templateModelNames[key]}</option>)}</select>}</Field>
          <Field label="액션">{props => <select {...props} className="input" value={action} onChange={event => setAction(event.target.value as TemplateAction)}>{modelActions(model).map(key => <option key={key} value={key}>{templateActionNames[key]}</option>)}</select>}</Field>
        </div>
        <Field label="메모 템플릿" error={fields[`${model}.${action}.memo`] ?? currentError ?? undefined}>{props => <textarea {...props} ref={text} className="input" rows={4} value={value.memo} onChange={event => setValue({ memo: event.target.value })} />}</Field>
        <Field label="변수 삽입">{props => <select {...props} className="input" value="" onChange={event => {
          const variable = `\${${event.target.value}$}`;
          const start = text.current?.selectionStart ?? value.memo.length, end = text.current?.selectionEnd ?? start;
          setValue({ memo: value.memo.slice(0, start) + variable + value.memo.slice(end) }); text.current?.focus();
        }}><option value="" disabled>변수를 선택하세요</option>{templateVariables(model, action).map(variable => <option key={variable}>{variable}</option>)}</select>}</Field>
        <TagPicker label="기본 기록 태그" scope="record" value={value.tag_ids} onChange={tag_ids => setValue({ tag_ids })} />
        <details><summary>미리보기 예시 값 편집</summary><div className="form">{Object.entries(templateFields[model]).filter(([, key]) => !Array.isArray(sample[key]) && typeof sample[key] !== "object" || sample[key] === null).map(([label, key]) => <Field key={key} label={label}>{props => <input {...props} className="input" value={sample[key] == null ? "" : String(sample[key])} onChange={event => setSample(current => ({ ...current, [key]: key === "prop2" ? event.target.value === "" ? null : Number(event.target.value) : event.target.value || null }))} />}</Field>)}</div></details>
        <div className="field"><span className="label">생성 결과 미리보기 (예시 값)</span><output className="secondary" style={{ whiteSpace: "pre-wrap" }}>{preview || `${String(sample.prop1 ?? sample.title)} ${templateActionNames[action]}`}</output></div>
        {Object.entries(fields).filter(([key]) => key !== `${model}.${action}.memo`).map(([key, error]) => <p className="error-text" key={key}>{key}: {error}</p>)}
        <p role="status">{message}</p>
        <div className="actions"><button type="button" className="btn" disabled={!dirty} onClick={() => { setDraft(saved.settings.record_templates ?? {}); setFields({}); setMessage(""); }}>변경 취소</button><button type="submit" className="btn btn-primary" disabled={!dirty}>{busy ? "저장 중…" : "기록 기본값 저장"}</button></div>
      </fieldset>
    </form>}
  </section>;
}
