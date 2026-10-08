import { useDetailResource } from "../details/useDetailResource.ts";
import { CollectionList } from "../../components/Collection.tsx";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { BodyAction } from "../../components/BodyAction.tsx";
import type { EntityContext } from "@contracts/entity-links.ts";
import { RelatedSection } from "../../components/RelatedItems.tsx";
import { RelatedRecordItem } from "../activity/RelatedRecords.tsx";
import { useDetailNavigate, useDetailOwnerReturn, useDetailDeleteReturn } from "../../lib/detail-exploration.tsx";
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
import { EntityTaskRelations } from "./TaskEntityRelations.tsx";
export function EntityDetailPage() {
  const { timezone } = useDisplayTime();
  const { id = "" } = useParams(),
    [params] = useSearchParams(),
    navigate = useDetailNavigate();
  const afterClose=useDeferredNavigation();
  const relationSaved = useRef(false);
    const location=useLocation();
  const [creating, setCreating] = useState<"task" | "record" | null>(null);
  const returnCreateFocus=useRef<"task"|"record"|null>(null),previousCreate=useRef<"task"|"record"|null>(null);
  const closeCreate=()=>{returnCreateFocus.current=creating;setCreating(null);const p=new URLSearchParams(params);p.delete("create");afterClose(`${location.pathname}?${p}`,true);};
  useEffect(()=>{const value=params.get("create"),next=value==="task"||value==="record"?value:null;if(!next&&previousCreate.current)returnCreateFocus.current=previousCreate.current;previousCreate.current=next;setCreating(next);},[location.key]);
  const detail = useDetailResource<EntityDetail>({
    id, query: params.toString(), refreshOnQuery: !params.has("create"), readyAfterFailedRefresh: true,
    load: (id, signal) => api("GET", `/entities/${id}`, undefined, signal),
  });
  const { value: entity, editReady } = detail;
  const [actionError, setError] = useState<string | null>(null);
  useEffect(() => { if (detail.loading) setError(null); }, [detail.loading]);
  const error = actionError ?? (detail.error ? detail.error instanceof ApiError ? detail.error.message : "엔터티를 불러오지 못했습니다." : null);
  const reload = detail.reload;
  const [editing, setEditing] = useState(params.get("edit") === "1"), [busy, setBusy] = useState(false);
  useEffect(() => { if (!detail.confirmed && entity) relationSaved.current = false; }, [entity, detail.confirmed]);
  const returnParams=new URLSearchParams(params); ["edit","edit_from","create"].forEach(key=>returnParams.delete(key));
  const back = useDetailOwnerReturn(`/entities?${returnParams}${id ? `#entity-${id}` : ""}`);
  const deleteBack=useDetailDeleteReturn(back);
  useEffect(() => { setEditing(params.get("edit") === "1"); }, [id, params.toString()]);
  useEffect(()=>{if(creating||!editReady||!returnCreateFocus.current)return;const frame=requestAnimationFrame(()=>{const label=returnCreateFocus.current==="task"?"할 일 작성":"기록 작성";const button=Array.from(document.querySelectorAll<HTMLButtonElement>("dialog[open] .detail-management button")).find(el=>el.getAttribute("aria-label")===label);if(button){button.focus();returnCreateFocus.current=null;}});return()=>cancelAnimationFrame(frame);},[creating,editReady,entity]);
  const closeEdit=()=>{setEditing(false);const p=new URLSearchParams(params);p.delete("edit");p.delete("edit_from");afterClose(`${location.pathname}?${p}`,true);detail.editClosed();};
  const entityContext: EntityContext[] = entity ? [{id:entity.id,title:entity.prop1,source:"selection",captured_at:new Date().toISOString()}] : [];
  const management = entity && <div className="detail-management">
      {error && (
        <>
          <Notice kind="error">{relationSaved.current?"연결은 저장했습니다. 최신 내용을 불러오지 못했습니다.":error}</Notice>
          <button type="button" className="btn" onClick={() => void reload()}>
            다시 시도
          </button>
        </>
      )}
          <EntityTaskRelations entity={entity} onSaved={(saved,before)=>{
            if(saved&&before){
              relationSaved.current=true;
              detail.confirm(current=>{if(!current)return current;const linked=saved.entity_ids.includes(current.id),wasLinked=before.entity_ids.includes(current.id);
                const items=current.tasks.items.filter(item=>item.id!==saved.id);
                if(linked)items.push({id:saved.id,title:saved.title,updated_at:saved.updated_at});
                items.sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||b.id.localeCompare(a.id));
                return {...current,tasks:{count:Math.max(0,current.tasks.count+Number(linked)-Number(wasLinked)),items:items.slice(0,5)}};
              });
            }
            void reload();
          }} onCreate={()=>{const p=new URLSearchParams(params);p.set("create","task");navigate(`?${p}`);}}/>
          {([["records", "기록"]] as const).map(([kind, label]) => (
            <RelatedSection key={kind} title={label} count={entity[kind].count} action={<BodyAction icon="create" aria-label="기록 작성" onClick={()=>{const p=new URLSearchParams(params);p.set("create","record");navigate(`?${p}`);}}>작성</BodyAction>}>
              {entity[kind].count>0&&<CollectionList>{entity[kind].items.map(item=><li key={item.id}><RelatedRecordItem record={item}/></li>)}</CollectionList>}
            </RelatedSection>
          ))}
    </div>;
  const startEdit=()=>navigate(editFromView(params));
  return <DetailSurface title={entity?.prop1??"엔터티"} onClose={()=>navigate(back)} busy={busy}
    footer={entity&&<button type="button" className="btn btn-primary" onClick={startEdit}>편집</button>}>
      {error && !entity && <><Notice kind="error">{error}</Notice><button className="btn" onClick={()=>void reload()}>다시 시도</button></>}
      {!entity&&!error&&<p className="secondary" role="status">불러오는 중…</p>}
      {entity&&<div className="detail-stack">
          <section className="detail-section entity-detail-properties"><dl className="props">
            {(["prop2","prop3","prop4"] as const).map(key=><div key={key}><dt>{entityLabels[key]}</dt><dd>{entity[key]??"미지정"}</dd></div>)}
          </dl><TagNames scope="entity" compact ids={entity.tag_ids}/></section>
          {management}
          {creating === "task" && <TaskFormModal key={location.key} open mode="create" initial={{ ...emptyTask(timezone), entity_ids: [entity.id], entity_context: entityContext }}
            onClose={closeCreate} onRouteDiscard={()=>setCreating(null)} onSave={async (draft, creationId) => {
              await api("POST", "/tasks", { ...taskInput(draft), id: creationId() });
              closeCreate(); void reload();
            }} />}
          {creating === "record" && <RecordFormModal key={location.key} open title="기록 작성" submitLabel="저장" initial={{ ...emptyRecord(), entity_ids: [entity.id], entity_context: entityContext }}
            onClose={closeCreate} onRouteDiscard={()=>setCreating(null)} onSave={async (value, creationId) => {
              await api("POST", "/records", { ...value, id: creationId() });
              closeCreate(); void reload();
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
                  afterClose(deleteBack,true);
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
                await detail.save(async current => {
                  const savedEntity = await api<EntityDetail>("PATCH", `/entities/${id}`, {
                    ...value, expected_version: entity.version,
                  });
                  return { ...current, ...savedEntity };
                });
                closeEdit();
                void reload();
              }}
            />
          )}

        </div>}
    </DetailSurface>;
}
