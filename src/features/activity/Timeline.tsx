import type { ReactNode } from "react";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { groupRecords } from "./timeline.ts";
/** Chronological display of loaded pages; server cursor retains its own order. */
export function Timeline<T extends { id: string }>({ items, at, children, kind }: { items: T[]; at: (item: T) => string; children: (item: T) => ReactNode; kind: string }) {
  const { timezone } = useDisplayTime();
  const dated = items.map(item => ({ ...item, occurred_at: at(item) })).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  return <div className="record-timeline">{groupRecords(dated, timezone).map(({ date, records }) => <section className="record-date-group panel" key={date} aria-label={`${date} ${kind}`}>
    <h3 className="timeline-day">{new Intl.DateTimeFormat("ko-KR", { dateStyle: "full", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))}</h3>
    <ul className="list fin-timeline">{records.map(item => <li key={item.id} className="list-item fin-entry">
      <div className="list-item-main">{children(item)}</div>
    </li>)}</ul>
  </section>)}</div>;
}
