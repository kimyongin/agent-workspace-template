import { useId, useState } from "react";
import { Bar, BarChart, CartesianGrid, ReferenceArea, XAxis, YAxis } from "recharts";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";
import type { StatusDay, StatusOverview } from "@contracts/status.ts";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
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

function DailyChart({ title, days, series, stacked = false }: {
  title: string;
  days: StatusDay[];
  series: Series[];
  stacked?: boolean;
}) {
  const id = useId();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
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
    if (day) setSelectedDate(day.date);
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
    <div role="region" aria-label={title} className="flex min-w-0 flex-col gap-4">
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
                  <ChartLegend verticalAlign="top" content={<ChartLegendContent className="flex-wrap gap-2" />} />
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
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button
                variant="outline"
                size="icon"
                aria-label={`${title} 이전 날짜`}
                disabled={index === 0}
                onClick={() => select(index - 1)}
              >
                <ChevronLeftIcon />
              </Button>
              <p id={id} aria-live="polite" className="text-sm tabular-nums">
                <time dateTime={current.date}>{current.date}</time>
              </p>
              <Button
                variant="outline"
                size="icon"
                aria-label={`${title} 다음 날짜`}
                disabled={index === days.length - 1}
                onClick={() => select(index + 1)}
              >
                <ChevronRightIcon />
              </Button>
            </div>
            <Table aria-label={`${title} 날짜별 수치`} aria-describedby={id}>
              <TableBody>
                {series.map((s) => (
                  <TableRow key={s.key}>
                    <TableHead scope="row">{s.label}</TableHead>
                    <TableCell className="text-right tabular-nums">
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
export function StatusContent({ data, children }: { data: StatusOverview; children?: React.ReactNode }) {
  const { entities, tasks, records, indexing, daily } = data;
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
              <DailyChart title="일별 등록" days={daily} series={entitySeries} />
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
              <DailyChart title="일별 생성·완료" days={daily} series={taskSeries} />
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
                values={[["일반", records.user], ["수행 결과", records.result], ["변경", records.change]]}
              />
              <DailyChart title="일별 작성" days={daily} series={recordSeries} />
            </CardContent>
          </Card>
        </div>
      </section>
      <Card role="region" aria-label="색인 현황" className="min-w-0">
        <CardHeader>
          <CardTitle>
            <h2>색인 현황</h2>
          </CardTitle>
          <CardDescription>전체 기록 {indexing.total.toLocaleString("ko-KR")}개 · 현재 검색 준비 상태</CardDescription>
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
                    <dt>오래 갱신되지 않은 기록</dt>
                    <dd>{indexing.waiting.long_waiting}개</dd>
                  </div>
                  <div>
                    <dt>가장 오래된 갱신</dt>
                    <dd>
                      <time dateTime={indexing.waiting.oldest_waiting_since!}>
                        {new Intl.DateTimeFormat("ko-KR", {
                          timeZone: data.timezone,
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(indexing.waiting.oldest_waiting_since!))}
                      </time>{" "}
                      ({data.timezone})
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
          <DailyChart title="작성일별 현재 색인 상태" days={daily} series={indexSeries} stacked />
          <p className="text-sm text-muted-foreground">
            최근{" "}
            {data.period.days}일 작성한 기록을 작성일로 묶은 현재 상태입니다. 과거 대기량·실패량이나 당일 처리량의
            이력이 아닙니다.
          </p>
          {children}
        </CardContent>
      </Card>
    </div>
  );
}
