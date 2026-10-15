import { TimezoneSelect } from "../../components/TimezoneSelect.tsx";
import { useDisplayTime } from "../../lib/useDisplayTime.ts";
import type { DeletionOptions } from "../../components/DeleteAction.tsx";
// 할 일·기록 작성/편집 폼. 검증은 서버와 같은 contracts로 하고, 저장 실패 시 초안을 유지한다.
import { TagPicker } from "../tags/TagPicker.tsx";
import { RelationPicker } from "../relations/RelationPicker.tsx";
import { EntityMultiPicker } from "../entity/EntityPicker.tsx";
import { recordCreate, recordLabels } from "@contracts/record.ts";
import { type Recurrence, taskCreate, taskLabels, type TaskResult } from "@contracts/task.ts";
import { api } from "../../lib/api.ts";
import { type ReactNode, useState } from "react";
import { Field } from "../../components/Field.tsx";
import { FormModal, type TextDraft, TextFields } from "../../components/ContentForm.tsx";
import { browserTimezone, fieldErrors, fromLocalInput, todayIn, toLocalInput } from "../../lib/format.ts";
import type { EntityContext } from "@contracts/entity-links.ts";

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

// ---------- 기록 폼(직접 작성·완료 결과·회차 기록·편집) ----------

export interface RecordDraft {
  body: string;
  task_id?: string;
  entity_ids?: string[];
  entity_context?: EntityContext[];
  tag_ids: string[];
  occurred_at: string; // datetime-local
  original_occurred_at?: string;
}

export const emptyRecord = (): RecordDraft => ({ body: "", occurred_at: "", tag_ids: [] });

export function recordDraftFrom(
  r: { body: string; occurred_at: string; tag_ids?: string[]; entity_ids?: string[]; entity_context?: EntityContext[] },
  timezone = browserTimezone(),
): RecordDraft {
  return {
    body: r.body,
    occurred_at: toLocalInput(r.occurred_at, timezone),
    original_occurred_at: r.occurred_at,
    tag_ids: r.tag_ids ?? [],
    entity_ids: r.entity_ids ?? [],
    entity_context: r.entity_context ?? [],
  };
}

/** The minute-only input must not truncate an untouched stored timestamp. */
export function recordDraftTime(draft: RecordDraft, timezone = browserTimezone()): string | undefined {
  return draft.original_occurred_at && draft.occurred_at === toLocalInput(draft.original_occurred_at, timezone)
    ? draft.original_occurred_at
    : fromLocalInput(draft.occurred_at, timezone);
}

