import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "./Modal.tsx";
import { ChangeNoteField, changeNoteErrors } from "./ContentForm.tsx";

export function DeleteDialog({title,message,busy,onCancel,onConfirm}: {title:string;message:ReactNode;busy:boolean;onCancel:()=>void;onConfirm:(reason:string)=>void}) {
  const [reason,setReason]=useState(""),[error,setError]=useState<string|undefined>();
  return <ConfirmDialog open title={title} message={<div className="form">{message}<fieldset disabled={busy} style={{border:0,padding:0,margin:0,minWidth:0}}><ChangeNoteField value={reason} onChange={setReason} error={error}/></fieldset></div>}
    confirmLabel="삭제" danger busy={busy} onCancel={onCancel} onConfirm={()=>{const errors=changeNoteErrors(reason,false);setError(errors?.change_note);if(!errors)onConfirm(reason.trim());}}/>;
}
