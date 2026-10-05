import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { DetailSurface } from "../../components/Modal.tsx";
import { Notice } from "../../components/Field.tsx";
import { DeleteDialog } from "../../components/DeleteDialog.tsx";
import type { ChangeMemo } from "@contracts/change.ts";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { useRequestId } from "../../lib/useRequestId.ts";
import { useDeferredNavigation } from "../../lib/useDeferredNavigation.ts";
import { formatDateTime } from "../../lib/format.ts";
import { useSearchReturn } from "../search/return.ts";
import { safeListReturn } from "../activity/list-state.ts";
import { PrincipleFormModal } from "./forms.tsx";
import type { WorkspacePrinciple } from "./model.ts";

export function PrincipleDetailPage() {
  const {id=""}=useParams(), [params]=useSearchParams(), navigate=useNavigate(), afterClose=useDeferredNavigation(), request=useRequestId();
  const origin=useSearchReturn(safeListReturn(params.get("list"),"principles","/principles"),"← 원칙 목록"), back=origin.path;
  const confirmed=useRef<WorkspacePrinciple|null>(null), conflicted=useRef(false);
  const [message,setMessage]=useState<string|null>(null);
  const [item,setItem]=useState<WorkspacePrinciple|null>(null), [error,setError]=useState<string|null>(null),[retry,setRetry]=useState(0);
  const [deleting,setDeleting]=useState(false),[busy,setBusy]=useState(false);
  const [editReady,setEditReady]=useState(false);
  const [editing,setEditing]=useState(params.get("edit")==="1");
  const previousQuery=useRef(params.toString());
  useEffect(()=>{setEditing(params.get("edit")==="1");if(previousQuery.current!==params.toString()&&params.get("edit")==="1"){request.renew();setEditReady(false);setRetry(n=>n+1);}previousQuery.current=params.toString();},[params.toString()]);
  useEffect(()=>{const controller=new AbortController();setItem(current=>current?.id===id?current:confirmed.current?.id===id?confirmed.current:null);setError(null);
    api<WorkspacePrinciple>("GET",`/principles/${id}`,undefined,controller.signal).then(p=>{if(!controller.signal.aborted){setItem(p);setError(null);setEditReady(true);}}).catch(e=>{if(!controller.signal.aborted)setError(e instanceof ApiError?e.message:"원칙을 불러오지 못했습니다.");});
    return()=>controller.abort();},[id,retry]);
  const closeEdit=()=>{setEditing(false);if(conflicted.current){conflicted.current=false;setRetry(n=>n+1);}if(params.get("edit_from")!=="view"){afterClose(back,true);return;}const p=new URLSearchParams(params);p.delete("edit");p.delete("edit_from");afterClose(`?${p}`,true);};
  return <DetailSurface title={item?.title??"원칙"} onClose={()=>navigate(back)} busy={busy}>
    {error&&<><Notice kind="error">{confirmed.current?.id===id?"저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.":error}</Notice><button className="btn" onClick={()=>setRetry(n=>n+1)}>조회 다시 시도</button></>}
    {!item&&!error&&<p role="status">불러오는 중…</p>}
    {item&&<section className="form">
      <MarkdownContent text={item.body}/>
      {editing&&editReady&&item.is_current&&<PrincipleFormModal id={item.id} version={item.version} editing initial={{...item,change_note:item.change_note??""}} onClose={closeEdit} onRouteDiscard={()=>setEditing(false)}
        details={<div className="detail-management">{message&&<Notice kind="success">{message}</Notice>}{error&&<Notice kind="error">{error}</Notice>}<p className="meta">{item.is_current?"현재 원칙":"과거 저장본"} · {formatDateTime(item.saved_at)}</p>
          <button type="button" className="btn btn-danger" onClick={()=>{request.renew();setDeleting(true);}}>삭제</button>
          {item.origin==="legacy"&&<p className="help">기존 원칙에서 보존한 자료입니다. 과거의 실제 편집 사건을 뜻하지 않습니다.</p>}</div>}
        onSave={async draft=>{
        let saved:WorkspacePrinciple;
        try {saved=await api<WorkspacePrinciple>(item.is_current?"POST":"PATCH",item.is_current?"/principles/current":`/principles/${item.id}/correct`,{...draft,expected_version:item.version,request_id:request.current});}catch(e){if(e instanceof ApiError&&e.code==="conflict")conflicted.current=true;throw e;}
        confirmed.current=saved;setMessage("저장했습니다.");request.renew();setEditing(false);setItem(saved);const p=new URLSearchParams(params);p.delete("edit");p.delete("edit_from");afterClose(params.get("edit_from")==="view"?`/principles/${saved.id}?${p}`:back,true);
      }}/>}
      {!item.is_current&&<p className="help">기존 보존 자료입니다. 현재 원칙으로 변경하지 않습니다. 과거 근거는 통합 기록에서 확인하세요.</p>}
      {deleting&&item.is_current&&<DeleteDialog title="원칙을 삭제할까요?" busy={busy}
        message={<p>삭제하면 현재 원칙이 없는 상태가 됩니다. 과거 원칙을 자동 승격하지 않습니다. 기록에 보존한 근거는 남습니다.</p>}
        prepare={async()=> (await api<{memo:ChangeMemo}>("POST","/principles/preview",{action:"delete",id:item.id,input:{expected_version:item.version}})).memo}
        onCancel={()=>setDeleting(false)} onConfirm={async(reason,change_memo)=>{setBusy(true);try{await api("POST",`/principles/${item.id}/delete`,{expected_version:item.version,change_note:reason||undefined,request_id:request.current,change_memo});setEditing(false);afterClose(back,true);}catch(e){setError(e instanceof ApiError?e.message:"삭제하지 못했습니다.");setDeleting(false);}finally{setBusy(false);}}}/>}
    </section>}
  </DetailSurface>;
}
