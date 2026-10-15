import {
  Children,
  cloneElement,
  createContext,
  type CSSProperties,
  isValidElement,
  type ReactNode,
  useContext,
  useRef,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import "./collection.css";
import { useCollectionExpansion } from "./item-expansion.tsx";

export type CollectionView = "list" | "cards" | "table" | "calendar";
export type ItemView = Exclude<CollectionView, "calendar">;
const names: Record<CollectionView, string> = { list: "리스트", cards: "카드", table: "테이블", calendar: "캘린더" };
const icons: Record<CollectionView, string> = {
  list: "M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01",
  cards: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  table: "M3 4h18v16H3zM3 9h18M3 14h18M10 9v11M16 9v11",
  calendar: "M3 5h18v16H3zM7 3v4M17 3v4M3 10h18M7 14h.01M12 14h.01M17 14h.01",
};

/** Only presentation belongs here; data, pagination and mutations remain with the feature. */
export function ViewPicker(
  { label, value, onChange, calendar = false }: {
    label: string;
    value: CollectionView;
    onChange: (view: CollectionView) => void;
    calendar?: boolean;
  },
) {
  const root = useRef<HTMLDivElement>(null);
  const choices: CollectionView[] = calendar ? ["list", "cards", "table", "calendar"] : ["list", "cards", "table"];
  return (
    <div
      className="view-picker"
      role="radiogroup"
      aria-label={`${label} 보기 방식`}
      ref={root}
      onKeyDown={(event) => {
        if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const focused = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-view]")?.dataset.view as
          | CollectionView
          | undefined;
        const index = choices.indexOf(focused ?? value),
          direction = ["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1;
        const next = event.key === "Home"
          ? 0
          : event.key === "End"
          ? choices.length - 1
          : (index + direction + choices.length) % choices.length;
        onChange(choices[next]);
        root.current?.querySelectorAll<HTMLButtonElement>("button")[next]?.focus();
      }}
    >
      {choices.map((view) => (
        <button
          key={view}
          type="button"
          role="radio"
          data-view={view}
          aria-checked={value === view}
          aria-label={names[view]}
          title={names[view]}
          tabIndex={value === view ? 0 : -1}
          onClick={() => onChange(view)}
        >
          <span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d={icons[view]} />
            </svg>
          </span>
        </button>
      ))}
    </div>
  );
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
  return (
    <div className="collection-heading">
      <h2
        id={id}
        className="section-title"
        aria-label={hideLabel && count !== undefined ? `${label} (${count}개${hasMore ? "+" : ""})` : undefined}
      >
        {hideLabel && count !== undefined
          ? `${count}개${hasMore ? "+" : ""}`
          : <>{label}{count === undefined ? "" : ` (${count}개${hasMore ? "+" : ""})`}</>}
      </h2>
      <div className="collection-controls">
        {expansion && (
          <button
            type="button"
            className="collection-expand-toggle"
            aria-label={`${label} ${expansion.allOpen ? "전체 닫기" : "전체 열기"}`}
            title={expansion.allOpen ? "전체 닫기" : "전체 열기"}
            aria-expanded={expansion.allOpen}
            onClick={expansion.toggle}
          >
            <span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d={expansion.allOpen ? "m6 14 6-6 6 6m-12 6 6-6 6 6" : "m6 4 6 6 6-6m-12 6 6 6 6-6"} />
              </svg>
            </span>
          </button>
        )}
        <ViewPicker label={label} value={view} onChange={onChange} calendar={calendar} />
      </div>
    </div>
  );
}

export function useMainCollectionView(calendar = false) {
  const [params] = useSearchParams(), location = useLocation(), navigate = useNavigate();
  const raw = params.get("view"),
    view: CollectionView = raw === "cards" || raw === "table" || calendar && raw === "calendar"
      ? raw as CollectionView
      : "list";
  const change = (next: CollectionView) => {
    const updated = new URLSearchParams(params);
    next === "list" ? updated.delete("view") : updated.set("view", next);
    void navigate({ pathname: location.pathname, search: updated.toString(), hash: location.hash }, {
      replace: true,
      preventScrollReset: true,
    });
  };
  return [view, change] as const;
}

export const RelatedCollectionView = createContext<ItemView>("list");
const ItemLayout = createContext<{ view: ItemView; columns: string[]; numericColumns: number[] } | null>(null);
export function useItemLayout() {
  return useContext(ItemLayout);
}

/** Existing disclosure rows keep their identity while only their layout changes. */
export function CollectionList(
  { children, view: explicit, columns = ["내용"], numericColumns = [], label = "목록" }: {
    children: ReactNode;
    view?: ItemView;
    columns?: string[];
    numericColumns?: number[];
    label?: string;
  },
) {
  const inherited = useContext(RelatedCollectionView), view = explicit ?? inherited;
  const table = view === "table";
  return (
    <ItemLayout.Provider value={{ view, columns, numericColumns }}>
      <div
        className={`collection collection-${view}`}
        role={table ? "table" : undefined}
        aria-label={table ? label : undefined}
        style={{
          "--collection-columns": `minmax(0, 1fr)${
            columns.slice(1).map(() => " minmax(0, var(--collection-secondary-width))").join("")
          }`,
        } as CSSProperties}
      >
        {table && (
          <div className="collection-table-head" role="row">
            {columns.map((column, index) => (
              <span
                key={column}
                role="columnheader"
                className={numericColumns.includes(index) ? "collection-numeric" : undefined}
              >
                {column}
              </span>
            ))}
          </div>
        )}
        <ul className="list related-items" role={table ? "rowgroup" : "list"} aria-label={table ? undefined : label}>
          {Children.map(children, (child) =>
            isValidElement<{ role?: string; className?: string }>(child) && child.type === "li"
              ? cloneElement(child, {
                role: table ? "none" : undefined,
                className: `list-item ${child.props.className ?? ""}`,
              })
              : child)}
        </ul>
      </div>
    </ItemLayout.Provider>
  );
}
