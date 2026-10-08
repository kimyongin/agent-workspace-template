// 할 일·기록·원칙에서 함께 쓰는 내용 입력과 저장 실패·미저장 보호.
import { useRecordConfirmation, type RecordMemo } from "./RecordConfirmation.tsx";
import type { PrepareRecordMemo } from "@contracts/record-preparation.ts";
import { contentLabels } from "@contracts/common.ts";
import { type FormEvent, type ReactNode, useCallback, useContext, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Field, Notice } from "./Field.tsx";
import { ModalShell, SurfaceContext, type ModalProps } from "./Modal.tsx";
import { type DeletionOptions } from "./DeleteAction.tsx";

export interface TextDraft {
  title: string;
  body: string;
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
  domain?: string;
  open: boolean;
  submitLabel: string;
  dirty: boolean;
  onClose: () => void;
  onRouteDiscard?: () => void;
  onSubmit: (creationId: () => string, memo: RecordMemo) => Promise<void>;
  validate: () => Record<string, string> | null;
  children: (errors: Record<string, string>) => ReactNode;
  deletion?: DeletionOptions;
  preparation?: () => PrepareRecordMemo;
  mutation?: { target: string; action: "등록" | "수정" | "중단" | "재개" | "연결" | "해제"; message?: ReactNode };
  confirmationOnly?: boolean;
}
interface Presentation { dirty: boolean; busy: boolean; footer: ModalProps["footer"] }

export function FormModal(props: FormModalProps) {
  const surface = useContext(SurfaceContext);
  const [presentation, setPresentation] = useState<Presentation>({dirty: props.dirty, busy: false, footer: null});
  const present = useCallback((value: Presentation) => setPresentation(value), []);
  if (surface) return <FormContents {...props}/>;
  return <ModalShell open={props.open} title={props.title} domain={props.domain} dirty={props.dirty || presentation.dirty} busy={presentation.busy}
    onClose={props.onClose} onRouteDiscard={props.onRouteDiscard} footer={presentation.footer}>
    <FormContents {...props} present={present}/>
  </ModalShell>;
}

function FormContents({title, domain, open, submitLabel, dirty, onClose, onRouteDiscard, onSubmit, validate, children, deletion, mutation, preparation, confirmationOnly, present}: FormModalProps & {present?: (value: Presentation)=>void}) {
  const formId = useId();
  const surface = useContext(SurfaceContext);
  const callbacks = useRef({onClose,onRouteDiscard,onSubmit,validate,deletion,mutation,preparation});
  callbacks.current = {onClose,onRouteDiscard,onSubmit,validate,deletion,mutation,preparation};
  const confirmation = useRecordConfirmation({
    open, initial: confirmationOnly ? "save" : undefined,
    onCancel: confirmationOnly ? () => callbacks.current.onClose() : undefined,
    describe: kind => {
      const current = callbacks.current;
      const action = kind === "delete" ? "삭제" : current.mutation?.action ?? "저장";
      return {
        title: `‘${current.mutation?.target ?? title}’을 ${action}하시겠습니까?`,
        label: kind === "delete" ? "삭제하고 기록" : `${action}하고 저장`,
        defaultNote: `${current.mutation?.target ?? title} ${kind === "delete" ? "삭제" : current.mutation?.action ?? "수정"}`,
        preparation: kind === "delete" ? current.deletion?.preparation : current.preparation,
        danger: kind === "delete",
        record: kind === "delete" ? current.deletion?.note !== false : !!current.mutation,
        message: kind === "delete" ? current.deletion?.message : current.mutation?.message,
        execute: kind === "delete"
          ? (_id, memo) => current.deletion!.onConfirm(memo.change_note ?? "", memo.change_tag_ids)
          : current.onSubmit,
      };
    },
  });
  const { busy, uncertain, active, errors, failure } = confirmation;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || active) return;
    const local = callbacks.current.validate();
    if (local) return confirmation.reject(local, "입력을 확인하세요.");
    if (mutation) confirmation.begin("save"); else await confirmation.write("save");
  };
  const footer = (requestCancel:()=>void) => <>
    {deletion && !uncertain && <button type="button" key="delete" className="btn btn-danger delete-trigger" disabled={busy} onClick={()=>confirmation.begin("delete")}>삭제</button>}
    <button key="cancel" type="button" className="btn" disabled={busy} onClick={requestCancel}>취소</button>
    <button key="save" type="submit" form={formId} className="btn btn-primary" disabled={busy}>{busy ? "처리 중…" : uncertain ? "같은 내용 다시 시도" : submitLabel}</button>
  </>;
  const register = surface?.register;
  useLayoutEffect(() => {
    if (!open) return;
    const presentation = {dirty: dirty || confirmation.dirty, busy, footer};
    if (register) register({title, domain, ...presentation,
      onClose: ()=>callbacks.current.onClose(), onRouteDiscard: ()=>(callbacks.current.onRouteDiscard ?? callbacks.current.onClose)()});
    else present?.(presentation);
    return () => { register?.(null); };
  }, [register,present,open,title,domain,dirty,confirmation.dirty,busy,formId,submitLabel,!!deletion]);
  const form = <form id={formId} className="form" onSubmit={submit} noValidate>
    {failure && !active && <Notice kind="error">{failure}</Notice>}
    <fieldset disabled={busy || uncertain || active} className="form plain-fieldset">{children(errors)}</fieldset>
  </form>;
  useLayoutEffect(() => {
    if (!active && Object.keys(errors).length) document.getElementById(formId)?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [errors,formId,active]);
  useLayoutEffect(() => { if(surface?.slot && open) surface.slot.querySelector<HTMLElement>("input,textarea,select,button")?.focus(); }, [surface?.slot,open]);
  return surface ? surface.slot && open ? createPortal(form, surface.slot) : null : form;
}
