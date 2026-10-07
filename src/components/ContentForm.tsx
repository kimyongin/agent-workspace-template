// 할 일·기록·원칙에서 함께 쓰는 내용 입력과 저장 실패·미저장 보호.
import { RecordConfirmation, type RecordMemo } from "./RecordConfirmation.tsx";
import { changeNoteErrors } from "./change-note.ts";
import { contentLabels } from "@contracts/common.ts";
import { type FormEvent, type ReactNode, useCallback, useContext, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Field, Notice } from "./Field.tsx";
import { ModalShell, SurfaceContext, SurfaceActionContext } from "./Modal.tsx";
import { ApiError } from "../lib/api-error.ts";
import { useWriteAttempt, writeErrorMessage } from "../lib/write-attempt.ts";
import { type DeletionOptions } from "./DeleteAction.tsx";

export interface TextDraft {
  title: string;
  body: string;
}

function serverFieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError ? Object.fromEntries(e.fields.map((f) => [f.path, f.message])) : {};
}

/** 할 일·원칙의 제목과 본문 입력 묶음. */
export function TextFields(
  { draft, set, errors }: { draft: TextDraft; set: (patch: Partial<TextDraft>) => void; errors: Record<string, string> },
) {
  return (
    <>
      <section className="detail-section form">
      <Field label={contentLabels.title} required error={errors.title}>
        {(p) => <input {...p} className="input" placeholder="대상과 행동 또는 결론" value={draft.title} onChange={(e) => set({ title: e.target.value })} />}
      </Field>
      <Field label={contentLabels.body} error={errors.body}>
        {(p) => (
          <textarea {...p} className="input" rows={8} placeholder="상세 내용과 근거를 작성하세요 (마크다운)" value={draft.body} onChange={(e) => set({ body: e.target.value })} />
        )}
      </Field>
      </section>
    </>
  );
}

interface FormModalProps {
  title: string;
  open: boolean;
  submitLabel: string;
  dirty: boolean;
  onClose: () => void;
  onRouteDiscard?: () => void;
  onSubmit: (creationId: () => string, memo: RecordMemo) => Promise<void>;
  validate: () => Record<string, string> | null;
  children: (errors: Record<string, string>) => ReactNode;
  deletion?: DeletionOptions;
  mutation?: { target: string; action: "등록" | "수정" | "중단" | "재개"; message?: ReactNode };
  confirmationOnly?: boolean;
}
interface Presentation { dirty: boolean; busy: boolean; footer: ReactNode }

export function FormModal(props: FormModalProps) {
  const surface = useContext(SurfaceContext);
  const [presentation, setPresentation] = useState<Presentation>({dirty: props.dirty, busy: false, footer: null});
  const present = useCallback((value: Presentation) => setPresentation(value), []);
  if (surface) return <FormContents {...props}/>;
  return <ModalShell open={props.open} title={props.title} dirty={props.dirty || presentation.dirty} busy={presentation.busy}
    onClose={props.onClose} onRouteDiscard={props.onRouteDiscard} footer={presentation.footer}>
    <FormContents {...props} present={present}/>
  </ModalShell>;
}

