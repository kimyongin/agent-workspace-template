import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { RelatedItem, useRelatedExpansion } from "../../components/RelatedItems.tsx";
import { BodyAction, BodyActionFace } from "../../components/BodyAction.tsx";
import { Notice } from "../../components/Field.tsx";
import { SurfaceContext } from "../../components/Modal.tsx";
import { DetailLink } from "../../lib/detail-exploration.tsx";
import { api, ApiError } from "../../lib/api.ts";

import { PreviewContents, previewKind, previewViewable, type Preview } from "./PreviewContents.tsx";
import { ListPreviewReadiness } from "./preview-readiness.ts";

/** Current content only, never another relationship graph or a write during disclosure. */
export function RelatedPreviewItem({list,...props}:ComponentProps<typeof RelatedItem>&{list?:{link:()=>LinkProps;metadata?:ReactNode}}) {
  const readiness = useContext(ListPreviewReadiness);
  const selection=useRelatedExpansion(),surface=useContext(SurfaceContext),button=useRef<HTMLElement|null>(null);
  const [item,setItem]=useState<Preview|null>(null),[error,setError]=useState<"missing"|"failed"|null>(null),[retry,setRetry]=useState(0);
  const path=props.to?.split(/[?#]/)[0],kind=path?previewKind(path):undefined;
  const enabled=!surface?.editor.current;
  const expanded=enabled&&!!path&&selection?.value===path;
  const readKey=expanded?path:null;
  const [ownedKey,setOwnedKey]=useState(readKey),[tagsReady,setTagsReady]=useState(false);
  if(ownedKey!==readKey){setOwnedKey(readKey);setItem(null);setError(null);setTagsReady(false);}
  const report=useRef<ReturnType<NonNullable<typeof readiness>["track"]>|null>(null);
  useLayoutEffect(()=>{
    if(!expanded||!path||!readiness)return;
    const tracked=readiness.track(path);report.current=tracked;
    return()=>{tracked.dispose();report.current=null;};
  },[readiness,path,expanded]);
  const onTagsReady=useCallback((ready:boolean)=>setTagsReady(ready),[]);
  useLayoutEffect(()=>{report.current?.settle(!!error||!!item&&(kind==="principles"||tagsReady));},[item,error,tagsReady,kind,readiness,expanded]);
  useEffect(()=>{
    if(!expanded||!path){setItem(null);setError(null);return;}
    const controller=new AbortController();setItem(null);setError(null);
    void api<Preview>("GET",path,undefined,controller.signal).then(value=>{if(!controller.signal.aborted)setItem(value);},cause=>{
      if(!controller.signal.aborted)setError(cause instanceof ApiError&&cause.status===404&&cause.code==="not_found"?"missing":"failed");
    });
    return()=>controller.abort();
  },[path,expanded,retry]);
  if(!selection||!path||!kind)return <RelatedItem {...props}/>;
  if(!enabled)return <RelatedItem {...props} to={undefined}/>;
  const toggle=()=>{
    button.current=document.activeElement as HTMLElement;
    const top=button.current?.getBoundingClientRect().top;
    selection.toggle(path);
    requestAnimationFrame(()=>{
      const target=button.current,body=target?.closest<HTMLElement>(".modal-body");
      if(!target?.isConnected||top===undefined)return;
      // Collapsing an earlier row must not move the newly activated title out of view.
      const shift=target.getBoundingClientRect().top-top;
      if(body)body.scrollTop+=shift;else window.scrollBy(0,shift);
    });
  };
  const viewable=!!item&&!error&&previewViewable(kind,item);
  const viewProps={className:"body-action",title:"상세","aria-label":`${props.title} 상세`};
  return <RelatedItem {...props} to={undefined} action={<>{props.action}{viewable&&(list?<Link {...list.link()} {...viewProps}><BodyActionFace icon="view">상세</BodyActionFace></Link>:<DetailLink {...viewProps} to={path} restoreKey={`view-related-${path}`}><BodyActionFace icon="view">상세</BodyActionFace></DetailLink>)}</>} disclosure={{expanded,toggle,content:<>
    {!item&&!error&&<p className="secondary" role="status">불러오는 중…</p>}
    {error==="missing"&&<p className="secondary">삭제된 대상 또는 접근할 수 없는 대상입니다.</p>}
    {error==="failed"&&<><Notice kind="error">내용을 불러오지 못했습니다.</Notice><BodyAction onClick={()=>setRetry(n=>n+1)}>다시 시도</BodyAction></>}
    {item&&<>
      <PreviewContents kind={kind} item={item} main={!!list} onTagsReady={onTagsReady}/>
      {list?.metadata}
    </>}
  </>}}/>;
}
