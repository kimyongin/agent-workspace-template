import { useDetailNavigate, useDetailOwnerReturn, useDetailEditReturn } from "../../lib/detail-exploration.tsx";
import { editFromView } from "../../lib/detail-navigation.ts";
import { useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { DetailSurface } from "../../components/Modal.tsx";
import { Notice } from "../../components/Field.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { useDeferredNavigation } from "../../lib/useDeferredNavigation.ts";
import { formatDateTime } from "../../lib/format.ts";

import { PrincipleFormModal } from "./forms.tsx";
import type { WorkspacePrinciple } from "./model.ts";

export function PrincipleDetailPage() {
  const {id=""}=useParams(), [params]=useSearchParams(), navigate=useDetailNavigate(), afterClose=useDeferredNavigation();
  const back=useDetailOwnerReturn("/principles");
  const editBack=useDetailEditReturn(back);
  const confirmed=useRef<WorkspacePrinciple|null>(null), conflicted=useRef(false);
  const [message,setMessage]=useState<string|null>(null);
  const [item,setItem]=useState<WorkspacePrinciple|null>(null), [error,setError]=useState<string|null>(null),[retry,setRetry]=useState(0);
  const [busy,setBusy]=useState(false);
  const [editReady,setEditReady]=useState(false);
  const [editing,setEditing]=useState(params.get("edit")==="1");
  const previousQuery=useRef(params.toString());
  useEffect(()=>{setEditing(params.get("edit")==="1");if(previousQuery.current!==params.toString()&&params.get("edit")==="1"){setEditReady(false);setRetry(n=>n+1);}previousQuery.current=params.toString();},[params.toString()]);
  useEffect(()=>{const controller=new AbortController();setItem(current=>current?.id===id?current:confirmed.current?.id===id?confirmed.current:null);setError(null);
    api<WorkspacePrinciple>("GET",`/principles/${id}`,undefined,controller.signal).then(p=>{if(!controller.signal.aborted){setItem(p);setError(null);setEditReady(true);}}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof ApiError?e.message:"원칙을 불러오지 못했습니다.");});
    return()=>controller.abort();},[id,retry]);
  const closeEdit=()=>{setEditing(false);if(conflicted.current){conflicted.current=false;setRetry(n=>n+1);}const p=new URLSearchParams(params);p.delete("edit");p.delete("edit_from");afterClose(`?${p}`,true);};
  const startEdit=()=>navigate(editFromView(params));
  return <DetailSurface footer={item?.is_current&&<button type="button" className="btn btn-primary" onClick={startEdit}>편집</button>} title={item?.title??"원칙"} onClose={()=>navigate(back)} busy={busy}>
    {error&&<><Notice kind="error">{confirmed.current?.id===id?"저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.":error}</Notice><button className="btn" onClick={()=>setRetry(n=>n+1)}>조회 다시 시도</button></>}
    {!item&&!error&&<p role="status">불러오는 중…</p>}
    {item&&<section className="form">
      <section className="detail-section" aria-label="현재 원칙">{item.body&&<MarkdownContent text={item.body}/>}<p className="meta">수정 {formatDateTime(item.saved_at)}</p></section>
      {editing&&editReady&&item.is_current&&<PrincipleFormModal editing initial={{title:item.title,body:item.body}} onClose={closeEdit} onRouteDiscard={()=>setEditing(false)}
        deletion={{message:<p>삭제하면 현재 원칙이 없는 상태가 됩니다. 과거 원칙을 자동 승격하지 않습니다. 기록에 보존한 근거는 남습니다.</p>,onConfirm:async(reason,tags)=>{setBusy(true);try{await api("POST",`/principles/${item.id}/delete`,{expected_version:item.version,change_note:reason||undefined, change_tag_ids:tags});setEditing(false);afterClose(editBack,true);}catch(e){setError(e instanceof ApiError?e.message:"삭제하지 못했습니다.");throw e;}finally{setBusy(false);}}}} details={<div className="detail-management">{message&&<Notice kind="success">{message}</Notice>}{error&&<Notice kind="error">{error}</Notice>}

          </div>}
        onSave={async draft=>{
        let saved:WorkspacePrinciple;
        try {saved=await api<WorkspacePrinciple>("PATCH",`/principles/${item.id}`,{...draft,expected_version:item.version});}catch(e){if(e instanceof ApiError&&e.code==="conflict")conflicted.current=true;throw e;}
        confirmed.current=saved;setMessage("저장했습니다.");setEditing(false);setItem(saved);const p=new URLSearchParams(params);p.delete("edit");p.delete("edit_from");afterClose(`/principles/${saved.id}?${p}`,true);
      }}/>}

    </section>}
  </DetailSurface>;
}
