import { RelatedRecords } from "./RelatedRecords.tsx";
import { useDetailNavigate, useDetailOwnerReturn } from "../../lib/detail-exploration.tsx";
import { editFromView } from "../../lib/detail-navigation.ts";
import { FormModal } from "../../components/ContentForm.tsx";
// 할 일 상세: 읽기, 편집, 일회성 완료, 반복 할 일의 회차·회차 기록·중단/재개, 삭제.
import type { RecordResult } from "@contracts/record.ts";
import type { Occurrence, TaskDetail, TaskResult } from "@contracts/task.ts";
import { taskLabels } from "@contracts/task.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import {useDeferredNavigation} from "../../lib/useDeferredNavigation.ts";
import { Notice } from "../../components/Field.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { DetailSurface } from "../../components/Modal.tsx";
import { api, ApiError, query } from "../../lib/api.ts";
import { addDays, formatDateTime, todayIn } from "../../lib/format.ts";
import { emptyRecord, RecordFormModal, TaskFormModal, taskDraftFrom, taskInput } from "./forms.tsx";
import { OccurrenceBadge, StatusBadge } from "./shared.tsx";
import {TagNames} from "../tags/TagPicker.tsx";
import {EntityLinks} from "../entity/EntityPicker.tsx";

const WEEKDAY_NAMES = ["", "월", "화", "수", "목", "금", "토", "일"];

function describeRecurrence(t: TaskResult): string {
  const r = t.recurrence;
  if (!r) return "—";
  const rule = r.freq === "daily"
    ? "매일"
    : r.freq === "weekly"
    ? `매주 ${r.weekdays.map((d) => WEEKDAY_NAMES[d]).join("·")}`
    : `매월 ${r.month_days.join("·")}일`;
  return `${rule}, ${r.starts_on}부터 (${t.timezone})`;
}

type Dialog = null | "edit" | "complete" | "delete" | "transition" | { occurrence: string };
function requestedDialog(params: URLSearchParams): Dialog {

  const action = params.get("action");
  return action === "complete" || action === "transition" ? action : params.has("occurrence") ? { occurrence: params.get("occurrence")! } : params.get("edit")==="1" ? "edit" : null;
}

