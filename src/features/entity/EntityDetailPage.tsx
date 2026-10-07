import type { EntityContext } from "@contracts/entity-links.ts";
import { RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import { RelatedRecordItem } from "../activity/RelatedRecords.tsx";
import { useDetailNavigate, useDetailOwnerReturn } from "../../lib/detail-exploration.tsx";
import { editFromView } from "../../lib/detail-navigation.ts";
import { useDeferredNavigation } from "../../lib/useDeferredNavigation.ts";
import { TagNames } from "../tags/TagPicker.tsx";
import { entityLabels } from "@contracts/entity.ts";
import type { EntityDetail } from "@contracts/entity.ts";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { DetailSurface } from "../../components/Modal.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { EntityForm } from "./forms.tsx";
import { emptyRecord, emptyTask, RecordFormModal, TaskFormModal, taskInput } from "../activity/forms.tsx";
import "./entity.css";
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
  const [entity, setEntity] = useState<EntityDetail | null>(null),
    [error, setError] = useState<string | null>(null),
    [retry, setRetry] = useState(0),
    [editing, setEditing] = useState(params.get("edit")==="1"),
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
  useEffect(() => { setEntity(null); setEditing(params.get("edit")==="1"); }, [id]);
  const returnParams=new URLSearchParams(params); ["edit","edit_from","create"].forEach(key=>returnParams.delete(key));
  const back = useDetailOwnerReturn(`/entities?${returnParams}${id ? `#entity-${id}` : ""}`);
  const previousQuery=useRef(params.toString());
  useEffect(()=>{setEditing(params.get("edit")==="1");if(previousQuery.current!==params.toString()&&!params.has("create")){setEditReady(false);setRetry(n=>n+1);}previousQuery.current=params.toString();},[params.toString()]);
  useEffect(()=>{if(creating||!editReady||!returnCreateFocus.current)return;const frame=requestAnimationFrame(()=>{const label=returnCreateFocus.current==="task"?"할 일 작성":"기록 작성";const button=Array.from(document.querySelectorAll<HTMLButtonElement>("dialog[open] .detail-management button")).find(el=>el.textContent===label);if(button){button.focus();returnCreateFocus.current=null;}});return()=>cancelAnimationFrame(frame);},[creating,editReady,entity]);
  const closeEdit=()=>{setEditing(false);const p=new URLSearchParams(params);p.delete("edit");p.delete("edit_from");afterClose(`${location.pathname}?${p}`,true);if(conflicted.current){conflicted.current=false;setRetry(n=>n+1);}};
  const entityContext: EntityContext[] = entity ? [{id:entity.id,title:entity.prop1,source:"selection",captured_at:new Date().toISOString()}] : [];
  const management = entity && <div className="detail-management">
      {error && (
        <>
          <Notice kind="error">{error}</Notice>
          <button type="button" className="btn" onClick={() => setRetry((n) => n + 1)}>
            다시 시도
          </button>
        </>
      )}
          {([["tasks", "할 일"], ["records", "기록"]] as const).map(([kind, label]) => (
            <RelatedSection key={kind} title={`연결된 ${label}`} count={entity[kind].count} action={<button type="button" className="btn btn-text" onClick={()=>{const p=new URLSearchParams(params);p.set("create",kind==="tasks"?"task":"record");navigate(`?${p}`);}}>{kind==="tasks"?"할 일 작성":"기록 작성"}</button>}>
              {entity[kind].count>0&&<ul className="related-items">{entity[kind].items.map(item=><li key={item.id}>{"record_kind" in item?<RelatedRecordItem record={item}/>:<RelatedItem to={`/tasks/${item.id}`} title={item.title}/>}</li>)}</ul>}
            </RelatedSection>
          ))}
    </div>;
  const startEdit=()=>navigate(editFromView(params));
  return <DetailSurface title={entity?.prop1??"엔터티"} onClose={()=>navigate(back)} busy={busy}
    footer={entity&&<button type="button" className="btn btn-primary" onClick={startEdit}>편집</button>}>
      {error && !entity && <><Notice kind="error">{error}</Notice><button className="btn" onClick={()=>setRetry(n=>n+1)}>다시 시도</button></>}
      {!entity&&!error&&<p className="secondary" role="status">불러오는 중…</p>}
      {entity&&<div className="detail-stack">
          <section className="detail-section entity-detail-properties"><dl className="props">
            {(["prop2","prop3","prop4"] as const).map(key=><div key={key}><dt>{entityLabels[key]}</dt><dd>{entity[key]??"미지정"}</dd></div>)}
          </dl><TagNames scope="entity" compact ids={entity.tag_ids}/></section>
          {management}
          {creating === "task" && <TaskFormModal key={location.key} open mode="create" initial={{ ...emptyTask(), entity_ids: [entity.id], entity_context: entityContext }}
            onClose={closeCreate} onRouteDiscard={()=>setCreating(null)} onSave={async (draft, creationId) => {
              await api("POST", "/tasks", { ...taskInput(draft), id: creationId() });
              closeCreate(); setRetry(n => n + 1);
            }} />}
          {creating === "record" && <RecordFormModal key={location.key} open title="기록 작성" submitLabel="저장" initial={{ ...emptyRecord(), entity_ids: [entity.id], entity_context: entityContext }}
            onClose={closeCreate} onRouteDiscard={()=>setCreating(null)} onSave={async (value, creationId) => {
              await api("POST", "/records", { ...value, id: creationId() });
              closeCreate(); setRetry(n => n + 1);
            }} />}
          {editing && !creating && editReady && (
            <EntityForm
              initial={entity}
              deletion={{message:`${entity.prop1}을 삭제하고 연결을 해제합니다. 할 일·기록 원문은 보존합니다.`,onConfirm:async (reason, tags) => {
                setBusy(true);
                try {
                  await api(
                    "POST",
                    `/entities/${id}/delete`,
                    {expected_version:entity.version,change_note:reason||undefined, change_tag_ids:tags},
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
              }}}
              onClose={closeEdit}
              onRouteDiscard={()=>setEditing(false)}
              onSave={async (value) => {
                try {
                  const savedEntity=await api<EntityDetail>("PATCH", `/entities/${id}`, {
                    ...value,
                    expected_version: entity.version,
                  });
                  setEntity(current=>current?{...current,...savedEntity}:current);
                  closeEdit();
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

        </div>}
    </DetailSurface>;
}
