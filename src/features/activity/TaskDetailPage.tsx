// 할 일 상세: 읽기, 편집, 일회성 완료, 반복 할 일의 회차·회차 기록·중단/재개, 삭제.
import type { RecordResult } from "@contracts/record.ts";
import type { Occurrence, TaskDetail, TaskResult } from "@contracts/task.ts";
import { taskLabels } from "@contracts/task.ts";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Notice } from "../../components/Field.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { api, ApiError } from "../../lib/api.ts";
import { addDays, formatDateTime, todayIn } from "../../lib/format.ts";
import { emptyRecord, RecordFormModal, TaskFormModal, taskDraftFrom, taskInput } from "./forms.tsx";
import { OccurrenceBadge, StatusBadge, useRequestId } from "./shared.tsx";
import {TagNames} from "../tags/TagPicker.tsx";
import {EntityLink} from "../entity/EntityPicker.tsx";
import {useSearchReturn} from "../search/return.ts";

const WEEKDAY_NAMES = ["", "월", "화", "수", "목", "금", "토", "일"];

function describeRecurrence(t: TaskResult): string {
  const r = t.recurrence;
  if (!r) return "—";
  const rule = r.freq === "daily"
    ? "매일"
    : r.freq === "weekly"
    ? `매주 ${r.weekdays.map((d) => WEEKDAY_NAMES[d]).join("·")}`
    : `매월 ${r.month_days.join("·")}일`;
  return `${rule}, ${r.starts_on}부터 (${t.timezone})`;
}

type Dialog = null | "edit" | "complete" | "delete" | { occurrence: string };