export function TaskDetailPage() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const back=useDetailOwnerReturn(`/tasks${query({kind:params.get("kind"),status:params.get("status"),tag_id:params.get("tag_id"),entity_id:params.get("entity_id")})}`);
  const navigate = useDetailNavigate();
  const navigateAfterClose = useDeferredNavigation();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const directEdit = params.get("edit") === "1";
  const [dialog, setDialog] = useState<Dialog>(requestedDialog(params));
    const manage = (action: string, occurrence?: string) => { const next = new URLSearchParams(params); next.set("action", action); occurrence ? next.set("occurrence", occurrence) : next.delete("occurrence"); navigate(`?${next}`); };
  const closeManagement = () => { setDialog(null); const next = new URLSearchParams(params); next.delete("action"); next.delete("occurrence"); navigateAfterClose(`?${next}`, true); };
  const conflicted=useRef(false);
  const closeEdit = () => { setDialog(null);if(conflicted.current){conflicted.current=false;void reload();} if(directEdit&&params.get("edit_from")!=="view")navigateAfterClose(back,true);else{const p=new URLSearchParams(params);p.delete("edit");p.delete("edit_from");navigateAfterClose(`?${p}`,true);} };
  const [editReady,setEditReady]=useState(false);
  const [busy, setBusy] = useState(false);
  const [occurrences, setOccurrences] = useState<{ today: string; items: Occurrence[] } | null>(null);
  const [recordRefresh,setRecordRefresh]=useState(0);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);

  const previousQuery = useRef(params.toString());
  const loadGeneration = useRef(0);
  const reload = useCallback(async () => {
    const started = ++loadGeneration.current;
    try {
      const loaded = await api<TaskDetail>("GET", `/tasks/${id}`);
      if(started !== loadGeneration.current)return;
      setTask(loaded);
      setLoadError(null);setEditReady(true);
    } catch (e) {
      if(started !== loadGeneration.current)return;
      setLoadError(e instanceof ApiError && e.code === "not_found" ? "할 일을 찾을 수 없습니다." : "할 일을 불러오지 못했습니다.");
    }
  }, [id]);

  useEffect(() => {
    setTask(null); setLoadError(null); setDialog(requestedDialog(params));
    reload();
    return () => {loadGeneration.current++;};
  }, [reload]);

  const occurrenceGeneration=useRef(0);
  useEffect(()=>()=>{occurrenceGeneration.current++;},[id]);
  const loadOccurrences = useCallback(async (t: TaskResult, end: string | null) => {
    const started=++occurrenceGeneration.current;
    try {
      // 할 일 시간대의 오늘 기준 앞 13일과 뒤 7일. 이전 기간으로 옮길 수 있다.
      const to = end ?? addDays(todayIn(t.timezone ?? "UTC"), 7);
      const from = addDays(to, -20);
      const res = await api<{ today: string; items: Occurrence[] }>("GET", `/tasks/${t.id}/occurrences?from=${from}&to=${to}`);
      if(started!==occurrenceGeneration.current)return;
      setOccurrences({ today: res.today, items: [...res.items].reverse() });
    } catch {
      if(started!==occurrenceGeneration.current)return;
      setOccurrences(null);
      setActionError("회차를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    if (task?.kind === "recurring") loadOccurrences(task, rangeEnd);
  }, [task, rangeEnd, loadOccurrences]);

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await action();
      setMessage(done);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "처리하지 못했습니다.");
      throw e;
    } finally {
      setBusy(false);
    }
  };

  useEffect(()=>{
    const query=params.toString();
    if(previousQuery.current===query)return;
    previousQuery.current=query;
    setDialog(requestedDialog(params));
    if(directEdit){setEditReady(false);void reload();}
  },[params.toString(),reload]);

  if (loadError && !task) {
    return (
      <DetailSurface title="할 일" onClose={()=>navigate(back)}>
        <Notice kind="error">{loadError}</Notice>
        <button type="button" className="btn" onClick={reload}>조회 다시 시도</button>
      </DetailSurface>
    );
  }
  if (!task) return <p className="secondary" role="status">불러오는 중…</p>;

  const management = <div className="detail-management">
      <section className="detail-section">
        {message && <Notice kind="success">{message}</Notice>}
        {actionError && <Notice kind="error">{actionError}</Notice>}
        {loadError && <><Notice kind="error">{message ? "저장은 완료했습니다. 최신 내용을 불러오지 못했습니다." : loadError}</Notice><button type="button" className="btn" onClick={reload}>조회 다시 시도</button></>}
        {task.body&&<MarkdownContent text={task.body}/>}
        <dl className="props">
          <div>
            <dt>{taskLabels.status}</dt>
            <dd><StatusBadge status={task.status} /></dd>
          </div>
          <div>
            <dt>{taskLabels.kind}</dt>
            <dd>{taskLabels[task.kind]}</dd>
          </div>
          {task.kind === "once"
            ? (
              <div>
                <dt>{taskLabels.due_on}</dt>
                <dd>{task.due_on ?? "없음"}</dd>
              </div>
            )
            : (
              <div>
                <dt>{taskLabels.recurrence}</dt>
                <dd>{describeRecurrence(task)}</dd>
              </div>
            )}
          {task.completed_at && (
            <div>
              <dt>완료 시각</dt>
              <dd>{formatDateTime(task.completed_at)}</dd>
            </div>
          )}
        </dl>
        <TagNames compact ids={task.tag_ids}/>
        {task.kind==="once"&&task.status==="done"&&!task.result_record&&<p className="secondary">결과 기록이 삭제되었습니다.</p>}
      </section>

    </div>;
  const occurrenceSection = <>{task.kind === "recurring" && (
        <section className="detail-section" aria-labelledby="occ-title">
          <div className="panel-head">
            <h2 id="occ-title" className="section-title">회차</h2>
            {occurrences && (
              <div className="actions">
                <button type="button" className="btn" onClick={() => setRangeEnd(addDays(occurrences.items.at(-1)?.date ?? occurrences.today, -1))}>
                  이전 기간
                </button>
                {rangeEnd && <button type="button" className="btn" onClick={() => setRangeEnd(null)}>최근으로</button>}
              </div>
            )}
          </div>
          {task.status === "stopped" && <Notice>중단된 할 일입니다. 재개하면 그날부터 회차가 생깁니다.</Notice>}
          {!occurrences && <p className="secondary" role="status">불러오는 중…</p>}
          {occurrences?.items.length === 0 && <p className="secondary">이 기간에는 회차가 없습니다.</p>}
          {occurrences && occurrences.items.length > 0 && (
            <ul className="list">
              {occurrences.items.map((o) => (
                <li key={o.date} className="list-item">
                  <div className="list-item-main">
                    <span className="item-title">
                      {o.date}
                      {o.date === occurrences.today ? " (오늘)" : ""}
                    </span>
                    {!o.in_rule && <span className="secondary">규칙 밖 기록(규칙이 바뀌기 전에 남긴 기록)</span>}
                    {o.record_ids.length>0&&<span className="secondary">기록 {o.record_ids.length}개</span>}
                  </div>
                  <OccurrenceBadge status={o.status} />
                  {o.in_rule && o.status !== "upcoming" && (
                    <button type="button" className="btn" onClick={() => manage("occurrence", o.date)} aria-label={`${o.date} 회차 기록`}>
                      기록
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}</>;
  const startEdit=()=>navigate(editFromView(params));
  return <DetailSurface title={task.title} onClose={()=>navigate(back)} busy={busy} footer={<>
    <button type="button" className="btn" disabled={busy} onClick={startEdit}>편집</button>
    {task.kind==="once"&&task.status==="open"&&<button type="button" className="btn btn-primary" disabled={busy} onClick={()=>manage("complete")}>완료하고 기록</button>}
    {task.kind==="recurring"&&<button type="button" className="btn btn-primary" disabled={busy} onClick={()=>manage("transition")}>{task.status==="active"?"중단":"재개"}</button>}
  </>}>
      <div className="detail-stack">{management}
      <EntityLinks ids={task.entity_ids} context={task.entity_context}/>
      <RelatedRecords taskId={task.id} revision={task.version+recordRefresh}/>
      {occurrenceSection}</div>
      {dialog === "edit" && editReady && (
        <TaskFormModal
          mode="edit"
          open
          initial={taskDraftFrom(task)}
          deletion={{message:<p style={{ margin: 0 }}>
            「{task.title}」을(를) 삭제합니다. 연결된 결과·회차 기록은 남고 이 할 일과의 연결만 사라집니다.
          </p>,onConfirm:(reason,tags) =>
          run(async () => {
            await api("POST", `/tasks/${task.id}/delete`, {expected_version:task.version,change_note:reason||undefined, change_tag_ids:tags});
            setDialog(null);
            navigateAfterClose(back,true);
          }, "삭제했습니다.")}}
          onClose={closeEdit}
          onRouteDiscard={() => setDialog(null)}
          onSave={async (draft) => {
            try {
            loadGeneration.current++;
            const patch: Record<string, unknown> = {
              expected_version: task.version,
              title: draft.title,
              body: draft.body,
              change_note:draft.change_note,
              change_tag_ids:draft.change_tag_ids,
              tag_ids:draft.tag_ids,
              entity_ids:draft.entity_ids??[],
            };
            if (task.kind === "once") patch.due_on = draft.due_on || null;
            else {
              const input = taskInput(draft);
              patch.recurrence = input.recurrence;
              patch.timezone = input.timezone;
            }
            const saved = await api<TaskResult>("PATCH", `/tasks/${task.id}`, patch);
            setTask(current => current?.id === task.id ? {...current,...saved} : current);
            }catch(e){if(e instanceof ApiError&&e.code==="conflict")conflicted.current=true;throw e;}
            closeEdit();
            setMessage("저장했습니다.");
            await reload();
          }}
        />
      )}
      {task.kind==="recurring"&&<TaskTransitionForm key={`${task.id}:${task.version}`} open={dialog==="transition"} task={task} onClose={closeManagement} onSaved={async()=>{closeManagement();setMessage(task.status==="active"?"중단했습니다. 오늘부터 회차가 없습니다.":"재개했습니다.");await reload();}}/>}
      {dialog === "complete" && (
        <RecordFormModal
          title="할 일 완료"
          entityEditable={false}
          submitLabel="완료하고 기록 저장"
          open
          initial={emptyRecord()}
          intro={<p className="help" style={{ margin: 0 }}>실제로 수행한 결과를 남기면 할 일이 완료됩니다.</p>}
          onClose={closeManagement}
          onRouteDiscard={() => setDialog(null)}
          onSave={async (value) => {
            await api("POST", `/tasks/${task.id}/complete`, { ...value, expected_version: task.version });
            closeManagement();
            setMessage("완료하고 결과 기록을 저장했습니다.");
            await reload();
          }}
        />
      )}
      {dialog && typeof dialog === "object" && (
        <RecordFormModal
          title={`${dialog.occurrence} 회차 기록`}
          submitLabel="기록 저장"
          open
          initial={{...emptyRecord(),entity_ids:task.entity_ids,entity_context:task.entity_context}}
          onClose={closeManagement}
          onRouteDiscard={() => setDialog(null)}
          onSave={async (value, creationId) => {
            await api<RecordResult>("POST", `/tasks/${task.id}/occurrences/${dialog.occurrence}/records`, {
              ...value,
              id: creationId(),
            });
            closeManagement();
            setMessage(`${dialog.occurrence} 회차에 기록했습니다.`);
            setRecordRefresh(n=>n+1);
            await loadOccurrences(task, rangeEnd);
          }}
        />
      )}

    </DetailSurface>;
}

function TaskTransitionForm({task,open,onClose,onSaved}:{task:TaskResult;open:boolean;onClose:()=>void;onSaved:()=>Promise<void>}) {
  const action=task.status==="active"?"stop":"resume",label=action==="stop"?"중단":"재개";
  return <FormModal open={open} title={`반복 할 일 ${label}`} submitLabel={label} dirty={false} confirmationOnly
    mutation={{target:task.title,action:label,message:action==="stop"?"오늘부터 이후 회차가 생기지 않고 기존 기록은 남습니다.":"오늘부터 규칙에 따라 회차가 다시 생깁니다."}}
    onClose={onClose} onRouteDiscard={onClose} validate={()=>null} onSubmit={async(_id,memo)=>{
      await api("POST",`/tasks/${task.id}/${action}`,{expected_version:task.version,...memo});
      await onSaved();
    }}>{()=>null}</FormModal>;
}
