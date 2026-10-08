import { DetailLink as Link, useDetailExploration } from "../../lib/detail-exploration.tsx";
import { SearchMatch } from "../../components/SearchMatch.tsx";
import { useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { type SearchResult } from "@contracts/search.ts";
import { Field, Notice } from "../../components/Field.tsx";
import { api } from "../../lib/api.ts";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { TagFilter, TagNames, TagReadProvider, useTagDictionary } from "../tags/TagPicker.tsx";
import { EntityPicker } from "../entity/EntityPicker.tsx";
import { workspaceSearchScope } from "./search-scope.ts";
import { activityTags } from "../activity/activity-filters.ts";
const kinds={task:"할 일",record:"기록",principle:"원칙"} as const;
export function SearchPage(){
  const { formatDateTime } = useDisplayTime();
  useDetailExploration();
  const composing=useRef(false);
  const [params,setParams]=useSearchParams(), [draft,setDraft]=useState(params.get("q")??"");
  const [result,setResult]=useState<SearchResult|null>(null), [error,setError]=useState<string|null>(null), [busy,setBusy]=useState(false);
  const generation=useRef(0), [retry,setRetry]=useState(0);
  const loaded=useRef<{key:string;retry:number;count:number;result:SearchResult}|null>(null);
  const pending=useRef<AbortController|null>(null);
  const {hash}=useLocation(),focused=useRef("");
  const searchParams=new URLSearchParams(params);searchParams.delete("pages");searchParams.delete("scroll");
  const key=searchParams.toString(),q=params.get("q")??"",tag=params.get("tag_id")??"";
  const requested=Number(params.get("pages")??1),pages=Number.isSafeInteger(requested)&&requested>0?Math.min(requested,1000):1;
  const selectedKind=params.get("kind");
  const tasks=useTagDictionary(selectedKind!=="record",false,"task"),records=useTagDictionary(selectedKind!=="task",false,"record");
  const dictionary=selectedKind==="task"?tasks:selectedKind==="record"?records:{tags:tasks.tags&&records.tags?[...tasks.tags.map(tag=>({...tag,name:`할 일: ${tag.name}`})),...records.tags.map(tag=>({...tag,name:`기록: ${tag.name}`}))]:null,failed:tasks.failed||records.failed,retry:()=>{tasks.retry();records.retry();}};
  const input=()=>workspaceSearchScope(params);
  useEffect(()=>{
    let alive=true;const current=++generation.current;setDraft(q);setError(null);focused.current="";
    const controller=new AbortController();pending.current=controller;
    const prior=loaded.current,cached=prior?.key===key&&prior.retry===retry&&prior.count<=pages?prior:null;
    if(!cached){loaded.current=null;setResult(null);}setBusy(!!q);
    if(q){
      try{const value=input(),restore=async()=>{
        let result=cached?.result??null,count=cached?.count??0;
        const anchor=/^#search-(task|record|principle)-([0-9a-f-]+)$/.exec(hash);
        let targetPages=pages;
        while(count<targetPages&&(!result||result.next_cursor)){
          const next:SearchResult=await api<SearchResult>("POST","/search",{...value,...(!count&&anchor?{anchor:{kind:anchor[1],id:anchor[2]}}:{}),...(result?.next_cursor?{cursor:result.next_cursor}:{})},controller.signal);
          if(!count)targetPages=Math.max(pages,next.anchor_page??0);
          if(!alive)return;result={...next,items:[...(result?.items??[]),...next.items]};count++;
          loaded.current={key,retry,count,result};setResult(result);
        }
      };restore()
        .catch(()=>{if(alive)setError("검색하지 못했습니다. 다시 시도하세요.");}).finally(()=>{if(alive&&current===generation.current)setBusy(false);});
      }catch{setBusy(false);setError("검색어와 필터를 확인하세요. 검색어는 1~200자입니다.");}
    }
    return()=>{alive=false;generation.current++;controller.abort();};
  },[key,pages,retry,hash]);
  useEffect(()=>{
    if(busy||focused.current===hash||!/^#search-(task|record|principle)-[0-9a-f-]+$/.test(hash))return;
    const target=document.getElementById(hash.slice(1));if(!target){if(result){document.getElementById("search-title")?.focus();focused.current=hash;}return;}
    target.focus({preventScroll:true});const y=Number(params.get("scroll"));
    if(params.has("scroll")&&Number.isFinite(y)&&y>=0)window.scrollTo(0,y);
    const rect=target.getBoundingClientRect();if(rect.top<0||rect.bottom>window.innerHeight)target.scrollIntoView({block:"center"});
    focused.current=hash;
  },[hash,result,busy]);
  const change=(name:string,value:string)=>{const p=new URLSearchParams(params);p.delete("pages");p.delete("scroll");if(name==="kind"){p.delete("tag_id");p.delete("tag_ids");}value?p.set(name,value):p.delete(name);setParams(p);};
  const clearTags=()=>{const next=new URLSearchParams(params);for(const name of ["tag_id","tag_ids","pages","scroll"])next.delete(name);setParams(next);};
  const more=async()=>{
    if(!result?.next_cursor)return;const current=generation.current;setBusy(true);setError(null);
    try{const next=await api<SearchResult>("POST","/search",{...input(),cursor:result.next_cursor},pending.current?.signal);if(current===generation.current){
      const combined={...next,items:[...result.items,...next.items]},count=(loaded.current?.count??1)+1;
      loaded.current={key,retry,count,result:combined};setResult(combined);const p=new URLSearchParams(params);p.set("pages",String(count));setParams(p,{replace:true});
    }}
    catch{if(current===generation.current)setError("다음 결과를 불러오지 못했습니다. 다시 시도하세요.");}
    finally{if(current===generation.current)setBusy(false);}
  };
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
      {result.next_cursor&&<button type="button" className="btn" disabled={busy} onClick={more}>더 보기</button>}
    </>}
  </section>;
}
