import { useDetailResource } from "../details/useDetailResource.ts";
import { BodyAction } from "../../components/BodyAction.tsx";
import { RelatedRecords } from "./RelatedRecords.tsx";
import { useDetailNavigate, useDetailOwnerReturn, useDetailDeleteReturn } from "../../lib/detail-exploration.tsx";
import { useDetailEditor } from "../details/useDetailEditor.ts";
import { FormModal } from "../../components/ContentForm.tsx";
// 할 일 상세: 읽기, 편집, 일회성 완료, 반복 할 일의 회차·회차 기록·중단/재개, 삭제.
import type { RecordResult } from "@contracts/record.ts";
import type { Occurrence, TaskDetail, TaskResult } from "@contracts/task.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import {useDeferredNavigation} from "../../lib/useDeferredNavigation.ts";
import { Notice } from "../../components/Field.tsx";
import { TaskDataFields } from "./TaskDataFields.tsx";
import { DetailSurface } from "../../components/Modal.tsx";
import { api, ApiError, query } from "../../lib/api.ts";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { addDays, todayIn } from "../../lib/format.ts";
import { emptyRecord, RecordFormModal, TaskFormModal, taskDraftFrom } from "./forms.tsx";
import { OccurrenceBadge } from "./shared.tsx";
import { TagConnections } from "../tags/TagConnections.tsx";
import {TaskEntityRelations} from "../entity/TaskEntityRelations.tsx";

type Dialog = null | "complete" | "record" | "transition" | { occurrence: string };
function requestedDialog(params: URLSearchParams): Dialog {

  const action = params.get("action");
  return action === "complete" || action === "transition" || action === "record" ? action : params.has("occurrence") ? { occurrence: params.get("occurrence")! } : null;
}

