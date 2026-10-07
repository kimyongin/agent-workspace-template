import type { RecordResult } from "@contracts/record.ts";
import { useEffect, useState } from "react";
import { RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { formatDateTime } from "../../lib/format.ts";

export type WorkspaceRecord = RecordResult;
export const recordKindNames = {user:"직접 작성",result:"수행 결과",change:"변경 기록"};
const actions = {create:"등록",update:"수정",delete:"삭제",stop:"중단",resume:"재개"};
const targets = {entity:"엔터티",task:"할 일",record:"기록",principle:"원칙"};
const targetRoutes = {entity:"entities",task:"tasks",record:"records",principle:"principles"};
function CurrentTarget({change}: {change:NonNullable<WorkspaceRecord["change"]>}) {
  const [state,setState]=useState<"loading"|"exists"|"missing"|"failed">("loading");
  const [attempt,setAttempt]=useState(0);
  const path=`/${targetRoutes[change.target_kind]}/${encodeURIComponent(change.target_id)}`;
  useEffect(()=>{
    const controller=new AbortController();
    setState("loading");
    // Stored paths and snapshots describe the event, not the target's current availability.
    void api("GET",path,undefined,controller.signal).then(()=>{
      if(!controller.signal.aborted)setState("exists");
    },error=>{
      if(!controller.signal.aborted)setState(error instanceof ApiError&&error.status===404&&error.code==="not_found"?"missing":"failed");
    });
    return ()=>controller.abort();
  },[path,attempt]);
  return <RelatedSection title="변경 대상" count={1}>
    <ul className="related-items"><li><RelatedItem
      to={state==="exists"?path:undefined}
      restoreKey="change-target"
      title={change.target_title}
      metadata={<span className="meta">{targets[change.target_kind]} · {actions[change.action]}</span>}
    /></li></ul>
    {state==="missing"&&<p className="secondary">삭제된 대상 또는 접근할 수 없는 대상입니다. 당시의 기록은 그대로 보존됩니다.</p>}
    {state==="failed"&&<div className="form"><p className="notice" role="status">대상의 현재 상태를 확인하지 못했습니다.</p><button type="button" className="btn" onClick={()=>setAttempt(value=>value+1)}>대상 다시 조회</button></div>}
    {state==="loading"&&<p className="secondary" role="status" aria-label="변경 대상 조회">불러오는 중…</p>}
  </RelatedSection>;
}
export function ChangeContext({record,compact=false}: {record: WorkspaceRecord;compact?:boolean}) {
  const change=record.change;
  const kind=`${recordKindNames[record.record_kind]??"기록"}${change?` · ${change.source==="http"?"웹":"에이전트"}`:""}`;
  const target=change?`${targets[change.target_kind]} 「${change.target_title}」 · ${actions[change.action]}`:null;
  if(compact)return <><span className="meta">{kind}</span>{target&&<p className="secondary record-change-target">{target}{change?.action==="delete"?" · 삭제된 대상":""}</p>}</>;
  return <div className="record-context">
    <div className="record-context-meta"><span>{kind}</span><time dateTime={record.occurred_at}>{formatDateTime(record.occurred_at)}</time></div>
    {change&&<>
      <CurrentTarget key={`${change.target_kind}:${change.target_id}`} change={change}/>
      {(change.before!==null||change.after!==null)&&<details className="workspace-additional"><summary>변경 전후 값</summary><div className="change-snapshot"><section><h3 className="section-title">변경 전</h3><pre>{change.before?JSON.stringify(change.before,null,2):"없음"}</pre></section><section><h3 className="section-title">변경 후</h3><pre>{change.after?JSON.stringify(change.after,null,2):"없음"}</pre></section></div></details>}
    </>}
  </div>;
}
export function PrincipleSnapshots({snapshots}: {snapshots:NonNullable<WorkspaceRecord["applied_principle_snapshots"]>}) {
  if (!snapshots.length) return null;
  return <section className="form"><h2 className="section-title">적용 당시 원칙</h2>
    {snapshots.map((p,index)=><section key={index} className="form">
      <h3 className="item-title">{p.title}</h3>
      <p className="meta">원본 ID: {p.id} · 버전 {p.version} · 당시 상태: {p.status}</p>
      <p className="meta">저장 {formatDateTime(p.saved_at)}</p>
      <p className="secondary">{p.summary}</p><MarkdownContent text={p.body}/>
      {p.captured_at==="migration"?<p className="help">기존 자료 이관 때 보존한 본문입니다. 실제 판단 당시의 본문을 보증하지 않습니다.</p>:<p className="help">업무 적용 시 보존한 본문입니다.</p>}
    </section>)}
    <p className="help">기록에 보존한 본문입니다. 이후 원칙 변경·삭제와 별도로 보존됩니다.</p>
  </section>;
}
