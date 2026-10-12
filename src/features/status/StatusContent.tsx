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
        <section className="status-domain" aria-label="자료 현황">
          <Summary
            title="자료"
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
        {!!indexing.waiting?.long_waiting && (
          <p className="help" role="status">
            준비 상태 갱신이 {indexing.waiting.threshold_minutes}분 이상 없는 기록{" "}
            {indexing.waiting.long_waiting}개가 있습니다. 가장 오래된 갱신: {new Intl.DateTimeFormat("ko-KR", {
              timeZone: data.timezone,
              dateStyle: "medium",
              timeStyle: "short",
            }).format(new Date(indexing.waiting.oldest_waiting_since!))}{" "}
            ({data.timezone}). 처리 실패로 확정된 상태는 아닙니다. 새로고침 후에도 계속되면 관리자에게 색인 서비스
            점검을 요청하세요.
          </p>
        )}
        <DailyChart title="작성일별 현재 색인 상태" days={daily} series={indexSeries} stacked />
        <p className="help">
          최근 30일 작성한 기록을 작성일로 묶은 현재 상태입니다. 과거 대기량·실패량이나 당일 처리량의 이력이 아닙니다.
        </p>
        {children}
      </section>
    </>
  );
}
