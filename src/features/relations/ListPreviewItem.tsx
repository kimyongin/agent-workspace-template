import { useContext, useEffect, useMemo, useRef, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { WorkspaceContext } from "../details/workspace-context.ts";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ItemExpansionProvider } from "../../components/RelatedItems.tsx";
import { anchorId, listAnchor, listReturnPath, listScope, type ActivityListKind } from "../activity/list-state.ts";
import { RelatedPreviewItem } from "./RelatedPreviewItem.tsx";
import { createPreviewReadiness, ListPreviewReadiness, type PreviewReadiness } from "./preview-readiness.ts";

/** Restore after both the list and reopened content settle; loading height can clamp scroll. */
export function useRestoreListPosition(kind:ActivityListKind,ready:boolean) {
  const workspace=useContext(WorkspaceContext);
  const location=useLocation(),[params]=useSearchParams(),restored=useRef({key:"",positionKey:""});
  // A workspace return restores focus again only after the refreshed list and preview settle.
  const positionKey = [location.pathname, location.hash, listScope(params), params.get("open")].join("|");
  const key = `${positionKey}|${workspace?.listReturnRevision ?? 0}`;
  const path = params.get("open");
  const readiness = useMemo(()=>createPreviewReadiness(path),[key]);
  const previewReady = useSyncExternalStore(readiness.subscribe,readiness.snapshot);
  useEffect(()=>{
    if(!ready||restored.current.key===key||!anchorId(kind,location.hash))return;
    const target=document.getElementById(listAnchor(kind,anchorId(kind,location.hash)!));
    if(target&&path&&!previewReady)return;
    const frame=requestAnimationFrame(()=>{
      const focus=target??document.getElementById(kind+"-title");
      focus?.focus({preventScroll:true});
      // The workspace already transfers the reader's live scroll when the pane closes.
      if(restored.current.positionKey!==positionKey){
        const y=Number(params.get("scroll"));
        const container=target?.closest<HTMLElement>(".has-detail-panel .workspace-list");
        if(params.has("scroll")&&Number.isFinite(y)&&y>=0){if(container)container.scrollTop=y;else window.scrollTo(0,y);}
      }
      // A removed or filtered row returns to a visible heading instead.
      if(restored.current.positionKey!==positionKey||!target){
        const rect=focus?.getBoundingClientRect();
        if(rect&&(rect.top<0||rect.bottom>innerHeight))focus?.scrollIntoView({block:"center"});
      }
      restored.current={key,positionKey};
    });
    return()=>cancelAnimationFrame(frame);
  },[ready,previewReady,key,positionKey,kind,location.hash]);
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
  const workspace=useContext(WorkspaceContext);
  const path=`/${kind}/${encodeURIComponent(id)}`;
  const link=()=>{
    const back=listReturnPath(kind,params,id,0,location.pathname);
    return {to:`${path}?list=${encodeURIComponent(back)}`,onClick:(event:MouseEvent<HTMLAnchorElement>)=>{
      if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      event.preventDefault();
      const container=event.currentTarget.closest<HTMLElement>(".has-detail-panel .workspace-list");
      const at=listReturnPath(kind,params,id,container?.scrollTop??window.scrollY,location.pathname);
      if(workspace){const url=new URL(at,"https://workspace.invalid");workspace.open(`${path}?list=${encodeURIComponent(at)}`,{...location,search:url.search,hash:url.hash});return;}
      void Promise.resolve(navigate(at,{replace:true,preventScrollReset:true})).then(()=>navigate(`${path}?list=${encodeURIComponent(at)}`,{state:null}));
    }};
  };
  return <div className={kind==="records"?"related-record":undefined}><RelatedPreviewItem id={listAnchor(kind,id)} to={path} title={title} cells={cells} list={{link,metadata}}/></div>;
}
