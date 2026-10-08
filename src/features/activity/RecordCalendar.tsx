import { useEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { CollectionList } from "../../components/Collection.tsx";
import { BodyAction } from "../../components/BodyAction.tsx";
import { todayIn } from "../../lib/format.ts";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { groupRecords } from "./timeline.ts";
import { adjacentMonth, calendarDay, calendarMonth, monthDays, moveCalendarDay } from "./calendar.ts";
import "./record-calendar.css";

/** A calendar projects the same loaded records; it never claims server-wide date coverage. */
export function RecordCalendar<T extends { id: string }>({ items, at, children, partial }: { items: T[]; at: (item: T) => string; children: (item: T) => ReactNode; partial: boolean }) {
  const { timezone } = useDisplayTime(), [params] = useSearchParams(), location = useLocation(), navigate = useNavigate();
  const dates = useRef<HTMLDivElement>(null), focusDay = useRef<string | null>(null);
  const today = todayIn(timezone), groups = groupRecords(items.map(item => ({ ...item, occurred_at: at(item) })), timezone).sort((a, b) => b.date.localeCompare(a.date));
  const opened = params.get("open")?.split("/").pop();
  const defaultDay = groups.find(group => group.records.some(item => item.id === opened))?.date ?? groups[0]?.date ?? today;
  const month = calendarMonth(params.get("calendar_month"), defaultDay.slice(0, 7));
  const selected = calendarDay(params.get("calendar_day"), month) ?? groups.find(group => group.date.startsWith(month))?.date ?? `${month}-01`;
  const records = groups.find(group => group.date === selected)?.records ?? [];
  const choose = (month: string, day: string) => {
    const next = new URLSearchParams(params);
    next.set("calendar_month", month); next.set("calendar_day", day);
    if (day !== selected) next.delete("open");
    void navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, { replace: true, preventScrollReset: true });
  };
  const before = adjacentMonth(month, -1), after = adjacentMonth(month, 1);
  useEffect(() => {
    if (!focusDay.current) return;
    const target = dates.current?.querySelector<HTMLButtonElement>(`button[data-date="${focusDay.current}"]`);
    if (target) { target.focus(); focusDay.current = null; }
  }, [month, selected]);
  return <div className="record-calendar">
    <div className="calendar-toolbar"><div className="actions">
      <BodyAction aria-label="이전 달" disabled={!before} onClick={() => before && choose(before, `${before}-01`)}>‹</BodyAction>
      <h3 className="section-title">{Number(month.slice(0, 4))}년 {Number(month.slice(5))}월</h3>
      <BodyAction aria-label="다음 달" disabled={!after} onClick={() => after && choose(after, `${after}-01`)}>›</BodyAction>
    </div><BodyAction onClick={() => choose(today.slice(0, 7), today)}>오늘</BodyAction></div>
    {partial && <p className="help calendar-coverage" role="status">불러온 기록만 표시합니다. 더 보기로 나머지 기록을 불러올 수 있습니다.</p>}
    <div className="calendar-week" aria-hidden="true">{"일월화수목금토".split("").map(day => <span key={day}>{day}</span>)}</div>
    <div className="calendar-days" role="group" aria-label="기록 날짜" ref={dates} onKeyDown={event => {
      const offsets: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (offsets[event.key] === undefined) return;
      event.preventDefault();
      const focused = (event.target as HTMLElement).closest<HTMLButtonElement>("button[data-date]")?.dataset.date ?? selected;
      const target = moveCalendarDay(focused, offsets[event.key]);
      if (target) { focusDay.current = target; choose(target.slice(0, 7), target); }
    }}>{monthDays(month).map((day, index) => {
      if (!day) return <span key={index} aria-hidden="true"/>;
      const count = groups.find(group => group.date === day)?.records.length ?? 0;
      return <button key={day} type="button" data-date={day} tabIndex={day === selected ? 0 : -1} aria-label={`${day}, 불러온 기록 ${count}개`} aria-pressed={day === selected} aria-current={day === today ? "date" : undefined} onClick={() => choose(month, day)}>
        <span>{Number(day.slice(8))}</span>{count > 0 && <small aria-hidden="true">{count}</small>}
      </button>;
    })}</div>
    <section className="calendar-selection" aria-label={`${selected} 기록`}><h3 className="section-title">{Number(selected.slice(5, 7))}월 {Number(selected.slice(8))}일 · 기록 {records.length}개</h3>
      {records.length > 0 ? <CollectionList label={`${selected} 기록`}>{records.map(item => <li key={item.id}>{children(item)}</li>)}</CollectionList> : <p className="secondary">이 날짜에 불러온 기록이 없습니다.</p>}
    </section>
  </div>;
}
