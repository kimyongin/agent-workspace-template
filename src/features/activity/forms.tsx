// 할 일·기록 작성/편집 폼. 검증은 서버와 같은 contracts로 하고, 저장 실패 시 초안을 유지한다.
import { recordCreate, recordLabels } from "@contracts/record.ts";
import { type Recurrence, taskCreate, taskLabels } from "@contracts/task.ts";
import { type FormEvent, type ReactNode, useState } from "react";
import { Field, Notice } from "../../components/Field.tsx";
import { ModalShell } from "../../components/Modal.tsx";
import { ApiError, isUncertain } from "../../lib/api.ts";
import { browserTimezone, fieldErrors, fromLocalInput, todayIn, toLocalInput } from "../../lib/format.ts";

export interface TextDraft {
  title: string;
  summary: string;
  body: string;
}

const WEEKDAYS = ["월", "화", "수", "목", "금", "토", "일"];

function saveErrorMessage(e: unknown): string {
  if (isUncertain(e)) {
    return "응답을 받지 못해 저장 여부를 알 수 없습니다. 같은 내용으로 다시 시도하면 중복 없이 결과를 확인합니다.";
  }
  if (e instanceof ApiError) {
    if (e.code === "conflict") return `${e.message} 화면을 닫고 다시 연 뒤 시도하세요.`;
    return e.message;
  }
  return "저장하지 못했습니다.";
}

function serverFieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError ? Object.fromEntries(e.fields.map((f) => [f.path, f.message])) : {};
}

/** 제목·요약·본문 입력 묶음. */
function TextFields(
  { draft, set, errors }: { draft: TextDraft; set: (patch: Partial<TextDraft>) => void; errors: Record<string, string> },
) {
  return (
    <>
      <Field label={recordLabels.title} required error={errors.title} help="핵심 대상과 행동 또는 결론, 100자 이하">
        {(p) => <input {...p} className="input" value={draft.title} onChange={(e) => set({ title: e.target.value })} />}
      </Field>
      <Field label={recordLabels.summary} required error={errors.summary} help="나중에 검색할 때 쓰는 요약, 300자 이하">
        {(p) => (
          <textarea {...p} className="input" rows={3} value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
        )}
      </Field>
      <Field label={recordLabels.body} error={errors.body} help="상세 근거·결과(마크다운)">
        {(p) => (
          <textarea {...p} className="input" rows={8} value={draft.body} onChange={(e) => set({ body: e.target.value })} />
        )}
      </Field>
    </>
  );
}

interface FormModalProps {
  title: string;
  open: boolean;
  submitLabel: string;
  dirty: boolean;
  onClose: () => void;
  /** 검증·저장. 실패하면 throw하고 초안은 유지된다. */
  onSubmit: () => Promise<void>;
  validate: () => Record<string, string> | null;
  children: (errors: Record<string, string>) => ReactNode;
}

function FormModal({ title, open, submitLabel, dirty, onClose, onSubmit, validate, children }: FormModalProps) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const formId = `form-${title.replace(/\s/g, "-")}`;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const local = validate();
    setErrors(local ?? {});
    if (local) return setFailure("입력을 확인하세요.");
    setBusy(true);
    setFailure(null);
    try {
      await onSubmit();
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFailure(saveErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ModalShell
      title={title}
      open={open}
      dirty={dirty}
      busy={busy}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>취소</button>
          <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>
            {busy ? "저장 중…" : submitLabel}
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="form"
        onSubmit={submit}
        noValidate
        onKeyDown={(e) => {
          // 저장 버튼이 폼 밖(대화상자 아래)에 있어 브라우저의 Enter 제출이 동작하지 않으므로 직접 제출한다.
          // 한 줄 입력에서만, 한글 조합 중의 Enter는 제외한다.
          const target = e.target as HTMLElement;
          if (e.key !== "Enter" || e.nativeEvent.isComposing || target.tagName !== "INPUT") return;
          if ((target as HTMLInputElement).type === "checkbox" || (target as HTMLInputElement).type === "radio") return;
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }}
      >
        {failure && <Notice kind="error">{failure}</Notice>}
        {children(errors)}
      </form>
    </ModalShell>
  );
}

// ---------- 기록 폼(직접 작성·완료 결과·회차 기록·편집) ----------

export interface RecordDraft extends TextDraft {
  occurred_at: string; // datetime-local
}

export const emptyRecord = (): RecordDraft => ({ title: "", summary: "", body: "", occurred_at: "" });

export function recordDraftFrom(r: { title: string; summary: string; body: string; occurred_at: string }): RecordDraft {
  return { title: r.title, summary: r.summary, body: r.body, occurred_at: toLocalInput(r.occurred_at) };
}

