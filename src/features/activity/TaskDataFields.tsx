import type { ReactNode } from "react";
import type { TaskResult } from "@contracts/task.ts";
import { taskLabels } from "@contracts/task.ts";
import { Field } from "../../components/Field.tsx";
import { MarkdownContent } from "../../components/MarkdownContent.tsx";
import { DetailTitle } from "../../components/Modal.tsx";
import { TimezoneSelect } from "../../components/TimezoneSelect.tsx";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import { StatusBadge } from "./shared.tsx";
import type { TaskDraft } from "./forms.tsx";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

/** One field sequence for saved tasks and drafts; immutable context remains selectable text. */
export function TaskDataFields({ task, draft, set, errors = {} }: {
  task?: TaskResult;
  draft?: TaskDraft;
  set?: (
    patch: Partial<TaskDraft> | ((draft: TaskDraft) => Partial<TaskDraft>),
  ) => void;
  errors?: Record<string, string>;
}) {
  const { formatDateTime } = useDisplayTime();
  const value = draft ?? task!;
  const recurrence = task?.recurrence;
  const freq = draft?.freq ?? recurrence?.freq;
  const pair = (label: string, content: ReactNode, full = false) =>
    draft
      ? (
        <dl className={`key-value-static${full ? " key-value-full" : ""}`}>
          <div>
            <dt>{label}</dt>
            <dd>{content}</dd>
          </div>
        </dl>
      )
      : (
        <div className={full ? "key-value-full" : undefined}>
          <dt>{label}</dt>
          <dd>{content}</dd>
        </div>
      );
  const field = (
    label: string,
    key: "title" | "body" | "due_on" | "month_days" | "starts_on" | "timezone",
    type = "text",
    full = false,
  ) => (
    <Field
      pair
      fullWidth={full}
      className={key === "title" ? "key-value-primary" : ""}
      label={label}
      required={key === "title" || key === "starts_on" || key === "timezone"}
      error={errors[key]}
    >
      {(p) =>
        key === "body"
          ? (
            <textarea
              {...p}
              className="input"
              rows={8}
              value={draft!.body}
              onChange={(e) => set!({ body: e.target.value })}
            />
          )
          : key === "timezone"
          ? (
            <TimezoneSelect
              {...p}
              value={draft!.timezone}
              onChange={(e) => set!({ timezone: e.target.value })}
            />
          )
          : (
            <input
              {...p}
              className="input"
              type={type}
              value={draft![key]}
              onChange={(e) => set!({ [key]: e.target.value })}
            />
          )}
    </Field>
  );
  const Grid = draft ? "div" : "dl";
  return (
    <Grid className="key-value-grid">
      {draft
        ? field("제목", "title", "text", true)
        : pair("제목", <DetailTitle>{value.title}</DetailTitle>, true)}
      {draft ? field("본문", "body", "text", true) : pair(
        "본문",
        value.body ? <MarkdownContent text={value.body} /> : "—",
        true,
      )}
      {task && pair(taskLabels.status, <StatusBadge status={task.status} />)}
      {task && pair(taskLabels.kind, taskLabels[task.kind])}
      {value.kind === "once"
        ? draft
          ? field(taskLabels.due_on, "due_on", "date")
          : pair(taskLabels.due_on, task!.due_on ?? "—")
        : (
          <>
            {draft
              ? (
                <Field pair label={taskLabels.recurrence}>
                  {(p) => (
                    <div
                      id={p.id}
                      role="radiogroup"
                      aria-label={taskLabels.recurrence}
                      className="chips"
                    >
                      {(["daily", "weekly", "monthly"] as const).map((f) => (
                        <label key={f} className="chip choice-chip">
                          <input
                            type="radio"
                            name="task-frequency"
                            checked={freq === f}
                            onChange={() => set!({ freq: f })}
                          />
                          {taskLabels[f]}
                        </label>
                      ))}
                    </div>
                  )}
                </Field>
              )
              : pair(taskLabels.recurrence, freq ? taskLabels[freq] : "—")}
            {freq === "weekly" && (draft
              ? (
                <Field pair label={taskLabels.weekdays} error={errors.weekdays}>
                  {(p) => (
                    <div
                      id={p.id}
                      className="chips"
                      role="group"
                      aria-label={taskLabels.weekdays}
                    >
                      {WEEKDAYS.map((name, i) => (
                        <button
                          key={name}
                          type="button"
                          className="chip"
                          aria-pressed={draft.weekdays.includes(i + 1)}
                          onClick={() =>
                            set!((d) => ({
                              weekdays: d.weekdays.includes(i + 1)
                                ? d.weekdays.filter((n) => n !== i + 1)
                                : [...d.weekdays, i + 1],
                            }))}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  )}
                </Field>
              )
              : pair(
                taskLabels.weekdays,
                recurrence?.freq === "weekly"
                  ? recurrence.weekdays.map((n) => WEEKDAYS[n - 1]).join("·") ||
                    "—"
                  : "—",
              ))}
            {freq === "monthly" &&
              (draft ? field(taskLabels.month_days, "month_days") : pair(
                taskLabels.month_days,
                recurrence?.freq === "monthly"
                  ? recurrence.month_days.join(", ")
                  : "—",
              ))}
            {draft
              ? field(taskLabels.starts_on, "starts_on", "date")
              : pair(taskLabels.starts_on, recurrence?.starts_on ?? "—")}
            {draft
              ? field(taskLabels.timezone, "timezone")
              : pair(taskLabels.timezone, task?.timezone ?? "—")}
            {freq === "monthly" && (
              <p className="help key-value-full">
                해당 달에 없는 날짜는 마지막 날로 옮깁니다. 같은 날로 겹치면
                회차 하나입니다.
              </p>
            )}
          </>
        )}
      {task?.completed_at &&
        pair("완료 시각", formatDateTime(task.completed_at))}
    </Grid>
  );
}
