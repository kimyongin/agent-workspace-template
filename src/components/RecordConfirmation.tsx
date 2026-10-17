import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SurfaceActionContext, SurfaceContext } from "./Modal.tsx";
import { changeNoteErrors } from "./change-note.ts";
import { ApiError } from "../lib/api-error.ts";
import { useWriteAttempt, writeErrorMessage } from "../lib/write-attempt.ts";
import { Field, Notice } from "./Field.tsx";
import { TagPicker } from "../features/tags/TagPicker.tsx";
import type { PrepareRecordMemo, PreparedRecordMemo } from "@contracts/record-preparation.ts";
import { api } from "../lib/api.ts";
import { WorkspaceContext } from "../features/details/workspace-context.ts";

export type ConfirmationValue = { label: string; value: ReactNode; fullWidth?: boolean };

export interface RecordMemo { change_note?: string; change_tag_ids?: string[] }
function RecordMemoFields({note, tags, onNote, onTags, errors, failure, frozen, message, data, record=true, excludeTag, preparing}: {
  preparing?: boolean;
  data?: ConfirmationValue[];
  note: string; tags: string[]; onNote: (value: string) => void; onTags: (value: string[]) => void;
  errors: Record<string,string>; failure?: string | null; frozen: boolean; message?: ReactNode; record?: boolean; excludeTag?: string;
}) {
  return <div className="form">
    {!!data?.length && <dl className="key-value-grid key-value-static">{data.map(({label,value,fullWidth}) => <div key={label} className={fullWidth ? "key-value-full" : undefined}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>}
    {message && <div className="action-explanation">{message}</div>}
    {failure && <Notice kind="error">{failure}</Notice>}
    {record && preparing && <p role="status" className="secondary">기록 메모 준비 중…</p>}
    {record && <fieldset disabled={frozen} className="form plain-fieldset key-value-grid">
      <Field pair fullWidth label="기록 메모" error={errors.change_note}>{p => <textarea {...p} className="input" rows={4} value={note} onChange={e=>onNote(e.target.value)} placeholder="변경 내용과 이유를 작성하세요"/>}</Field>
      <div className="key-value-full"><TagPicker label="기록 태그" value={tags} error={errors.change_tag_ids} onChange={onTags} excludeId={excludeTag}/></div>
    </fieldset>}
  </div>;
}


type ConfirmationKind = "save" | "delete";
interface ConfirmationDescription {
  title: string;
  label: string;
  defaultNote: string;
  preparation?: () => PrepareRecordMemo | Promise<PrepareRecordMemo>;
  onPrepared?: (result:PreparedRecordMemo) => void;
  message?: ReactNode;
  data?: ConfirmationValue[];
  record: boolean;
  danger?: boolean;
  excludeTag?: string;
  pendingLabel?: string;
  execute: (requestKey: () => string, memo: RecordMemo) => void | Promise<void>;
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
  const surface = useContext(SurfaceContext);
  const workspace = useContext(WorkspaceContext);
  const [stage, setStage] = useState<ConfirmationKind | null>(options.open === false ? null : options.initial ?? null);
  const [note, setNote] = useState(() => options.initial ? options.describe(options.initial).defaultNote : "");
  const [tags, setTags] = useState<string[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const touched = useRef({ note: false, tags: false });
  const [preparing, setPreparing] = useState(false);
  const preparationReady = useRef(false);
  const preparationRun = useRef(0);
  const reject = (fields: Record<string, string>, message: string | null) => {
    setErrors(fields);
    setFailure(message);
  };
  const begin = async (kind: ConfirmationKind) => {
    if (attempt.snapshot().busy || attempt.snapshot().uncertain) { setStage(kind); return; }
    setStage(kind);
    reject({}, null);
    const description = latest.current.describe(kind);
    if (!description.preparation || !description.record) {
      if (!touched.current.note) setNote(description.defaultNote);
      preparationReady.current = true;
      return;
    }
    const run = ++preparationRun.current;
    preparationReady.current = false;
    setPreparing(true);
    try {
      const request = await description.preparation();
      const result = await api<PreparedRecordMemo>("POST", "/records/prepare", request);
      if (run !== preparationRun.current) return;
      description.onPrepared?.(result);
      if (!touched.current.note) setNote(result.change_note);
      if (!touched.current.tags) setTags(result.change_tag_ids);
      preparationReady.current = true;
      if (result.missing_tag_ids.length) setFailure("삭제된 기본 기록 태그를 제외했습니다. 설정에서 정리하세요.");
    } catch (error) {
      if (run === preparationRun.current) {
        surface?.onError?.(error);
        reject(error instanceof ApiError ? Object.fromEntries(error.fields.map(field => [field.path, field.message])) : {}, failureMessage(error));
      }
    } finally { if (run === preparationRun.current) setPreparing(false); }
  };
  const failureMessage = (error: unknown) => {
    if (error instanceof ApiError && error.code === "conflict" && surface?.editor.current) {
      return `${error.message} 확인창을 취소한 뒤 편집을 취소하고 ‘변경 버리기’를 선택하면 최신 내용을 다시 조회합니다. 상세 패널 숨기기는 초안을 유지합니다. 탭 닫기에서 ‘변경 버리기’를 선택하면 초안을 버리며, 다시 열면 최신 내용을 조회합니다.`;
    }
    return writeErrorMessage(error);
  };
  useEffect(() => { if (options.initial && options.open !== false) void begin(options.initial); if(options.open===false){setStage(null);setPreparing(false);} return () => { preparationRun.current++; }; }, [options.initial, options.open]);
  const cancel = () => {
    if (attempt.snapshot().busy) return;
    if (latest.current.clearOnCancel) reject({}, null);
    if (latest.current.onCancel) latest.current.onCancel();
    else setStage(null);
  };
  const write = async (kind: ConfirmationKind) => {
    if (attempt.snapshot().busy || preparing) return;
    const description = latest.current.describe(kind);
    if (description.preparation && description.record && !preparationReady.current && !attempt.snapshot().uncertain) return;
    const local = description.record ? changeNoteErrors(note, false) : null;
    reject(local ?? {}, null);
    if (local) return;
    const memo = { change_note: note, change_tag_ids: [...tags] };
    const execute = description.execute;
    try {
      // Capture the actual operation and memo. WriteAttempt retains this closure on uncertainty.
      await attempt.run(async () => { await execute(attempt.requestKey, memo); });
      workspace?.saved();
      if (latest.current.closeOnSuccess) setStage(null);
    } catch (error) {
      surface?.onError?.(error);
      reject(error instanceof ApiError ? Object.fromEntries(error.fields.map(field => [field.path, field.message])) : {}, failureMessage(error));
    }
  };
  const description = stage ? options.describe(stage) : null;
  useLayoutEffect(() => {
    if (!register || options.open === false || !stage || !description) return;
    register({
      title: description.title, busy,
      body: <RecordMemoFields note={note} tags={tags} onNote={value => { touched.current.note = true; setNote(value); }} onTags={value => { touched.current.tags = true; setTags(value); }}
        preparing={preparing}
        errors={errors} failure={failure} frozen={busy || uncertain || preparing} record={description.record}
        data={description.data} message={description.message} excludeTag={description.excludeTag}/>,
      footer: <><button type="button" className="btn" disabled={busy} onClick={cancel}>{Object.keys(errors).some(key => key.startsWith("properties.")) ? "입력 수정" : "취소"}</button>
        <button type="button" className={description.danger ? "btn btn-danger" : "btn btn-primary"} disabled={busy || preparing || (!!description.preparation && !preparationReady.current && !uncertain)} onClick={() => void write(stage)}>
          {busy ? description.pendingLabel ?? "처리 중…" : uncertain ? "같은 내용 다시 시도" : description.label}
        </button></>,
      onCancel: cancel,
    });
    return () => register(null);
  }, [register, options.open, stage, note, tags, errors, failure, busy, uncertain, preparing,
    description?.title, description?.label, description?.record, description?.danger, description?.excludeTag]);
  return { active: stage !== null, dirty: !!stage || touched.current.note || touched.current.tags || !!tags.length || uncertain,
    busy, uncertain, errors, failure, begin, write, reject };
}
