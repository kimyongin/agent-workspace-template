import { FieldGroup, FieldSet } from "./ui/field.tsx";
import { Input } from "./ui/input.tsx";
import { Textarea } from "./ui/textarea.tsx";
import { Button } from "./ui/button.tsx";
import { firstField } from "../lib/surface-dom.ts";
// 할 일·기록에서 함께 쓰는 내용 입력과 저장 실패·미저장 보호.
import { useRecordConfirmation, type RecordMemo, type ConfirmationValue } from "./RecordConfirmation.tsx";
import type { PrepareRecordMemo, PreparedRecordMemo } from "@contracts/record-preparation.ts";
import { contentLabels } from "@contracts/common.ts";
import { type FormEvent, type MouseEvent, type ReactNode, useCallback, useContext, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Field, Notice } from "./Field.tsx";
import { ModalShell, SurfaceContext, type ModalProps } from "./Modal.tsx";
import { type DeletionOptions } from "./DeleteAction.tsx";

export interface TextDraft {
  title: string;
  body: string;
}

/** 할 일의 제목과 본문 입력 묶음. */
export function TextFields(
  { draft, set, errors }: { draft: TextDraft; set: (patch: Partial<TextDraft>) => void; errors: Record<string, string> },
) {
  return (
    <>
      <FieldGroup>
      <Field pair label={contentLabels.title} required error={errors.title}>
        {(p) => <Input {...p}  placeholder="대상과 행동 또는 결론" value={draft.title} onChange={(e) => set({ title: e.target.value })} />}
      </Field>
      <Field pair fullWidth label={contentLabels.body} error={errors.body}>
        {(p) => (
          <Textarea {...p}  rows={8} placeholder="상세 내용과 근거를 작성하세요 (마크다운)" value={draft.body} onChange={(e) => set({ body: e.target.value })} />
        )}
      </Field>
      </FieldGroup>
    </>
  );
}

interface FormModalProps {
  title: string;
  description?: string;
  domain?: string;
  open: boolean;
  submitLabel: string;
  submitDisabled?: boolean;
  dirty: boolean;
  onClose: () => void;
  onRouteDiscard?: () => void;
  onSubmit: (requestKey: () => string, memo: RecordMemo) => Promise<void>;
  validate: () => Record<string, string> | null;
  children: (errors: Record<string, string>, disabled: boolean) => ReactNode;
  deletion?: DeletionOptions;
  preparation?: () => PrepareRecordMemo | Promise<PrepareRecordMemo>;
  onPrepared?: (result:PreparedRecordMemo) => void;
  mutation?: { target: string; action: "등록" | "수정" | "중단" | "재개" | "연결" | "해제" | "복원" | "식별 정보 변경"; message?: ReactNode; data?: ConfirmationValue[] };
  confirmationOnly?: boolean;
}
interface Presentation { dirty: boolean; busy: boolean; footer: ModalProps["footer"] }

export function FormModal(props: FormModalProps) {
  const surface = useContext(SurfaceContext);
  const [presentation, setPresentation] = useState<Presentation>({dirty: props.dirty, busy: false, footer: null});
  const present = useCallback((value: Presentation) => setPresentation(value), []);
  if (surface) return <FormContents {...props}/>;
  return <ModalShell open={props.open} title={props.title} description={props.description} domain={props.domain} dirty={props.dirty || presentation.dirty} busy={presentation.busy}
    onClose={props.onClose} onRouteDiscard={props.onRouteDiscard} footer={presentation.footer}>
    <FormContents {...props} present={present}/>
  </ModalShell>;
}

