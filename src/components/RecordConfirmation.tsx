import { useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SurfaceActionContext } from "./Modal.tsx";
import { changeNoteErrors } from "./change-note.ts";
import { ApiError } from "../lib/api-error.ts";
import { useWriteAttempt, writeErrorMessage } from "../lib/write-attempt.ts";
import { Field, Notice } from "./Field.tsx";
import { TagPicker } from "../features/tags/TagPicker.tsx";

export interface RecordMemo { change_note?: string; change_tag_ids?: string[] }
function RecordMemoFields({note, tags, onNote, onTags, errors, failure, frozen, message, record=true, excludeTag}: {
  note: string; tags: string[]; onNote: (value: string) => void; onTags: (value: string[]) => void;
  errors: Record<string,string>; failure?: string | null; frozen: boolean; message?: ReactNode; record?: boolean; excludeTag?: string;
}) {
  return <div className="form">
    {message && <div className="secondary action-explanation">{message}</div>}
    {failure && <Notice kind="error">{failure}</Notice>}
    {record && <fieldset disabled={frozen} className="form plain-fieldset">
      <Field label="기록 메모" error={errors.change_note}>{p => <textarea {...p} className="input" rows={4} value={note} onChange={e=>onNote(e.target.value)} placeholder="변경 내용과 이유를 작성하세요"/>}</Field>
      <TagPicker label="기록 태그" value={tags} error={errors.change_tag_ids} onChange={onTags} excludeId={excludeTag}/>
    </fieldset>}
  </div>;
}


type ConfirmationKind = "save" | "delete";
interface ConfirmationDescription {
  title: string;
  label: string;
  defaultNote: string;
  message?: ReactNode;
  record: boolean;
  danger?: boolean;
  excludeTag?: string;
  pendingLabel?: string;
  execute: (creationId: () => string, memo: RecordMemo) => void | Promise<void>;
}

/** One confirmation lifetime owns memo drafts, errors, frozen retries and its dialog stage. */
export function useRecordConfirmation(options: {
  open?: boolean;
  initial?: ConfirmationKind;
  describe: (kind: ConfirmationKind) => ConfirmationDescription;
  onCancel?: () => void;
  closeOnSuccess?: boolean;
  clearOnCancel?: boolean;
}) {
  const latest = useRef(options);
  latest.current = options;
  const { attempt, busy, uncertain } = useWriteAttempt();
  const register = useContext(SurfaceActionContext);
  const [stage, setStage] = useState<ConfirmationKind | null>(options.initial ?? null);
  const [note, setNote] = useState(() => options.initial ? options.describe(options.initial).defaultNote : "");
  const [tags, setTags] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const touched = useRef(false);
  const reject = (fields: Record<string, string>, message: string | null) => {
    setErrors(fields);
    setFailure(message);
  };
  const begin = (kind: ConfirmationKind) => {
    if (attempt.snapshot().busy) return;
    if (!touched.current && !attempt.snapshot().uncertain) setNote(latest.current.describe(kind).defaultNote);
    setStage(kind);
    reject({}, null);
  };
  const cancel = () => {
    if (attempt.snapshot().busy) return;
    if (latest.current.clearOnCancel) reject({}, null);
    if (latest.current.onCancel) latest.current.onCancel();
    else setStage(null);
  };
  const write = async (kind: ConfirmationKind) => {
    if (attempt.snapshot().busy) return;
    const description = latest.current.describe(kind);
    const local = description.record ? changeNoteErrors(note, false) : null;
    reject(local ?? {}, null);
    if (local) return;
    const memo = { change_note: note.trim() ? note : undefined, change_tag_ids: [...tags] };
    const execute = description.execute;
    try {
      // Capture the actual operation and memo. WriteAttempt retains this closure on uncertainty.
      await attempt.run(async () => { await execute(attempt.creationId, memo); });
      if (latest.current.closeOnSuccess) setStage(null);
    } catch (error) {
      reject(error instanceof ApiError ? Object.fromEntries(error.fields.map(field => [field.path, field.message])) : {}, writeErrorMessage(error));
    }
  };
  const description = stage ? options.describe(stage) : null;
  useLayoutEffect(() => {
    if (!register || options.open === false || !stage || !description) return;
    register({
      title: description.title, busy,
      body: <RecordMemoFields note={note} tags={tags} onNote={value => { touched.current = true; setNote(value); }} onTags={setTags}
        errors={errors} failure={failure} frozen={busy || uncertain} record={description.record}
        message={description.message} excludeTag={description.excludeTag}/>,
      footer: <><button type="button" className="btn" disabled={busy} onClick={cancel}>취소</button>
        <button type="button" className={description.danger ? "btn btn-danger" : "btn btn-primary"} disabled={busy} onClick={() => void write(stage)}>
          {busy ? description.pendingLabel ?? "처리 중…" : uncertain ? "같은 내용 다시 시도" : description.label}
        </button></>,
      onCancel: cancel,
    });
    return () => register(null);
  }, [register, options.open, stage, note, tags, errors, failure, busy, uncertain,
    description?.title, description?.label, description?.record, description?.danger, description?.excludeTag]);
  return { active: stage !== null, dirty: !!stage || touched.current || !!tags.length || uncertain,
    busy, uncertain, errors, failure, begin, write, reject };
}
