import { type ReactNode, useId } from "react";
import { DetailLink, useDetailViewState } from "../lib/detail-exploration.tsx";
import { CollectionHeading, type ItemView, RelatedCollectionView, useItemLayout } from "./Collection.tsx";
import { Button } from "./ui/button.tsx";
import { Item, ItemContent, ItemHeader, ItemActions } from "./ui/item.tsx";
import { BusinessRow, BusinessCell, BusinessDisclosureCell, BusinessDetails } from "./BusinessTable.tsx";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "./ui/collapsible.tsx";
import { ChevronRightIcon, ChevronDownIcon } from "lucide-react";
import { cn } from "../lib/utils.ts";
import { ExpansionGroupProvider, ItemExpansion } from "./item-expansion.tsx";
import { useContext } from "react";

/** A related section owns presentation; its feature supplies data, loading and actions. */
export function RelatedSection(
  { title, count, hasMore = false, action, children, views = true, busy = false }: {
    title: string;
    count?: number;
    hasMore?: boolean;
    action?: ReactNode;
    children: ReactNode;
    views?: boolean;
    busy?: boolean;
  },
) {
  const heading = useId();
  const [storedView, setView] = useDetailViewState<unknown>(`collection-view-${title}`, "table");
  const view: ItemView = storedView === "cards" ? "cards" : "table";
  return (
    <RelatedCollectionView.Provider value={view}>
      <ExpansionGroupProvider>
        <section className="flex min-w-0 flex-col gap-4" aria-labelledby={heading} aria-busy={busy || undefined}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              {views
                ? (
                  <CollectionHeading
                    id={heading}
                    label={title}
                    count={count}
                    hasMore={hasMore}
                    view={view}
                    onChange={(next) => setView(next as ItemView)}
                  />
                )
                : (
                  <h2 id={heading} className="text-base font-semibold">
                    {title}
                    {count !== undefined ? ` (${count}개${hasMore ? "+" : ""})` : ""}
                  </h2>
                )}
            </div>
            {action}
          </div>
          {children}
        </section>
      </ExpansionGroupProvider>
    </RelatedCollectionView.Provider>
  );
}

export function ItemExpansionProvider(
  { value, toggle, setMany, children }: {
    value: readonly string[];
    toggle: (key: string) => void;
    setMany: (keys: readonly string[], open: boolean) => void;
    children: ReactNode;
  },
) {
  return <ItemExpansion.Provider value={{ value, toggle, setMany }}>{children}</ItemExpansion.Provider>;
}
/** Each disclosure is independent; returning from a related viewer restores all open items. */
export function RelatedExpansionProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useDetailViewState<string[]>("related-expanded", []);
  return (
    <ItemExpansionProvider
      value={value}
      toggle={(key) =>
        setValue((prior) => prior.includes(key) ? prior.filter((path) => path !== key) : [...prior, key])}
      setMany={(keys, open) =>
        setValue((prior) => open ? [...new Set([...prior, ...keys])] : prior.filter((path) => !keys.includes(path)))}
    >
      {children}
    </ItemExpansionProvider>
  );
}
export function useRelatedExpansion() {
  return useContext(ItemExpansion);
}

