import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceArea, XAxis, YAxis } from "recharts";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { StatusDay, StatusOverview } from "@contracts/status.ts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartProvider,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { Table, TableBody, TableCell, TableHead, TableRow } from "@/components/ui/table";

type Series = { key: string; label: string; value: (day: StatusDay) => number };
const entitySeries: Series[] = [{ key: "created", label: "등록", value: (d) => d.entities_created }];
const taskSeries: Series[] = [
  { key: "created", label: "생성", value: (d) => d.tasks_created },
  { key: "completed", label: "일회성 완료", value: (d) => d.once_completed },
];
const recordSeries: Series[] = [{ key: "created", label: "작성", value: (d) => d.records_created }];
const indexSeries: Series[] = [
  { key: "indexed", label: "완료", value: (d) => d.indexing.indexed },
  { key: "preparing", label: "준비 중", value: (d) => d.indexing.preparing },
  { key: "attention", label: "확인 필요", value: (d) => d.indexing.attention },
  { key: "excluded", label: "대상 제외", value: (d) => d.indexing.excluded },
];

const entityIndexSeries: Series[] = indexSeries.map((series) => ({ ...series, value: (day) => day.entity_indexing[series.key as keyof StatusDay["entity_indexing"]] }));

function DailyChart({ title, days, series, stacked = false, initialDate, onSelectDate }: {
  title: string;
  days: StatusDay[];
  series: Series[];
  stacked?: boolean;
  initialDate?: string;
  onSelectDate?: (date: string) => void;
}) {
  const id = useId();
  const [selectedDate, setSelectedDate] = useState<string | null>(initialDate ?? null);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  // Keep the selected calendar day across refreshes. If it leaves the window,
  // use the closest available preceding day (or the first day).
  const index = selectedDate === null
    ? days.length - 1
    : Math.max(0, days.findLastIndex((day) => day.date <= selectedDate));
  const current = days[index];
  const rows = days.map((day) => ({ date: day.date, ...Object.fromEntries(series.map((s) => [s.key, s.value(day)])) }));
  const config = Object.fromEntries(
    series.map((s, i) => [s.key, { label: s.label, color: `var(--chart-${i + 1})` }]),
  ) satisfies ChartConfig;
  function select(next: number) {
    setTooltipOpen(false);
    const day = days[Math.max(0, Math.min(days.length - 1, next))];
    if (day) {
      setSelectedDate(day.date);
      onSelectDate?.(day.date);
    }
  }
  function selectActive(state: { activeTooltipIndex?: string | number | null }) {
    if (state.activeTooltipIndex === null || state.activeTooltipIndex === undefined) return;
    const next = Number(state.activeTooltipIndex);
    if (Number.isInteger(next)) {
      select(next);
      setTooltipOpen(true);
    }
  }
  return (
    <div role="region" aria-label={title} className="@container/daily flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="text-sm text-muted-foreground">최근 {days.length}일</span>
      </div>
      {!current
        ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>표시할 날짜가 없습니다.</EmptyTitle>
              <EmptyDescription>조회 기간에 제공된 활동 수치가 없습니다.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )
        : (
          <>
            <div
              role="group"
              tabIndex={0}
              aria-label={`${title} 그래프: 막대를 누르거나 방향키로 날짜 선택`}
              aria-describedby={id}
              className="min-w-0 rounded-lg outline-offset-4 focus-visible:outline-2 focus-visible:outline-ring"
              onKeyDown={(event) => {
                const next = event.key === "ArrowLeft"
                  ? index - 1
                  : event.key === "ArrowRight"
                  ? index + 1
                  : event.key === "Home"
                  ? 0
                  : event.key === "End"
                  ? days.length - 1
                  : null;
                if (next !== null) {
                  event.preventDefault();
                  select(next);
                }
              }}
            >
              <ChartProvider value={{ config }}>
                <ChartContainer config={config} className="h-56 w-full aspect-auto [&_.recharts-text]:text-[0.75rem]">
                  <BarChart
                    data={rows}
                    accessibilityLayer={false}
                    onClick={selectActive}
                    margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="date"
                      tickLine={false}
                      axisLine={false}
                      minTickGap={32}
                      tickFormatter={(date) => date.slice(5)}
                    />
                    <YAxis
                      width="auto"
                      tickLine={false}
                      axisLine={false}
                      allowDecimals={false}
                      tickFormatter={(value) => new Intl.NumberFormat("ko-KR", { notation: "compact" }).format(value)}
                    />
                    <ReferenceArea x1={current.date} x2={current.date} fill="var(--muted)" fillOpacity={0.6} />
                    <ChartTooltip active={tooltipOpen} trigger="click" content={<ChartTooltipContent />} />
                    {series.map((s) => (
                      <Bar
                        key={s.key}
                        dataKey={s.key}
                        fill={`var(--color-${s.key})`}
                        stackId={stacked ? "indexing" : undefined}
                        radius={stacked ? 0 : 4}
                        isAnimationActive={false}
                      />
                    ))}
                  </BarChart>
                </ChartContainer>
                <ChartLegendContent
                  className="flex-wrap gap-2 pb-1 text-xs"
                  payload={series.map((s, i) => ({ dataKey: s.key, value: s.label, color: `var(--chart-${i + 1})`, type: "square" as const }))}
                />
              </ChartProvider>
            </div>
            <div className="grid grid-cols-2 items-center gap-2 @min-[14rem]/daily:grid-cols-[auto_minmax(0,1fr)_auto]">
              <Button
                variant="outline"
                size="icon"
                className="justify-self-start"
                aria-label={`${title} 이전 날짜`}
                disabled={index === 0}
                onClick={() => select(index - 1)}
              >
                <ChevronLeftIcon />
              </Button>
              <p id={id} aria-live="polite" className="order-first col-span-2 text-center text-sm tabular-nums @min-[14rem]/daily:order-none @min-[14rem]/daily:col-span-1">
                <time dateTime={current.date}>{current.date}</time>
              </p>
              <Button
                variant="outline"
                size="icon"
                className="justify-self-end"
                aria-label={`${title} 다음 날짜`}
                disabled={index === days.length - 1}
                onClick={() => select(index + 1)}
              >
                <ChevronRightIcon />
              </Button>
            </div>
            <Table role="table" aria-label={`${title} 날짜별 수치`} aria-describedby={id} className="@max-[24rem]/daily:block">
              <TableBody role="rowgroup" className="@max-[24rem]/daily:block">
                {series.map((s) => (
                  <TableRow key={s.key} role="row" className="@max-[24rem]/daily:grid @max-[24rem]/daily:grid-cols-1">
                    <TableHead role="rowheader" scope="row" className="font-normal text-muted-foreground whitespace-normal wrap-anywhere @max-[24rem]/daily:h-auto @max-[24rem]/daily:pt-2">{s.label}</TableHead>
                    <TableCell role="cell" className="text-right tabular-nums whitespace-normal wrap-anywhere @max-[24rem]/daily:text-left">
                      {s.value(current).toLocaleString("ko-KR")}건
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
    </div>
  );
}

function Summary({ total, values }: { total: number; values: [string, number][] }) {
  return (
    <dl className="flex flex-wrap gap-x-6 gap-y-3 tabular-nums">
      <div>
        <dt className="text-sm text-muted-foreground">합계</dt>
        <dd className="text-2xl font-semibold">{total.toLocaleString("ko-KR")}개</dd>
      </div>
      {values.map(([label, value]) => (
        <div key={label}>
          <dt className="text-sm text-muted-foreground">{label}</dt>
          <dd className="text-lg font-medium">{value.toLocaleString("ko-KR")}</dd>
        </div>
      ))}
    </dl>
  );
}
export function StatusContent({ data, children, selectedDates = {}, onDateSelect }: {
  data: StatusOverview;
  children?: React.ReactNode;
  selectedDates?: Record<string, string>;
  onDateSelect?: (chart: string, date: string) => void;
}) {
  const { entities, tasks, records, indexing, entity_indexing, daily } = data;
  const selection = (title: string) => ({ initialDate: selectedDates[title], onSelectDate: (date: string) => onDateSelect?.(title, date) });
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <section aria-labelledby="status-current-title" className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="status-current-title" className="text-lg font-semibold">현재 자료·최근 활동</h2>
          <p className="text-sm text-muted-foreground">
            최근 {data.period.days}일 · {data.period.from}–{data.period.to}
          </p>
        </div>
        {entities.total + tasks.total + records.total === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyTitle>아직 보관한 자료가 없습니다.</EmptyTitle>
              <EmptyDescription>자료와 활동이 쌓이면 이곳에서 현황을 확인할 수 있습니다.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
        <div className="grid min-w-0 gap-4 @min-[64rem]:grid-cols-2">
          <Card role="region" aria-label="자료 현황" className="min-w-0">
            <CardHeader>
              <CardTitle>자료</CardTitle>
              <CardDescription>현재 보관 상태와 일별 등록 건수</CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-6">
              <Summary total={entities.total} values={[["활성", entities.active], ["삭제 보관", entities.deleted]]} />
              <DailyChart {...selection("일별 등록")} title="일별 등록" days={daily} series={entitySeries} />
            </CardContent>
          </Card>
          <Card role="region" aria-label="할 일 현황" className="min-w-0">
            <CardHeader>
              <CardTitle>할 일</CardTitle>
              <CardDescription>현재 진행 상태와 일별 생성·완료 건수</CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-6">
              <Summary
                total={tasks.total}
                values={[["진행 중", tasks.open], ["완료", tasks.done], ["반복 중", tasks.active], [
                  "중단됨",
                  tasks.stopped,
                ]]}
              />
              <DailyChart {...selection("일별 생성·완료")} title="일별 생성·완료" days={daily} series={taskSeries} />
            </CardContent>
          </Card>
          <Card role="region" aria-label="기록 현황" className="min-w-0">
            <CardHeader>
              <CardTitle>기록</CardTitle>
              <CardDescription>현재 기록 종류와 일별 작성 건수</CardDescription>
            </CardHeader>
            <CardContent className="flex min-w-0 flex-col gap-6">
              <Summary
                total={records.total}
                values={[["수행 결과", records.result], ["변경", records.change]]}
              />
              <DailyChart {...selection("일별 작성")} title="일별 작성" days={daily} series={recordSeries} />
            </CardContent>
          </Card>
        </div>
      </section>
      <div className="grid min-w-0 gap-4 @min-[64rem]:grid-cols-2">
        <IndexingCard label="기록" indexing={indexing} daily={daily} series={indexSeries} timezone={data.timezone} days={data.period.days}
          chartTitle="작성일별 현재 색인 상태" {...selection("작성일별 현재 색인 상태")} />
        <IndexingCard label="자료" indexing={entity_indexing} daily={daily} series={entityIndexSeries} timezone={data.timezone} days={data.period.days}
          chartTitle="등록일별 현재 자료 색인 상태" {...selection("등록일별 현재 자료 색인 상태")} />
      </div>
      {children && <Card role="region" aria-label="자료·기록 색인 문제" className="min-w-0">
        <CardHeader><CardTitle>자료·기록 색인 문제</CardTitle><CardDescription>확인이 필요한 자료와 기록을 원문과 함께 확인합니다.</CardDescription></CardHeader>
        <CardContent>{children}</CardContent>
      </Card>}
    </div>
  );
}


function IndexingCard({ label, indexing, daily, series, timezone, days, chartTitle, initialDate, onSelectDate }: {
  label: "기록" | "자료";
  indexing: StatusOverview["indexing"];
  daily: StatusDay[];
  series: Series[];
  timezone: string;
  days: number;
  chartTitle: string;
  initialDate?: string;
  onSelectDate?: (date: string) => void;
}) {
  return (
      <Card role="region" aria-label={`${label} 색인 현황`} className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h2>{label} 색인 현황</h2>
          </CardTitle>
          <CardDescription>전체 {label} {indexing.total.toLocaleString("ko-KR")}개 · 현재 검색 준비 상태</CardDescription>
        </CardHeader>
        <CardContent className="flex min-w-0 flex-col gap-6">
          <Summary
            total={indexing.total}
            values={[["완료", indexing.indexed], ["준비 중", indexing.preparing], ["확인 필요", indexing.attention], [
              "대상 제외",
              indexing.excluded,
            ]]}
          />
          {!!indexing.waiting?.long_waiting && (
            <Alert role="status">
              <AlertTitle>색인 준비 갱신이 지연되고 있습니다.</AlertTitle>
              <AlertDescription>
                <dl className="flex flex-wrap gap-x-6 gap-y-2">
                  <div>
                    <dt>갱신 지연 기준</dt>
                    <dd>{indexing.waiting.threshold_minutes}분</dd>
                  </div>
                  <div>
                    <dt>오래 갱신되지 않은 {label}</dt>
                    <dd>{indexing.waiting.long_waiting}개</dd>
                  </div>
                  <div>
                    <dt>가장 오래된 갱신</dt>
                    <dd>
                      <time dateTime={indexing.waiting.oldest_waiting_since!}>
                        {new Intl.DateTimeFormat("ko-KR", {
                          timeZone: timezone,
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(indexing.waiting.oldest_waiting_since!))}
                      </time>{" "}
                      ({timezone})
                    </dd>
                  </div>
                </dl>
                <p>
                  준비 상태 갱신이 오래 지연되고 있습니다. 처리 실패로 확정된 상태는 아닙니다. 새로고침 후에도 계속되면
                  관리자에게 색인 서비스 점검을 요청하세요.
                </p>
              </AlertDescription>
            </Alert>
          )}
          <DailyChart title={chartTitle} days={daily} series={series} stacked initialDate={initialDate} onSelectDate={onSelectDate} />
          <p className="text-sm text-muted-foreground">
            최근{" "}
            {days}일 {label === "기록" ? "작성한 기록을 작성일" : "등록한 자료를 등록일"}로 묶은 현재 상태입니다. 과거 대기량·실패량이나 당일 처리량의
            이력이 아닙니다.
          </p>
        </CardContent>
      </Card>
  );
}
