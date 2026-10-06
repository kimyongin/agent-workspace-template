import { DetailLink as Link, useDetailNavigate, useDetailOwnerReturn } from "../../lib/detail-exploration.tsx";
import { editFromView } from "../../lib/detail-navigation.ts";
import { DeleteDialog } from "../../components/DeleteDialog.tsx";
import { useDeferredNavigation } from "../../lib/useDeferredNavigation.ts";
import { TagNames } from "../tags/TagPicker.tsx";
import { entityLabels } from "@contracts/entity.ts";
import type { EntityDetail } from "@contracts/entity.ts";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { DetailSurface } from "../../components/Modal.tsx";
import { api, ApiError, query } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { EntityForm } from "./forms.tsx";
import { emptyRecord, emptyTask, RecordFormModal, TaskFormModal, taskInput } from "../activity/forms.tsx";
import "./entity.css";
import { recordKindNames } from "../activity/ChangeContext.tsx";
export function EntityDetailPage() {
  const { id } = useParams(),
    [params] = useSearchParams(),
    navigate = useDetailNavigate();
  const afterClose=useDeferredNavigation();
  const conflicted = useRef(false);
    const location=useLocation();
  const [creating, setCreating] = useState<"task" | "record" | null>(null);
  const returnCreateFocus=useRef<"task"|"record"|null>(null),previousCreate=useRef<"task"|"record"|null>(null);
  const closeCreate=()=>{returnCreateFocus.current=creating;setCreating(null);const p=new URLSearchParams(params);p.delete("create");afterClose(`${location.pathname}?${p}`,true);};
  useEffect(()=>{const value=params.get("create"),next=value==="task"||value==="record"?value:null;if(!next&&previousCreate.current)returnCreateFocus.current=previousCreate.current;previousCreate.current=next;setCreating(next);},[location.key]);
  const [editReady,setEditReady]=useState(false);
  const [saved, setSaved] = useState<string | null>(null);
  const [entity, setEntity] = useState<EntityDetail | null>(null),
    [error, setError] = useState<string | null>(null),
    [retry, setRetry] = useState(0),
    [editing, setEditing] = useState(params.get("edit")==="1"),
    [deleting, setDeleting] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    api<EntityDetail>("GET", `/entities/${id}`, undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted){setEntity(value);setEditReady(true);} }).catch((e) => {
        if (!controller.signal.aborted) {
          // Keep confirmed entity fields/actions available when a follow-up GET fails.
          setEditReady(true);
          setError(
            e instanceof ApiError ? e.message : "엔터티를 불러오지 못했습니다.",
          );
        }
      });
    return () => controller.abort();
  }, [id, retry]);
  useEffect(() => { setEntity(null); setSaved(null); setEditing(params.get("edit")==="1"); setDeleting(false); }, [id]);
  const returnParams=new URLSearchParams(params); ["edit","edit_from","create"].forEach(key=>returnParams.delete(key));
  const back = useDetailOwnerReturn(`/entities?${returnParams}${id ? `#entity-${id}` : ""}`);
  const previousQuery=useRef(params.toString());
  useEffect(()=>{setEditing(params.get("edit")==="1");if(previousQuery.current!==params.toString()&&!params.has("create")){setEditReady(false);setRetry(n=>n+1);}previousQuery.current=params.toString();},[params.toString()]);
  useEffect(()=>{if(creating||!editReady||!returnCreateFocus.current)return;const frame=requestAnimationFrame(()=>{const label=returnCreateFocus.current==="task"?"관련 할 일 추가":"기록 작성";const button=Array.from(document.querySelectorAll<HTMLButtonElement>("dialog[open] .detail-management button")).find(el=>el.textContent===label);if(button){button.focus();returnCreateFocus.current=null;}});return()=>cancelAnimationFrame(frame);},[creating,editReady,entity]);
  const closeEdit=()=>{setEditing(false);const p=new URLSearchParams(params);p.delete("edit");p.delete("edit_from");afterClose(params.get("edit_from")==="view"?`${location.pathname}?${p}`:back,true);if(conflicted.current){conflicted.current=false;setRetry(n=>n+1);}};
  const management = entity && <div className="detail-management">
      {saved && <Notice>{saved}</Notice>}
      {error && (
        <>
          <Notice kind="error">{error}</Notice>
          <button type="button" className="btn" onClick={() => setRetry((n) => n + 1)}>
            다시 시도
          </button>
        </>
      )}
          <TagNames scope="entity" ids={(entity as EntityDetail & {tag_ids?:string[]}).tag_ids??[]}/>
          <p className="meta">
            수정 {formatDateTime(entity.updated_at)}
          </p>
          {([["tasks", "할 일"], ["records", "기록"]] as const).map(([kind, label]) => (
            <section className="detail-section entity-related" key={kind}>
              <div className="detail-section-head"><h2 className="section-title">연결된 {label} ({entity[kind].count}개)</h2>
                <button type="button" className="btn btn-text" onClick={() => {
                  const p=new URLSearchParams(params);p.set("create",kind==="tasks"?"task":"record");navigate(`?${p}`);
                }}>{kind === "tasks" ? "관련 할 일 추가" : "기록 작성"}</button>
              </div>
              {entity[kind].count === 0
                ? <p className="secondary">연결된 {label}이 없습니다.</p>
                : (
                  <ul className="entity-related-list">
                    {entity[kind].items.map((item) => (
                      <li key={item.id}>
                        <Link className="entity-related-item" aria-label={item.title} to={`/${kind}/${item.id}`}>
                          <div className="entity-related-title"><span className="item-title">{item.title}</span><span aria-hidden="true">›</span></div>
                          <div className="entity-related-meta">{"record_kind" in item&&<span className="badge">{recordKindNames[item.record_kind]}</span>}<time className="meta" dateTime={"occurred_at" in item?item.occurred_at:item.updated_at}>{"occurred_at" in item?"":"수정 "}{formatDateTime("occurred_at" in item?item.occurred_at:item.updated_at)}</time></div>
                          {"summary" in item&&item.summary!==item.title&&<p className="secondary record-summary">{item.summary}</p>}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              {entity[kind].count>0&&<Link className="entity-related-all" to={`/${kind}${query({ entity_id: id })}`}>전체 {label} 보기</Link>}
            </section>
          ))}
    </div>;
  const startEdit=()=>navigate(editFromView(params));
  return <DetailSurface title={entity?.prop1??"엔터티"} onClose={()=>navigate(back)} busy={busy}
    footer={entity&&<button type="button" className="btn btn-primary" onClick={startEdit}>편집</button>}>
      {error && !entity && <><Notice kind="error">{error}</Notice><button className="btn" onClick={()=>setRetry(n=>n+1)}>다시 시도</button></>}
      {!entity&&!error&&<p className="secondary" role="status">불러오는 중…</p>}
      {entity&&<>
          <section className="detail-section"><h2 className="section-title">기본 정보</h2><dl className="props">
            {(["prop1","prop2","prop3","prop4"] as const).map(key=><div key={key}><dt>{entityLabels[key]}</dt><dd>{entity[key]??"미지정"}</dd></div>)}
          </dl></section>
          {management}
          {creating === "task" && <TaskFormModal key={location.key} open mode="create" initial={{ ...emptyTask(), entity_ids: [entity.id] }}
            onClose={closeCreate} onRouteDiscard={()=>setCreating(null)} onSave={async (draft, creationId) => {
              await api("POST", "/tasks", { ...taskInput(draft), id: creationId() });
              closeCreate(); setSaved("할 일을 추가했습니다."); setRetry(n => n + 1);
            }} />}
          {creating === "record" && <RecordFormModal key={location.key} open title="기록 작성" submitLabel="저장" initial={{ ...emptyRecord(), entity_ids: [entity.id] }}
            onClose={closeCreate} onRouteDiscard={()=>setCreating(null)} onSave={async (value, creationId) => {
              await api("POST", "/records", { ...value, id: creationId() });
              closeCreate(); setSaved("기록을 저장했습니다."); setRetry(n => n + 1);
            }} />}
          {editing && !creating && editReady && (
            <EntityForm
              initial={entity}
              onDelete={()=>setDeleting(true)}
              onClose={closeEdit}
              onRouteDiscard={()=>setEditing(false)}
              onSave={async (value) => {
                try {
                  const savedEntity=await api<EntityDetail>("PATCH", `/entities/${id}`, {
                    ...value,
                    expected_version: entity.version,
                  });
                  setEntity(current=>current?{...current,...savedEntity}:current);
                  setSaved("저장했습니다.");closeEdit();
                  setRetry((n) => n + 1);
                } catch (e) {
                  if (
                    e instanceof ApiError && e.code === "conflict"
                  ) conflicted.current = true;
                  throw e;
                }
              }}
            />
          )}
          {deleting && (
            <DeleteDialog
              title="엔터티를 삭제할까요?"
              prepare={async(change_note)=> (await api<{memo:import("@contracts/change.ts").ChangeMemo}>("POST","/entities/preview",{action:"delete",id:entity.id,input:{expected_version:entity.version,change_note:change_note||undefined}})).memo}
              message={`${entity.prop1}을 삭제하고 연결을 해제합니다. 할 일·기록 원문은 보존합니다.`}
              busy={busy}
              onCancel={() => setDeleting(false)}
              onConfirm={async (reason,change_memo) => {
                setBusy(true);
                try {
                  await api(
                    "POST",
                    `/entities/${id}/delete`,
                    {expected_version:entity.version,change_note:reason||undefined,change_memo},
                  );
                  setEditing(false);
                  afterClose(back,true);
                } catch (e) {
                  setError(
                    e instanceof ApiError ? e.message : "삭제하지 못했습니다.",
                  );
                  throw e;
                } finally {
                  setBusy(false);
                }
              }}
            />
          )}
        </>}
    </DetailSurface>;
}
