import { useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { SurfaceContext } from "../../components/Modal.tsx";
import type { EntityDetail, EntityResult } from "@contracts/entity.ts";
import type { TaskResult } from "@contracts/task.ts";
import { FormModal } from "../../components/ContentForm.tsx";
import { Field, Notice } from "../../components/Field.tsx";
import { RelatedItem, RelatedSection } from "../../components/RelatedItems.tsx";
import { api, query } from "../../lib/api.ts";

type Candidate = {id:string;title:string;entityIds?:string[]};
type CandidatePage = {items:Candidate[];next_cursor:string|null};
/** Current-title lookup, shared by the two directions of the same relationship. */
function RelationSearch({kind,excluded,onChoose,disabled}: {kind:"entity"|"task";excluded:(item:Candidate)=>boolean;onChoose:(item:Candidate)=>void;disabled:boolean}) {
  const label=kind==="entity"?"엔터티":"할 일";
  const [draft,setDraft]=useState(""),[composing,setComposing]=useState(false),[retry,setRetry]=useState(0);
  const [result,setResult]=useState<CandidatePage|null>(null),[pending,setPending]=useState(false),[failed,setFailed]=useState(false);
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
    } catch {if(!controller.signal.aborted)setFailed(true);}
    finally {if(!controller.signal.aborted)setPending(false);}
  };
  useEffect(()=>{
    const controller=new AbortController();request.current=controller;setResult(null);setPending(false);setFailed(false);
    const delay=immediate.current?0:300;immediate.current=false;
    if(!keyword||composing)return()=>controller.abort();
    const timer=setTimeout(()=>void load(controller),delay);
    return()=>{clearTimeout(timer);controller.abort();request.current?.abort();};
  },[keyword,composing,retry,kind]);
  const more=()=>{request.current?.abort();const controller=new AbortController();request.current=controller;void load(controller,result?.next_cursor);};
  return <div className="related-search">
    <Field label={`${label} 제목 검색`}>{props=><input {...props} autoFocus type="search" maxLength={100} className="input" placeholder="제목으로 검색" value={draft} disabled={disabled}
      onChange={e=>setDraft(e.target.value)} onCompositionStart={()=>setComposing(true)} onCompositionEnd={()=>setComposing(false)}
      onKeyDown={e=>{if(e.key!=="Enter")return;e.preventDefault();if(composing||e.nativeEvent.isComposing||e.nativeEvent.keyCode===229)return;immediate.current=true;setRetry(n=>n+1);}}/>}</Field>
    {pending&&<p className="secondary" role="status">검색 중…</p>}
    {failed&&<><Notice kind="error">검색하지 못했습니다.</Notice><button className="btn" type="button" disabled={pending||disabled} onClick={()=>result?.next_cursor?more():setRetry(n=>n+1)}>검색 다시 시도</button></>}
    {result&&<div className="related-search-results" role="group" aria-label={`${label} 검색 결과`}>
      {result.items.filter(item=>!excluded(item)).map(item=><RelatedItem key={item.id} title={item.title} action={<button className="btn btn-text" type="button" aria-disabled={disabled} aria-label={`${item.title} 연결`} onClick={()=>{if(!disabled)onChoose(item);}}>연결</button>}/>)}
      {!result.items.length&&!pending&&<p className="secondary">검색 결과가 없습니다.</p>}
      {result.next_cursor&&<button type="button" className="btn btn-text" disabled={pending||disabled} onClick={more}>검색 결과 더 보기</button>}
    </div>}
  </div>;
}

