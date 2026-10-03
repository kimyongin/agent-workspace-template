import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { searchInput, type SearchResult } from "@contracts/search.ts";
import { Field, Notice } from "../../components/Field.tsx";
import { api } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { TagFilter } from "../tags/TagPicker.tsx";
const kinds={task:"할 일",record:"기록",principle:"원칙"} as const;
export function SearchPage(){
  const [params,setParams]=useSearchParams(), [draft,setDraft]=useState(params.get("q")??"");
  const [result,setResult]=useState<SearchResult|null>(null), [error,setError]=useState<string|null>(null), [busy,setBusy]=useState(false);
  const generation=useRef(0), [retry,setRetry]=useState(0);
  const key=params.toString(),q=params.get("q")??"",tag=params.get("tag_id")??"";
  const input=()=>searchInput.parse({query:q, ...(tag?{tag_id:tag}:{}), mode:params.get("mode")??"auto",
    status:params.get("status")??"active", ...(params.get("kind")?{kinds:[params.get("kind")]}:{}),
    ...(params.get("from")?{from:new Date(params.get("from")!).toISOString()}:{}),
    ...(params.get("to")?{to:new Date(params.get("to")!).toISOString()}:{}),});
  useEffect(()=>{
    let alive=true;const current=++generation.current;setDraft(q);setResult(null);setError(null);setBusy(false);
    if(q){
      try{const value=input();setBusy(true);api<SearchResult>("POST","/search",value).then(r=>{if(alive)setResult(r);})
        .catch(()=>{if(alive)setError("검색하지 못했습니다. 다시 시도하세요.");}).finally(()=>{if(alive&&current===generation.current)setBusy(false);});
      }catch{setError("검색어와 필터를 확인하세요. 검색어는 1~200자입니다.");}
    }
    return()=>{alive=false;generation.current++;};
  },[key,retry]);
  const change=(name:string,value:string)=>{const p=new URLSearchParams(params);value?p.set(name,value):p.delete(name);setParams(p);};
  const more=async()=>{
    if(!result?.next_cursor)return;const current=generation.current;setBusy(true);setError(null);
    try{const next=await api<SearchResult>("POST","/search",{...input(),cursor:result.next_cursor});if(current===generation.current)setResult({...next,items:[...result.items,...next.items]});}
    catch{if(current===generation.current)setError("다음 결과를 불러오지 못했습니다. 다시 시도하세요.");}
    finally{if(current===generation.current)setBusy(false);}
  };
  return <section className="panel" aria-labelledby="search-title">
    <h1 id="search-title" className="page-title">검색</h1>
    <form onSubmit={e=>{e.preventDefault();const value=draft.trim();if(value===q)setRetry(n=>n+1);else change("q",value);}}>
      <Field label="검색어" required help="제목·요약·본문에서 찾습니다. 검색 후 원문을 열어 확인하세요.">{p=><input {...p} className="input" value={draft} onChange={e=>setDraft(e.target.value)} required/>}</Field>
      <button className="btn btn-primary" type="submit" disabled={busy}>검색</button>
    </form>
    <div className="actions">
      <Field label="검색 대상">{p=><select {...p} className="input" value={params.get("kind")??""} onChange={e=>change("kind",e.target.value)}><option value="">전체</option>{Object.entries(kinds).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select>}</Field>
      <Field label="원칙 상태">{p=><select {...p} className="input" value={params.get("status")??"active"} onChange={e=>change("status",e.target.value)}><option value="active">활성</option><option value="inactive">비활성</option><option value="all">전체</option></select>}</Field>
      <Field label="검색 방식">{p=><select {...p} className="input" value={params.get("mode")??"auto"} onChange={e=>change("mode",e.target.value)}><option value="auto">자동</option><option value="keyword">키워드</option></select>}</Field>
    </div>
    <TagFilter value={tag} onChange={id=>change("tag_id",id)}/>
    <div className="actions">{["from","to"].map(name=><Field key={name} label={name==="from"?"기간 시작":"기간 끝"}>{p=><input {...p} type="datetime-local" className="input" value={params.get(name)??""} onChange={e=>change(name,e.target.value)}/>}</Field>)}</div>
    {error&&<><Notice kind="error">{error}</Notice><button className="btn" type="button" onClick={()=>setRetry(n=>n+1)}>다시 시도</button></>}
    {busy&&<p role="status" className="secondary">검색 중…</p>}
    {result&&<>
      {result.search_state==="keyword_fallback"&&<Notice>현재 키워드 검색 결과를 표시합니다. 의미 검색을 사용할 수 없습니다.</Notice>}
      {!!(result.semantic_coverage.pending+result.semantic_coverage.excluded)&&<p className="help">의미 색인 대기 {result.semantic_coverage.pending}개 · 제외 {result.semantic_coverage.excluded}개</p>}
      {!result.items.length&&<p className="secondary">검색 결과가 없습니다. 검색어 또는 필터를 바꿔 보세요.</p>}
      <ul className="list">{result.items.map(r=><li className="list-item" key={`${r.kind}:${r.id}`}><div className="list-item-main">
        <Link className="item-title" to={r.path}>{r.title}</Link><span className="secondary">{r.summary}</span>
        <span className="meta">{kinds[r.kind]} · {formatDateTime(r.at)} · {r.match==="keyword"?"키워드":r.match==="both"?"키워드·의미":"의미"} · {r.index_state==="pending"?"색인 대기":r.index_state==="excluded"?"색인 제외":"색인 완료"}</span>
      </div></li>)}</ul>
      {result.next_cursor&&<button type="button" className="btn" disabled={busy} onClick={more}>더 보기</button>}
    </>}
  </section>;
}
