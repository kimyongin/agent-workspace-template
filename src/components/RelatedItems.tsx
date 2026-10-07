import { useId, type ReactNode } from "react";
import { DetailLink } from "../lib/detail-exploration.tsx";
import "./related-items.css";

/** A related section owns presentation; its feature supplies data, loading and actions. */
export function RelatedSection({title,count,action,children}: {title:string;count?:number;action?:ReactNode;children:ReactNode}) {
  const heading=useId();
  return <section className="detail-section related-section" aria-labelledby={heading}>
    <div className="detail-section-head"><h2 id={heading} className="section-title">{title}{count!==undefined?` (${count}개)`:""}</h2>{action}</div>
    {children}
  </section>;
}

export function RelatedItem({to,title,metadata,restoreKey}: {to?:string;title:string;metadata?:ReactNode;restoreKey?:string}) {
  const content=<><div className="related-item-title"><span className="item-title">{title}</span>{to&&<span aria-hidden="true">›</span>}</div>{metadata&&<div className="related-item-meta">{metadata}</div>}</>;
  return to?<DetailLink className="related-item" to={to} aria-label={title} restoreKey={restoreKey}>{content}</DetailLink>:<div className="related-item">{content}</div>;
}