type Mutation = {task:TaskResult;entity:Candidate;remove:boolean;ids:string[]};
/** Both directions patch the task's single membership field; no mirrored entity state. */
function RelationControls({task,entityId,entityTitle,children,onSaved}: {task?:TaskResult;entityId?:string;entityTitle?:string;children:(controls:{search:ReactNode;button:ReactNode;unlink:(item:Candidate)=>ReactNode})=>ReactNode;onSaved:(saved?:TaskResult)=>void}) {
  const surface=useContext(SurfaceContext);
  const [searching,setSearching]=useState(false),[preparing,setPreparing]=useState(false),[error,setError]=useState<string|null>(null),[mutation,setMutation]=useState<Mutation|null>(null);
  const request=useRef<AbortController|null>(null);
  useEffect(()=>()=>request.current?.abort(),[]);
  const prepare=async(item:Candidate,remove:boolean)=>{
    if(preparing)return;
    request.current?.abort();const controller=new AbortController();request.current=controller;setPreparing(true);setError(null);
    try {
      const latest=await api<TaskResult>("GET",`/tasks/${task?.id??item.id}`,undefined,controller.signal);
      if(controller.signal.aborted||surface?.editor.current)return;
      const entity=task?item:{id:entityId!,title:entityTitle!},ids=latest.entity_ids;
      if(ids.includes(entity.id)===!remove){onSaved(latest);return;}
      setMutation({task:latest,entity,remove,ids:remove?ids.filter(id=>id!==entity.id):[...ids,entity.id]});
    }catch{if(!controller.signal.aborted)setError("최신 연결을 불러오지 못했습니다. 다시 시도하세요.");}
    finally{if(!controller.signal.aborted)setPreparing(false);}
  };
  const kind=task?"entity":"task",label=task?"엔터티":"할 일";
  const unlink=(item:Candidate)=><button type="button" className="btn btn-text" aria-label={`${item.title} 연결 해제`} aria-disabled={preparing} onClick={()=>void prepare(item,true)}>연결 해제</button>;
  return <>
    {children({button:<button type="button" className="btn btn-text" aria-expanded={searching} disabled={preparing} onClick={()=>setSearching(value=>!value)}>{searching?"검색 닫기":`${label} 연결`}</button>,unlink,
      search:<>{error&&<Notice kind="error">{error}</Notice>}{preparing&&<p className="secondary" role="status">연결 확인 중…</p>}{searching&&<RelationSearch kind={kind} disabled={preparing} excluded={item=>task?task.entity_ids.includes(item.id):!!item.entityIds?.includes(entityId!)} onChoose={item=>void prepare(item,false)}/>}</>})}
    {mutation&&<FormModal open confirmationOnly title={mutation.remove?"연결 해제":"연결"} submitLabel="저장" dirty={false}
      mutation={{target:`${mutation.task.title} — ${mutation.entity.title}`,action:mutation.remove?"연결 해제":"연결",message:mutation.remove?"연결만 해제하며 원문과 과거 기록은 유지합니다.":undefined}}
      onClose={()=>{setMutation(null);onSaved();}} onRouteDiscard={()=>setMutation(null)} validate={()=>null}
      onSubmit={async(_id,memo)=>{const saved=await api<TaskResult>("PATCH",`/tasks/${mutation.task.id}`,{expected_version:mutation.task.version,entity_ids:mutation.ids,...memo});setMutation(null);onSaved(saved);}}>{()=>null}</FormModal>}
  </>;
}

export function TaskEntityRelations({task,onSaved}: {task:TaskResult;onSaved:(saved?:TaskResult)=>void}) {
  return <RelationControls key={task.id} task={task} onSaved={onSaved}>{({search,button,unlink})=><RelatedSection title="연결된 엔터티" count={task.entity_ids.length} action={button}>
    {search}<ul className="related-items">{task.entity_ids.map(id=>{const item={id,title:task.entity_context.find(item=>item.id===id)?.title??"엔터티"};return <li key={id}><RelatedItem to={`/entities/${id}`} title={item.title} action={unlink(item)}/></li>;})}</ul>
  </RelatedSection>}</RelationControls>;
}

export function EntityTaskRelations({entity,onCreate,onSaved}: {entity:EntityDetail;onCreate:()=>void;onSaved:()=>void}) {
  const [items,setItems]=useState(entity.tasks.items),[cursor,setCursor]=useState<string|null|undefined>(undefined),[loading,setLoading]=useState(false),[failed,setFailed]=useState(false);
  const request=useRef<AbortController|null>(null);
  useEffect(()=>{request.current?.abort();setItems(entity.tasks.items);setCursor(undefined);setLoading(false);setFailed(false);},[entity.tasks]);
  useEffect(()=>()=>request.current?.abort(),[]);
  const more=async()=>{
    const controller=new AbortController();request.current=controller;setLoading(true);setFailed(false);
    try{const page=await api<{items:TaskResult[];next_cursor:string|null}>("GET",`/tasks${query({entity_id:entity.id,limit:20,cursor})}`,undefined,controller.signal);
      if(!controller.signal.aborted){setItems(prior=>[...prior,...page.items.filter(item=>!prior.some(old=>old.id===item.id))]);setCursor(page.next_cursor);}}
    catch{if(!controller.signal.aborted)setFailed(true);}finally{if(!controller.signal.aborted)setLoading(false);}
  };
  return <RelationControls key={entity.id} entityId={entity.id} entityTitle={entity.prop1} onSaved={onSaved}>{({search,button,unlink})=><RelatedSection title="연결된 할 일" count={entity.tasks.count} action={<div className="actions"><button type="button" className="btn btn-text" onClick={onCreate}>할 일 작성</button>{button}</div>}>
    {search}<ul className="related-items">{items.map(item=><li key={item.id}><RelatedItem to={`/tasks/${item.id}`} title={item.title} action={unlink(item)}/></li>)}</ul>
    {failed&&<Notice kind="error">연결된 할 일을 불러오지 못했습니다.</Notice>}
    {(failed||cursor||cursor===undefined&&entity.tasks.count>items.length)&&<button type="button" className="btn btn-text" disabled={loading} onClick={()=>void more()}>{loading?"불러오는 중…":failed?"할 일 다시 시도":"할 일 더 보기"}</button>}
  </RelatedSection>}</RelationControls>;
}
