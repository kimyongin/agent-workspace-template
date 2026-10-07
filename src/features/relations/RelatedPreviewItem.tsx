import { useContext, useEffect, useRef, useState, type ComponentProps } from "react";
import type { EntityResult } from "@contracts/entity.ts";
import { entityLabels } from "@contracts/entity.ts";
import type { TaskResult } from "@contracts/task.ts";
import type { RecordResult } from "@contracts/record.ts";
import type { WorkspacePrinciple } from "../principles/model.ts";
import { RelatedItem, useRelatedExpansion } from "../../components/RelatedItems.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { Notice } from "../../components/Field.tsx";
import { SurfaceContext } from "../../components/Modal.tsx";
import { DetailLink } from "../../lib/detail-exploration.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { StatusBadge } from "../activity/shared.tsx";
import { TagNames } from "../tags/TagPicker.tsx";

type Preview = EntityResult | TaskResult | RecordResult | WorkspacePrinciple;
/** Current content only, never another relationship graph or a write during disclosure. */
export function RelatedPreviewItem(props:ComponentProps<typeof RelatedItem>) {
  const selection=useRelatedExpansion(),surface=useContext(SurfaceContext),button=useRef<HTMLElement|null>(null);
  const [item,setItem]=useState<Preview|null>(null),[error,setError]=useState<"missing"|"failed"|null>(null),[retry,setRetry]=useState(0);
  const path=props.to?.split(/[?#]/)[0];
  const enabled=!surface?.editor.current;
  const expanded=enabled&&!!path&&selection?.value===path;
  useEffect(()=>{
    if(!expanded||!path)return;
    const controller=new AbortController();setItem(null);setError(null);
    void api<Preview>("GET",path,undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setItem(value);},cause=>{
      if(!controller.signal.aborted)setError(cause instanceof ApiError&&cause.status===404&&cause.code==="not_found"?"missing":"failed");
    });
    return()=>controller.abort();
  },[path,expanded,retry]);
  if(!selection||!path)return <RelatedItem {...props}/>;
  if(!enabled)return <RelatedItem {...props} to={undefined}/>;
  const toggle=()=>{
    button.current=document.activeElement as HTMLElement;
    const top=button.current?.getBoundingClientRect().top;
    selection.toggle(path);
    requestAnimationFrame(()=>{
      const target=button.current,body=target?.closest<HTMLElement>(".modal-body");
      if(!body||!target?.isConnected||top===undefined)return;
      // Collapsing an earlier row must not move the newly activated title out of view.
      body.scrollTop+=target.getBoundingClientRect().top-top;
    });
  };
  const editable=item&&(!("is_current" in item)||item.is_current);
  return <RelatedItem {...props} to={undefined} disclosure={{expanded,toggle,content:<>
    {!item&&!error&&<p className="secondary" role="status">불러오는 중…</p>}
    {error==="missing"&&<p className="secondary">삭제된 대상 또는 접근할 수 없는 대상입니다.</p>}
    {error==="failed"&&<><Notice kind="error">내용을 불러오지 못했습니다.</Notice><button type="button" className="btn" onClick={()=>setRetry(n=>n+1)}>다시 시도</button></>}
    {item&&<>
      {"prop1" in item?<><dl className="props">{(["prop2","prop3","prop4"] as const).map(key=>item[key]!==null&&<div key={key}><dt>{entityLabels[key]}</dt><dd>{item[key]}</dd></div>)}</dl><TagNames compact scope="entity" ids={item.tag_ids}/></>:<>
        {item.body&&<MarkdownContent text={item.body}/>}
        {"status" in item&&<div className="related-item-meta"><StatusBadge status={item.status}/>{item.due_on&&<span className="meta">{item.due_on}</span>}</div>}
        {"tag_ids" in item&&<TagNames compact scope={"status" in item?"task":"record"} ids={item.tag_ids}/>}
      </>}
      {editable&&<div className="related-preview-actions"><DetailLink className="btn" to={`${path}?edit=1`} state={{relatedEditor:true,relatedTitle:props.title}} restoreKey={`edit-related-${path}`} aria-label={`${props.title} 편집`}>편집</DetailLink></div>}
    </>}
  </>}}/>;
}
