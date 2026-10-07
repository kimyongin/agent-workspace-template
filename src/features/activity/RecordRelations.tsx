import { useEffect, useState } from "react";
import type { RecordResult } from "@contracts/record.ts";
import type { TaskResult } from "@contracts/task.ts";
import { RelatedSection } from "../../components/RelatedItems.tsx";
import { RelatedPreviewItem } from "../relations/RelatedPreviewItem.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { EntityLinkItem } from "../entity/EntityPicker.tsx";
import { RelatedTaskItem } from "./RelatedTask.tsx";
import { StatusBadge } from "./shared.tsx";
import { changeActionNames } from "./ChangeContext.tsx";

type Change = NonNullable<RecordResult["change"]>;
const groups = [
  {kind:"task",title:"할 일",route:"tasks"},
  {kind:"entity",title:"엔터티",route:"entities"},
  {kind:"principle",title:"원칙",route:"principles"},
  {kind:"record",title:"기록",route:"records"},
] as const;

/** Event targets and explicit relationships share one section and one card per kind/ID. */
export function RecordRelations({record,includeEntities=true}: {record:RecordResult;includeEntities?:boolean}) {
  return <>{groups.map(group=>{
    const change=record.change?.target_kind===group.kind?record.change:null;
    const selected=group.kind==="entity"?(includeEntities?record.entity_ids:[]):group.kind==="task"&&record.task_id?[record.task_id]:[];
    const ids=[...new Set([...(change?[change.target_id]:[]),...selected])];
    if(!ids.length)return null;
    return <RelatedSection key={group.kind} title={group.title} count={ids.length}>
      <ul className="related-items">{ids.map(id=><li key={id}>
        {change?.target_id===id
          ?<ChangedRelation change={change} path={`/${group.route}/${encodeURIComponent(id)}`} occurrence={group.kind==="task"&&record.task_id===id?record.occurrence_on:null}/>
          :group.kind==="entity"?<EntityLinkItem id={id} context={record.entity_context}/>
          :group.kind==="task"?<RelatedTaskItem id={id} occurrence={record.occurrence_on}/>:null}
      </li>)}</ul>
    </RelatedSection>;
  })}</>;
}

function ChangedRelation({change,path,occurrence}: {change:Change;path:string;occurrence:string|null}) {
  const [state,setState]=useState<"loading"|"exists"|"missing"|"failed">("loading");
  const [status,setStatus]=useState<TaskResult["status"]|null>(null);
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{
    const controller=new AbortController();
    setState("loading");setStatus(null);
    // The captured title describes the event; only a successful current GET enables navigation.
    void api<{status?:TaskResult["status"]}>("GET",path,undefined,controller.signal).then(value=>{
      if(!controller.signal.aborted){setState("exists");if(change.target_kind==="task")setStatus(value.status??null);}
    },error=>{
      if(!controller.signal.aborted)setState(error instanceof ApiError&&error.status===404&&error.code==="not_found"?"missing":"failed");
    });
    return ()=>controller.abort();
  },[path,attempt,change.target_kind]);
  return <>
    <RelatedPreviewItem to={state==="exists"?path:undefined} restoreKey="change-target" title={change.target_title}
      metadata={<><span className="meta">{changeActionNames[change.action]}</span>{status&&<StatusBadge status={status}/>} {occurrence&&<span className="meta">{occurrence} 회차</span>}</>}/>
    {state==="missing"&&<p className="secondary">삭제된 대상 또는 접근할 수 없는 대상입니다. 당시의 기록은 그대로 보존됩니다.</p>}
    {state==="failed"&&<div className="form"><p className="notice" role="status">대상의 현재 상태를 확인하지 못했습니다.</p><button type="button" className="btn" onClick={()=>setAttempt(value=>value+1)}>대상 다시 조회</button></div>}
    {state==="loading"&&<p className="secondary" role="status" aria-label="변경 대상 조회">불러오는 중…</p>}
  </>;
}
