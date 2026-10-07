import { useEffect, useRef, type MouseEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ItemExpansionProvider } from "../../components/RelatedItems.tsx";
import { anchorId, listAnchor, listReturnPath, listScope, type ActivityListKind } from "../activity/list-state.ts";
import { RelatedPreviewItem } from "./RelatedPreviewItem.tsx";
import { useDetailNavigationScope } from "../../lib/detail-exploration.tsx";

/** Restore after both the list and reopened content settle; loading height can clamp scroll. */
export function useRestoreListPosition(kind:ActivityListKind,ready:boolean) {
  const location=useLocation(),[params]=useSearchParams(),restored=useRef("");
  const key=`${location.pathname}|${location.hash}|${listScope(params)}`;
  useEffect(()=>{
    if(!ready||restored.current===key||!anchorId(kind,location.hash))return;
    let frame=0;
    const restore=()=>{
      const target=document.getElementById(location.hash.slice(1));
      if(target?.closest(".related-item")?.querySelector('.related-preview [role="status"]'))return;
      const focus=target??document.getElementById(`${kind}-title`);
      focus?.focus({preventScroll:true});
      const y=Number(params.get("scroll"));
      if(params.has("scroll")&&Number.isFinite(y)&&y>=0)window.scrollTo(0,y);
      const rect=focus?.getBoundingClientRect();
      if(rect&&(rect.top<0||rect.bottom>innerHeight))focus?.scrollIntoView({block:"center"});
      restored.current=key;observer.disconnect();
    };
    const schedule=()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(restore);};
    const observer=new MutationObserver(schedule);
    observer.observe(document.body,{childList:true,subtree:true});schedule();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();};
  },[ready,key,kind,location.hash]);
}

/** List expansion belongs to its URL, so edit/save/back restores the same item. */
export function ListExpansionProvider({children}:{children:ReactNode}) {
  const [params,setParams]=useSearchParams();
  return <ItemExpansionProvider value={params.get("open")} toggle={path=>{
    const next=new URLSearchParams(params);
    next.get("open")===path?next.delete("open"):next.set("open",path);
    setParams(next,{replace:true,preventScrollReset:true});
  }}>{children}</ItemExpansionProvider>;
}

export function ListPreviewItem({kind,id,title,metadata}:{kind:ActivityListKind;id:string;title:string;metadata?:ReactNode}) {
  const [params]=useSearchParams(),location=useLocation(),navigate=useNavigate();
  const detailScope=useDetailNavigationScope();
  const path=`/${kind}/${id}`;
  const link=(editing:boolean)=>{
    const back=listReturnPath(kind,params,id,0,location.pathname);
    return {to:`${path}?list=${encodeURIComponent(back)}${editing?"&edit=1":""}`,onClick:(event:MouseEvent<HTMLAnchorElement>)=>{
      if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      event.preventDefault();
      const at=listReturnPath(kind,params,id,window.scrollY,location.pathname);
      void Promise.resolve(navigate(at,{replace:true,preventScrollReset:true})).then(()=>navigate(`${path}?list=${encodeURIComponent(at)}${editing?"&edit=1":""}`,{state:editing?{listEditor:true,detailScope}:null}));
    }};
  };
  return <div className={kind==="records"?"related-record":undefined}><RelatedPreviewItem id={listAnchor(kind,id)} to={path} title={title} list={{link,metadata}}/></div>;
}
