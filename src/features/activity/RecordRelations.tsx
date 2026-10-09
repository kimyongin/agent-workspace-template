import { CollectionList } from "../../components/Collection.tsx";
import { useEffect, useState } from "react";
import type { RecordResult } from "@contracts/record.ts";
import { RelatedSection } from "../../components/RelatedItems.tsx";
import { RelatedPreviewItem } from "../relations/RelatedPreviewItem.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { EntityLinkItem } from "../entity/EntityPicker.tsx";
import { RelatedTaskItem } from "./RelatedTask.tsx";


type Change = NonNullable<RecordResult["change"]>;
const groups = [
  {kind:"task",title:"할 일",route:"tasks"},
  {kind:"entity",title:"엔터티",route:"entities"},
  {kind:"principle",title:"원칙",route:"principles"},
  {kind:"record",title:"기록",route:"records"},
] as const;

/** Event targets and explicit relationships share one section and one card per kind/ID. */
export function RecordRelations({record}: {record:RecordResult}) {
  return <>{groups.map(group=>{
    const change=record.change?.target_kind===group.kind?record.change:null;
    const selected=group.kind==="entity"?record.entity_ids:group.kind==="task"&&record.task_id?[record.task_id]:[];
    const ids=[...new Set([...(change?[change.target_id]:[]),...selected])];
    if(!ids.length)return null;
    return <RelatedSection key={group.kind} title={group.title} count={ids.length}>
      <CollectionList>{ids.map(id=><li key={id}>
        {change?.target_id===id
          ?<ChangedRelation change={change} path={`/${group.route}/${encodeURIComponent(id)}`} occurrence={group.kind==="task"&&record.task_id===id?record.occurrence_on:null}/>
          :group.kind==="entity"?<EntityLinkItem id={id} context={record.entity_context}/>
          :group.kind==="task"?<RelatedTaskItem id={id} occurrence={record.occurrence_on}/>:null}
      </li>)}</CollectionList>
    </RelatedSection>;
  })}</>;
}

function ChangedRelation({change,path,occurrence}: {change:Change;path:string;occurrence:string|null}) {
  const [state,setState]=useState<"loading"|"exists"|"missing"|"failed">("loading");
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setState("loading");
    // The captured title describes the event; only a successful current GET enables navigation.
    void api<{deleted_at?:string|null}>("GET",path,undefined,controller.signal).then(value=>{
      if(!controller.signal.aborted)setState(value.deleted_at ? "missing" : "exists");
    },error=>{
      if(!controller.signal.aborted)setState(error instanceof ApiError&&error.status===404&&error.code==="not_found"?"missing":"failed");
    });
    return ()=>controller.abort();
  },[path,attempt,change.target_kind]);
  const missing=state==="missing";
  const deleted=missing&&change.action==="delete";
  const fallback=missing
    ?<p className="secondary">{deleted?"삭제된 항목입니다. 기록에 저장된 당시 제목을 표시합니다.":"현재 항목을 조회할 수 없습니다. 기록에 저장된 당시 제목을 표시합니다."}</p>
    :state==="failed"
    ?<><p className="secondary">현재 항목을 불러오지 못했습니다.</p><button type="button" className="btn" onClick={()=>setAttempt(value=>value+1)}>다시 시도</button></>
    :state==="loading"?<p className="secondary" role="status">불러오는 중…</p>:undefined;
  return <RelatedPreviewItem to={path} restoreKey="change-target" title={change.target_title}
    titleBadge={missing?<span className="badge">{deleted?"삭제됨":"조회 불가"}</span>:undefined}
    metadata={occurrence?<span className="meta">{occurrence} 회차</span>:undefined}
    fallback={fallback}/>;
}
