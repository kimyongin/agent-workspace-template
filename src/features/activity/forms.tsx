// 할 일·기록 작성/편집 폼. 검증은 서버와 같은 contracts로 하고, 저장 실패 시 초안을 유지한다.
import { TagPicker } from "../tags/TagPicker.tsx";
import { EntityMultiPicker } from "../entity/EntityPicker.tsx";
import { recordCreate, recordLabels } from "@contracts/record.ts";
import { type Recurrence, taskCreate, taskLabels } from "@contracts/task.ts";
import { type ReactNode, useEffect, useState } from "react";
import { Field } from "../../components/Field.tsx";
import { changeNoteErrors, ChangeNoteField, FormModal, TextFields, type TextDraft } from "../../components/ContentForm.tsx";
import { browserTimezone, fieldErrors, fromLocalInput, todayIn, toLocalInput } from "../../lib/format.ts";
import { api } from "../../lib/api.ts";
import type { EntityContext } from "@contracts/entity-links.ts";
import type { ChangeMemo } from "@contracts/change.ts";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

// ---------- 기록 폼(직접 작성·완료 결과·회차 기록·편집) ----------

export interface RecordDraft extends TextDraft {
  change_note?: string;
  entity_id?:string|null;
  entity_ids?:string[];
  entity_context?:EntityContext[];
  tag_ids:string[];
  occurred_at: string; // datetime-local
  original_occurred_at?: string;
  applied_principle_ids: string[];
}

export const emptyRecord = (): RecordDraft => ({ title: "", summary: "", body: "", occurred_at: "", applied_principle_ids: [],tag_ids:[] });

export function recordDraftFrom(r: { title: string; summary: string; body: string; occurred_at: string; applied_principle_ids?: string[];tag_ids?:string[];entity_id?:string|null;entity_ids?:string[];entity_context?:EntityContext[] }): RecordDraft {
  return { title: r.title, summary: r.summary, body: r.body, occurred_at: toLocalInput(r.occurred_at), original_occurred_at: r.occurred_at, applied_principle_ids:r.applied_principle_ids??[],tag_ids:r.tag_ids??[],entity_ids:r.entity_ids??(r.entity_id?[r.entity_id]:[]),entity_context:r.entity_context??[] };
}

/** The minute-only input must not truncate an untouched stored timestamp. */
export function recordDraftTime(draft: RecordDraft): string | undefined {
  return draft.original_occurred_at && draft.occurred_at === toLocalInput(draft.original_occurred_at)
    ? draft.original_occurred_at : fromLocalInput(draft.occurred_at);
}

