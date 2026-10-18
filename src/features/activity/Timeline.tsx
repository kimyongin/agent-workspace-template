import { CollectionItem, CollectionList, type ItemView } from "../../components/Collection.tsx";
import type { ReactNode } from "react";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { groupRecords } from "./timeline.ts";
/** Chronological display of loaded pages; server cursor retains its own order. */
export function Timeline<T extends { id: string }>(
  { items, at, children, kind, view = "table" }: {
    items: T[];
    at: (item: T) => string;
    children: (item: T) => ReactNode;
    kind: string;
    view?: ItemView;
  },
) {
  const { timezone } = useDisplayTime();
  const dated = items.map((item) => ({ ...item, occurred_at: at(item) })).sort((a, b) =>
    b.occurred_at.localeCompare(a.occurred_at)
  );
  if (view === "cards") {
    return (
      <CollectionList
        view={view}
        label={`${kind} 목록`}
        columns={["본문 대표 문구", "종류", "날짜"]}
        numericColumns={[2]}
      >
        {dated.map((item) => <CollectionItem key={item.id}>{children(item)}</CollectionItem>)}
      </CollectionList>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {groupRecords(dated, timezone).map(({ date, records }) => (
        <section className="flex min-w-0 flex-col gap-3" key={date} aria-label={`${date} ${kind}`}>
          <h3 className="text-sm font-medium text-muted-foreground">
            {new Intl.DateTimeFormat("ko-KR", { dateStyle: "full", timeZone: "UTC" }).format(
              new Date(`${date}T12:00:00Z`),
            )}
          </h3>
          <CollectionList
            view={view}
            label={`${date} ${kind}`}
            columns={["본문 대표 문구", "종류", "날짜"]}
            numericColumns={[2]}
          >
            {records.map((item) => (
              <CollectionItem key={item.id} className="min-w-0">
                {children(item)}
              </CollectionItem>
            ))}
          </CollectionList>
        </section>
      ))}
    </div>
  );
}