export function RecordFormModal(props: {
  title: string;
  submitLabel: string;
  open: boolean;
  initial: RecordDraft;
  intro?: ReactNode;
  details?: ReactNode;
  deletion?: DeletionOptions;
  entityEditable?: boolean;
  taskEditable?: boolean;
  systemRecord?: boolean;
  editing?: boolean;
  onClose: () => void;
  onRouteDiscard?: () => void;
  onSave: (
    value: { body: string; occurred_at?: string; tag_ids?: string[]; entity_ids?: string[]; task_id?: string },
    requestKey: () => string,
  ) => Promise<void>;
}) {
  const displayTime = useDisplayTime();
  const [timezone] = useState(displayTime.timezone);
  const [initial] = useState(props.initial);
  const [draft, setDraft] = useState(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const value = () => ({
    body: draft.body,
    ...(!props.editing && props.taskEditable !== false && props.entityEditable !== false
      ? { task_id: draft.task_id }
      : {}),
    occurred_at: recordDraftTime(draft, timezone),
    tag_ids: draft.tag_ids,
    ...(!props.editing && props.entityEditable !== false ? { entity_ids: draft.entity_ids ?? [] } : {}),
  });
  return (
    <FormModal
      domain="기록"
      description={props.systemRecord
        ? "업무 변경 당시 정보는 유지하고 기록 내용을 수정합니다."
        : "메모·참고 자료·수행 결과를 작성하고 저장합니다."}
      title={props.title}
      submitLabel={props.submitLabel}
      open={props.open}
      dirty={dirty}
      deletion={props.deletion}
      onClose={props.onClose}
      onRouteDiscard={props.onRouteDiscard}
      validate={() => {
        if (draft.occurred_at && !recordDraftTime(draft, timezone)) {
          return {
            occurred_at: "선택한 시간대에서 존재하지 않는 시각입니다. 다른 시각을 입력하세요.",
          };
        }
        const r = recordCreate.safeParse(value());
        return r.success ? null : fieldErrors(r.error.issues);
      }}
      onSubmit={(requestKey) => {
        const parsed = recordCreate.parse(value());
        return props.onSave(props.systemRecord ? { body: parsed.body } : parsed, requestKey);
      }}
    >
      {(errors) => (
        <>
          {props.intro}
          <section className="detail-section form">
            <Field label="본문" required error={errors.body}>
              {(p) => (
                <textarea
                  {...p}
                  className="input"
                  rows={8}
                  placeholder="내용과 근거를 작성하세요 (마크다운)"
                  value={draft.body}
                  onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
                />
              )}
            </Field>
          </section>
          {!props.systemRecord && (
            <section className="detail-section form">
              <TagPicker
                value={draft.tag_ids}
                error={errors.tag_ids}
                onChange={(tag_ids) => setDraft((d) => ({ ...d, tag_ids }))}
              />
              {!props.editing && props.taskEditable !== false && props.entityEditable !== false && (
                <RelationPicker
                  kind="task"
                  value={draft.task_id ? [draft.task_id] : []}
                  error={errors.task_id}
                  onChange={(ids) => setDraft((d) => ({ ...d, task_id: ids[0] }))}
                />
              )}
              {!props.editing && props.entityEditable !== false && (
                <EntityMultiPicker
                  value={draft.entity_ids ?? []}
                  context={draft.entity_context}
                  error={errors.entity_ids}
                  onChange={(entity_ids) => setDraft((d) => ({ ...d, entity_ids }))}
                />
              )}
              <Field label={recordLabels.occurred_at} error={errors.occurred_at}>
                {(p) => (
                  <input
                    {...p}
                    className="input"
                    type="datetime-local"
                    value={draft.occurred_at}
                    onChange={(e) => setDraft((prev) => ({ ...prev, occurred_at: e.target.value }))}
                  />
                )}
              </Field>
            </section>
          )}
          {props.details}
        </>
      )}
    </FormModal>
  );
}

// ---------- 할 일 폼(작성·편집) ----------

export interface TaskDraft extends TextDraft {
  entity_ids?: string[];
  entity_context?: EntityContext[];
  tag_ids: string[];
  kind: "once" | "recurring";
  due_on: string;
  freq: Recurrence["freq"];
  weekdays: number[];
  month_days: string; // 쉼표로 구분
  starts_on: string;
  timezone: string;
}

export function emptyTask(tz = browserTimezone()): TaskDraft {
  return {
    kind: "once",
    tag_ids: [],
    title: "",
    body: "",
    due_on: "",
    freq: "daily",
    weekdays: [],
    month_days: "",
    starts_on: todayIn(tz),
    timezone: tz,
  };
}

export function taskDraftFrom(t: {
  entity_ids?: string[];
  entity_context?: EntityContext[];
  tag_ids: string[];
  kind: "once" | "recurring";
  title: string;
  body: string;
  due_on: string | null;
  recurrence: Recurrence | null;
  timezone: string | null;
}, timezone = browserTimezone()): TaskDraft {
  const base = emptyTask(timezone);
  const r = t.recurrence;
  return {
    ...base,
    entity_ids: t.entity_ids ?? [],
    entity_context: t.entity_context ?? [],
    kind: t.kind,
    tag_ids: t.tag_ids,
    title: t.title,
    body: t.body,
    due_on: t.due_on ?? "",
    freq: r?.freq ?? "daily",
    weekdays: r?.freq === "weekly" ? r.weekdays : [],
    month_days: r?.freq === "monthly" ? r.month_days.join(", ") : "",
    starts_on: r?.starts_on ?? base.starts_on,
    timezone: t.timezone ?? base.timezone,
  };
}

function recurrenceOf(d: TaskDraft): unknown {
  if (d.freq === "weekly") return { freq: "weekly", weekdays: d.weekdays, starts_on: d.starts_on };
  if (d.freq === "monthly") {
    const days = d.month_days.split(/[,\s]+/).filter(Boolean).map(Number);
    return { freq: "monthly", month_days: days, starts_on: d.starts_on };
  }
  return { freq: "daily", starts_on: d.starts_on };
}

// Both memo preparation and the write use the same business input. Relations are edited separately.
function taskInput(draft: TaskDraft, mode: "create" | "edit"): Record<string, unknown> {
  const text = { title: draft.title, body: draft.body, tag_ids: draft.tag_ids };
  const input = draft.kind === "once"
    ? { ...text, ...(draft.due_on ? { due_on: draft.due_on } : mode === "edit" ? { due_on: null } : {}) }
    : { ...text, recurrence: recurrenceOf(draft), timezone: draft.timezone };
  return mode === "create" ? { ...input, kind: draft.kind, entity_ids: draft.entity_ids ?? [] } : input;
}

export function TaskFormModal(
  props: {
    open: boolean;
    initial: TaskDraft;
    details?: ReactNode;
    deletion?: DeletionOptions;
    onClose: () => void;
    onRouteDiscard?: () => void;
    // The caller wraps this operation to retain its read cancellation and confirmed-value lifetime.
    onSave: (save: () => Promise<TaskResult>) => Promise<void>;
  } & ({ mode: "create"; target?: never } | { mode: "edit"; target: { id: string; version: number } }),
) {
  const [initial] = useState(props.initial);
  const [draft, setDraft] = useState(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  // 연속 입력이 앞선 변경을 덮지 않도록 항상 최신 초안에 합친다.
  const set = (patch: Partial<TaskDraft> | ((d: TaskDraft) => Partial<TaskDraft>)) =>
    setDraft((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));
  return (
    <FormModal
      domain="할 일"
      description={props.mode === "create"
        ? "내용과 일정을 정하고, 관련 자료와 태그를 연결합니다."
        : "할 일의 내용과 태그를 수정합니다."}
      title={props.mode === "create" ? "할 일 추가" : "할 일 편집"}
      mutation={{ target: draft.title, action: props.mode === "create" ? "등록" : "수정" }}
      preparation={() => ({
        model: "task",
        action: props.mode === "create" ? "create" : "update",
        target_id: props.target?.id,
        expected_version: props.target?.version,
        input: taskInput(draft, props.mode),
      })}
      submitLabel={props.mode === "create" ? "추가" : "저장"}
      open={props.open}
      dirty={dirty}
      deletion={props.deletion}
      onClose={props.onClose}
      onRouteDiscard={props.onRouteDiscard}
      validate={() => {
        const input = taskInput(draft, "create");
        const r = (draft.kind === "once" ? taskCreate.options[0] : taskCreate.options[1]).safeParse(input);
        if (r.success) return null;
        const errs = fieldErrors(r.error.issues);
        // 반복 규칙 하위 오류는 해당 입력 옆에 보인다.
        for (const [k, v] of Object.entries(errs)) {
          if (k.startsWith("recurrence.")) errs[k.slice(11).split(".")[0]] ??= v;
        }
        return errs;
      }}
      onSubmit={(requestKey, memo) => {
        const input = { ...taskInput(draft, props.mode), ...memo };
        const save = props.mode === "create"
          ? () => api<TaskResult>("POST", "/tasks", input, undefined, requestKey())
          : () =>
            api<TaskResult>(
              "PATCH",
              `/tasks/${props.target.id}`,
              { ...input, expected_version: props.target.version },
              undefined,
              requestKey(),
            );
        return props.onSave(save);
      }}
    >
      {(errors) => (
        <>
          {props.mode === "create" && (
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">{taskLabels.kind}</legend>
              <div className="chips">
                {(["once", "recurring"] as const).map((k) => (
                  <label key={k} className="chip choice-chip">
                    <input type="radio" name="task-kind" checked={draft.kind === k} onChange={() => set({ kind: k })} />
                    {taskLabels[k]}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <TextFields draft={draft} set={set} errors={errors} />
          <section className="detail-section form">
            {props.mode === "create" && (
              <EntityMultiPicker
                value={draft.entity_ids ?? []}
                context={draft.entity_context}
                error={errors.entity_ids}
                onChange={(entity_ids) => set({ entity_ids })}
              />
            )}
            <TagPicker
              scope="task"
              value={draft.tag_ids}
              error={errors.tag_ids}
              onChange={(tag_ids) => set({ tag_ids })}
            />
          </section>
          <section className="detail-section form">
            {draft.kind === "once"
              ? (
                <Field label={taskLabels.due_on} error={errors.due_on}>
                  {(p) => (
                    <input
                      {...p}
                      className="input"
                      type="date"
                      value={draft.due_on}
                      onChange={(e) => set({ due_on: e.target.value })}
                    />
                  )}
                </Field>
              )
              : (
                <>
                  <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                    <legend className="label">{taskLabels.recurrence}</legend>
                    <div className="chips">
                      {(["daily", "weekly", "monthly"] as const).map((f) => (
                        <label key={f} className="chip choice-chip">
                          <input
                            type="radio"
                            name="task-frequency"
                            checked={draft.freq === f}
                            onChange={() => set({ freq: f })}
                          />
                          {taskLabels[f]}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  {draft.freq === "weekly" && (
                    <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                      <legend className="label">{taskLabels.weekdays}</legend>
                      <div className="chips">
                        {WEEKDAYS.map((w, i) => {
                          const day = i + 1;
                          const on = draft.weekdays.includes(day);
                          return (
                            <button
                              key={w}
                              type="button"
                              className="chip"
                              aria-pressed={on}
                              onClick={() =>
                                set((d) => ({
                                  weekdays: d.weekdays.includes(day)
                                    ? d.weekdays.filter((x) => x !== day)
                                    : [...d.weekdays, day],
                                }))}
                            >
                              {w}
                            </button>
                          );
                        })}
                      </div>
                      {errors.weekdays && <p className="error-text" style={{ margin: 0 }}>{errors.weekdays}</p>}
                    </fieldset>
                  )}
                  {draft.freq === "monthly" && (
                    <Field
                      label={taskLabels.month_days}
                      error={errors.month_days}
                      help="해당 달에 없는 날짜는 마지막 날로 옮깁니다. 같은 날로 겹치면 회차 하나입니다."
                    >
                      {(p) => (
                        <input
                          {...p}
                          className="input"
                          placeholder="예: 1, 15, 31"
                          inputMode="text"
                          value={draft.month_days}
                          onChange={(e) => set({ month_days: e.target.value })}
                        />
                      )}
                    </Field>
                  )}
                  <div className="field-row">
                    <Field label={taskLabels.starts_on} required error={errors.starts_on}>
                      {(p) => (
                        <input
                          {...p}
                          className="input"
                          type="date"
                          value={draft.starts_on}
                          onChange={(e) => set({ starts_on: e.target.value })}
                        />
                      )}
                    </Field>
                    <Field label={taskLabels.timezone} required error={errors.timezone}>
                      {(p) => (
                        <TimezoneSelect
                          {...p}
                          value={draft.timezone}
                          onChange={(e) => set({ timezone: e.target.value })}
                        />
                      )}
                    </Field>
                  </div>
                </>
              )}
          </section>
          {props.details}
        </>
      )}
    </FormModal>
  );
}