export function RelatedItem(
  { id, to, title, titleLabel, metadata, summary, titleBadge, restoreKey, action, disclosure, cells = [] }: {
    id?: string;
    to?: string;
    title: string;
    titleLabel?: string;
    metadata?: ReactNode;
    summary?: ReactNode;
    titleBadge?: ReactNode;
    restoreKey?: string;
    action?: ReactNode;
    cells?: ReactNode[];
    disclosure?: { expanded: boolean; toggle: () => void; content: ReactNode };
  },
) {
  const panel = useId(), generatedHeading = useId(), heading = id ?? generatedHeading;
  const layout = useItemLayout(), table = layout?.view === "table";
  const label = titleLabel ?? (layout?.columns[0] !== "내용" ? layout?.columns[0] : undefined) ??
    (to?.startsWith("/records/") ? "본문 대표 문구" : to?.startsWith("/tasks/") ? "제목" : "자료 이름");
  const titleButton = <Button data-list-anchor={id ? "" : undefined} id={heading} type="button" variant="link" className="h-auto min-h-[max(2.75rem,44px)] max-w-full justify-start px-0 text-left whitespace-normal wrap-anywhere"
    aria-expanded={disclosure?.expanded} aria-controls={disclosure ? panel : undefined} onClick={table ? disclosure?.toggle : undefined}>{title}</Button>;
  const titleContent = disclosure ? (table ? titleButton : <CollapsibleTrigger asChild>{titleButton}</CollapsibleTrigger>)
    : to ? <Button asChild variant="ghost" className="h-auto min-h-[max(2.75rem,44px)] max-w-full justify-start px-0 text-left whitespace-normal wrap-anywhere"><DetailLink data-list-anchor={id ? "" : undefined} id={heading} to={to} aria-label={title} restoreKey={restoreKey}>{title}</DetailLink></Button>
    : <span id={heading} className="font-medium wrap-anywhere">{title}</span>;
  const Icon = disclosure?.expanded ? ChevronDownIcon : ChevronRightIcon;
  const toggle = disclosure && <Button type="button" variant="ghost" size="icon" aria-label={`${title} ${disclosure.expanded ? "접기" : "열기"}`}
    title={disclosure.expanded ? "접기" : "열기"} aria-expanded={disclosure.expanded} aria-controls={panel} onClick={table ? disclosure.toggle : undefined}><Icon /></Button>;
  const actions = (action || disclosure) && <ItemActions className="max-w-full shrink-0 flex-wrap">
    {(!disclosure || disclosure.expanded) && action}
    {table ? toggle : toggle && <CollapsibleTrigger asChild>{toggle}</CollapsibleTrigger>}
  </ItemActions>;
  const metadataContent = metadata && (!disclosure || disclosure.expanded) && <div className="min-w-0 text-sm text-muted-foreground">{metadata}</div>;
  const previewContent = disclosure?.expanded && disclosure.content;
  const titleData = <dl className="min-w-0 flex-1"><div><dt className="text-xs text-muted-foreground">{label}</dt><dd className="flex min-w-0 flex-wrap items-center gap-2">{titleContent}{titleBadge}</dd></div></dl>;
  if (table) return <>
    <BusinessRow data-expanded={disclosure?.expanded || undefined}>
      <BusinessDisclosureCell>{toggle}</BusinessDisclosureCell>
      <BusinessCell index={0}><div className="flex min-w-0 flex-wrap items-center gap-2">{titleContent}{titleBadge}{!disclosure && action}</div></BusinessCell>
      {layout.columns.slice(1).map((column, index) => <BusinessCell key={index} index={index + 1}>{cells[index] ?? "—"}</BusinessCell>)}
    </BusinessRow>
    {(disclosure?.expanded || metadata && !disclosure) && <BusinessDetails id={panel} aria-labelledby={heading}>
      {metadataContent}{previewContent}{disclosure && action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </BusinessDetails>}
  </>;
  const item = <Item variant="outline" className="@container min-w-0 flex-col flex-nowrap items-stretch">
    <ItemHeader className="flex-wrap items-start">{titleData}{actions}</ItemHeader>
    <ItemContent className="min-w-0">
      {cells.length > 0 && <dl className="grid min-w-0 grid-cols-[repeat(auto-fill,minmax(min(100%,16rem),1fr))] gap-4">
        {(layout?.columns.slice(1) ?? cells.map(() => "값")).map((column, index) => <div key={column} className="min-w-0"><dt className="text-xs text-muted-foreground">{column}</dt><dd className="wrap-anywhere">{cells[index] ?? "—"}</dd></div>)}
      </dl>}
      {summary && cells.length === 0 && <div className="min-w-0 text-muted-foreground">{summary}</div>}
      {metadataContent}
      {disclosure && <CollapsibleContent id={panel} aria-labelledby={heading} className="min-w-0 pt-3">{previewContent}</CollapsibleContent>}
    </ItemContent>
  </Item>;
  return disclosure ? <Collapsible asChild open={disclosure.expanded} onOpenChange={next => { if (next !== disclosure.expanded) disclosure.toggle(); }}>{item}</Collapsible> : item;
}