export function TaskDetailPage() {
  const { timezone } = useDisplayTime();
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const back=useDetailOwnerReturn(`/tasks${query({kind:params.get("kind"),status:params.get("status"),tag_id:params.get("tag_id"),entity_id:params.get("entity_id")})}`);
  const deleteBack=useDetailDeleteReturn(back);
  const navigate = useDetailNavigate();
  const navigateAfterClose = useDeferredNavigation();
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const relationSaved=useRef(false);
  const directEdit = params.get("edit") === "1";
  const [dialog, setDialog] = useState<Dialog>(requestedDialog(params));
    const manage = (action: string, occurrence?: string) => { const next = new URLSearchParams(params); next.set("action", action); occurrence ? next.set("occurrence", occurrence) : next.delete("occurrence"); navigate(`?${next}`); };
  const closeManagement = () => { setDialog(null); const next = new URLSearchParams(params); next.delete("action"); next.delete("occurrence"); navigateAfterClose(`?${next}`, true); };
  const [busy, setBusy] = useState(false);
  const [occurrences, setOccurrences] = useState<{ today: string; items: Occurrence[] } | null>(null);
  const [recordRefresh,setRecordRefresh]=useState(0);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);

  const detail = useDetailResource<TaskDetail>({
    id, query: params.toString(), refreshOnQuery: directEdit,
    load: (id, signal) => api("GET", `/tasks/${id}`, undefined, signal),
  });
  const editor = useDetailEditor(detail.editClosed);
  const { value: task, editReady } = detail;
  const loadError = detail.error ? detail.error instanceof ApiError && detail.error.code === "not_found" ? "할 일을 찾을 수 없습니다." : "할 일을 불러오지 못했습니다." : null;
  const reload = detail.reload;
  useEffect(() => { if (!detail.confirmed && detail.value) relationSaved.current = false; }, [detail.value, detail.confirmed]);

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

  useEffect(() => { setDialog(requestedDialog(params)); }, [id, params.toString()]);

  if (loadError && !task) {
    return (
      <DetailSurface ready={!detail.loading} title="할 일" description="일정과 진행 상태를 확인하고, 수행 결과를 기록합니다." onClose={()=>navigate(back)}>
        <Notice kind="error">{loadError}</Notice>
        <button type="button" className="btn" onClick={reload}>조회 다시 시도</button>
      </DetailSurface>
    );
  }
  if (!task) return <p className="secondary" role="status">불러오는 중…</p>;

  const management = <div className="detail-management">
      <section className="detail-section task-overview">
        {message && <Notice kind="success">{message}</Notice>}
        {actionError && <Notice kind="error">{actionError}</Notice>}
        {loadError && <><Notice kind="error">{relationSaved.current?"연결은 저장했습니다. 최신 내용을 불러오지 못했습니다.":message ? "저장은 완료했습니다. 최신 내용을 불러오지 못했습니다." : loadError}</Notice><button type="button" className="btn" onClick={reload}>조회 다시 시도</button></>}
        <TaskDataFields task={task}/>
        <TagConnections onDraftClosed={detail.editClosed} scope="task" target={task} onSaved={(saved) => detail.confirm((current) => current ? { ...current, ...saved } : current)} />
        {task.kind==="once"&&task.status==="done"&&!task.result_record&&<p className="secondary">결과 기록이 삭제되었습니다.</p>}
      </section>

    </div>;
  const occurrenceSection = (readOnly = false) => <>{task.kind === "recurring" && (
        <section className="detail-section" aria-labelledby={readOnly ? "occ-edit-title" : "occ-title"}>
          <div className="panel-head">
            <h2 id={readOnly ? "occ-edit-title" : "occ-title"} className="section-title">회차</h2>
            {occurrences && !readOnly && (
              <div className="actions">
                <BodyAction onClick={() => setRangeEnd(addDays(occurrences.items.at(-1)?.date ?? occurrences.today, -1))}>
                  이전 기간
                </BodyAction>
                {rangeEnd && <BodyAction onClick={() => setRangeEnd(null)}>최근으로</BodyAction>}
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
                    {!o.in_rule && <span className="secondary">규칙 밖 기록</span>}
                    {o.record_ids.length>0&&<span className="secondary">기록 {o.record_ids.length}개</span>}
                  </div>
                  <OccurrenceBadge status={o.status} />
                  {!readOnly && o.in_rule && o.status !== "upcoming" && (
                    <BodyAction onClick={() => manage("occurrence", o.date)} aria-label={`${o.date} 회차 기록`}>
                      기록
                    </BodyAction>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}</>;
  return <DetailSurface ready={!detail.loading} title="할 일" description="일정과 진행 상태를 확인하고, 수행 결과를 기록합니다." tabTitle={task.title} onClose={()=>navigate(back)} onError={detail.failed} busy={busy} footer={<>
    <button type="button" className="btn" disabled={busy} onClick={editor.start}>편집</button>
    {task.kind==="once"&&task.status==="open"&&<button type="button" className="btn btn-primary" disabled={busy} onClick={()=>manage("complete")}>완료하고 기록</button>}
    {task.kind==="recurring"&&<button type="button" className="btn btn-primary" disabled={busy} onClick={()=>manage("transition")}>{task.status==="active"?"중단":"재개"}</button>}
  </>}>
      <div className="detail-stack">{management}
      <div className="detail-relations"><TaskEntityRelations task={task} onSaved={(saved,before)=>{if(before)relationSaved.current=true;if(saved)detail.confirm(current=>current?{...current,...saved}:current);setRecordRefresh(n=>n+1);void reload();}}/>
      <RelatedRecords taskId={task.id} revision={task.version+recordRefresh} action={<BodyAction icon="create" aria-label="기록 작성" onClick={()=>manage("record")}>작성</BodyAction>}/>
      {occurrenceSection()}</div></div>
      {editor.active && !dialog && editReady && (
        <TaskFormModal
          mode="edit"
          target={task}
          open
          initial={taskDraftFrom(task, timezone)}
          details={<>{task.kind==="once"&&task.status==="done"&&!task.result_record&&<p className="secondary">결과 기록이 삭제되었습니다.</p>}<div className="detail-relations"><TaskEntityRelations readOnly task={task} onSaved={()=>{}}/><RelatedRecords readOnly taskId={task.id} revision={task.version+recordRefresh}/>{occurrenceSection(true)}</div></>}
          deletion={{target:task.title,preparation:()=>({model:"task",action:"delete",target_id:task.id,expected_version:task.version,input:{}}),message:<p style={{ margin: 0 }}>
            이 할 일을 삭제합니다. 연결된 결과·회차 기록은 남고 이 할 일과의 연결만 사라집니다.
          </p>,onConfirm:(reason,tags,requestKey) =>
          run(async () => {
            await api("POST", `/tasks/${task.id}/delete`, {expected_version:task.version,change_note:reason, change_tag_ids:tags}, undefined, requestKey());
            editor.leave(deleteBack);
          }, "삭제했습니다.")}}
          {...editor.formProps}
          onSave={async save => {
            await detail.save(async current => ({...current, ...await save()}));
            editor.close();
            setMessage("저장했습니다.");
            await reload();
          }}
        />
      )}
      {dialog === "record" && <RecordFormModal title="기록 작성" submitLabel="저장" open
        initial={{...emptyRecord(),task_id:task.id,entity_ids:task.entity_ids,entity_context:task.entity_context}}
        onClose={closeManagement} onRouteDiscard={()=>setDialog(null)}
        onSave={async(value,requestKey)=>{await api("POST","/records",{...value}, undefined, requestKey());closeManagement();setRecordRefresh(n=>n+1);}}/>}
      {task.kind==="recurring"&&<TaskTransitionForm key={`${task.id}:${task.version}`} open={dialog==="transition"} task={task} onClose={closeManagement} onSaved={async()=>{closeManagement();setMessage(task.status==="active"?"중단했습니다. 오늘부터 회차가 없습니다.":"재개했습니다.");await reload();}}/>}
      {dialog === "complete" && (
        <RecordFormModal
          title="할 일 완료"
          entityEditable={false}
          submitLabel="완료하고 기록 저장"
          open
          initial={emptyRecord()}
          onClose={closeManagement}
          onRouteDiscard={() => setDialog(null)}
          onSave={async (value,requestKey) => {
            await api("POST", `/tasks/${task.id}/complete`, { ...value, expected_version: task.version }, undefined, requestKey());
            closeManagement();
            setMessage("완료하고 결과 기록을 저장했습니다.");
            await reload();
          }}
        />
      )}
      {dialog && typeof dialog === "object" && (
        <RecordFormModal
          title={`${dialog.occurrence} 회차 기록`}
          taskEditable={false}
          submitLabel="기록 저장"
          open
          initial={{...emptyRecord(),entity_ids:task.entity_ids,entity_context:task.entity_context}}
          onClose={closeManagement}
          onRouteDiscard={() => setDialog(null)}
          onSave={async (value, requestKey) => {
            await api<RecordResult>("POST", `/tasks/${task.id}/occurrences/${dialog.occurrence}/records`, {
              ...value,
            }, undefined, requestKey());
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
    preparation={()=>({model:"task",action,target_id:task.id,expected_version:task.version,input:{}})}
    mutation={{target:task.title,action:label,message:action==="stop"?"오늘부터 이후 회차가 생기지 않고 기존 기록은 남습니다.":"오늘부터 규칙에 따라 회차가 다시 생깁니다."}}
    onClose={onClose} onRouteDiscard={onClose} validate={()=>null} onSubmit={async(requestKey,memo)=>{
      await api("POST",`/tasks/${task.id}/${action}`,{expected_version:task.version,...memo}, undefined, requestKey());
      await onSaved();
    }}>{()=>null}</FormModal>;
}
