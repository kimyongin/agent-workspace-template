import { Fragment } from "react";
import { useItemLayout } from "../../components/Collection.tsx";
import { restoreScroll, scrollTop } from "../../lib/surface-dom.ts";
import { useContext, useEffect, useMemo, useRef, useSyncExternalStore, type MouseEvent, type ReactNode } from "react";
import { WorkspaceContext } from "../details/workspace-context.ts";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ExpansionGroupProvider } from "../../components/item-expansion.tsx";
import { ItemExpansionProvider } from "../../components/RelatedItems.tsx";
import { anchorId, listAnchor, listDetailVisit, listScope, type ActivityListKind } from "../activity/list-state.ts";
import { RelatedPreviewItem } from "./RelatedPreviewItem.tsx";
import { createPreviewReadiness, ListPreviewReadiness, type PreviewReadiness } from "./preview-readiness.ts";

/** Restore after both the list and reopened content settle; loading height can clamp scroll. */
export function useRestoreListPosition(kind:ActivityListKind,ready:boolean) {
  const location=useLocation(),[params]=useSearchParams(),restored=useRef("");
  const paths = params.getAll("open");
  const key = JSON.stringify([location.pathname, location.hash, listScope(params), paths]);
  const readiness = useMemo(()=>createPreviewReadiness(paths),[key]);
  const previewReady = useSyncExternalStore(readiness.subscribe,readiness.snapshot);
  useEffect(()=>{
    if(!ready||restored.current===key||!anchorId(kind,location.hash))return;
    const target=document.getElementById(listAnchor(kind,anchorId(kind,location.hash)!));
    if(target&&paths.length&&!previewReady)return;
    const frame=requestAnimationFrame(()=>{
      const focus=target??document.getElementById(kind+"-title");
      focus?.focus({preventScroll:true});
      const y=Number(params.get("scroll"));
      if(params.has("scroll")&&Number.isFinite(y)&&y>=0){restoreScroll(target,y);}
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
  const [params,originalSetParams]=useSearchParams(),location=useLocation(),navigate=useNavigate();
  const setParams=(next:URLSearchParams,options:{replace:boolean;preventScrollReset:boolean})=>location.pathname==="/entities"&&location.hash.startsWith("#property_filters=")
    ?navigate({pathname:location.pathname,search:next.toString(),hash:location.hash},options):originalSetParams(next,options);
  return <ListPreviewReadiness.Provider value={readiness??null}><ItemExpansionProvider value={params.getAll("open")} toggle={path=>{
    const next=new URLSearchParams(params);
    if(next.getAll("open").includes(path))next.delete("open",path);else next.append("open",path);
    setParams(next,{replace:true,preventScrollReset:true});
  }} setMany={(paths,open)=>{
    const next=new URLSearchParams(params);
    const selected=next.getAll("open");next.delete("open");
    const result=open?[...new Set([...selected,...paths])]:selected.filter(path=>!paths.includes(path));
    result.forEach(path=>next.append("open",path));
    setParams(next,{replace:true,preventScrollReset:true});
  }}><ExpansionGroupProvider>{children}</ExpansionGroupProvider></ItemExpansionProvider></ListPreviewReadiness.Provider>;
}

export function ListPreviewItem({kind,id,title,metadata,cells}:{kind:ActivityListKind;id:string;title:string;metadata?:ReactNode;cells?:ReactNode[]}) {
  const location=useLocation(),navigate=useNavigate();
  const workspace=useContext(WorkspaceContext);
  const path=`/${kind}/${encodeURIComponent(id)}`;
  const table = useItemLayout()?.view === "table";
  const Wrapper = table ? Fragment : "div";
  const link=()=>{
    return {to:listDetailVisit(kind,location,id,0).to,onClick:(event:MouseEvent<HTMLAnchorElement>)=>{
      if(event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
      event.preventDefault();
      const visit=listDetailVisit(kind,location,id,scrollTop(event.currentTarget));
      if(workspace){workspace.open(visit.to,{...location,...visit.origin});return;}
      void Promise.resolve(navigate(visit.back,{replace:true,preventScrollReset:true})).then(()=>navigate(visit.to,{state:null}));
    }};
  };
  return <Wrapper {...(table ? {} : {className: kind === "records" ? "related-record" : undefined})}><RelatedPreviewItem id={listAnchor(kind,id)} to={path} title={title} titleLabel={kind==="tasks"?"제목":kind==="records"?"본문 대표 문구":undefined} cells={cells} list={{link,metadata}}/></Wrapper>;
}
