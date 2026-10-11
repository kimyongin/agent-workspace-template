import { useDetailResource } from "../details/useDetailResource.ts";
import { useDetailNavigate, useDetailOwnerReturn, useDetailDeleteReturn } from "../../lib/detail-exploration.tsx";
import { useDetailEditor } from "../details/useDetailEditor.ts";
import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router";
import { DetailSurface, DetailTitle } from "../../components/Modal.tsx";
import { Notice } from "../../components/Field.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";

import { PrincipleFormModal } from "./forms.tsx";
import type { WorkspacePrinciple } from "./model.ts";

export function PrincipleDetailPage() {
  const { formatDateTime } = useDisplayTime();
  const {id=""}=useParams(), [params]=useSearchParams(), navigate=useDetailNavigate();
  const back=useDetailOwnerReturn("/principles");
  const deleteBack=useDetailDeleteReturn(back);
  const [message,setMessage]=useState<string|null>(null);
  const detail = useDetailResource<WorkspacePrinciple>({
    id, query: params.toString(), refreshOnQuery: params.get("edit") === "1",
    load: (id, signal) => api("GET", `/principles/${id}`, undefined, signal),
  });
  const { value: item, editReady } = detail;
  const [actionError, setError] = useState<string | null>(null);
  useEffect(() => { if (detail.loading) setError(null); }, [detail.loading]);
  const error = actionError ?? (detail.error ? detail.error instanceof ApiError ? detail.error.message : "원칙을 불러오지 못했습니다." : null);
  const [busy,setBusy]=useState(false);
  const editor = useDetailEditor(detail.editClosed);
  return <DetailSurface footer={item?.is_current&&<button type="button" className="btn btn-primary" onClick={editor.start}>편집</button>} title="원칙" tabTitle={item?.title??"원칙"} onClose={()=>navigate(back)} busy={busy}>
    {error&&<><Notice kind="error">{detail.confirmed?"저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.":error}</Notice><button className="btn" onClick={()=>void detail.reload()}>조회 다시 시도</button></>}
    {!item&&!error&&<p role="status">불러오는 중…</p>}
    {item&&<section className="form">
      <section className="detail-section" aria-label="현재 원칙"><DetailTitle>{item.title}</DetailTitle>{item.body&&<MarkdownContent text={item.body}/>}<p className="meta">수정 {formatDateTime(item.saved_at)}</p></section>
      {editor.active&&editReady&&item.is_current&&<PrincipleFormModal editing target={item} initial={{title:item.title,body:item.body}} {...editor.formProps}
        deletion={{preparation:()=>({model:"principle",action:"delete",target_id:item.id,expected_version:item.version,input:{}}),message:<p>삭제하면 현재 원칙이 없는 상태가 됩니다. 과거 원칙을 자동 승격하지 않습니다. 기록에 보존한 근거는 남습니다.</p>,onConfirm:async(reason,tags,requestKey)=>{setBusy(true);try{await api("POST",`/principles/${item.id}/delete`,{expected_version:item.version,change_note:reason, change_tag_ids:tags}, undefined, requestKey());editor.leave(deleteBack);}catch(e){setError(e instanceof ApiError?e.message:"삭제하지 못했습니다.");throw e;}finally{setBusy(false);}}}} details={<div className="detail-management">{message&&<Notice kind="success">{message}</Notice>}{error&&<Notice kind="error">{error}</Notice>}

          </div>}
        onSave={async (draft,requestKey)=>{
        let savedId = item.id;
        await detail.save(async () => {
          const saved = await api<WorkspacePrinciple>("PATCH", `/principles/${item.id}`, { ...draft, expected_version: item.version }, undefined, requestKey());
          savedId = saved.id;
          return saved;
        });
        editor.close(`/principles/${savedId}`); setMessage("저장했습니다.");
      }}/>}

    </section>}
  </DetailSurface>;
}
