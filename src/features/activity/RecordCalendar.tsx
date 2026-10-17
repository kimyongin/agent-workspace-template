import { type ComponentProps, createContext, type ReactNode, useContext } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { TZDate } from "react-day-picker";
import { ko } from "date-fns/locale";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { CollectionItem, CollectionList } from "../../components/Collection.tsx";
import { todayIn } from "../../lib/format.ts";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { groupRecords } from "./timeline.ts";
import { calendarDay, calendarMonth } from "./calendar.ts";

const DayCounts = createContext(new Map<string, number>());
function civilDay(date: Date) {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${
    String(date.getDate()).padStart(2, "0")
  }`;
}
function zonedDay(day: string, timezone: string) {
  const [year, month, date] = day.split("-").map(Number);
  const result = new TZDate(0, timezone);
  result.setFullYear(year, month - 1, date);
  result.setHours(12, 0, 0, 0);
  return result;
}
function RecordDayButton(props: ComponentProps<typeof CalendarDayButton>) {
  const counts = useContext(DayCounts), day = civilDay(props.day.date), count = counts.get(day) ?? 0;
  return (
    <CalendarDayButton
      {...props}
      locale={ko}
      aria-label={`${day}, 불러온 기록 ${count}개`}
      aria-pressed={props.modifiers.selected}
    >
      <span>{props.day.date.getDate()}</span>
      {count > 0 && <Badge variant="secondary" aria-hidden="true">{count}</Badge>}
    </CalendarDayButton>
  );
}
/** The calendar projects loaded records; it never claims server-wide coverage. */
export function RecordCalendar<T extends { id: string }>(
  { items, at, children, partial }: {
    items: T[];
    at: (item: T) => string;
    children: (item: T) => ReactNode;
    partial: boolean;
  },
) {
  const { timezone } = useDisplayTime(),
    [params] = useSearchParams(),
    location = useLocation(),
    navigate = useNavigate();
  const today = todayIn(timezone),
    groups = groupRecords(items.map((item) => ({ ...item, occurred_at: at(item) })), timezone).sort((a, b) =>
      b.date.localeCompare(a.date)
    );
  const opened = params.get("open")?.split("/").pop();
  const openedDay = groups.find((group) => group.records.some((item) => item.id === opened))?.date;
  const defaultDay = groups[0]?.date ?? today;
  const month = openedDay?.slice(0, 7) ?? calendarMonth(params.get("calendar_month"), defaultDay.slice(0, 7));
  const selected = openedDay ?? calendarDay(params.get("calendar_day"), month) ??
    groups.find((group) => group.date.startsWith(month))?.date ?? `${month}-01`;
  const records = groups.find((group) => group.date === selected)?.records ?? [];
  const choose = (month: string, day: string) => {
    const next = new URLSearchParams(params);
    next.set("calendar_month", month);
    next.set("calendar_day", day);
    if (day !== selected) next.delete("open");
    void navigate({ pathname: location.pathname, search: next.toString(), hash: location.hash }, {
      replace: true,
      preventScrollReset: true,
    });
  };
  return (
    <section aria-label="기록 달력" className="grid min-w-0 items-start gap-4 @min-[56rem]:grid-cols-2">
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>기록 날짜</CardTitle>
          <CardDescription>{timezone} 기준으로 불러온 기록을 표시합니다.</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-4">
          <Button type="button" variant="outline" onClick={() => choose(today.slice(0, 7), today)}>오늘</Button>
          {partial && (
            <Alert role="status">
              <AlertDescription>불러온 기록만 표시합니다. 더 보기로 나머지 기록을 불러올 수 있습니다.</AlertDescription>
            </Alert>
          )}
          <ScrollArea className="w-full whitespace-nowrap">
            <DayCounts.Provider value={new Map(groups.map((group) => [group.date, group.records.length]))}>
              <Calendar
                mode="single"
                required
                locale={ko}
                timeZone={timezone}
                noonSafe
                showOutsideDays={false}
                weekStartsOn={0}
                className="w-full [--cell-size:2.75rem]"
                month={zonedDay(`${month}-01`, timezone)}
                selected={zonedDay(selected, timezone)}
                today={zonedDay(today, timezone)}
                startMonth={zonedDay("0001-01-01", timezone)}
                endMonth={zonedDay("9999-12-01", timezone)}
                onMonthChange={(date) => {
                  const day = civilDay(date);
                  choose(day.slice(0, 7), `${day.slice(0, 7)}-01`);
                }}
                onSelect={(date) => {
                  if (date) {
                    const day = civilDay(date);
                    choose(day.slice(0, 7), day);
                  }
                }}
                onDayFocus={(date) => {
                  const day = civilDay(date);
                  if (day !== selected) choose(day.slice(0, 7), day);
                }}
                labels={{ labelPrevious: () => "이전 달", labelNext: () => "다음 달" }}
                components={{ DayButton: RecordDayButton }}
              />
            </DayCounts.Provider>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </CardContent>
      </Card>
      <section aria-label={`${selected} 기록`} className="flex min-w-0 flex-col gap-4">
        <h3 className="text-base font-semibold">
          {Number(selected.slice(5, 7))}월 {Number(selected.slice(8))}일 · 기록 {records.length}개
        </h3>
        {records.length > 0
          ? (
            <CollectionList label={`${selected} 기록`} columns={["본문 대표 문구", "종류", "날짜"]}>
              {records.map((item) => <CollectionItem key={item.id}>{children(item)}</CollectionItem>)}
            </CollectionList>
          )
          : (
            <Empty>
              <EmptyHeader>
                <EmptyTitle>이 날짜에 불러온 기록이 없습니다.</EmptyTitle>
              </EmptyHeader>
            </Empty>
          )}
      </section>
    </section>
  );
}
