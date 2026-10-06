import type { ReactNode } from "react";
import { browserTimezone } from "../../lib/format.ts";
import { groupRecords } from "./timeline.ts";
/** Chronological display of loaded pages; server cursor retains its own order. */
export function Timeline<T extends { id: string }>({ items, at, children, kind }: { items: T[]; at: (item: T) => string; children: (item: T, time: ReactNode) => ReactNode; kind: string }) {
  const dated = items.map(item => ({ ...item, occurred_at: at(item) })).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
  return <div className="record-timeline">{groupRecords(dated, browserTimezone()).map(({ date, records }) => <section className="record-date-group panel" key={date} aria-label={`${date} ${kind}`}>
    <h3 className="item-title timeline-day">{new Intl.DateTimeFormat("ko-KR", { dateStyle: "full" }).format(new Date(`${date}T12:00:00`))}</h3>
    <ul className="list fin-timeline">{records.map(item => <li key={item.id} className="list-item fin-entry"><span className="timeline-dot" aria-hidden="true"/>
      <div className="list-item-main">{children(item,<time className="meta" dateTime={at(item)}>{new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(at(item)))}</time>)}</div>
    </li>)}</ul>
  </section>)}</div>;
}