export function RecordFormModal(props: {
  title: string;
  submitLabel: string;
  open: boolean;
  initial: RecordDraft;
  intro?: ReactNode;
  onClose: () => void;
  onSave: (value: { title: string; summary: string; body: string; occurred_at?: string }) => Promise<void>;
}) {
  const [draft, setDraft] = useState(props.initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(props.initial);
  const value = () => ({
    title: draft.title,
    summary: draft.summary,
    body: draft.body,
    occurred_at: fromLocalInput(draft.occurred_at),
  });
  return (
    <FormModal
      title={props.title}
      submitLabel={props.submitLabel}
      open={props.open}
      dirty={dirty}
      onClose={props.onClose}
      validate={() => {
        const r = recordCreate.safeParse(value());
        return r.success ? null : fieldErrors(r.error.issues);
      }}
      onSubmit={() => props.onSave(recordCreate.parse(value()))}
    >
      {(errors) => (
        <>
          {props.intro}
          <TextFields draft={draft} set={(d) => setDraft((prev) => ({ ...prev, ...d }))} errors={errors} />
          <Field label={recordLabels.occurred_at} error={errors.occurred_at} help="비우면 저장한 시각">
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
        </>
      )}
    </FormModal>
  );
}

// ---------- 할 일 폼(작성·편집) ----------

export interface TaskDraft extends TextDraft {
  kind: "once" | "recurring";
  due_on: string;
  freq: Recurrence["freq"];
  weekdays: number[];
  month_days: string; // 쉼표로 구분
  starts_on: string;
  timezone: string;
}

export function emptyTask(): TaskDraft {
  const tz = browserTimezone();
  return {
    kind: "once",
    title: "",
    summary: "",
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
  kind: "once" | "recurring";
  title: string;
  summary: string;
  body: string;
  due_on: string | null;
  recurrence: Recurrence | null;
  timezone: string | null;
}): TaskDraft {
  const base = emptyTask();
  const r = t.recurrence;
  return {
    ...base,
    kind: t.kind,
    title: t.title,
    summary: t.summary,
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

/** 생성 입력(contracts의 taskCreate 모양). */
export function taskInput(d: TaskDraft): Record<string, unknown> {
  const text = { title: d.title, summary: d.summary, body: d.body };
  return d.kind === "once"
    ? { kind: "once", ...text, ...(d.due_on ? { due_on: d.due_on } : {}) }
    : { kind: "recurring", ...text, recurrence: recurrenceOf(d), timezone: d.timezone };
}

export function TaskFormModal(props: {
  mode: "create" | "edit";
  open: boolean;
  initial: TaskDraft;
  onClose: () => void;
  onSave: (draft: TaskDraft) => Promise<void>;
}) {
  const [draft, setDraft] = useState(props.initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(props.initial);
  // 연속 입력이 앞선 변경을 덮지 않도록 항상 최신 초안에 합친다.
  const set = (patch: Partial<TaskDraft> | ((d: TaskDraft) => Partial<TaskDraft>)) =>
    setDraft((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));
  return (
    <FormModal
      title={props.mode === "create" ? "할 일 추가" : "할 일 편집"}
      submitLabel={props.mode === "create" ? "추가" : "저장"}
      open={props.open}
      dirty={dirty}
      onClose={props.onClose}
      validate={() => {
        const r = taskCreate.safeParse(taskInput(draft));
        if (r.success) return null;
        const errs = fieldErrors(r.error.issues);
        // 반복 규칙 하위 오류는 해당 입력 옆에 보인다.
        for (const [k, v] of Object.entries(errs)) if (k.startsWith("recurrence.")) errs[k.slice(11)] ??= v;
        return errs;
      }}
      onSubmit={() => props.onSave(draft)}
    >
      {(errors) => (
        <>
          {props.mode === "create" && (
            <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="label">{taskLabels.kind}</legend>
              <div className="chips">
                {(["once", "recurring"] as const).map((k) => (
                  <button key={k} type="button" className="chip" aria-pressed={draft.kind === k} onClick={() => set({ kind: k })}>
                    {taskLabels[k]}
                  </button>
                ))}
              </div>
              {draft.kind === "recurring" && (
                <p className="help" style={{ margin: 0 }}>
                  반복 할 일은 회차마다 기록을 남깁니다. 앱이 자동으로 실행하거나 알림을 보내지 않습니다.
                </p>
              )}
            </fieldset>
          )}
          <TextFields draft={draft} set={set} errors={errors} />
          {draft.kind === "once"
            ? (
              <Field label={taskLabels.due_on} error={errors.due_on} help="알림은 없습니다">
                {(p) => <input {...p} className="input" type="date" value={draft.due_on} onChange={(e) => set({ due_on: e.target.value })} />}
              </Field>
            )
            : (
              <>
                <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
                  <legend className="label">{taskLabels.recurrence}</legend>
                  <div className="chips">
                    {(["daily", "weekly", "monthly"] as const).map((f) => (
                      <button key={f} type="button" className="chip" aria-pressed={draft.freq === f} onClick={() => set({ freq: f })}>
                        {taskLabels[f]}
                      </button>
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
                                weekdays: d.weekdays.includes(day) ? d.weekdays.filter((x) => x !== day) : [...d.weekdays, day],
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
                  <Field label={taskLabels.month_days} error={errors.month_days} help="1~31, 쉼표로 구분. 그 달에 없는 날짜는 말일로 계산합니다">
                    {(p) => (
                      <input {...p} className="input" inputMode="numeric" value={draft.month_days} onChange={(e) => set({ month_days: e.target.value })} />
                    )}
                  </Field>
                )}
                <div className="field-row">
                  <Field label={taskLabels.starts_on} required error={errors.starts_on}>
                    {(p) => (
                      <input {...p} className="input" type="date" value={draft.starts_on} onChange={(e) => set({ starts_on: e.target.value })} />
                    )}
                  </Field>
                  <Field label={taskLabels.timezone} required error={errors.timezone} help="오늘과 회차 날짜의 기준">
                    {(p) => <input {...p} className="input" value={draft.timezone} onChange={(e) => set({ timezone: e.target.value })} />}
                  </Field>
                </div>
              </>
            )}
        </>
      )}
    </FormModal>
  );
}
