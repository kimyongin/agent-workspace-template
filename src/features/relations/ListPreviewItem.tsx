import type { MouseEvent, ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { ItemExpansionProvider } from "../../components/RelatedItems.tsx";
import { listAnchor, listReturnPath, type ActivityListKind } from "../activity/list-state.ts";
import { RelatedPreviewItem } from "./RelatedPreviewItem.tsx";
import { useDetailNavigationScope } from "../../lib/detail-exploration.tsx";

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
