import { useEffect, useState } from "react";
import type { TaskResult } from "@contracts/task.ts";
import { RelatedPreviewItem } from "../relations/RelatedPreviewItem.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { StatusBadge } from "./shared.tsx";

export function RelatedTaskItem({id,occurrence}: {id:string;occurrence:string|null}) {
  const [task,setTask]=useState<TaskResult|null>(null),[error,setError]=useState<"missing"|"failed"|null>(null),[retry,setRetry]=useState(0);
  useEffect(()=>{const controller=new AbortController();setError(null);
    void api<TaskResult>("GET",`/tasks/${id}`,undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setTask(value);},cause=>{if(!controller.signal.aborted)setError(cause instanceof ApiError&&cause.status===404?"missing":"failed");});
    return()=>controller.abort();},[id,retry]);
  return <>
    {task&&<RelatedPreviewItem to={`/tasks/${id}`} title={task.title} metadata={<><StatusBadge status={task.status}/>{occurrence&&<span className="meta">{occurrence} 회차</span>}</>}/>}
    {!task&&!error&&<p className="secondary" role="status">불러오는 중…</p>}
    {error&&<p className="secondary">{error==="missing"?"삭제된 할 일 또는 접근할 수 없는 할 일입니다.":"연결된 할 일을 불러오지 못했습니다."}</p>}
    {error==="failed"&&<button type="button" className="btn" onClick={()=>setRetry(n=>n+1)}>할 일 다시 조회</button>}
  </>;
}
