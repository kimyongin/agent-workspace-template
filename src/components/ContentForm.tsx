// 할 일·기록·원칙에서 함께 쓰는 내용 입력과 저장 실패·미저장 보호.
import { contentLabels } from "@contracts/common.ts";
import { type FormEvent, type ReactNode, useContext, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Field, Notice } from "./Field.tsx";
import { ModalShell, SurfaceContext } from "./Modal.tsx";
import { ApiError } from "../lib/api-error.ts";
import { useWriteAttempt, writeErrorMessage } from "../lib/write-attempt.ts";
import { changeMemo, type ChangeMemo } from "@contracts/change.ts";

export interface TextDraft {
  title: string;
  summary: string;
  body: string;
}

function serverFieldErrors(e: unknown): Record<string, string> {
  return e instanceof ApiError ? Object.fromEntries(e.fields.map((f) => [f.path, f.message])) : {};
}

/** 제목·요약·본문 입력 묶음. */
export function TextFields(
  { draft, set, errors }: { draft: TextDraft; set: (patch: Partial<TextDraft>) => void; errors: Record<string, string> },
) {
  return (
    <>
      <section className="detail-section form"><h2 className="section-title">기본 정보</h2>
      <Field label={contentLabels.title} required error={errors.title}>
        {(p) => <input {...p} className="input" placeholder="대상과 행동 또는 결론" value={draft.title} onChange={(e) => set({ title: e.target.value })} />}
      </Field>
      <Field label={contentLabels.summary} required error={errors.summary}>
        {(p) => (
          <textarea {...p} className="input" rows={3} placeholder="핵심 내용을 짧게 요약하세요" value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
        )}
      </Field>
      </section><section className="detail-section form">
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
  /** 경로 폐기는 이동 없이 편집만 닫는다. onClose가 이동하면 별도 콜백이 필요하다. */
  onRouteDiscard?: () => void;
  /** 검증·저장. 실패하면 throw하고 초안은 유지된다. */
  onSubmit: (memo: ChangeMemo | undefined, creationId: () => string) => Promise<void>;
  prepare?: () => Promise<ChangeMemo>;
  previewKey?: string;
  validate: () => Record<string, string> | null;
  children: (errors: Record<string, string>) => ReactNode;
  onDelete?: () => void;
}

export function FormModal({ title, open, submitLabel, dirty, onClose, onRouteDiscard, onSubmit, prepare, previewKey, validate, children, onDelete }: FormModalProps) {
  const { attempt, busy, uncertain } = useWriteAttempt();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const formId = useId();
  const surface = useContext(SurfaceContext);
  const [memo, setMemo] = useState<ChangeMemo | null>(null);
  const memoTitle = useRef<HTMLInputElement>(null);
  const memoEditable = !!memo && !busy && !uncertain;
  useLayoutEffect(() => { if(open && memoEditable)memoTitle.current?.focus(); }, [open,memoEditable]);
  const key = useRef(previewKey);
  if(key.current!==previewKey){key.current=previewKey; if(memo)setMemo(null);}

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const local = validate();
    setErrors(local ?? {});
    if (local) return setFailure("입력을 확인하세요.");
    setFailure(null);
    try {
      await attempt.run(async () => {
      if(prepare&&!memo){setMemo(changeMemo.parse(await prepare()));return;}
      if(memo){const parsed=changeMemo.safeParse(memo);if(!parsed.success){setFailure("기록 메모의 제목·요약과 길이를 확인하세요.");return;}}
      await onSubmit(memo??undefined, attempt.creationId);
      }, !prepare || !!memo);
    } catch (err) {
      setErrors(serverFieldErrors(err));
      setFailure(prepare&&!memo ? `${err instanceof ApiError?err.message:"기본 메모를 불러오지 못했습니다."} 아직 저장하지 않았습니다.` : writeErrorMessage(err));
    }
  };

  const footer = <>
    {onDelete && <button type="button" className="btn btn-danger modal-delete" disabled={busy || uncertain} onClick={onDelete}>삭제</button>}
    <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? "처리 중…" : uncertain ? "같은 내용 다시 시도" : prepare ? memo ? "확인하고 저장" : "기록 메모 확인" : submitLabel}</button>
  </>;
  const callbacks = useRef({onClose, onRouteDiscard}); callbacks.current = {onClose, onRouteDiscard};
  const register = surface?.register;
  useLayoutEffect(() => {
    if (!register || !open) return;
    register({title, dirty: dirty || uncertain || !!memo, busy, footer,
      onClose: () => callbacks.current.onClose(), onRouteDiscard: () => (callbacks.current.onRouteDiscard ?? callbacks.current.onClose)()});
    return () => register(null);
  }, [register, open, title, dirty, uncertain, busy, formId, submitLabel, memo, prepare, onDelete]);
  const form = <form id={formId} className="form" onSubmit={submit} noValidate>
    {failure && <Notice kind="error">{failure}</Notice>}
    <fieldset disabled={busy || uncertain} style={{border:0,padding:0,margin:0,minWidth:0}} className="form">{children(errors)}
      {memo&&<section aria-label="저장할 기록 메모" className="detail-section change-memo form">
        <h2 className="section-title">변경 기록 메모</h2><p className="secondary">아직 저장하지 않았습니다. 메모를 확인한 뒤 변경과 함께 저장합니다.</p>
        <Field label="기록 제목" required>{p=><input {...p} ref={memoTitle} className="input" value={memo.title} onChange={e=>setMemo({...memo,title:e.target.value})}/>}</Field>
        <Field label="기록 요약" required>{p=><textarea {...p} className="input" rows={3} value={memo.summary} onChange={e=>setMemo({...memo,summary:e.target.value})}/>}</Field>
        <Field label="기록 본문">{p=><textarea {...p} className="input" rows={6} value={memo.body} onChange={e=>setMemo({...memo,body:e.target.value})}/>}</Field>
      </section>}
    </fieldset>
  </form>;
  useLayoutEffect(() => {
    if(Object.keys(errors).length)document.getElementById(formId)?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [errors,formId]);
  useLayoutEffect(() => { if(surface?.slot && open)surface.slot.querySelector<HTMLElement>("input,textarea,select,button")?.focus(); }, [surface?.slot, open]);
  if (surface) return surface.slot && open ? createPortal(form, surface.slot) : null;
  return (
    <ModalShell
      title={title}
      open={open}
      dirty={dirty || uncertain || !!memo}
      busy={busy}
      onClose={onClose}
      onRouteDiscard={onRouteDiscard}
      footer={footer}
    >
      {form}
    </ModalShell>
  );
}

export function ChangeNoteField({value, onChange, required = false, error, label}: {value: string; onChange: (value: string) => void; required?: boolean; error?: string;label?:string}) {
  return <Field label={label??(required ? "편집 메모" : "이유 (선택)")} required={required} error={error}>
    {p => <textarea {...p} className="input" rows={3} placeholder="변경 이유나 보충할 내용" value={value} onChange={e => onChange(e.target.value)} />}
  </Field>;
}

export { changeNoteErrors } from "./change-note.ts";