function FormContents({title, description, domain, open, submitLabel, submitDisabled = false, dirty, onClose, onRouteDiscard, onSubmit, validate, children, deletion, mutation, preparation, onPrepared, confirmationOnly, present}: FormModalProps & {present?: (value: Presentation)=>void}) {
  const formId = useId();
  const surface = useContext(SurfaceContext);
  const callbacks = useRef({onClose,onRouteDiscard,onSubmit,validate,deletion,mutation,preparation,onPrepared});
  callbacks.current = {onClose,onRouteDiscard,onSubmit,validate,deletion,mutation,preparation,onPrepared};
  const confirmation = useRecordConfirmation({
    open, initial: confirmationOnly ? "save" : undefined,
    onCancel: confirmationOnly ? () => callbacks.current.onClose() : undefined,
    describe: kind => {
      const current = callbacks.current;
      const action = kind === "delete" ? "삭제" : current.mutation?.action ?? "저장";
      return {
        title: `${action}하시겠습니까?`,
        label: kind === "delete" ? "삭제하고 기록" : `${action}하고 저장`,
        defaultNote: `${current.mutation?.target ?? title} ${kind === "delete" ? "삭제" : current.mutation?.action ?? "수정"}`,
        preparation: kind === "delete" ? current.deletion?.preparation : current.preparation,
        onPrepared:current.onPrepared,
        danger: kind === "delete",
        record: kind === "delete" ? current.deletion?.note !== false : !!current.mutation,
        message: kind === "delete" ? current.deletion?.message : current.mutation?.message,
        data: [
          { label: "대상", value: kind === "delete" ? current.deletion?.target ?? current.mutation?.target ?? title : current.mutation?.target ?? title, fullWidth: true },
          { label: "작업", value: action },
          ...(kind === "delete" ? current.deletion?.data ?? [] : current.mutation?.data ?? []),
        ],
        execute: kind === "delete"
          ? (requestKey, memo) => current.deletion!.onConfirm(memo.change_note ?? "", memo.change_tag_ids, requestKey)
          : current.onSubmit,
      };
    },
  });
  const { busy, uncertain, active, errors, failure } = confirmation;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || active || submitDisabled) return;
    const local = callbacks.current.validate();
    if (local) return confirmation.reject(local, "입력을 확인하세요.");
    if (mutation) confirmation.begin("save", (e.nativeEvent as SubmitEvent).submitter); else await confirmation.write("save");
  };
  const footer = (requestCancel:(event?: MouseEvent<HTMLElement>)=>void) => <>
    {deletion && !uncertain && <Button variant="destructive" type="button" key="delete" className="sm:mr-auto" disabled={busy} onClick={event=>confirmation.begin("delete", event.currentTarget)}>삭제</Button>}
    <Button variant="outline" key="cancel" type="button"  disabled={busy} onClick={requestCancel}>취소</Button>
    <Button variant="default" key="save" type="submit" form={formId}  disabled={busy || submitDisabled}>{busy ? "처리 중…" : uncertain ? "같은 내용 다시 시도" : submitLabel}</Button>
  </>;
  const register = surface?.register;
  useLayoutEffect(() => {
    if (!open) return;
    const presentation = {dirty: dirty || confirmation.dirty, busy, footer};
    if (register) register({title, description, domain, ...presentation,
      onClose: ()=>callbacks.current.onClose(), onRouteDiscard: ()=>(callbacks.current.onRouteDiscard ?? callbacks.current.onClose)()});
    else present?.(presentation);
    return () => { register?.(null); };
  }, [register,present,open,title,description,domain,dirty,confirmation.dirty,busy,formId,submitLabel,submitDisabled,!!deletion]);
  const form = <form id={formId} className="flex min-w-0 flex-col gap-5" onSubmit={submit} noValidate>
    {failure && !active && <Notice kind="error">{failure}</Notice>}
    <FieldSet disabled={busy || uncertain || active}><FieldGroup>{children(errors, busy || uncertain || active)}</FieldGroup></FieldSet>
  </form>;
  useLayoutEffect(() => {
    if (!active && Object.keys(errors).length) document.getElementById(formId)?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
  }, [errors,formId,active]);
  useLayoutEffect(() => { if(surface?.slot && open) (firstField(surface.slot) ?? surface.slot.querySelector<HTMLElement>("input,textarea,select,button"))?.focus(); }, [surface?.slot,open]);
  return surface ? surface.slot && open ? createPortal(form, surface.slot) : null : form;
}
