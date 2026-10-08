import { BodyAction } from "../../components/BodyAction.tsx";
import { useEffect, useRef, useState } from "react";
import type { EntityDetail, EntityResult } from "@contracts/entity.ts";
import type { TaskResult } from "@contracts/task.ts";
import { useDetailViewState } from "../../lib/detail-exploration.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { RelatedItem } from "../../components/RelatedItems.tsx";
import { api, query } from "../../lib/api.ts";

export type Candidate = {id:string;title:string;entityIds?:string[]};
type CandidatePage = {items:Candidate[];next_cursor:string|null};
/** Saved relationships and draft selection expose the same search action. */
export function RelationSearchAction({kind,expanded,controls,disabled=false,onToggle}: {kind:"entity"|"task";expanded:boolean;controls:string;disabled?:boolean;onToggle:()=>void}) {
  const label=kind==="entity"?"엔터티":"할 일";
  return <BodyAction icon={expanded?"close":"link"} data-relation-search-toggle={kind} aria-label={expanded?`${label} 검색 닫기`:`${label} 연결`} aria-expanded={expanded} aria-controls={controls} disabled={disabled} onClick={onToggle}>{expanded?"닫기":"연결"}</BodyAction>;
}
/** Current-title lookup, shared by the two directions of the same relationship. */
export function RelationSearch({kind,excluded,onChoose,disabled,revision, draftMode=false}: {kind:"entity"|"task";excluded:(item:Candidate)=>boolean;onChoose:(item:Candidate)=>void;disabled:boolean;revision?:number|EntityDetail["tasks"];draftMode?:boolean}) {
  const label=kind==="entity"?"엔터티":"할 일";
  const [view,setView]=useDetailViewState(`${draftMode?"draft-":""}relation-search-${kind}`,{draft:"",pages:1});
  const draft=view.draft,setDraft=(draft:string)=>setView({draft,pages:1});
  const [composing,setComposing]=useState(false),[retry,setRetry]=useState(0);
  const [result,setResult]=useState<CandidatePage|null>(null),[pending,setPending]=useState(!!draft.trim()),[failed,setFailed]=useState(false);
  const request=useRef<AbortController|null>(null),immediate=useRef(false),keyword=draft.trim();
  const load=async(controller:AbortController,cursor?:string|null)=>{
    setPending(true);setFailed(false);
    try {
      const page=kind==="entity"
        ? await api<{items:EntityResult[];next_cursor:string|null}>("GET",`/entities${query({keyword,limit:20,cursor})}`,undefined,controller.signal)
        : await api<{items:TaskResult[];next_cursor:string|null}>("GET",`/tasks${query({keyword,limit:20,cursor})}`,undefined,controller.signal);
      if(controller.signal.aborted)return;
      const items=page.items.map(item=>({id:item.id,title:"prop1" in item?item.prop1:item.title,...("entity_ids" in item?{entityIds:item.entity_ids}:{})}));
      setResult(prior=>({next_cursor:page.next_cursor,items:cursor?[...(prior?.items??[]),...items.filter(item=>!prior?.items.some(old=>old.id===item.id))]:items}));
      return page.next_cursor;
    } catch {if(!controller.signal.aborted)setFailed(true);}
    finally {if(!controller.signal.aborted)setPending(false);}
  };
  useEffect(()=>{
    const controller=new AbortController();request.current=controller;setResult(null);setPending(!!keyword&&!composing);setFailed(false);
    const delay=immediate.current?0:300;immediate.current=false;
    if(!keyword||composing)return()=>controller.abort();
    const timer=setTimeout(()=>void (async()=>{let cursor:string|null|undefined;for(let page=0;page<Math.min(view.pages,250);page++){cursor=await load(controller,cursor);if(!cursor||controller.signal.aborted)break;}})(),delay);
    return()=>{clearTimeout(timer);controller.abort();request.current?.abort();};
  },[keyword,composing,retry,kind,revision]);
  const more=()=>{request.current?.abort();const controller=new AbortController();request.current=controller;void load(controller,result?.next_cursor).then(cursor=>{if(cursor!==undefined&&!controller.signal.aborted)setView(prior=>({...prior,pages:prior.pages+1}));});};
  return <div className="related-search">
    <Field label={`${label} 제목 검색`}>{props=><input {...props} autoFocus type="search" maxLength={100} className="input" placeholder="제목으로 검색" value={draft} disabled={disabled}
      onChange={e=>setDraft(e.target.value)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)}
      onKeyDown={e=>{if(e.key!=="Enter")return;e.preventDefault();if(composing||e.nativeEvent.isComposing||e.nativeEvent.keyCode===229)return;immediate.current=true;setRetry(n=>n+1);}}/>}</Field>
    {pending&&<p className="secondary" role="status" aria-label="후보 검색">불러오는 중…</p>}
    {failed&&<><Notice kind="error">검색하지 못했습니다.</Notice><BodyAction disabled={pending||disabled} onClick={()=>result?.next_cursor?more():setRetry(n=>n+1)}>검색 다시 시도</BodyAction></>}
    {result&&<div className="related-search-results" role="group" aria-label={`${label} 검색 결과`}>
      {result.items.filter(item=>!excluded(item)).map(item=><RelatedItem key={item.id} to={draftMode?undefined:`/${kind==="entity"?"entities":"tasks"}/${item.id}`} restoreKey={`relation-candidate-${kind}-${item.id}`} title={item.title} action={<BodyAction icon="link" aria-disabled={disabled} aria-label={`${item.title} 연결`} onClick={()=>{if(!disabled)onChoose(item);}}>연결</BodyAction>}/>)}
      {!result.items.length&&!pending&&<p className="secondary">검색 결과가 없습니다.</p>}
      {result.next_cursor&&<BodyAction disabled={pending||disabled} onClick={more}>검색 결과 더 보기</BodyAction>}
    </div>}
  </div>;
}
