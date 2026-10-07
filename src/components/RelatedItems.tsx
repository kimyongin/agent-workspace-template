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
/** One disclosure across a detail; returning from an editor restores its previous selection. */
export function RelatedExpansionProvider({children}:{children:ReactNode}) {
  const [value,setValue]=useDetailViewState<string|null>("related-expanded",null);
  return <Expansion.Provider value={{value,toggle:key=>setValue(prior=>prior===key?null:key)}}>{children}</Expansion.Provider>;
}
export function useRelatedExpansion() { return useContext(Expansion); }

export function RelatedItem({to,title,metadata,restoreKey,action,disclosure}: {to?:string;title:string;metadata?:ReactNode;restoreKey?:string;action?:ReactNode;disclosure?:{expanded:boolean;toggle:()=>void;content:ReactNode}}) {
  const panel=useId(),heading=useId();
  return <div className="related-item"><div className="related-item-title">{disclosure
    ?<button id={heading} type="button" className="item-title related-toggle" aria-expanded={disclosure.expanded} aria-controls={panel} onClick={disclosure.toggle}><span aria-hidden="true" className="related-toggle-mark">{disclosure.expanded?"−":"＋"}</span>{title}</button>
    :to
    ?<DetailLink className="item-title" to={to} aria-label={title} restoreKey={restoreKey}>{title}</DetailLink>
    :<span className="item-title">{title}</span>}{action&&<div className="related-item-actions">{action}</div>}</div>{metadata&&<div className="related-item-meta">{metadata}</div>}{disclosure&&<div id={panel} hidden={!disclosure.expanded} aria-labelledby={heading} className="related-preview">{disclosure.expanded&&disclosure.content}</div>}</div>;
}