function FormContents({title, open, submitLabel, dirty, onClose, onRouteDiscard, onSubmit, validate, children, deletion, mutation, confirmationOnly, present}: FormModalProps & {present?: (value: Presentation)=>void}) {
  const {attempt, busy, uncertain} = useWriteAttempt();
  const [errors, setErrors] = useState<Record<string,string>>({});
  const [failure, setFailure] = useState<string|null>(null);
  const [stage, setStage] = useState<"save"|"delete"|null>(confirmationOnly ? "save" : null);
  const [note, setNote] = useState(confirmationOnly && mutation ? `${mutation.target} ${mutation.action}` : "");
  const [tags, setTags] = useState<string[]>([]);
  const memoTouched = useRef(false);
  const formId = useId();
  const surface = useContext(SurfaceContext), registerAction = useContext(SurfaceActionContext);
  const callbacks = useRef({onClose,onRouteDiscard,onSubmit,validate,deletion,mutation});
  callbacks.current = {onClose,onRouteDiscard,onSubmit,validate,deletion,mutation};
  const cancel = () => {
    if (attempt.snapshot().busy) return;
    if (confirmationOnly) return callbacks.current.onClose();
    setStage(null);
  };
  const write = async (kind: "save"|"delete") => {
    if (attempt.snapshot().busy) return;
    const local = mutation || kind === "delete" ? changeNoteErrors(note, false) : null;
    setErrors(local ?? {});
    if (local) return;
    setFailure(null);
    const memo = {change_note: note.trim() ? note : undefined, change_tag_ids: [...tags]};
    const submitOperation = callbacks.current.onSubmit, deleteOperation = callbacks.current.deletion?.onConfirm;
    try {
      await attempt.run(async () => {
        if (kind === "delete") await deleteOperation!(memo.change_note ?? "", memo.change_tag_ids);
        else await submitOperation(attempt.creationId, memo);
      });
    } catch (error) { setErrors(serverFieldErrors(error)); setFailure(writeErrorMessage(error)); }
  };
  const begin = (kind: "save"|"delete") => {
    if (attempt.snapshot().busy) return;
    if (!memoTouched.current) setNote(`${mutation?.target ?? title} ${kind === "delete" ? "삭제" : mutation?.action ?? "수정"}`);
    setStage(kind); setFailure(null); setErrors({});
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || stage) return;
    const local = callbacks.current.validate(); setErrors(local ?? {});
    if (local) return setFailure("입력을 확인하세요.");
    if (mutation) begin("save"); else await write("save");
  };
  const footer = <>
    {deletion && !uncertain && <button type="button" className="btn btn-text delete-trigger" disabled={busy} onClick={()=>begin("delete")}>삭제</button>}
    <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? "처리 중…" : uncertain ? "같은 내용 다시 시도" : submitLabel}</button>
  </>;
  const register = surface?.register;
  useLayoutEffect(() => {
    if (!open) return;
    const presentation = {dirty: dirty || uncertain || !!stage || memoTouched.current || !!tags.length, busy, footer};
    if (register) register({title, ...presentation,
      onClose: ()=>callbacks.current.onClose(), onRouteDiscard: ()=>(callbacks.current.onRouteDiscard ?? callbacks.current.onClose)()});
    else present?.(presentation);
    return () => { register?.(null); };
  }, [register,present,open,title,dirty,uncertain,busy,stage,formId,submitLabel,!!deletion,note,tags]);
  useLayoutEffect(() => {
    if (!registerAction || !open || !stage) return;
    const action = stage === "delete" ? "삭제" : mutation?.action ?? "저장";
    registerAction({title: `‘${mutation?.target ?? title}’${action === "등록" ? "을 등록" : `을 ${action}`}하시겠습니까?`, busy,
      body: <RecordConfirmation note={note} tags={tags} onNote={value=>{memoTouched.current=true;setNote(value);}} onTags={setTags}
        errors={errors} failure={failure} frozen={busy || uncertain} record={stage !== "delete" || deletion?.note !== false}
        message={stage === "delete" ? deletion?.message : mutation?.message}/>,
      footer: <><button type="button" className="btn btn-text" disabled={busy} onClick={cancel}>취소</button>
        <button type="button" className={stage === "delete" ? "btn btn-danger" : "btn btn-primary"} disabled={busy} onClick={()=>void write(stage)}>
          {busy ? "처리 중…" : uncertain ? "같은 내용 다시 시도" : stage === "delete" ? "삭제하고 기록" : `${action}하고 저장`}
        </button></>, onCancel: cancel});
    return () => registerAction(null);
  }, [registerAction,open,stage,note,tags,errors,failure,busy,uncertain,mutation?.target,mutation?.action]);
  const form = <form id={formId} className="form" onSubmit={submit} noValidate>
    {failure && !stage && <Notice kind="error">{failure}</Notice>}
    <fieldset disabled={busy || uncertain || !!stage} className="form plain-fieldset">{children(errors)}</fieldset>
  </form>;
  useLayoutEffect(() => {
    if (!stage && Object.keys(errors).length) document.getElementById(formId)?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [errors,formId,stage]);
  useLayoutEffect(() => { if(surface?.slot && open) surface.slot.querySelector<HTMLElement>("input,textarea,select,button")?.focus(); }, [surface?.slot,open]);
  return surface ? surface.slot && open ? createPortal(form, surface.slot) : null : form;
}
