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

type Page={items:RecordResult[];next_cursor:string|null};
export function RelatedRecords({taskId,revision}: {taskId:string;revision:number}) {
  // Each task/revision starts a fresh cursor; a request never publishes into another owner's list.
  return <TaskRecords key={`${taskId}:${revision}`} taskId={taskId}/>;
}
function TaskRecords({taskId}:{taskId:string}) {
  const [page,setPage]=useState<Page|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),[retry,setRetry]=useState(0);
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const load=async(cursor?:string)=>{
    if(request.current&&!request.current.signal.aborted)return;
    const controller=new AbortController();request.current=controller;setBusy(true);setError(false);
    try {
      const next=await api<Page>("GET",`/records${query({task_id:taskId,limit:20,cursor})}`,undefined,controller.signal);
      if(!controller.signal.aborted)setPage(previous=>cursor&&previous?{items:[...previous.items,...next.items.filter(item=>!previous.items.some(old=>old.id===item.id))],next_cursor:next.next_cursor}:next);
    } catch {if(!controller.signal.aborted)setError(true);}
    finally {if(!controller.signal.aborted){setBusy(false);request.current=null;}}
  };
  useEffect(()=>{void load();return()=>request.current?.abort();},[retry]);
  return <RelatedSection title="연결된 기록">
    {busy&&!page&&<p className="secondary" role="status">불러오는 중…</p>}
    {page?.items.length===0&&<p className="secondary">연결된 기록이 없습니다.</p>}
    {!!page?.items.length&&<ul className="related-items">{page.items.map(record=><li key={record.id}><RelatedRecordItem record={record}/></li>)}</ul>}
    {error&&<Notice kind="error">연결된 기록을 불러오지 못했습니다.</Notice>}
    {(page?.next_cursor||error)&&<button type="button" className="btn" disabled={busy} onClick={()=>page?void load(page.next_cursor??undefined):setRetry(n=>n+1)}>{busy?"불러오는 중…":error?"기록 다시 시도":"기록 더 보기"}</button>}
  </RelatedSection>;
}
