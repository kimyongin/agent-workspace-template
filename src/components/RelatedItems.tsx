import { createContext, useContext, useId, type ReactNode } from "react";
import { DetailLink, useDetailViewState } from "../lib/detail-exploration.tsx";
import { CollectionHeading, RelatedCollectionView, useItemLayout, type ItemView } from "./Collection.tsx";
import "./related-items.css";

/** A related section owns presentation; its feature supplies data, loading and actions. */
export function RelatedSection({title,count,hasMore=false,action,children,views=true}: {title:string;count?:number;hasMore?:boolean;action?:ReactNode;children:ReactNode;views?:boolean}) {
  const heading=useId();
  const [view,setView]=useDetailViewState<ItemView>(`collection-view-${title}`,"list");
  return <RelatedCollectionView.Provider value={view}><section className="detail-section related-section" aria-labelledby={heading}>
    <div className="detail-section-head"><div id={heading}>{views?<CollectionHeading label={title} count={count} hasMore={hasMore} view={view} onChange={next=>setView(next as ItemView)}/>:<h2 className="section-title">{title}{count!==undefined?` (${count}개${hasMore?"+":""})`:""}</h2>}</div>{action}</div>
    {children}
  </section></RelatedCollectionView.Provider>;
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

export function RelatedItem({id,to,title,metadata,restoreKey,action,disclosure,cells=[]}: {id?:string;to?:string;title:string;metadata?:ReactNode;restoreKey?:string;action?:ReactNode;cells?:ReactNode[];disclosure?:{expanded:boolean;toggle:()=>void;content:ReactNode}}) {
  const panel=useId(),generatedHeading=useId(),heading=id??generatedHeading;
  const layout=useItemLayout(),table=layout?.view==="table";
  const titleContent=disclosure
    ?<button id={heading} type="button" className="item-title related-toggle" aria-expanded={disclosure.expanded} aria-controls={panel} onClick={disclosure.toggle}><span className="related-item-text">{title}</span></button>
    :to
    ?<DetailLink className="item-title" to={to} aria-label={title} restoreKey={restoreKey}><span className="related-item-text">{title}</span></DetailLink>
    :<span className="item-title"><span className="related-item-text">{title}</span></span>;
  const actions=(action||disclosure)&&<div className="related-item-actions">{(!disclosure||disclosure.expanded)&&action}{disclosure&&<button type="button" className="btn btn-text item-icon" aria-label={`${title} ${disclosure.expanded?"접기":"열기"}`} title={disclosure.expanded?"접기":"열기"} aria-expanded={disclosure.expanded} aria-controls={panel} onClick={disclosure.toggle}><ItemIcon kind={disclosure.expanded?"up":"down"}/></button>}</div>;
  const details=<>{metadata&&(!disclosure||disclosure.expanded)&&<div className="related-item-meta">{metadata}</div>}{disclosure&&<div id={panel} hidden={!disclosure.expanded} aria-labelledby={heading} className="related-preview">{disclosure.expanded&&disclosure.content}</div>}</>;
  return <div className="related-item" data-expanded={disclosure?.expanded||undefined}>
    <div className="related-item-title" role={table?"row":undefined}>
      <div className="related-item-heading" role={table?"cell":undefined}>{titleContent}{table&&actions}</div>
      {table?layout.columns.slice(1).map((column,index)=><div className={`collection-table-cell${layout.numericColumns.includes(index+1)?" collection-numeric":""}`} role="cell" key={column}>{cells[index]??"—"}</div>):actions}
    </div>
    {layout?.view==="cards"&&cells.length>0&&<dl className="collection-card-data">{layout.columns.slice(1).map((column,index)=>cells[index]!=null&&<div key={column}><dt>{column}</dt><dd>{cells[index]}</dd></div>)}</dl>}
    {table?<div role="row" hidden={!disclosure?.expanded&&!(metadata&&!disclosure)}><div role="cell" aria-colspan={layout.columns.length}>{details}</div></div>:details}
  </div>;
}

function ItemIcon({kind}:{kind:"up"|"down"}) {
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={kind==="down"?"m6 9 6 6 6-6":"m6 15 6-6 6 6"}/></svg>;
}
