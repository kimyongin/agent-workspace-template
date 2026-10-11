import { writeErrorMessage } from "../../lib/write-attempt.ts";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_RECORD_MEMO_TEMPLATES, effectiveRecordTemplate, modelActions, recordTemplates, TEMPLATE_MODELS, templateActionNames, templateModelNames, templateVariables, type TemplateAction, type TemplateModel } from "@contracts/record-template.ts";
import { Field, Notice } from "../../components/Field.tsx";
import { TagPicker } from "../tags/TagPicker.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { useSettingsDraft } from "./useSettingsDraft.ts";
import { createRecordTemplatesDraft, unavailableTemplateTags } from "./business-settings-drafts.ts";

const recordTemplatesDraft = createRecordTemplatesDraft(api);

export function RecordTemplateSettings({onStateChange}: {onStateChange?: (state: {dirty:boolean;busy:boolean})=>void}) {
  const editor = useSettingsDraft(recordTemplatesDraft,onStateChange);
  const {draft,dirty,busy,conflict,uncertain}=editor;
  const saved=editor.saved?.settings;
  const setDraft=editor.resource.edit;
  const [model, setModel] = useState<TemplateModel>("entity");
  const [action, setAction] = useState<TemplateAction>("create");
  const [message, setMessage] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const missing = unavailableTemplateTags(editor.saved,draft);
  const text = useRef<HTMLTextAreaElement>(null);
  const read=async()=>{const refreshing=!!saved;setMessage("");if(await editor.resource.read())setMessage(refreshing?"최신 설정을 읽었습니다. 입력한 템플릿은 유지했습니다. 확인한 뒤 다시 저장하세요.":"");};
  useEffect(()=>{if(editor.error){setMessage(writeErrorMessage(editor.error));if(editor.error instanceof ApiError)setFields(Object.fromEntries(editor.error.fields.map(field=>[field.path.replace(/^value\./,""),field.message])));}},[editor.error]);
  const value = draft[model]?.[action] ?? effectiveRecordTemplate(undefined, model, action);
  const setValue = (patch: Partial<typeof value>) => { setDraft(current => ({ ...current, [model]: { ...current[model], [action]: { ...value, ...patch } } })); setMessage(""); setFields({}); };
  const parse = recordTemplates.safeParse(draft);
  const currentError = parse.success ? null : parse.error.issues.find(issue => issue.path[0] === model && issue.path[1] === action)?.message;
  return <section className="settings-section" aria-labelledby="record-template-title">
    <h2 className="settings-section-title" id="record-template-title">변경 기록 기본값</h2>
    {!saved && <><p role={message ? "alert" : "status"}>{message || "설정을 읽는 중…"}</p>{message && <button type="button" className="btn" disabled={busy} onClick={()=>void read()}>다시 시도</button>}</>}
    {saved && <form className="form" aria-label="변경 기록 기본값" aria-busy={busy} onSubmit={async event => {
      event.preventDefault(); if (busy || !dirty) return;
      if (!parse.success) { setFields(Object.fromEntries(parse.error.issues.map(issue => [issue.path.join("."), issue.message]))); setMessage("템플릿 오류를 확인하세요."); return; }
      setMessage("");
      if(await editor.resource.save()){setMessage("기록 기본값을 저장했습니다.");setFields({});}
    }}>
      {missing.length > 0 && <Notice kind="error">삭제된 기본 기록 태그 {missing.length}개를 정리해야 합니다. <button type="button" className="btn" disabled={busy} onClick={() => { setDraft(current => Object.fromEntries(Object.entries(current).map(([key, group]) => [key, Object.fromEntries(Object.entries(group).map(([name, template]) => [name, template && { ...template, tag_ids: template.tag_ids.filter(id => !missing.includes(id)) }]))])));  }}>삭제된 태그 정리</button></Notice>}
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
        {conflict&&<button type="button" className="btn" onClick={()=>void read()}>최신값 확인</button>}
        <div className="settings-section-footer"><div className="actions"><button type="button" className="btn" disabled={!dirty} onClick={() => { editor.resource.reset(); setFields({}); setMessage(""); }}>변경 취소</button><button type="submit" className="btn btn-primary" disabled={!dirty}>{busy ? "저장 중…" : uncertain ? "같은 내용 다시 시도" : "기록 기본값 저장"}</button></div></div>
      </fieldset>
    </form>}
  </section>;
}
