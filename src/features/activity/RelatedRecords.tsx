import { useSearchParams } from "react-router";
import { useDetailNavigate } from "../../lib/detail-exploration.tsx";
import { requestedPages, restoreList, type LoadedList } from "./list-state.ts";
import { useEffect, useRef, useState } from "react";
import type { RecordResult } from "@contracts/record.ts";
import { recordDisplayText } from "@contracts/record-display.ts";
import { RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import { Notice } from "../../components/Field.tsx";
import { api, query } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { recordKindNames } from "./ChangeContext.tsx";

export function RelatedRecordItem({record}: {record:Pick<RecordResult,"id"|"body"|"record_kind"|"occurred_at">&{occurrence_on?:string|null}}) {
  return <RelatedItem to={`/records/${record.id}`} title={recordDisplayText(record.body)} metadata={<><span className="badge">{recordKindNames[record.record_kind]}</span>{record.occurrence_on&&<span className="meta">{record.occurrence_on} 회차</span>}<time className="meta" dateTime={record.occurred_at}>{formatDateTime(record.occurred_at)}</time></>}/>;
}

export function RelatedRecords({taskId,revision}: {taskId:string;revision:number}) {
  // Each task/revision starts a fresh cursor; a request never publishes into another owner's list.
  return <TaskRecords key={`${taskId}:${revision}`} taskId={taskId}/>;
}
function TaskRecords({taskId}:{taskId:string}) {
  const [params]=useSearchParams(),navigate=useDetailNavigate();
  const requested=requestedPages(new URLSearchParams({pages:params.get("related_record_pages")??"1"}));
  const [page,setPage]=useState<LoadedList<RecordResult>|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false);
  const loaded=useRef<LoadedList<RecordResult>|undefined>(undefined),request=useRef<AbortController|null>(null),failedTarget=useRef(requested);
  const load=async(target:number)=>{
    if(request.current&&!request.current.signal.aborted)return;
    const controller=new AbortController();request.current=controller;failedTarget.current=target;setBusy(true);setError(false);
    try {
      await restoreList<RecordResult>({pages:target,prior:loaded.current,current:()=>!controller.signal.aborted,
        load:cursor=>api("GET",`/records${query({task_id:taskId,limit:20,cursor})}`,undefined,controller.signal),
        publish:value=>{loaded.current=value;setPage(value);}});
    } catch {if(!controller.signal.aborted)setError(true);}
    finally {if(!controller.signal.aborted){setBusy(false);request.current=null;}}
  };
  useEffect(()=>{void load(requested);return()=>request.current?.abort();},[]);
  // A background read must not navigate or interrupt a dirty management form.
  useEffect(()=>{if(!page||busy||error||params.has("edit")||params.has("action")||params.has("occurrence")||page.pages===requested)return;const next=new URLSearchParams(params);next.set("related_record_pages",String(page.pages));void navigate(`?${next}`);},[page,busy,error,params,requested,navigate]);
  return <RelatedSection title="연결된 기록">
    {busy&&<p className="secondary" role="status">불러오는 중…</p>}
    {page?.items.length===0&&<p className="secondary">연결된 기록이 없습니다.</p>}
    {!!page?.items.length&&<ul className="related-items">{page.items.map(record=><li key={record.id}><RelatedRecordItem record={record}/></li>)}</ul>}
    {error&&<Notice kind="error">연결된 기록을 불러오지 못했습니다.</Notice>}
    {(page?.next_cursor||error)&&<button type="button" className="btn" disabled={busy} onClick={()=>void load(error?failedTarget.current:(page?.pages??0)+1)}>{busy?"불러오는 중…":error?"기록 다시 시도":"기록 더 보기"}</button>}
  </RelatedSection>;
}
