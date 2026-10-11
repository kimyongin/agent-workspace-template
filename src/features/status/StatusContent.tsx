import { useId, useState } from "react";
import type { StatusDay, StatusOverview } from "@contracts/status.ts";

type Series = { label: string; tone: string; value: (day: StatusDay) => number };
const entitySeries: Series[] = [{ label: "등록", tone: "accent", value: (d) => d.entities_created }];
const taskSeries: Series[] = [{ label: "생성", tone: "accent", value: (d) => d.tasks_created }, {
  label: "일회성 완료",
  tone: "success",
  value: (d) => d.once_completed,
}];
const recordSeries: Series[] = [{ label: "작성", tone: "accent", value: (d) => d.records_created }];
const indexSeries: Series[] = [
  { label: "완료", tone: "success", value: (d) => d.indexing.indexed },
  { label: "준비 중", tone: "warning", value: (d) => d.indexing.preparing },
  { label: "확인 필요", tone: "danger", value: (d) => d.indexing.attention },
  { label: "대상 제외", tone: "muted-ink", value: (d) => d.indexing.excluded },
];

// Exact daily values reuse the same metric readers as the four charts.
const dailyValues = [
  entitySeries[0],
  { ...taskSeries[0], label: "할 일 생성" },
  taskSeries[1],
  { ...recordSeries[0], label: "기록 작성" },
  { ...indexSeries[0], label: "색인 완료" },
  ...indexSeries.slice(1),
];

