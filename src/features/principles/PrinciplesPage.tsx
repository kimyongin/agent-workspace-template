import { useCreateMode } from "../../components/useCreateMode.ts";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { PrincipleFormModal, emptyPrinciple } from "./forms.tsx";
import { Notice } from "../../components/Field.tsx";
import { TabSearch, AppliedConditions } from "../../components/TabSearch.tsx";
import { TabSearchResults } from "../search/TabSearchResults.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { api } from "../../lib/api.ts";
import { useRequestId } from "../../lib/useRequestId.ts";
import { formatDateTime } from "../../lib/format.ts";
import { useActivityList } from "../activity/useActivityList.ts";
import type { WorkspacePrinciple } from "./model.ts";
import "../activity/activity.css";
import { TabActions } from "../../components/TabActions.tsx";
import { Timeline } from "../activity/Timeline.tsx";
export function PrinciplesPage() {
  const create=useCreateMode();
  const [params]=useSearchParams(), request=useRequestId();
  useEffect(()=>{if(create.open)request.renew();},[create.open,create.key]);
  const [current,setCurrent]=useState<WorkspacePrinciple|null|undefined>(undefined),[error,setError]=useState<string|null>(null),[retry,setRetry]=useState(0);
  const list=useActivityList<WorkspacePrinciple>("principles","/principles?view=history&limit=20","principles-title","과거 원칙을 불러오지 못했습니다.",true,!params.get("q"));
  useEffect(()=>{const controller=new AbortController();setError(null);
    api<{current:WorkspacePrinciple|null}>("GET","/principles/current",undefined,controller.signal).then(p=>{if(!controller.signal.aborted)setCurrent(p.current);}).catch(()=>{if(!controller.signal.aborted)setError("현재 원칙을 불러오지 못했습니다.");});
    return()=>controller.abort();},[retry]);
  return <><section className="panel" aria-labelledby="principles-title">
    <div className="panel-head"><h1 id="principles-title" className="page-title" tabIndex={-1}>원칙</h1>
      <TabActions title="원칙" actions={error||current===undefined?[]:current===null?[{label:"원칙 작성",run:create.begin}]:[{label:"현재 원칙 편집",...list.link(current.id,true)},{label:"현재 원칙 보기",...list.link(current.id)}]}/>
    </div>
    <TabSearch/><AppliedConditions excluded={["tag_id","entity_id","status"]}/>
    </section><section className="activity-section" aria-label="현재 원칙">
    {error&&<><Notice kind="error">{error}</Notice><button className="btn" onClick={()=>setRetry(n=>n+1)}>다시 시도</button></>}
    {current===undefined&&!error&&<p role="status">현재 원칙을 불러오는 중…</p>}
    {current===null&&<p className="secondary">현재 원칙이 없습니다. 계정 전체에서 사용할 판단 기준을 등록하세요.</p>}
    {current&&<section className="panel current-document"><h2 className="section-title">{current.title}</h2><p className="secondary">{current.summary}</p><MarkdownContent text={current.body}/><p className="meta">저장 {formatDateTime(current.saved_at)}</p>{current.change_note&&<p className="notice">편집 메모: {current.change_note}</p>}</section>}
    {["tag_id","entity_id","status"].some(k=>params.has(k))&&<Notice>원칙은 계정 전체의 문서입니다. 기존 태그·엔터티·활성 상태 조건은 적용하지 않습니다.</Notice>}
    </section><section className="activity-section" aria-labelledby="principle-history-title"><h2 id="principle-history-title" className="section-title">과거 저장본</h2>
    {params.get("q")?<TabSearchResults kind="principles"/>:<>
      {list.error&&<Notice kind="error">{list.error}</Notice>}
      {!list.items&&!list.error&&<p role="status">과거본을 불러오는 중…</p>}
      {list.items?.length===0&&<p className="secondary">과거 저장본이 없습니다.</p>}
      <Timeline items={list.items??[]} at={p=>p.saved_at} kind="과거 저장본">{p=><><div className="activity-item-heading"><Link {...list.link(p.id)} className="item-title">{p.title}</Link><span className="activity-item-actions"><Link {...list.link(p.id)} id={undefined} aria-label={`${p.title} 보기`}>보기</Link><span aria-hidden="true">·</span><Link {...list.link(p.id,true)} aria-label={`${p.title} 정정`}>정정</Link></span></div>{p.change_note&&<p className="notice">편집 메모: {p.change_note}</p>}<span className="secondary">{p.summary}</span>{p.origin==="legacy"&&<span className="meta">기존 보존 자료</span>}</>}</Timeline>
      {list.showMoreControl&&<button className="btn" aria-disabled={list.busy||!list.cursor&&!list.error} onClick={list.error?list.retry:list.more}>{list.busy?"불러오는 중…":list.error?"다시 시도":list.cursor?"더 보기":"모두 불러왔습니다"}</button>}
    </>}
    {create.open&&current===null&&<PrincipleFormModal key={create.key} initial={emptyPrinciple} onClose={create.close} onRouteDiscard={create.discard} onSave={async draft=>{
      const saved=await api<WorkspacePrinciple>("POST","/principles/current",{...draft,request_id:request.current});request.renew();const p=new URLSearchParams(params);p.delete("create");create.finish(`/principles/${saved.id}?list=${encodeURIComponent(`/principles?${p}`)}`);
    }}/>}
  </section></>;
}
