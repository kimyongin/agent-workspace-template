import type { ReactNode } from "react";
import { recordLabels, type RecordResult } from "@contracts/record.ts";
import { taskLabels } from "@contracts/task.ts";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";

export type WorkspaceRecord = RecordResult;
export const recordKindNames = {
  user: "직접 작성",
  result: "수행 결과",
  change: "변경 기록",
};
export const changeActionNames = {
  create: "등록",
  update: "수정",
  delete: "삭제",
  restore: "복원",
  stop: "중단",
  resume: "재개",
};
const targets = { entity: "자료", task: "할 일", record: "기록" };
const snapshotLabels: Record<string, string> = {
  title: "이름",
  body: "내용",
  source: "번호 출처",
  external_id: "자료 번호",
  entity_type_id: "자료 종류",
  schema_version: "입력 항목 버전",
  properties: "입력 항목",
  tag_ids: "태그",
  entity_ids: "연결 자료",
  status: "상태",
  kind: "종류",
  due_on: "기한",
  recurrence: "반복",
  timezone: "시간대",
  pauses: "중단 기간",
  starts_on: "시작일",
  stopped_on: "중단일",
  resumed_on: "재개일",
  freq: "반복 주기",
  weekdays: "요일",
  month_days: "날짜",
};
function SnapshotValue(
  { value, labels, field }: {
    value: unknown;
    labels?: Record<string, string>;
    field?: string;
  },
) {
  if (value === null) return <>값 없음</>;
  if (typeof value === "boolean") return <>{value ? "예" : "아니오"}</>;
  if (Array.isArray(value)) {
    if (!value.length) return <>없음</>;
    return (
      <>
        {value.map((item, index) =>
          item !== null && typeof item === "object"
            ? (
              <div key={index} className="key-value-full">
                <p className="label">항목 {index + 1}</p>
                <SnapshotValue value={item} />
              </div>
            )
            : (
              <span key={index}>
                {index > 0 ? " · " : ""}
                <SnapshotValue value={item} />
              </span>
            )
        )}
      </>
    );
  }
  if (typeof value === "object") {
    const captured = "property_labels" in value && value.property_labels &&
        typeof value.property_labels === "object"
      ? Object.fromEntries(
        Object.entries(value.property_labels).filter((
          entry,
        ): entry is [string, string] => typeof entry[1] === "string"),
      )
      : undefined;
    const entries = Object.entries(value).filter(([key]) =>
      key !== "property_labels"
    );
    return entries.length
      ? (
        <div className="key-value-grid">
          {entries.map(([key, item]) => {
            const label = (labels && Object.hasOwn(labels, key)
              ? labels[key]
              : undefined) ||
              (Object.hasOwn(snapshotLabels, key)
                ? snapshotLabels[key]
                : undefined) ||
              (/^prop_[0-9]+$/.test(key) ? `항목 ${key.slice(5)}` : key);
            const nested = item !== null && typeof item === "object" &&
              (!Array.isArray(item) || item.some((value) =>
                value !== null && typeof value === "object"
              ));
            return nested
              ? (
                <div key={key} className="key-value-full">
                  <p className="label">{label}</p>
                  <SnapshotValue
                    value={item}
                    labels={key === "properties" ? captured : undefined}
                    field={key}
                  />
                </div>
              )
              : (
                <dl key={key} className="key-value-static">
                  <div>
                    <dt>{label}</dt>
                    <dd>
                      <SnapshotValue value={item} field={key} />
                    </dd>
                  </div>
                </dl>
              );
          })}
        </div>
      )
      : <>없음</>;
  }
  const translated = typeof value === "string" &&
      ["status", "kind", "freq"].includes(field ?? "")
    ? ({
      open: taskLabels.open,
      done: taskLabels.done,
      active: taskLabels.active,
      stopped: taskLabels.stopped,
      once: taskLabels.once,
      recurring: taskLabels.recurring,
      daily: taskLabels.daily,
      weekly: taskLabels.weekly,
      monthly: taskLabels.monthly,
    } as Record<string, string>)[value]
    : undefined;
  return <>{translated ?? (value === "" ? "빈 문자열" : String(value))}</>;
}
export function ChangeContext(
  { record, compact = false, occurredAt }: {
    record: WorkspaceRecord;
    compact?: boolean;
    occurredAt?: ReactNode;
  },
) {
  const { formatDateTime } = useDisplayTime();
  const change = record.change;
  const target = change
    ? `${
      change.target_kind === "entity"
        ? record.entity_context.find((item) => item.id === change.target_id)
          ?.type?.label ?? targets.entity
        : targets[change.target_kind]
    } 「${change.target_title}」`
    : null;
  const pair = (label: string, value: ReactNode, full = false) => (
    <dl className={`key-value-static${full ? " key-value-full" : ""}`}>
      <div>
        <dt>{label}</dt>
        <dd>{value}</dd>
      </div>
    </dl>
  );
  const properties = (
    <div className="key-value-grid">
      {pair("종류", recordKindNames[record.record_kind] ?? "기록")}
      {change && pair("출처", change.source === "http" ? "웹" : "에이전트")}
      {occurredAt ??
        pair(
          recordLabels.occurred_at,
          <time dateTime={record.occurred_at}>
            {formatDateTime(record.occurred_at)}
          </time>,
        )}
      {target &&
        pair(
          "변경 대상",
          <>
            {target}
            {compact && change?.action === "delete" ? " · 삭제된 대상" : ""}
          </>,
          true,
        )}
      {change && pair("행동", changeActionNames[change.action])}
    </div>
  );
  if (compact) return properties;
  return (
    <div className="detail-section record-context">
      {properties}
      {change && (
        <>
          {(change.before !== null || change.after !== null) && (
            <details className="workspace-additional">
              <summary>변경 전후 값</summary>
              <div className="change-snapshot">
                <section>
                  <h3 className="section-title">변경 전</h3>
                  {change.before === null
                    ? <p>없음</p>
                    : <SnapshotValue value={change.before} />}
                </section>
                <section>
                  <h3 className="section-title">변경 후</h3>
                  {change.after === null
                    ? <p>없음</p>
                    : <SnapshotValue value={change.after} />}
                </section>
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
