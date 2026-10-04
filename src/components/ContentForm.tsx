// 할 일·기록·원칙에서 함께 쓰는 내용 입력과 저장 실패·미저장 보호.
import { contentLabels } from "@contracts/common.ts";
import { type FormEvent, type ReactNode, useContext, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Field, Notice } from "./Field.tsx";
import { ModalShell, SurfaceContext } from "./Modal.tsx";
import { ApiError, isUncertain } from "../lib/api.ts";

export interface TextDraft {
  title: string;
  summary: string;
  body: string;
}

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
export function TextFields(
  { draft, set, errors }: { draft: TextDraft; set: (patch: Partial<TextDraft>) => void; errors: Record<string, string> },
) {
  return (
    <>
      <Field label={contentLabels.title} required error={errors.title} help="핵심 대상과 행동 또는 결론, 100자 이하">
        {(p) => <input {...p} className="input" value={draft.title} onChange={(e) => set({ title: e.target.value })} />}
      </Field>
      <Field label={contentLabels.summary} required error={errors.summary} help="나중에 검색할 때 쓰는 요약, 300자 이하">
        {(p) => (
          <textarea {...p} className="input" rows={3} value={draft.summary} onChange={(e) => set({ summary: e.target.value })} />
        )}
      </Field>
      <Field label={contentLabels.body} error={errors.body} help="상세 근거·결과(마크다운)">
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
  /** 경로 폐기는 이동 없이 편집만 닫는다. onClose가 이동하면 별도 콜백이 필요하다. */
  onRouteDiscard?: () => void;
  /** 검증·저장. 실패하면 throw하고 초안은 유지된다. */
  onSubmit: () => Promise<void>;
  validate: () => Record<string, string> | null;
  children: (errors: Record<string, string>) => ReactNode;
}

export function FormModal({ title, open, submitLabel, dirty, onClose, onRouteDiscard, onSubmit, validate, children }: FormModalProps) {
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const formId = useId();
  const surface = useContext(SurfaceContext);
  const [uncertain, setUncertain] = useState(false);
  const submitting = useRef(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (submitting.current) return;
    const local = validate();
    setErrors(local ?? {});
    if (local) return setFailure("입력을 확인하세요.");
    submitting.current = true; setBusy(true);
    setFailure(null);
    try {
      await onSubmit();
    } catch (err) {
      setUncertain(isUncertain(err));
      setErrors(serverFieldErrors(err));
      setFailure(saveErrorMessage(err));
    } finally {
      submitting.current = false; setBusy(false);
    }
  };

  const footer = (requestClose: () => void) => <>
    <button type="button" className="btn" onClick={requestClose} disabled={busy}>취소</button>
    <button type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? "저장 중…" : uncertain ? "같은 내용 다시 시도" : submitLabel}</button>
  </>;
  const callbacks = useRef({onClose, onRouteDiscard}); callbacks.current = {onClose, onRouteDiscard};
  const register = surface?.register;
  useLayoutEffect(() => {
    if (!register || !open) return;
    register({title, dirty: dirty || uncertain, busy, footer,
      onClose: () => callbacks.current.onClose(), onRouteDiscard: () => (callbacks.current.onRouteDiscard ?? callbacks.current.onClose)()});
    return () => register(null);
  }, [register, open, title, dirty, uncertain, busy, formId, submitLabel]);
  const form = <form id={formId} className="form" onSubmit={submit} noValidate>
    {failure && <Notice kind="error">{failure}</Notice>}
    <fieldset disabled={busy || uncertain} style={{border:0,padding:0,margin:0,minWidth:0}} className="form">{children(errors)}</fieldset>
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
      dirty={dirty || uncertain}
      busy={busy}
      onClose={onClose}
      onRouteDiscard={onRouteDiscard}
      footer={footer}
    >
      {form}
    </ModalShell>
  );
}

export function ChangeNoteField({value, onChange, required = false, error}: {value: string; onChange: (value: string) => void; required?: boolean; error?: string}) {
  return <Field label={required ? "편집 메모" : "이유 (선택)"} required={required} error={error} help="무엇을 왜 바꾸는지 남깁니다. 1,000자 이하">
    {p => <textarea {...p} className="input" rows={3} value={value} onChange={e => onChange(e.target.value)} />}
  </Field>;
}

export { changeNoteErrors } from "./change-note.ts";
