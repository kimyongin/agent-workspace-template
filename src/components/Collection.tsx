import { Fragment, type ReactNode, createContext, useContext } from "react";
import { useLocation, useNavigate, useSearchParams } from "../lib/workspace-router.tsx";
import { useCollectionExpansion } from "./item-expansion.tsx";
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group.tsx";
import { Button } from "./ui/button.tsx";
import { ItemGroup } from "./ui/item.tsx";
import { BusinessDetails, BusinessTable } from "./BusinessTable.tsx";
import { LayoutGridIcon, TableIcon, CalendarDaysIcon, ChevronsUpIcon, ChevronsDownIcon } from "lucide-react";
import { cn } from "../lib/utils.ts";

export type CollectionView = "cards" | "table" | "calendar";
export type ItemView = Exclude<CollectionView, "calendar">;
const names: Record<CollectionView, string> = { cards: "카드", table: "테이블", calendar: "캘린더" };
const icons = { cards: LayoutGridIcon, table: TableIcon, calendar: CalendarDaysIcon };

export function ViewPicker({ label, value, onChange, calendar = false }: {
  label: string; value: CollectionView; onChange: (view: CollectionView) => void; calendar?: boolean;
}) {
  const choices: CollectionView[] = calendar ? ["table", "cards", "calendar"] : ["table", "cards"];
  return <ToggleGroup type="single" variant="outline" spacing={1} value={value} className="max-w-full flex-wrap"
    aria-label={`${label} 보기 방식`} onValueChange={next => { if (choices.includes(next as CollectionView)) onChange(next as CollectionView); }}>
    {choices.map(view => { const Icon = icons[view]; return <ToggleGroupItem key={view} value={view} aria-label={names[view]} title={names[view]}>
      <Icon /><span className="sr-only">{names[view]}</span>
    </ToggleGroupItem>; })}
  </ToggleGroup>;
}

export function CollectionHeading(
  { id, label, count, hasMore = false, view, onChange, calendar, hideLabel = false }: {
    id?: string;
    label: string;
    hideLabel?: boolean;
    count?: number;
    hasMore?: boolean;
    view: CollectionView;
    onChange: (view: CollectionView) => void;
    calendar?: boolean;
  },
) {
  const expansion = useCollectionExpansion();
  const Icon = expansion?.allOpen ? ChevronsUpIcon : ChevronsDownIcon;
  return <div className="flex min-w-0 max-w-full flex-wrap items-center justify-between gap-3">
    <h2 id={id} className="text-base font-semibold" aria-label={hideLabel && count !== undefined ? `${label} (${count}개${hasMore ? "+" : ""})` : undefined}>
      {hideLabel && count !== undefined ? `${count}개${hasMore ? "+" : ""}` : <>{label}{count === undefined ? "" : ` (${count}개${hasMore ? "+" : ""})`}</>}
    </h2>
    <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
      {expansion && <Button type="button" variant="ghost" size="icon" aria-label={`${label} ${expansion.allOpen ? "전체 닫기" : "전체 열기"}`}
        title={expansion.allOpen ? "전체 닫기" : "전체 열기"} aria-expanded={expansion.allOpen} onClick={expansion.toggle}><Icon /></Button>}
      <ViewPicker label={label} value={view} onChange={onChange} calendar={calendar} />
    </div>
  </div>;
}

export function useMainCollectionView(calendar = false) {
  const [params] = useSearchParams(), location = useLocation(), navigate = useNavigate();
  const raw = params.get("view"),
    view: CollectionView = raw === "cards" || raw === "table" || calendar && raw === "calendar"
      ? raw as CollectionView
      : "table";
  const change = (next: CollectionView) => {
    const updated = new URLSearchParams(params);
    updated.set("view", next);
    void navigate({ pathname: location.pathname, search: updated.toString(), hash: location.hash }, {
      replace: true,
      preventScrollReset: true,
    });
  };
  return [view, change] as const;
}

export const RelatedCollectionView = createContext<ItemView>("table");
const ItemLayout = createContext<{ view: ItemView; columns: string[]; numericColumns: number[] } | null>(null);
export function useItemLayout() {
  return useContext(ItemLayout);
}

/** A collection entry keeps list and native table markup valid without remounting its feature state. */
export function CollectionItem({ children, className, ...props }: React.ComponentProps<"li">) {
  const layout = useItemLayout();
  return layout?.view === "table" ? <Fragment>{children}</Fragment> : <li {...props} className={cn("min-w-0", className)}>{children}</li>;
}

export function CollectionList({ children, view: explicit, columns = ["내용"], numericColumns = [], label = "목록", disclosureColumn = true }: {
  children: ReactNode; view?: ItemView; columns?: string[]; numericColumns?: number[]; label?: string; disclosureColumn?: boolean;
}) {
  const inherited = useContext(RelatedCollectionView), view = explicit ?? inherited;
  return <ItemLayout.Provider value={{ view, columns, numericColumns }}>
    {view === "table" ? <BusinessTable disclosureColumn={disclosureColumn} columns={columns} numericColumns={numericColumns} label={label}>{children}</BusinessTable> : <ItemGroup asChild><ul aria-label={label} className={cn("min-w-0", view === "cards" && "grid grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] items-start")}>{children}</ul></ItemGroup>}
  </ItemLayout.Provider>;
}

/** Keep loading and unavailable entries inside valid cells in every collection view. */
export function CollectionMessage(props: React.ComponentProps<"p">) {
  const table = useItemLayout()?.view === "table";
  const message = <p {...props} />;
  return table ? <BusinessDetails>{message}</BusinessDetails> : message;
}
