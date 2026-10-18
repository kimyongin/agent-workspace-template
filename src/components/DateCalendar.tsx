import { ko } from "date-fns/locale";
import { useEffect, useMemo, useRef } from "react";
import { MonthGrid, type MonthGridProps } from "react-day-picker";
import { UTCDate } from "@date-fns/utc";
import { Calendar } from "./ui/calendar.tsx";
import { ScrollArea, ScrollBar } from "./ui/scroll-area.tsx";
import { todayIn } from "../lib/format.ts";
import { useDisplayTime } from "../lib/useDisplayTime.ts";

function DateMonthGrid(props: MonthGridProps) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Focus precedes portal measurement; viewport changes must reveal the retained focus again.
    let layout = 0;
    let reveal = 0;
    const schedule = () => {
      cancelAnimationFrame(layout);
      cancelAnimationFrame(reveal);
      layout = requestAnimationFrame(() => {
        reveal = requestAnimationFrame(() => {
          const focused = document.activeElement;
          if (focused instanceof HTMLElement && root.current?.contains(focused)) {
            focused.scrollIntoView({ block: "nearest", inline: "nearest" });
          }
        });
      });
    };
    const observer = new ResizeObserver(schedule);
    const popup = root.current?.closest('[data-slot="popover-content"]');
    if (popup) observer.observe(popup);
    if (root.current) observer.observe(root.current);
    schedule();
    return () => {
      observer.disconnect();
      cancelAnimationFrame(layout);
      cancelAnimationFrame(reveal);
    };
  }, []);
  return (
    <ScrollArea ref={root} type="always" className="min-w-0 max-w-full">
      <MonthGrid {...props} />
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  );
}

function calendarDate(year: number, month: number, day: number) {
  const result = new UTCDate(0);
  result.setFullYear(year, month, day);
  result.setHours(12, 0, 0, 0);
  return result;
}

function civilDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1) return undefined;
  const result = calendarDate(year, month - 1, day);
  return result.getFullYear() === year && result.getMonth() === month - 1 && result.getDate() === day
    ? result
    : undefined;
}

export default function DateCalendar({ value, onSelect }: { value: string; onSelect: (value: string) => void }) {
  const { timezone } = useDisplayTime();
  const selected = civilDate(value);
  const todayValue = todayIn(timezone);
  const today = civilDate(todayValue);
  const dateLib = useMemo(() => ({ newDate: calendarDate, today: () => civilDate(todayValue)! }), [todayValue]);
  const first = civilDate("0001-01-01")!;
  const last = civilDate("9999-12-31")!;
  return (
    <Calendar
      mode="single"
      required
      locale={ko}
      dateLib={dateLib}
      autoFocus
      selected={selected}
      defaultMonth={selected ?? today}
      today={today}
      startMonth={first}
      endMonth={last}
      disabled={[{ before: first }, { after: last }]}
      className="w-[min(21rem,var(--radix-popover-content-available-width))] [--cell-size:2.75rem]"
      navLayout="after"
      classNames={{
        month: "flex min-w-0 w-full flex-col gap-4",
        nav: "static flex w-full items-center justify-between gap-2",
        month_caption: "flex min-h-(--cell-size) w-full items-center justify-center",
        caption_label: "text-center text-sm font-medium whitespace-normal wrap-anywhere",
      }}
      components={{ MonthGrid: DateMonthGrid }}
      labels={{ labelPrevious: () => "이전 달", labelNext: () => "다음 달" }}
      onSelect={(date) => {
        if (date) {
          onSelect(
            `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${
              String(date.getDate()).padStart(2, "0")
            }`,
          );
        }
      }}
    />
  );
}