function DailyChart(
  { title, days, series, stacked = false }: { title: string; days: StatusDay[]; series: Series[]; stacked?: boolean },
) {
  const id = useId();
  const [selected, setSelected] = useState(days.length - 1);
  const index = Math.max(0, Math.min(selected, days.length - 1));
  const current = days[index];
  const max = Math.max(
    1,
    ...days.map((day) =>
      stacked ? series.reduce((sum, s) => sum + s.value(day), 0) : Math.max(...series.map((s) => s.value(day)))
    ),
  );
  const width = 600, height = 80, step = width / Math.max(1, days.length);
  return (
    <div className="status-chart-area">
      <div className="status-chart-heading">
        <h3 className="section-title">{title}</h3>
        <span className="meta">최근 {days.length}일</span>
      </div>
      <div className="status-legend">
        {series.map((s) => (
          <span key={s.label}>
            <i style={{ background: `var(--${s.tone})` }} />
            {s.label}
          </span>
        ))}
      </div>
      <button
        type="button"
        className="status-chart-button"
        aria-label={`${title} 그래프: 막대를 누르거나 방향키로 날짜 선택`}
        aria-describedby={current ? id : undefined}
        disabled={!current}
        onClick={(event) => {
          if (!event.detail) return;
          const bounds = event.currentTarget.getBoundingClientRect();
          const day = Math.floor((event.clientX - bounds.left) / bounds.width * days.length);
          setSelected(Math.max(0, Math.min(days.length - 1, day)));
        }}
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
          if (next === null) return;
          event.preventDefault();
          setSelected(Math.max(0, Math.min(days.length - 1, next)));
        }}
      >
        <svg className="status-chart" viewBox="0 0 600 105" aria-hidden="true" preserveAspectRatio="none">
          <rect x={index * step} y="0" width={step} height={height + 4} fill="var(--accent-soft)" />
          {[0, .5, 1].map((n) => (
            <line
              key={n}
              x1="0"
              x2={width}
              y1={height - n * height + 4}
              y2={height - n * height + 4}
              stroke="var(--line)"
            />
          ))}
          {days.map((day, di) => {
            let cumulative = 0;
            return (
              <g key={day.date}>
                {series.map((s, si) => {
                  const value = s.value(day), barHeight = value / max * height;
                  const y = height + 4 - barHeight - (stacked ? cumulative : 0);
                  cumulative += barHeight;
                  const barWidth = stacked ? step * .68 : step * .78 / series.length;
                  return (
                    <rect
                      key={s.label}
                      x={di * step + step * .12 + (stacked ? 0 : si * barWidth)}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      fill={`var(--${s.tone})`}
                      opacity={di === index ? 1 : .8}
                    />
                  );
                })}
              </g>
            );
          })}
          {days.length > 0 && (
            <>
              <text x="0" y="103">{days[0].date.slice(5)}</text>
              <text x="600" y="103" textAnchor="end">{days[days.length - 1].date.slice(5)}</text>
            </>
          )}
        </svg>
      </button>
      {current && (
        <p id={id} className="status-day-detail" aria-live="polite">
          <strong>{current.date}</strong> · {series.map((s) => `${s.label} ${s.value(current)}건`).join(" · ")}
        </p>
      )}
    </div>
  );
}
function Summary({ title, total, values }: { title: string; total: number; values: [string, number][] }) {
  return (
    <div className="status-summary">
      <div className="status-total">
        <h3 className="section-title">{title}</h3>
        <strong>
          {total.toLocaleString("ko-KR")}
          <span className="meta">개</span>
        </strong>
      </div>
      <dl>
        {values.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value.toLocaleString("ko-KR")}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
export function StatusContent({ data, children }: { data: StatusOverview; children?: React.ReactNode }) {
  const { entities, tasks, records, indexing, daily } = data;
  return (
    <>
      <section className="status-section" aria-labelledby="status-current-title">
        <div className="status-section-heading">
          <h2 className="status-section-title" id="status-current-title">현재 자료·최근 활동</h2>
          <span className="meta">활동: 최근 {data.period.days}일 · {data.period.from}–{data.period.to}</span>
        </div>
        {entities.total + tasks.total + records.total === 0 && (
          <p className="secondary">아직 보관한 자료가 없습니다. 활동이 없는 날짜는 0으로 표시합니다.</p>
        )}
        <section className="status-domain" aria-label="엔터티 현황">
          <Summary
            title="엔터티"
            total={entities.total}
            values={[["활성", entities.active], ["삭제 보관", entities.deleted]]}
          />
          <DailyChart title="일별 등록" days={daily} series={entitySeries} />
        </section>
        <section className="status-domain" aria-label="할 일 현황">
          <Summary
            title="할 일"
            total={tasks.total}
            values={[["진행 중", tasks.open], ["완료", tasks.done], ["반복 중", tasks.active], [
              "중단됨",
              tasks.stopped,
            ]]}
          />
          <DailyChart title="일별 생성·완료" days={daily} series={taskSeries} />
        </section>
        <section className="status-domain" aria-label="기록 현황">
          <Summary
            title="기록"
            total={records.total}
            values={[["일반", records.user], ["수행 결과", records.result], ["변경", records.change]]}
          />
          <DailyChart title="일별 작성" days={daily} series={recordSeries} />
        </section>
      </section>
      <section className="status-section" aria-labelledby="status-index-title">
        <div className="status-section-heading">
          <h2 className="status-section-title" id="status-index-title">색인 현황</h2>
          <span className="meta">전체 기록 {indexing.total.toLocaleString("ko-KR")}개 · 현재 상태</span>
        </div>
        <dl className="status-index-counts">
          {[["완료", indexing.indexed], ["준비 중", indexing.preparing], ["확인 필요", indexing.attention], [
            "대상 제외",
            indexing.excluded,
          ]].map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{Number(value).toLocaleString("ko-KR")}</dd>
            </div>
          ))}
        </dl>
        <DailyChart title="작성일별 현재 색인 상태" days={daily} series={indexSeries} stacked />
        <p className="help">
          최근 30일 작성한 기록을 작성일로 묶은 현재 상태입니다. 과거 대기량·실패량이나 당일 처리량의 이력이 아닙니다.
        </p>
        {children}
      </section>
      <details className="status-explanation">
        <summary>집계 기준과 날짜별 값</summary>
        <p className="help">
          서버 조회 시각과 {data.timezone}{" "}
          시간대를 기준으로 오늘을 포함한 30개 날짜를 표시합니다. 현재 보관 중인 자료만 집계하며 삭제 보관 엔터티의
          등록도 포함합니다. 실제 삭제된 할 일·기록은 과거 활동 집계에서도 빠질 수 있습니다. 기록은 수정 가능한 발생
          시각 대신 작성 시각을 사용합니다. 반복 수행은 수행 결과 기록이며 일회성 완료에 합산하지 않습니다. 준비 중은
          대기·처리·재시도 상태, 확인 필요는 응답 확인 불가·서비스 설정 오류·자동 재시도 중단 등입니다.
        </p>
        <h2 className="status-daily-values-title">날짜별 값 (건)</h2>
        <div className="status-daily-values">
          {daily.map((day) => (
            <section key={day.date} aria-label={`${day.date} 날짜별 값`}>
              <h3>
                <time dateTime={day.date}>{day.date}</time>
              </h3>
              <dl>
                {dailyValues.map((metric) => (
                  <div key={metric.label}>
                    <dt>{metric.label}</dt>
                    <dd>{metric.value(day)}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </details>
    </>
  );
}
