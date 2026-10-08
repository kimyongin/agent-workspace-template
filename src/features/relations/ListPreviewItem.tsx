import { useEffect, useMemo, useRef, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ItemExpansionProvider } from "../../components/RelatedItems.tsx";
import { anchorId, listAnchor, listReturnPath, listScope, type ActivityListKind } from "../activity/list-state.ts";
import { RelatedPreviewItem } from "./RelatedPreviewItem.tsx";
import { createPreviewReadiness, ListPreviewReadiness, type PreviewReadiness } from "./preview-readiness.ts";

/** Restore after both the list and reopened content settle; loading height can clamp scroll. */
export function useRestoreListPosition(kind:ActivityListKind,ready:boolean) {
  const location=useLocation(),[params]=useSearchParams(),restored=useRef("");
  const key = [location.pathname, location.hash, listScope(params), params.get("open")].join("|");
  const path = params.get("open");
  const readiness = useMemo(()=>createPreviewReadiness(path),[key]);
  const previewReady = useSyncExternalStore(readiness.subscribe,readiness.snapshot);
  useEffect(()=>{
    if(!ready||restored.current===key||!anchorId(kind,location.hash))return;
    const target=document.getElementById(location.hash.slice(1));
    if(target&&path&&!previewReady)return;
    const frame=requestAnimationFrame(()=>{
      const focus=target??document.getElementById(kind+"-title");
      focus?.focus({preventScroll:true});
      const y=Number(params.get("scroll"));
      if(params.has("scroll")&&Number.isFinite(y)&&y>=0)window.scrollTo(0,y);
      const rect=focus?.getBoundingClientRect();
      if(rect&&(rect.top<0||rect.bottom>innerHeight))focus?.scrollIntoView({block:"center"});
      restored.current=key;
    });
    return()=>cancelAnimationFrame(frame);
  },[ready,previewReady,key,kind,location.hash]);
  return readiness;
}

/** List expansion belongs to its URL, so edit/save/back restores the same item. */
export function ListExpansionProvider({children,readiness}:{children:ReactNode;readiness?:PreviewReadiness}) {
  const [params,setParams]=useSearchParams();
  return <ListPreviewReadiness.Provider value={readiness??null}><ItemExpansionProvider value={params.get("open")} toggle={path=>{
    const next=new URLSearchParams(params);
    next.get("open")===path?next.delete("open"):next.set("open",path);
    setParams(next,{replace:true,preventScrollReset:true});
  }}>{children}</ItemExpansionProvider></ListPreviewReadiness.Provider>;
}

export function ListPreviewItem({kind,id,title,metadata,cells}:{kind:ActivityListKind;id:string;title:string;metadata?:ReactNode;cells?:ReactNode[]}) {
  const [params]=useSearchParams(),location=useLocation(),navigate=useNavigate();
  const path=`/${kind}/${id}`;
  const link=()=>{
    const back=listReturnPath(kind,params,id,0,location.pathname);
    return {to:`${path}?list=${encodeURIComponent(back)}`,onClick:(event:MouseEvent<HTMLAnchorElement>)=>{
      if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      event.preventDefault();
      const at=listReturnPath(kind,params,id,window.scrollY,location.pathname);
      void Promise.resolve(navigate(at,{replace:true,preventScrollReset:true})).then(()=>navigate(`${path}?list=${encodeURIComponent(at)}`,{state:null}));
    }};
  };
  return <div className={kind==="records"?"related-record":undefined}><RelatedPreviewItem id={listAnchor(kind,id)} to={path} title={title} cells={cells} list={{link,metadata}}/></div>;
}
