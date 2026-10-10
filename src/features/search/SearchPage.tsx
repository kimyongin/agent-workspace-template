import { DetailLink as Link, useDetailExploration } from "../../lib/detail-exploration.tsx";
import { SearchMatch } from "../../components/SearchMatch.tsx";
import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { Field, Notice } from "../../components/Field.tsx";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { TagFilter, TagNames, TagReadProvider, useTagDictionary } from "../tags/TagPicker.tsx";
import { EntityPicker } from "../entity/EntityPicker.tsx";
import { useSearchRead } from "./useSearchRead.ts";
import { activityTags } from "../activity/activity-filters.ts";
const kinds={task:"할 일",record:"기록",principle:"원칙"} as const;
export function SearchPage(){
  const { formatDateTime } = useDisplayTime();
  useDetailExploration();
  const composing=useRef(false);
  const [params,setParams]=useSearchParams(), [draft,setDraft]=useState(params.get("q")??"");
  const [retry,setRetry]=useState(0);
  const q=params.get("q")??"",tag=params.get("tag_id")??"";
  const {result,error,busy,more}=useSearchRead(params,retry);
  useEffect(()=>setDraft(q),[q]);
  const selectedKind=params.get("kind");
  const tasks=useTagDictionary(selectedKind!=="record",false,"task"),records=useTagDictionary(selectedKind!=="task",false,"record");
  const dictionary=selectedKind==="task"?tasks:selectedKind==="record"?records:{tags:tasks.tags&&records.tags?[...tasks.tags.map(tag=>({...tag,name:`할 일: ${tag.name}`})),...records.tags.map(tag=>({...tag,name:`기록: ${tag.name}`}))]:null,failed:tasks.failed||records.failed,retry:()=>{tasks.retry();records.retry();}};
  const change=(name:string,value:string)=>{const p=new URLSearchParams(params);p.delete("pages");p.delete("scroll");if(name==="kind"){p.delete("tag_id");p.delete("tag_ids");}value?p.set(name,value):p.delete(name);setParams(p);};
  const clearTags=()=>{const next=new URLSearchParams(params);for(const name of ["tag_id","tag_ids","pages","scroll"])next.delete(name);setParams(next);};
  return <section className="panel search-page" aria-labelledby="search-title">
    <h1 id="search-title" className="page-title" tabIndex={-1}>검색</h1>
    <form className="search-form" onSubmit={e=>{e.preventDefault();if(composing.current)return;const value=draft.trim();if(value===q)setRetry(n=>n+1);else change("q",value);}}>
      <Field label="검색어" required>{p=><input {...p} className="input" placeholder="검색어 입력" value={draft} onCompositionStart={()=>{composing.current=true;}} onCompositionEnd={()=>{composing.current=false;}} onKeyDown={e=>{if(e.key==="Enter"&&(e.nativeEvent.isComposing||e.keyCode===229))e.preventDefault();}} onChange={e=>setDraft(e.target.value)} required/>}</Field>
      <button className="btn btn-primary" type="submit" disabled={busy}>검색</button>
    </form>
    {(params.has("status")||params.has("principle_view"))&&<Notice kind="error">이 링크에는 지원하지 않는 검색 조건이 있습니다. 조건을 지운 뒤 현재 원칙이나 통합 기록을 검색하세요. <button type="button" className="btn" onClick={()=>{const next=new URLSearchParams(params);for(const key of ["status","principle_view","pages","scroll"])next.delete(key);setParams(next);}}>지원하지 않는 검색 조건 지우기</button></Notice>}
    <details className="workspace-additional"><summary>검색 조건{["kind","mode","tag_id","tag_ids","entity_id","from","to"].filter(k=>params.has(k)).length ? " · 조건 적용 중" : ""}</summary><div className="search-advanced">
    <div className="search-filters">
      <Field label="검색 대상">{p=><select {...p} className="input" value={params.get("kind")??""} onChange={e=>change("kind",e.target.value)}><option value="">전체</option>{Object.entries(kinds).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>}</Field>
      <Field label="검색 방식">{p=><select {...p} className="input" value={params.get("mode")??"auto"} onChange={e=>change("mode",e.target.value)}><option value="auto">자동</option><option value="keyword">키워드</option></select>}</Field>
    </div>
    <p className="help">현재 원칙은 원칙 탭에서 확인하고, 과거 변경과 근거는 기록을 검색해 원문을 읽으세요.</p>
    {(params.has("tag_ids")||selectedKind==="principle"&&!!tag)&&<div className="form"><TagReadProvider dictionary={dictionary}><TagNames ids={activityTags(params)}/></TagReadProvider><button type="button" className="btn" onClick={clearTags}>저장된 태그 조건 해제</button></div>}
    {selectedKind!=="principle"&&<TagFilter dictionary={dictionary} value={tag} onChange={id=>{const next=new URLSearchParams(params);next.delete("tag_ids");next.delete("pages");next.delete("scroll");id?next.set("tag_id",id):next.delete("tag_id");setParams(next);}}/>}
    <EntityPicker value={params.get("entity_id")??""} onChange={id=>change("entity_id",id??"")}/>
    <div className="search-filters">{["from","to"].map(name=><Field key={name} label={name==="from"?"기간 시작":"기간 끝"}>{p=><input {...p} type="datetime-local" className="input" value={params.get(name)??""} onChange={e=>change(name,e.target.value)}/>}</Field>)}</div>
    </div></details>
    {error&&<><Notice kind="error">{error}</Notice><button className="btn" type="button" onClick={()=>setRetry(n=>n+1)}>다시 시도</button></>}
    {busy&&<p role="status" className="secondary">검색 중…</p>}
    {result&&<>
      {result.search_state==="keyword_fallback"&&<Notice>현재 키워드 검색 결과를 표시합니다. 의미 검색을 사용할 수 없습니다.</Notice>}
      {!!(result.semantic_coverage.pending+result.semantic_coverage.excluded)&&<p className="help">의미 색인 대기 {result.semantic_coverage.pending}개 · 제외 {result.semantic_coverage.excluded}개</p>}
      {!result.items.length&&<p className="secondary">검색 결과가 없습니다. 검색어 또는 필터를 바꿔 보세요.</p>}
      <ul className="list">{result.items.map(r=>{
        return <li className="list-item" key={`${r.kind}:${r.id}`}><div className="list-item-main">
        <Link id={`search-${r.kind}-${r.id}`} className="item-title" to={r.path}><span className={r.kind==="record"?"record-preview":undefined}>{r.title}</span></Link>{r.snippet!==r.title&&<span className="secondary record-snippet">{r.snippet}</span>}
        <div className="search-result-meta"><span className="meta">{kinds[r.kind]} · {formatDateTime(r.at)}</span><SearchMatch item={r}/></div>
      </div></li>;})}</ul>
      {result.next_cursor&&<button type="button" className="btn" disabled={busy} onClick={()=>more?.()}>더 보기</button>}
    </>}
  </section>;
}