export function RecordFormModal(props: {
  title: string;
  submitLabel: string;
  open: boolean;
  initial: RecordDraft;
  intro?: ReactNode;
  details?: ReactNode;
  entityEditable?:boolean;
  systemRecord?: boolean;
  editing?: boolean;
  onClose: () => void;
  onRouteDiscard?: () => void;
  onSave: (value: { title: string; summary: string; body: string; change_note?: string; occurred_at?: string; applied_principle_ids?:string[];tag_ids?:string[];entity_ids?:string[] }) => Promise<void>;
}) {
  const [initial] = useState(props.initial);
  const [draft, setDraft] = useState(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const value = () => ({
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    occurred_at: recordDraftTime(draft),
    tag_ids:draft.tag_ids,
    ...(props.entityEditable===false?{}:{entity_ids:draft.entity_ids??(draft.entity_id?[draft.entity_id]:[])}),
  });
  return (
    <FormModal
      title={props.title}
      submitLabel={props.submitLabel}
      open={props.open}
      dirty={dirty}
      onClose={props.onClose}
      onRouteDiscard={props.onRouteDiscard}
      validate={() => {
        const noteErrors=changeNoteErrors(draft.change_note,false);if(noteErrors)return noteErrors;
        const r = recordCreate.safeParse(value());
        return r.success ? null : fieldErrors(r.error.issues);
      }}
      onSubmit={() => {const {applied_principle_ids:_legacy,...parsed}=recordCreate.parse(value());return props.onSave({... (props.systemRecord?{title:parsed.title,summary:parsed.summary,body:parsed.body}:parsed),change_note:draft.change_note?.trim()||undefined});}}
    >
      {(errors) => (
        <>
          {props.intro}
          <TextFields draft={draft} set={(d) => setDraft((prev) => ({ ...prev, ...d }))} errors={errors} />
          {!props.systemRecord && <>
          <TagPicker value={draft.tag_ids} error={errors.tag_ids} onChange={tag_ids=>setDraft(d=>({...d,tag_ids}))}/>
          {props.entityEditable!==false&&<EntityMultiPicker value={draft.entity_ids??(draft.entity_id?[draft.entity_id]:[])} context={draft.entity_context} error={errors.entity_ids} onChange={entity_ids=>setDraft(d=>({...d,entity_ids}))}/>}
          <Field label={recordLabels.occurred_at} error={errors.occurred_at} help="비우면 저장한 시각">
            {(p) => (
              <input
                {...p}
                className="input"
                type="datetime-local"
                value={draft.occurred_at}
                onChange={(e) => setDraft((prev) => ({ ...prev, occurred_at: e.target.value }))}
              />
            )}
          </Field></>}
          <Field label="편집 메모" error={errors.change_note} help="선택 입력입니다. 기록을 고쳐도 추가 편집 로그는 남기지 않습니다.">
            {p=><textarea {...p} className="input" rows={3} value={draft.change_note??""} onChange={e=>setDraft(d=>({...d,change_note:e.target.value}))}/>}</Field>
          {props.details}
        </>
      )}
    </FormModal>
  );
}

/** Completion/occurrence already save one result record; preview fills that same memo, not another log. */
export function TaskResultFormModal(props: Parameters<typeof RecordFormModal>[0] & { taskId:string;version:number;date?:string }) {
  const [initial,setInitial]=useState<RecordDraft|null>(null),[failure,setFailure]=useState<string|null>(null),[retry,setRetry]=useState(0);
  useEffect(()=>{let cancelled=false;setFailure(null);
    api<{memo:ChangeMemo}>("POST","/tasks/preview",{action:props.date?"occurrence":"complete",id:props.taskId,...(props.date?{date:props.date}:{}),input:{expected_version:props.version}}).then(result=>{
      if(!cancelled)setInitial({...props.initial,...result.memo});
    }).catch(e=>{if(!cancelled)setFailure(e instanceof Error?e.message:"기본 메모를 확인하지 못했습니다.");});
    return()=>{cancelled=true;};
  },[props.taskId,props.version,props.date,retry]);
  if(!initial)return <FormModal title={props.title} open={props.open} submitLabel="불러오는 중" dirty={false} onClose={props.onClose} onRouteDiscard={props.onRouteDiscard} validate={()=>({preview:"기본 메모를 먼저 확인하세요."})} onSubmit={async()=>{}}>
    {()=>failure?<><p role="alert">{failure}</p><button type="button" className="btn" onClick={()=>setRetry(n=>n+1)}>메모 다시 확인</button></>:<p role="status">기본 메모를 확인하고 있습니다.</p>}
  </FormModal>;
  return <RecordFormModal {...props} initial={initial}/>;
}

// ---------- 할 일 폼(작성·편집) ----------

export interface TaskDraft extends TextDraft {
  change_memo?: ChangeMemo;
  change_note?: string;
  entity_id?:string|null;
  entity_ids?:string[];
  entity_context?:EntityContext[];
  tag_ids: string[];
  kind: "once" | "recurring";
  due_on: string;
  freq: Recurrence["freq"];
  weekdays: number[];
  month_days: string; // 쉼표로 구분
  starts_on: string;
  timezone: string;
}

export function emptyTask(): TaskDraft {
  const tz = browserTimezone();
  return {
    kind: "once",
    tag_ids:[],
    title: "",
    summary: "",
    body: "",
    due_on: "",
    freq: "daily",
    weekdays: [],
    month_days: "",
    starts_on: todayIn(tz),
    timezone: tz,
  };
}

export function taskDraftFrom(t: {
  entity_id?:string|null;
  entity_ids?:string[];
  entity_context?:EntityContext[];
  tag_ids:string[];
  kind: "once" | "recurring";
  title: string;
  summary: string;
  body: string;
  due_on: string | null;
  recurrence: Recurrence | null;
  timezone: string | null;
}): TaskDraft {
  const base = emptyTask();
  const r = t.recurrence;
  return {
    ...base,
    entity_ids:t.entity_ids??(t.entity_id?[t.entity_id]:[]),entity_context:t.entity_context??[],
    kind: t.kind,
    tag_ids:t.tag_ids,
    title: t.title,
    summary: t.summary,
    body: t.body,
    due_on: t.due_on ?? "",
    freq: r?.freq ?? "daily",
    weekdays: r?.freq === "weekly" ? r.weekdays : [],
    month_days: r?.freq === "monthly" ? r.month_days.join(", ") : "",
    starts_on: r?.starts_on ?? base.starts_on,
    timezone: t.timezone ?? base.timezone,
  };
}

function recurrenceOf(d: TaskDraft): unknown {
  if (d.freq === "weekly") return { freq: "weekly", weekdays: d.weekdays, starts_on: d.starts_on };
  if (d.freq === "monthly") {
    const days = d.month_days.split(/[,\s]+/).filter(Boolean).map(Number);
    return { freq: "monthly", month_days: days, starts_on: d.starts_on };
  }
  return { freq: "daily", starts_on: d.starts_on };
}

/** 생성 입력(contracts의 taskCreate 모양). */
export function taskInput(d: TaskDraft): Record<string, unknown> {
  const text = { title: d.title, summary: d.summary, body: d.body, tag_ids:d.tag_ids,entity_ids:d.entity_ids??(d.entity_id?[d.entity_id]:[]), change_note:d.change_note?.trim()||undefined,change_memo:d.change_memo };
  return d.kind === "once"
    ? { kind: "once", ...text, ...(d.due_on ? { due_on: d.due_on } : {}) }
    : { kind: "recurring", ...text, recurrence: recurrenceOf(d), timezone: d.timezone };
}

export function TaskFormModal(props: {
  mode: "create" | "edit";
  open: boolean;
  initial: TaskDraft;
  target?: {id:string;version:number};
  details?: ReactNode;
  onClose: () => void;
  onRouteDiscard?: () => void;
  onSave: (draft: TaskDraft) => Promise<void>;
}) {
  const [initial] = useState(props.initial);
  const [draft, setDraft] = useState(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  // 연속 입력이 앞선 변경을 덮지 않도록 항상 최신 초안에 합친다.
  const set = (patch: Partial<TaskDraft> | ((d: TaskDraft) => Partial<TaskDraft>)) =>
    setDraft((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));
  return (
    <FormModal
      title={props.mode === "create" ? "할 일 추가" : "할 일 편집"}
      submitLabel={props.mode === "create" ? "추가" : "저장"}
      open={props.open}
      dirty={dirty}
      previewKey={JSON.stringify(draft)}
      prepare={async()=>{
        const {kind,...patch}=taskInput(draft);
        const result=await api<{memo:ChangeMemo}>("POST","/tasks/preview",props.mode==="edit"?{action:"update",id:props.target?.id,input:{...patch,expected_version:props.target?.version}}:{action:"create",input:{kind,...patch}});
        return result.memo;
      }}
      onClose={props.onClose}
      onRouteDiscard={props.onRouteDiscard}
      validate={() => {
        const noteErrors=changeNoteErrors(draft.change_note,false);if(noteErrors)return noteErrors;
        const {change_note, ...input}=taskInput(draft);
        const r = taskCreate.safeParse(input);
        if (r.success) return null;
        const errs = fieldErrors(r.error.issues);
        // 반복 규칙 하위 오류는 해당 입력 옆에 보인다.
        for (const [k, v] of Object.entries(errs)) if (k.startsWith("recurrence.")) errs[k.slice(11)] ??= v;
        return errs;
      }}
      onSubmit={(change_memo) => props.onSave({...draft,change_memo})}
    >
      {(errors) => (
        <>
          {props.mode === "create" && (
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">{taskLabels.kind}</legend>
              <div className="chips">
                {(["once", "recurring"] as const).map((k) => (
                  <button key={k} type="button" className="chip" aria-pressed={draft.kind === k} onClick={() => set({ kind: k })}>
                    {taskLabels[k]}
                  </button>
                ))}
              </div>
              {draft.kind === "recurring" && (
                <p className="help" style={{ margin: 0 }}>
                  반복 할 일은 회차마다 기록을 남깁니다. 앱이 자동으로 실행하거나 알림을 보내지 않습니다.
                </p>
              )}
            </fieldset>
          )}
          <TextFields draft={draft} set={set} errors={errors} />
          <EntityMultiPicker value={draft.entity_ids??(draft.entity_id?[draft.entity_id]:[])} context={draft.entity_context} error={errors.entity_ids} onChange={entity_ids=>set({entity_ids})}/>
          <TagPicker value={draft.tag_ids} error={errors.tag_ids} onChange={tag_ids=>set({tag_ids})}/>
          {draft.kind === "once"
            ? (
              <Field label={taskLabels.due_on} error={errors.due_on} help="알림은 없습니다">
                {(p) => <input {...p} className="input" type="date" value={draft.due_on} onChange={(e) => set({ due_on: e.target.value })} />}
              </Field>
            )
            : (
              <>
                <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="label">{taskLabels.recurrence}</legend>
                  <div className="chips">
                    {(["daily", "weekly", "monthly"] as const).map((f) => (
                      <button key={f} type="button" className="chip" aria-pressed={draft.freq === f} onClick={() => set({ freq: f })}>
                        {taskLabels[f]}
                      </button>
                    ))}
                  </div>
                </fieldset>
                {draft.freq === "weekly" && (
                  <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="label">{taskLabels.weekdays}</legend>
                    <div className="chips">
                      {WEEKDAYS.map((w, i) => {
                        const day = i + 1;
                        const on = draft.weekdays.includes(day);
                        return (
                          <button
                            key={w}
                            type="button"
                            className="chip"
                            aria-pressed={on}
                            onClick={() =>
                              set((d) => ({
                                weekdays: d.weekdays.includes(day) ? d.weekdays.filter((x) => x !== day) : [...d.weekdays, day],
                              }))}
                          >
                            {w}
                          </button>
                        );
                      })}
                    </div>
                    {errors.weekdays && <p className="error-text" style={{ margin: 0 }}>{errors.weekdays}</p>}
                  </fieldset>
                )}
                {draft.freq === "monthly" && (
                  <Field label={taskLabels.month_days} error={errors.month_days} help="1~31, 쉼표로 구분. 그 달에 없는 날짜는 말일로 계산합니다">
                    {(p) => (
                      <input {...p} className="input" inputMode="numeric" value={draft.month_days} onChange={(e) => set({ month_days: e.target.value })} />
                    )}
                  </Field>
                )}
                <div className="field-row">
                  <Field label={taskLabels.starts_on} required error={errors.starts_on}>
                    {(p) => (
                      <input {...p} className="input" type="date" value={draft.starts_on} onChange={(e) => set({ starts_on: e.target.value })} />
                    )}
                  </Field>
                  <Field label={taskLabels.timezone} required error={errors.timezone} help="오늘과 회차 날짜의 기준">
                    {(p) => <input {...p} className="input" value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })} />}
                  </Field>
                </div>
              </>
            )}
          <ChangeNoteField label="편집 메모" value={draft.change_note??""} required={false} error={errors.change_note} onChange={change_note=>set({change_note})}/>
          {props.details}
        </>
      )}
    </FormModal>
  );
}