export function TaskDetailPage() {
  const { id = "" } = useParams();
  const back=useSearchReturn(`/tasks${window.location.search}`,"← 할 일 목록");
  const navigate = useNavigate();
  const [task, setTask] = useState<TaskDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [busy, setBusy] = useState(false);
  const [occurrences, setOccurrences] = useState<{ today: string; items: Occurrence[] } | null>(null);
  const [rangeEnd, setRangeEnd] = useState<string | null>(null);
  const requestId = useRequestId();

  const reload = useCallback(async () => {
    try {
      setTask(await api<TaskDetail>("GET", `/tasks/${id}`));
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof ApiError && e.code === "not_found" ? "할 일을 찾을 수 없습니다." : "할 일을 불러오지 못했습니다.");
    }
  }, [id]);

  useEffect(() => {
    reload();
  }, [reload]);

  const loadOccurrences = useCallback(async (t: TaskResult, end: string | null) => {
    try {
      // 할 일 시간대의 오늘 기준 앞 13일과 뒤 7일. 이전 기간으로 옮길 수 있다.
      const to = end ?? addDays(todayIn(t.timezone ?? "UTC"), 7);
      const from = addDays(to, -20);
      const res = await api<{ today: string; items: Occurrence[] }>("GET", `/tasks/${t.id}/occurrences?from=${from}&to=${to}`);
      setOccurrences({ today: res.today, items: [...res.items].reverse() });
    } catch {
      setOccurrences(null);
      setActionError("회차를 불러오지 못했습니다.");
    }
  }, []);

  useEffect(() => {
    if (task?.kind === "recurring") loadOccurrences(task, rangeEnd);
  }, [task, rangeEnd, loadOccurrences]);

  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    setActionError(null);
    setMessage(null);
    try {
      await action();
      setMessage(done);
    } catch (e) {
      setActionError(e instanceof ApiError ? e.message : "처리하지 못했습니다.");
      await reload();
    } finally {
      setBusy(false);
    }
  };

  if (loadError) {
    return (
      <section className="panel">
        <Notice kind="error">{loadError}</Notice>
        <Link to={back.path}>{back.label}</Link>
      </section>
    );
  }
  if (!task) return <p className="secondary" role="status">불러오는 중…</p>;

  return (
    <>
      <section className="panel" aria-labelledby="task-title">
        <div className="panel-head">
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-2)", minWidth: 0 }}>
            <Link to={back.path} className="secondary back-link">{back.label}</Link>
            <h1 id="task-title" className="page-title">{task.title}</h1>
          </div>
          <div className="actions">
            {task.kind === "once" && task.status === "open" && (
              <button type="button" className="btn btn-primary" onClick={() => setDialog("complete")}>완료</button>
            )}
            {task.kind === "recurring" && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const path = task.status === "active" ? "stop" : "resume";
                    await api("POST", `/tasks/${task.id}/${path}`, { expected_version: task.version });
                    await reload();
                  }, task.status === "active" ? "중단했습니다. 오늘부터 회차가 없습니다." : "재개했습니다.")}
              >
                {task.status === "active" ? "중단" : "재개"}
              </button>
            )}
            <button type="button" className="btn" onClick={() => setDialog("edit")}>편집</button>
            <button type="button" className="btn btn-danger" onClick={() => setDialog("delete")}>삭제</button>
          </div>
        </div>
        {message && <Notice kind="success">{message}</Notice>}
        {actionError && <Notice kind="error">{actionError}</Notice>}
        <TagNames ids={task.tag_ids}/>
        <EntityLink id={task.entity_id}/>
        <dl className="props">
          <div>
            <dt>{taskLabels.status}</dt>
            <dd><StatusBadge status={task.status} /></dd>
          </div>
          <div>
            <dt>{taskLabels.kind}</dt>
            <dd>{taskLabels[task.kind]}</dd>
          </div>
          {task.kind === "once"
            ? (
              <div>
                <dt>{taskLabels.due_on}</dt>
                <dd>{task.due_on ?? "없음"}</dd>
              </div>
            )
            : (
              <div>
                <dt>{taskLabels.recurrence}</dt>
                <dd>{describeRecurrence(task)}</dd>
              </div>
            )}
          {task.completed_at && (
            <div>
              <dt>완료 시각</dt>
              <dd>{formatDateTime(task.completed_at)}</dd>
            </div>
          )}
          {task.kind === "once" && task.status === "done" && (
            <div>
              <dt>결과 기록</dt>
              <dd>
                {task.result_record
                  ? <Link to={`/records/${task.result_record.id}`}>{task.result_record.title}</Link>
                  : "결과 기록이 삭제되었습니다"}
              </dd>
            </div>
          )}
          <div>
            <dt>{taskLabels.summary}</dt>
            <dd>{task.summary}</dd>
          </div>
        </dl>
        <div>
          <h2 className="section-title">{taskLabels.body}</h2>
          <MarkdownContent text={task.body} />
        </div>
        <p className="meta" style={{ margin: 0 }}>
          만든 시각 {formatDateTime(task.created_at)} · 수정 {formatDateTime(task.updated_at)}
        </p>
      </section>

      {task.kind === "recurring" && (
        <section className="panel" aria-labelledby="occ-title">
          <div className="panel-head">
            <h2 id="occ-title" className="section-title">회차</h2>
            {occurrences && (
              <div className="actions">
                <button type="button" className="btn" onClick={() => setRangeEnd(addDays(occurrences.items.at(-1)?.date ?? occurrences.today, -1))}>
                  이전 기간
                </button>
                {rangeEnd && <button type="button" className="btn" onClick={() => setRangeEnd(null)}>최근으로</button>}
              </div>
            )}
          </div>
          {task.status === "stopped" && <Notice>중단된 할 일입니다. 재개하면 그날부터 회차가 생깁니다.</Notice>}
          {!occurrences && <p className="secondary" role="status">불러오는 중…</p>}
          {occurrences?.items.length === 0 && <p className="secondary">이 기간에는 회차가 없습니다.</p>}
          {occurrences && occurrences.items.length > 0 && (
            <ul className="list">
              {occurrences.items.map((o) => (
                <li key={o.date} className="list-item">
                  <div className="list-item-main">
                    <span className="item-title">
                      {o.date}
                      {o.date === occurrences.today ? " (오늘)" : ""}
                    </span>
                    {!o.in_rule && <span className="secondary">규칙 밖 기록(규칙이 바뀌기 전에 남긴 기록)</span>}
                    {o.record_ids.length > 0 && (
                      <span className="secondary">
                        {o.record_ids.map((rid, i) => (
                          <span key={rid}>
                            {i > 0 && ", "}
                            <Link to={`/records/${rid}`}>기록 {i + 1}</Link>
                          </span>
                        ))}
                      </span>
                    )}
                  </div>
                  <OccurrenceBadge status={o.status} />
                  {o.in_rule && o.status !== "upcoming" && (
                    <button type="button" className="btn" onClick={() => setDialog({ occurrence: o.date })} aria-label={`${o.date} 회차 기록`}>
                      기록
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {dialog === "edit" && (
        <TaskFormModal
          mode="edit"
          open
          initial={taskDraftFrom(task)}
          onClose={() => setDialog(null)}
          onSave={async (draft) => {
            const patch: Record<string, unknown> = {
              expected_version: task.version,
              title: draft.title,
              summary: draft.summary,
              body: draft.body,
              tag_ids:draft.tag_ids,
              entity_id:draft.entity_id,
            };
            if (task.kind === "once") patch.due_on = draft.due_on || null;
            else {
              const input = taskInput(draft);
              patch.recurrence = input.recurrence;
              patch.timezone = input.timezone;
            }
            await api("PATCH", `/tasks/${task.id}`, patch);
            setDialog(null);
            setMessage("저장했습니다.");
            await reload();
          }}
        />
      )}
      {dialog === "complete" && (
        <RecordFormModal
          title="할 일 완료"
          entityEditable={false}
          submitLabel="완료하고 기록 저장"
          open
          initial={emptyRecord()}
          intro={<p className="help" style={{ margin: 0 }}>실제로 수행한 결과를 남기면 할 일이 완료됩니다.</p>}
          onClose={() => setDialog(null)}
          onSave={async (value) => {
            await api("POST", `/tasks/${task.id}/complete`, { ...value, expected_version: task.version, request_id: requestId.current });
            requestId.renew();
            setDialog(null);
            setMessage("완료하고 결과 기록을 저장했습니다.");
            await reload();
          }}
        />
      )}
      {dialog && typeof dialog === "object" && (
        <RecordFormModal
          title={`${dialog.occurrence} 회차 기록`}
          submitLabel="기록 저장"
          open
          initial={{...emptyRecord(),entity_id:task.entity_id}}
          onClose={() => setDialog(null)}
          onSave={async (value) => {
            await api<RecordResult>("POST", `/tasks/${task.id}/occurrences/${dialog.occurrence}/records`, {
              ...value,
              request_id: requestId.current,
            });
            requestId.renew();
            setDialog(null);
            setMessage(`${dialog.occurrence} 회차에 기록했습니다.`);
            await loadOccurrences(task, rangeEnd);
          }}
        />
      )}
      <ConfirmDialog
        open={dialog === "delete"}
        title="할 일을 삭제할까요?"
        message={
          <p style={{ margin: 0 }}>
            「{task.title}」을(를) 삭제합니다. 연결된 결과·회차 기록은 남고 이 할 일과의 연결만 사라집니다.
          </p>
        }
        confirmLabel="삭제"
        danger
        busy={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          run(async () => {
            await api("DELETE", `/tasks/${task.id}?expected_version=${task.version}`);
            navigate(back.path, { replace: true });
          }, "삭제했습니다.")}
      />
    </>
  );
}
