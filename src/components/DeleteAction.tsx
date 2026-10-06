import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChangeNoteField } from "./ChangeNoteField.tsx";
import { changeNoteErrors } from "./change-note.ts";
import { useWriteAttempt, writeErrorMessage } from "../lib/write-attempt.ts";

export interface DeletionOptions {
  message: ReactNode;
  onConfirm: (reason: string) => void | Promise<void>;
  note?: boolean;
}
export interface DeletionState { armed: boolean; busy: boolean; uncertain: boolean }

/** Confirmation stays with its initiating action, within the existing surface. */
export function DeleteAction({message,onConfirm,note=true,onStateChange,label="삭제",disabled=false}: DeletionOptions & {
  onStateChange?: (state: DeletionState) => void; label?: string; disabled?: boolean;
}) {
  const [armed,setArmed]=useState(false),[reason,setReason]=useState(""),[error,setError]=useState<string>(),[fieldError,setFieldError]=useState<string>();
  const {attempt,busy,uncertain}=useWriteAttempt();
  const primary = useRef<HTMLButtonElement>(null);
  useEffect(()=>{onStateChange?.({armed,busy,uncertain});},[armed,busy,uncertain,onStateChange]);
  return <div className={`delete-action${armed?" is-armed":""}`}>
    {armed&&<div className="delete-action-context">
      <div className="secondary" role="status">{message}</div>
      {error&&<p role="alert">{error}</p>}
      {note&&<fieldset disabled={busy||uncertain}><ChangeNoteField value={reason} onChange={setReason} error={fieldError}/></fieldset>}
    </div>}
    <div className="actions">
      <button ref={primary} type="button" className="btn btn-danger" aria-label={armed?undefined:label} disabled={busy||disabled} onClick={async()=>{
        if(!armed){setArmed(true);return;}
        const errors=note?changeNoteErrors(reason,false):null;setFieldError(errors?.change_note);setError(undefined);if(errors)return;
        try{await attempt.run(async()=>{await onConfirm(reason);});}
        catch(e){setError(writeErrorMessage(e));}
      }}>{busy?"삭제 중…":uncertain?"같은 내용 다시 시도":armed?"삭제 확인":"삭제"}</button>
      {armed&&<button type="button" className="btn btn-text" disabled={busy} onClick={()=>{setArmed(false);setError(undefined);setFieldError(undefined);attempt.reset();primary.current?.focus();}}>취소</button>}
    </div>
  </div>;
}
