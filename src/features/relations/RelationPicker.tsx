import { BodyAction } from "../../components/BodyAction.tsx";
import { useEffect, useId, useRef, useState } from "react";
import type { EntityResult } from "@contracts/entity.ts";
import type { TaskResult } from "@contracts/task.ts";
import { RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import { api } from "../../lib/api.ts";
import { RelationSearch, RelationSearchAction, type Candidate } from "./RelationSearch.tsx";

/** Draft membership only; callers decide when and how to persist the relationship. */
export function RelationPicker({kind,value,context=[],onChange,error}: {
  kind:"entity"|"task";value:string[];context?:{id:string;title:string}[];
  onChange:(ids:string[])=>void;error?:string;
}) {
  const label=kind==="entity"?"엔터티":"할 일";
  const [names,setNames]=useState(()=>new Map(context.map(item=>[item.id,item.title])));
  const [searching,setSearching]=useState(false),searchId=useId();
  const root=useRef<HTMLDivElement>(null),nextFocus=useRef<string|null>(null);
  const selection=value.join(",");
  useEffect(()=>{
    const controller=new AbortController();
    for(const id of value.filter(id=>!names.has(id))) {
      void api<EntityResult|TaskResult>("GET",`/${kind==="entity"?"entities":"tasks"}/${id}`,undefined,controller.signal)
        .then(item=>{if(!controller.signal.aborted)setNames(prior=>new Map(prior).set(id,"prop1" in item?item.prop1:item.title));}).catch(()=>{});
    }
    return()=>controller.abort();
  },[kind,selection]);
  useEffect(()=>{
    if(nextFocus.current===null)return;
    const button=Array.from(root.current?.querySelectorAll<HTMLButtonElement>("button[data-selection]")??[]).find(button=>button.dataset.selection===nextFocus.current);
    (button??root.current?.querySelector<HTMLInputElement>("input[type=search]")??root.current?.querySelector<HTMLButtonElement>("button[data-relation-search-toggle]"))?.focus();nextFocus.current=null;
  },[selection]);
  const choose=(item:Candidate)=>{setNames(prior=>new Map(prior).set(item.id,item.title));nextFocus.current=item.id;onChange(kind==="task"?[item.id]:[...value,item.id].sort());};
  return <div ref={root} className="form">
    <RelatedSection title={label} count={value.length} action={<RelationSearchAction kind={kind} expanded={searching} controls={searchId} onToggle={()=>setSearching(value=>!value)}/>}>
      {error&&<p className="error-text" role="alert">{error}</p>}
      <div id={searchId} hidden={!searching}>{searching&&<RelationSearch draftMode kind={kind} disabled={false} excluded={item=>value.includes(item.id)} onChoose={choose}/>}</div>
      <ul className="related-items" aria-label={`선택한 ${label}`}>
        {value.map(id=><li key={id}><RelatedItem title={names.get(id)??label} action={<BodyAction icon="unlink" data-selection={id} aria-label={`${names.get(id)??label} 해제`} onClick={()=>{nextFocus.current="";onChange(value.filter(value=>value!==id));}}>해제</BodyAction>}/></li>)}
      </ul>
    </RelatedSection>
  </div>;
}
