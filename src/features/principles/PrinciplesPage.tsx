import { useCreateMode } from "../../components/useCreateMode.ts";
import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { PrincipleFormModal, emptyPrinciple } from "./forms.tsx";
import { Notice } from "../../components/Field.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { api } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import type { WorkspacePrinciple } from "./model.ts";
import "../activity/activity.css";
import { TabCreateButton } from "../../components/TabCreateButton.tsx";
export function PrinciplesPage() {
  const create=useCreateMode();
  const location=useLocation();
  useEffect(()=>{if(location.hash==="#principles-title")document.getElementById("principles-title")?.focus();},[location.key]);
  const [params]=useSearchParams();
  const [current,setCurrent]=useState<WorkspacePrinciple|null|undefined>(undefined),[error,setError]=useState<string|null>(null),[retry,setRetry]=useState(0);
  useEffect(()=>{const controller=new AbortController();setError(null);
    api<{current:WorkspacePrinciple|null}>("GET","/principles/current",undefined,controller.signal).then(p=>{if(!controller.signal.aborted)setCurrent(p.current);}).catch(()=>{if(!controller.signal.aborted)setError("현재 원칙을 불러오지 못했습니다.");});
    return()=>controller.abort();},[retry]);
  return <><section className="panel" aria-labelledby="principles-title">
    <div className="panel-head"><h1 id="principles-title" className="page-title" tabIndex={-1}>원칙</h1>
      {current===null&&!error&&<TabCreateButton label="원칙 작성" onClick={create.begin}/>}
    </div>
    <Link className="btn btn-text secondary" to="/records">과거 근거는 통합 기록에서 보기</Link>
    </section><section className="activity-section" aria-label="현재 원칙">
    {error&&<><Notice kind="error">{error}</Notice><button className="btn" onClick={()=>setRetry(n=>n+1)}>다시 시도</button></>}
    {current===undefined&&!error&&<p role="status">현재 원칙을 불러오는 중…</p>}
    {current===null&&<p className="secondary">현재 원칙이 없습니다. 계정 전체에서 사용할 판단 기준을 등록하세요.</p>}
    {current&&<section className="panel current-document"><h2><Link className="item-title" to={`/principles/${current.id}?list=${encodeURIComponent("/principles#principles-title")}`}>{current.title}</Link></h2>{current.body&&<MarkdownContent text={current.body}/>}<p className="meta">저장 {formatDateTime(current.saved_at)}</p></section>}
    {["tag_id","entity_id","status"].some(k=>params.has(k))&&<Notice>원칙은 계정 전체의 문서입니다. 기존 태그·엔터티·활성 상태 조건은 적용하지 않습니다.</Notice>}

    {create.open&&current===null&&<PrincipleFormModal key={create.key} initial={emptyPrinciple} onClose={create.close} onRouteDiscard={create.discard} onSave={async (draft, creationId)=>{
      const saved=await api<WorkspacePrinciple>("POST","/principles",{...draft,id:creationId()});const p=new URLSearchParams(params);p.delete("create");create.finish(`/principles/${saved.id}?list=${encodeURIComponent(`/principles?${p}`)}`);
    }}/>}
  </section></>;
}
