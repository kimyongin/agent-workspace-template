import type { SearchItem, SearchResult } from "@contracts/search.ts";
import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { api } from "../../lib/api.ts";
import { formatDateTime } from "../../lib/format.ts";
import { useActivityList } from "../activity/useActivityList.ts";
import { anchorId, type ActivityListKind } from "../activity/list-state.ts";
import { TagNames } from "../tags/TagPicker.tsx";
import { Timeline } from "../activity/Timeline.tsx";

/** One result position in its owning tab; every condition is sent to the server. */
export function TabSearchResults({kind}: {kind: ActivityListKind}) {
  const [params]=useSearchParams();
  const {hash}=useLocation();
  const [metadata,setMetadata]=useState<Omit<SearchResult,"items"|"next_cursor">|null>(null);
  const q=params.get("q")??"";
  const input={query:q,kinds:[kind.slice(0,-1)],mode:"auto",limit:20,
    ...(kind==="tasks"?{task_kind:params.get("kind")||undefined,task_status:params.get("status")||undefined}:{}),
    ...(kind==="records"?{record_kind:params.get("record_kind")||undefined}:{}),
    ...(kind==="principles"?{principle_view:"history"}:{tag_id:params.get("tag_id")||undefined,entity_id:params.get("entity_id")||undefined}),
    from:params.get("from")||undefined,to:params.get("to")||undefined};
  const scope=JSON.stringify(input);
  useEffect(()=>setMetadata(null),[scope]);
  const list=useActivityList<SearchItem>(kind,JSON.stringify(input),`${kind}-title`,"검색하지 못했습니다. 조건을 유지하고 다시 시도하세요.",true,!!q,async(cursor,signal)=>{
    const anchor=anchorId(kind,hash);
    const result=await api<SearchResult>("POST","/search",{...input,...(cursor?{cursor}:anchor?{anchor:{kind:kind.slice(0,-1),id:anchor}}:{})},signal);
    return result;
  }, undefined, page=>setMetadata(page as SearchResult));
  return <>
    <p className="help">검색 결과 · {input.mode==="keyword"?"키워드 일치순":"관련도순"}</p>
    {metadata?.search_state==="keyword_fallback"&&<Notice>의미 검색을 사용할 수 없어 키워드 검색 결과를 표시합니다.</Notice>}
    {!!metadata&&(metadata.semantic_coverage.pending+metadata.semantic_coverage.excluded)>0&&<p className="help">의미 색인 대기 {metadata.semantic_coverage.pending}개 · 제외 {metadata.semantic_coverage.excluded}개</p>}
    {list.busy&&<p role="status">검색 중…</p>}
    {list.error&&<Notice kind="error">{list.error}</Notice>}
    {list.items?.length===0&&<p className="secondary">검색 결과가 없습니다. 검색어 또는 조건을 바꿔 보세요.</p>}
    <Timeline items={list.items??[]} at={item=>item.at} kind={kind==="principles"?"과거 저장본":"기록"}>{item=><>
      <div className="activity-item-heading"><Link className="item-title" {...list.link(item.id)}>{item.title}</Link><span className="activity-item-actions"><Link {...list.link(item.id)} id={undefined} aria-label={`${item.title} 보기`}>보기</Link><span aria-hidden="true">·</span><Link {...list.link(item.id,true)} aria-label={`${item.title} ${kind==="principles"?"정정":"편집"}`}>{kind==="principles"?"정정":"편집"}</Link></span></div>
      <span className="secondary">{item.summary}</span><span className="meta">{formatDateTime(item.at)} · {item.match==="keyword"?"키워드":item.match==="both"?"키워드·의미":"의미"} · {item.index_state==="pending"?"색인 대기":item.index_state==="excluded"?"색인 제외":"색인 완료"}</span>
      {item.change_note&&<p className="notice">편집 메모: {item.change_note}</p>}
      {kind!=="principles"&&<TagNames ids={item.tag_ids} compact/>}
    </>}</Timeline>
    {list.showMoreControl&&<button className="btn" aria-disabled={list.busy||!list.cursor&&!list.error} onClick={list.error?list.retry:list.more}>{list.busy?"불러오는 중…":list.error?"다시 시도":list.cursor?"더 보기":"모두 불러왔습니다"}</button>}
  </>;
}
