import { Input } from "@/components/ui/input";
import { DateInput } from "../../components/DateInput.tsx";
import { Textarea } from "@/components/ui/textarea";
import { FieldGroup } from "@/components/ui/field";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
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
export function TaskDataFields({ task, draft, set, errors = {}, disabled = false }: {
  task?: TaskResult;
  draft?: TaskDraft;
  set?: (
    patch: Partial<TaskDraft> | ((draft: TaskDraft) => Partial<TaskDraft>),
  ) => void;
  errors?: Record<string, string>;
  disabled?: boolean;
}) {
  const { formatDateTime } = useDisplayTime();
  const value = draft ?? task!;
  const recurrence = task?.recurrence;
  const freq = draft?.freq ?? recurrence?.freq;
  const pair = (label: string, content: ReactNode, full = false) => (
    <dl className={cn("flex min-w-0 flex-col gap-1", full && "col-span-full")}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">{content}</dd>
    </dl>
  );
  const field = (
    label: string,
    key: "title" | "body" | "due_on" | "month_days" | "starts_on" | "timezone",
    type = "text",
    full = false,
  ) => (
    <Field
      fullWidth={full}
      label={label}
      required={key === "title" || key === "starts_on" || key === "timezone"}
      error={errors[key]}
    >
      {(p) =>
        key === "body"
          ? (
            <Textarea
              {...p}
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
          : type === "date" ? (
            <DateInput
              {...p}
              label={label}
              value={draft![key]}
              disabled={disabled}
              onValueChange={(next) => set!({ [key]: next })}
            />
          ) : (
            <Input
              {...p}
              type={type}
              value={draft![key]}
              onChange={(e) => set!({ [key]: e.target.value })}
            />
          )}
    </Field>
  );
  const Grid = draft ? FieldGroup : "div";
  return (
    <Grid className={draft ? undefined : "@container grid min-w-0 gap-4 @min-[36rem]:grid-cols-2"}>
      {draft ? field("제목", "title", "text", true) : pair("제목", <DetailTitle>{value.title}</DetailTitle>, true)}
      {draft ? field("본문", "body", "text", true) : pair(
        "본문",
        value.body ? <MarkdownContent text={value.body} /> : "—",
        true,
      )}
      {task && pair(taskLabels.status, <StatusBadge status={task.status} />)}
      {task && pair(taskLabels.kind, taskLabels[task.kind])}
      {value.kind === "once"
        ? draft ? field(taskLabels.due_on, "due_on", "date") : pair(taskLabels.due_on, task!.due_on ?? "—")
        : (
          <>
            {draft
              ? (
                <Field label={taskLabels.recurrence}>
                  {(p) => (
                    <ToggleGroup
                      id={p.id}
                      type="single"
                      variant="outline"
                      value={freq}
                      aria-label={taskLabels.recurrence}
                      onValueChange={(value) => {
                        if (value) set!({ freq: value as TaskDraft["freq"] });
                      }}
                    >
                      {(["daily", "weekly", "monthly"] as const).map((value) => (
                        <ToggleGroupItem key={value} value={value}>{taskLabels[value]}</ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                  )}
                </Field>
              )
              : pair(taskLabels.recurrence, freq ? taskLabels[freq] : "—")}
            {freq === "weekly" && (draft
              ? (
                <Field label={taskLabels.weekdays} error={errors.weekdays}>
                  {(p) => (
                    <ToggleGroup
                      id={p.id}
                      type="multiple"
                      variant="outline"
                      className="flex-wrap"
                      value={draft.weekdays.map(String)}
                      aria-label={taskLabels.weekdays}
                      onValueChange={(values) => set!({ weekdays: values.map(Number) })}
                    >
                      {WEEKDAYS.map((name, i) => (
                        <ToggleGroupItem
                          key={name}
                          value={String(i + 1)}
                          aria-invalid={p["aria-invalid"]}
                          aria-describedby={p["aria-describedby"]}
                          data-field-control={p["data-field-control"]}
                        >{name}</ToggleGroupItem>
                      ))}
                    </ToggleGroup>
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
                recurrence?.freq === "monthly" ? recurrence.month_days.join(", ") : "—",
              ))}
            {draft
              ? field(taskLabels.starts_on, "starts_on", "date")
              : pair(taskLabels.starts_on, recurrence?.starts_on ?? "—")}
            {draft ? field(taskLabels.timezone, "timezone") : pair(taskLabels.timezone, task?.timezone ?? "—")}
            {freq === "monthly" && (
              <p className="col-span-full text-sm text-muted-foreground">
                해당 달에 없는 날짜는 마지막 날로 옮깁니다. 같은 날로 겹치면 회차 하나입니다.
              </p>
            )}
          </>
        )}
      {task?.completed_at &&
        pair("완료 시각", formatDateTime(task.completed_at))}
    </Grid>
  );
}
