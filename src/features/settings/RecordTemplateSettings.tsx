import { useEffect, useRef, useState } from "react";
import type { BusinessSettingsResult } from "@contracts/business-settings.ts";
import { DEFAULT_RECORD_MEMO_TEMPLATES, editableRecordTemplates, effectiveRecordTemplate, modelActions, recordTemplates, TEMPLATE_MODELS, templateActionNames, templateModelNames, templateVariables, type RecordTemplates, type TemplateAction, type TemplateModel } from "@contracts/record-template.ts";
import { Field, Notice } from "../../components/Field.tsx";
import { TagPicker } from "../tags/TagPicker.tsx";
import { api, ApiError } from "../../lib/api.ts";

export function RecordTemplateSettings({onStateChange}: {onStateChange?: (state: {dirty:boolean;busy:boolean})=>void}) {
  const [saved, setSaved] = useState<BusinessSettingsResult | null>(null);
  const [draft, setDraft] = useState<RecordTemplates>({});
  const [model, setModel] = useState<TemplateModel>("entity");
  const [action, setAction] = useState<TemplateAction>("create");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const text = useRef<HTMLTextAreaElement>(null);
  const read = (signal?: AbortSignal) => Promise.all([
      api<BusinessSettingsResult>("GET", "/settings/business", undefined, signal),
      (async()=>{const items:{id:string}[]=[];let cursor:string|null=null;do{const result: {items:{id:string}[];next_cursor:string|null}=await api("GET",`/tags?scope=record&limit=100${cursor?`&cursor=${encodeURIComponent(cursor)}`:""}`,undefined,signal);items.push(...result.items);cursor=result.next_cursor;}while(cursor);return {items};})(),
    ]).then(([settings, tags]) => {
      if(signal?.aborted) return;
      setSaved(settings); setDraft(editableRecordTemplates(settings.settings.record_templates));
      setMessage("");
      const available = new Set(tags.items.map(tag => tag.id));
      setMissing([...new Set(Object.values(settings.settings.record_templates ?? {}).flatMap(group => Object.values(group).flatMap(value => value?.tag_ids ?? [])))].filter(id => !available.has(id)));
    }).catch(error => { if (!signal?.aborted) setMessage(error instanceof Error ? error.message : "설정을 읽지 못했습니다."); });
  useEffect(() => {
    const controller = new AbortController();
    void read(controller.signal);
    return () => controller.abort();
  }, []);
  const value = draft[model]?.[action] ?? effectiveRecordTemplate(undefined, model, action);
  const setValue = (patch: Partial<typeof value>) => { setDraft(current => ({ ...current, [model]: { ...current[model], [action]: { ...value, ...patch } } })); setMessage(""); setFields({}); };
  const dirty = JSON.stringify(draft) !== JSON.stringify(editableRecordTemplates(saved?.settings.record_templates));
  useEffect(()=>{onStateChange?.({dirty,busy});},[dirty,busy,onStateChange]);
  const parse = recordTemplates.safeParse(draft);
  const currentError = parse.success ? null : parse.error.issues.find(issue => issue.path[0] === model && issue.path[1] === action)?.message;
  return <section className="settings-section" aria-labelledby="record-template-title">
    <h2 className="settings-section-title" id="record-template-title">변경 기록 기본값</h2>
    {!saved && <><p role={message ? "alert" : "status"}>{message || "설정을 읽는 중…"}</p>{message && <button type="button" className="btn" onClick={()=>void read()}>다시 시도</button>}</>}
    {saved && <form className="form" aria-label="변경 기록 기본값" onSubmit={async event => {
      event.preventDefault(); if (busy || !dirty) return;
      if (!parse.success) { setFields(Object.fromEntries(parse.error.issues.map(issue => [issue.path.join("."), issue.message]))); setMessage("템플릿 오류를 확인하세요."); return; }
      setBusy(true); setMessage("");
      try {
        const result = await api<BusinessSettingsResult>("PATCH", "/settings/business", { id: "record_templates", expected_version: saved.versions.record_templates, value: parse.data });
        setSaved(result); setDraft(editableRecordTemplates(result.settings.record_templates)); setMessage("기록 기본값을 저장했습니다."); setMissing([]); setConflict(false);
      } catch (error) { setMessage(error instanceof Error ? error.message : "저장하지 못했습니다."); if (error instanceof ApiError) {setConflict(error.status===409); setFields(Object.fromEntries(error.fields.map(field => [field.path.replace(/^value\./, ""), field.message]))); } }
      finally { setBusy(false); }
    }}>
      {missing.length > 0 && <Notice kind="error">삭제된 기본 기록 태그 {missing.length}개를 정리해야 합니다. <button type="button" className="btn" onClick={() => { setDraft(current => Object.fromEntries(Object.entries(current).map(([key, group]) => [key, Object.fromEntries(Object.entries(group).map(([name, template]) => [name, template && { ...template, tag_ids: template.tag_ids.filter(id => !missing.includes(id)) }]))]))); setMissing([]); }}>삭제된 태그 정리</button></Notice>}
      <fieldset disabled={busy} className="form plain-fieldset">
        <div className="field-row">
          <Field label="모델">{props => <select {...props} className="input" value={model} onChange={event => { const next = event.target.value as TemplateModel; setModel(next); if (!modelActions(next).includes(action)) setAction("create"); }}>{TEMPLATE_MODELS.map(key => <option key={key} value={key}>{templateModelNames[key]}</option>)}</select>}</Field>
          <Field label="액션">{props => <select {...props} className="input" value={action} onChange={event => setAction(event.target.value as TemplateAction)}>{modelActions(model).map(key => <option key={key} value={key}>{templateActionNames[key]}</option>)}</select>}</Field>
        </div>
        <Field label="메모 템플릿" help={`사용자 설정이 없거나 비어 있으면 기본 템플릿 ${DEFAULT_RECORD_MEMO_TEMPLATES[action]}을 사용합니다. 달러 기호 자체는 $$로 입력하세요.`} error={fields[`${model}.${action}.memo`] ?? currentError ?? undefined}>{props => <textarea {...props} ref={text} className="input" rows={3} value={value.memo} onChange={event => setValue({ memo: event.target.value })} />}</Field>
        <Field label="변수 삽입">{props => <select {...props} className="input" value="" onChange={event => {
          const variable = `$${event.target.value}$`;
          const start = text.current?.selectionStart ?? value.memo.length, end = text.current?.selectionEnd ?? start;
          setValue({ memo: value.memo.slice(0, start) + variable + value.memo.slice(end) }); text.current?.focus();
        }}><option value="" disabled>변수를 선택하세요</option>{templateVariables(model, action).map(variable => <option key={variable}>{variable}</option>)}</select>}</Field>
        <TagPicker label="기본 기록 태그" scope="record" value={value.tag_ids} onChange={tag_ids => setValue({ tag_ids })} />
        {Object.entries(fields).filter(([key]) => key !== `${model}.${action}.memo`).map(([key, error]) => <p className="error-text" key={key}>{templateModelNames[key.split(".")[0] as TemplateModel] ?? "설정"} {templateActionNames[key.split(".")[1] as TemplateAction] ?? ""}: {error} <button type="button" className="btn" onClick={()=>{const [nextModel,nextAction]=key.split(".");if(TEMPLATE_MODELS.includes(nextModel as TemplateModel)){setModel(nextModel as TemplateModel);setAction(nextAction as TemplateAction);}}}>오류 항목 보기</button></p>)}
        <p role="status">{message}</p>
        {conflict&&<button type="button" className="btn" onClick={async()=>{try{setSaved(await api<BusinessSettingsResult>("GET","/settings/business"));setConflict(false);setMessage("최신 설정을 읽었습니다. 입력한 템플릿은 유지했습니다. 확인한 뒤 다시 저장하세요.");}catch{setMessage("최신 설정을 읽지 못했습니다. 다시 시도하세요.");}}}>최신값 확인</button>}
        <div className="settings-section-footer"><div className="actions"><button type="button" className="btn" disabled={!dirty} onClick={() => { setDraft(editableRecordTemplates(saved.settings.record_templates)); setFields({}); setMessage(""); setConflict(false); }}>변경 취소</button><button type="submit" className="btn btn-primary" disabled={!dirty}>{busy ? "저장 중…" : "기록 기본값 저장"}</button></div></div>
      </fieldset>
    </form>}
  </section>;
}
