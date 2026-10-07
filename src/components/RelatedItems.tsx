import { createContext, useContext, useId, type ReactNode } from "react";
import { DetailLink, useDetailViewState } from "../lib/detail-exploration.tsx";
import "./related-items.css";

/** A related section owns presentation; its feature supplies data, loading and actions. */
export function RelatedSection({title,count,hasMore=false,action,children}: {title:string;count?:number;hasMore?:boolean;action?:ReactNode;children:ReactNode}) {
  const heading=useId();
  return <section className="detail-section related-section" aria-labelledby={heading}>
    <div className="detail-section-head"><h2 id={heading} className="section-title">{title}{count!==undefined?` (${count}개${hasMore?"+":""})`:""}</h2>{action}</div>
    {children}
  </section>;
}

const Expansion = createContext<{value:string|null;toggle:(key:string)=>void}|null>(null);
export function ItemExpansionProvider({value,toggle,children}:{value:string|null;toggle:(key:string)=>void;children:ReactNode}) {
  return <Expansion.Provider value={{value,toggle}}>{children}</Expansion.Provider>;
}
/** One disclosure across a detail; returning from a related viewer restores its previous selection. */
export function RelatedExpansionProvider({children}:{children:ReactNode}) {
  const [value,setValue]=useDetailViewState<string|null>("related-expanded",null);
  return <ItemExpansionProvider value={value} toggle={key=>setValue(prior=>prior===key?null:key)}>{children}</ItemExpansionProvider>;
}
export function useRelatedExpansion() { return useContext(Expansion); }

export function RelatedItem({id,to,title,metadata,restoreKey,action,disclosure}: {id?:string;to?:string;title:string;metadata?:ReactNode;restoreKey?:string;action?:ReactNode;disclosure?:{expanded:boolean;toggle:()=>void;content:ReactNode}}) {
  const panel=useId(),generatedHeading=useId(),heading=id??generatedHeading;
  return <div className="related-item" data-expanded={disclosure?.expanded||undefined}><div className="related-item-title"><div className="related-item-heading">{disclosure
    ?<button id={heading} type="button" className="item-title related-toggle" aria-expanded={disclosure.expanded} aria-controls={panel} onClick={disclosure.toggle}><span className="related-item-text">{title}</span></button>
    :to
    ?<DetailLink className="item-title" to={to} aria-label={title} restoreKey={restoreKey}><span className="related-item-text">{title}</span></DetailLink>
    :<span className="item-title"><span className="related-item-text">{title}</span></span>}</div>{(action||disclosure)&&<div className="related-item-actions">{(!disclosure||disclosure.expanded)&&action}{disclosure&&<button type="button" className="btn btn-text item-icon" aria-label={`${title} ${disclosure.expanded?"접기":"열기"}`} title={disclosure.expanded?"접기":"열기"} aria-expanded={disclosure.expanded} aria-controls={panel} onClick={disclosure.toggle}><ItemIcon kind={disclosure.expanded?"up":"down"}/></button>}</div>}</div>{metadata&&(!disclosure||disclosure.expanded)&&<div className="related-item-meta">{metadata}</div>}{disclosure&&<div id={panel} hidden={!disclosure.expanded} aria-labelledby={heading} className="related-preview">{disclosure.expanded&&disclosure.content}</div>}</div>;
}

export function ItemIcon({kind}:{kind:"view"|"up"|"down"}) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{kind==="view"?<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></>:<path d={kind==="down"?"m6 9 6 6 6-6":"m6 15 6-6 6 6"}/>}</svg>;
}
