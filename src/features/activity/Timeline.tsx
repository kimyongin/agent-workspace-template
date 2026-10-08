import { CollectionList, type ItemView } from "../../components/Collection.tsx";
import type { ReactNode } from "react";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { groupRecords } from "./timeline.ts";
/** Chronological display of loaded pages; server cursor retains its own order. */
export function Timeline<T extends { id: string }>({ items, at, children, kind, view="list" }: { items: T[]; at: (item: T) => string; children: (item: T) => ReactNode; kind: string; view?: ItemView }) {
  const { timezone } = useDisplayTime();
  const dated = items.map(item => ({ ...item, occurred_at: at(item) })).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  if (view !== "list") return <CollectionList view={view} label={`${kind} 목록`} columns={["기록", "종류", "날짜"]} numericColumns={[2]}>{dated.map(item => <li key={item.id}>{children(item)}</li>)}</CollectionList>;
  return <div className="record-timeline">{groupRecords(dated, timezone).map(({ date, records }) => <section className="record-date-group panel" key={date} aria-label={`${date} ${kind}`}>
    <h3 className="timeline-day">{new Intl.DateTimeFormat("ko-KR", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))}</h3>
    <CollectionList view={view} label={`${date} ${kind}`} columns={["기록","종류","날짜"]} numericColumns={[2]}>{records.map(item => <li key={item.id} className="list-item fin-entry">
      <div className="list-item-main">{children(item)}</div>
    </li>)}</CollectionList>
  </section>)}</div>;
}
