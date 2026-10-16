import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router";
import { RelatedItem, useRelatedExpansion } from "../../components/RelatedItems.tsx";
import { BodyAction, BodyActionFace } from "../../components/BodyAction.tsx";
import { useExpansionRegistration } from "../../components/item-expansion.tsx";
import { Notice } from "../../components/Field.tsx";
import { SurfaceContext } from "../../components/Modal.tsx";
import { DetailLink } from "../../lib/detail-exploration.tsx";
import { useRelatedRead } from "./useRelatedRead.ts";
import type { RelatedRead } from "./related-read.ts";
import { ApiError } from "../../lib/api.ts";

import { PreviewContents, previewKind, type Preview } from "./PreviewContents.tsx";
import { ListPreviewReadiness } from "./preview-readiness.ts";

/** Current content only, never another relationship graph or a write during disclosure. */
export function RelatedPreviewItem({list,fallback,resource,...props}:ComponentProps<typeof RelatedItem>&{list?:{link:()=>LinkProps;metadata?:ReactNode};fallback?:ReactNode;resource?:RelatedRead<Preview>}) {
  const readiness = useContext(ListPreviewReadiness);
  const selection=useRelatedExpansion(),surface=useContext(SurfaceContext),button=useRef<HTMLElement|null>(null);
  const path=props.to?.split(/[?#]/)[0],kind=path?previewKind(path):undefined;
  const read = useRelatedRead<Preview>(path, { resource });
  const item = read.preview.value;
  const cause = read.preview.error;
  const error = cause ? cause instanceof ApiError && cause.status === 404 && cause.code === "not_found" ? "missing" : "failed" : null;
  const enabled=!surface?.editor.current;
  useExpansionRegistration(kind ? path : undefined,enabled);
  const expanded=enabled&&!!path&&!!selection?.value.includes(path);
  const readKey=expanded?path:null;
  const [ownedKey,setOwnedKey]=useState(readKey),[tagsReady,setTagsReady]=useState(false),[propertiesReady,setPropertiesReady]=useState(false);
  if(ownedKey!==readKey){setOwnedKey(readKey);setTagsReady(false);setPropertiesReady(false);}
  const report=useRef<ReturnType<NonNullable<typeof readiness>["track"]>|null>(null);
  useLayoutEffect(()=>{
    if(!expanded||!path||!readiness)return;
    const tracked=readiness.track(path);report.current=tracked;
    return()=>{tracked.dispose();report.current=null;};
  },[readiness,path,expanded]);
  const onTagsReady=useCallback((ready:boolean)=>setTagsReady(ready),[]);
  const onPropertiesReady=useCallback((ready:boolean)=>setPropertiesReady(ready),[]);
  useLayoutEffect(()=>{report.current?.settle(!!fallback||!!error||!!item&&tagsReady&&(kind!=="entities"||propertiesReady));},[item,error,tagsReady,propertiesReady,kind,readiness,expanded,fallback]);
  const hasFallback = !!fallback;
  useEffect(() => {
    if (!expanded || !path || hasFallback) { read.resource.closePreview(); return; }
    void read.resource.read("preview");
    return () => read.resource.closePreview();
  }, [read.resource, path, expanded, hasFallback]);
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
  const viewable=!!item&&!error;
  const viewProps={className:"body-action",title:"상세","aria-label":`${props.title} 상세`};
  return <RelatedItem {...props} to={undefined} action={<>{props.action}{viewable&&(list?<Link {...list.link()} {...viewProps}><BodyActionFace icon="view">상세</BodyActionFace></Link>:<DetailLink {...viewProps} to={path} restoreKey={`view-related-${path}`}><BodyActionFace icon="view">상세</BodyActionFace></DetailLink>)}</>} disclosure={{expanded,toggle,content:<>{fallback}
    {!fallback&&!item&&!error&&<p className="secondary" role="status">불러오는 중…</p>}
    {!fallback&&error==="missing"&&<p className="secondary">삭제된 대상 또는 접근할 수 없는 대상입니다.</p>}
    {!fallback&&error==="failed"&&<><Notice kind="error">내용을 불러오지 못했습니다.</Notice><BodyAction onClick={()=>void read.resource.read("preview")}>다시 시도</BodyAction></>}
    {!fallback&&item&&<>
      <PreviewContents kind={kind} item={item} main={!!list} onTagsReady={onTagsReady} onPropertiesReady={onPropertiesReady}/>
      {list?.metadata}
    </>}
  </>}}/>;
}
