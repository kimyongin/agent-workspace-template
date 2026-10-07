import { useId, type ReactNode } from "react";
import { DetailLink } from "../lib/detail-exploration.tsx";
import "./related-items.css";

/** A related section owns presentation; its feature supplies data, loading and actions. */
export function RelatedSection({title,count,hasMore=false,action,children}: {title:string;count?:number;hasMore?:boolean;action?:ReactNode;children:ReactNode}) {
  const heading=useId();
  return <section className="detail-section related-section" aria-labelledby={heading}>
    <div className="detail-section-head"><h2 id={heading} className="section-title">{title}{count!==undefined?` (${count}개${hasMore?"+":""})`:""}</h2>{action}</div>
    {children}
  </section>;
}

export function RelatedItem({to,title,metadata,restoreKey,action}: {to?:string;title:string;metadata?:ReactNode;restoreKey?:string;action?:ReactNode}) {
  return <div className="related-item"><div className="related-item-title">{to
    ?<DetailLink className="item-title" to={to} aria-label={title} restoreKey={restoreKey}>{title}</DetailLink>
    :<span className="item-title">{title}</span>}{action?<div className="related-item-actions">{action}</div>:to&&<span aria-hidden="true">›</span>}</div>{metadata&&<div className="related-item-meta">{metadata}</div>}</div>;
}
