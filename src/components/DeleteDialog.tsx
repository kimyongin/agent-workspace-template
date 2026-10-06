import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "./Modal.tsx";
import { ChangeNoteField, changeNoteErrors } from "./ContentForm.tsx";
import { useWriteAttempt, writeErrorMessage } from "../lib/write-attempt.ts";

export function DeleteDialog({title,message,busy,onCancel,onConfirm,note=true}: {title:string;message:ReactNode;busy:boolean;onCancel:()=>void;onConfirm:(reason:string)=>void|Promise<void>;note?:boolean}) {
  const [reason,setReason]=useState(""),[error,setError]=useState<string|undefined>();
  const {attempt, uncertain, busy:writing}=useWriteAttempt();
  return <ConfirmDialog open title={title} message={<div className="form">{message}{uncertain&&<p role="alert">응답을 받지 못해 삭제 여부를 알 수 없습니다. 같은 내용으로 다시 시도합니다.</p>}{error&&<p role="alert">{error}</p>}{note&&<fieldset disabled={busy||writing||uncertain} style={{border:0,padding:0,margin:0,minWidth:0}}><ChangeNoteField value={reason} onChange={setReason} error={error}/></fieldset>}</div>}
    confirmLabel={uncertain?"같은 내용 다시 시도":"삭제"} danger busy={busy||writing} onCancel={onCancel} onConfirm={async()=>{
      const errors=note?changeNoteErrors(reason,false):null;setError(errors?.change_note);if(errors)return;
      try{await attempt.run(async()=>{await onConfirm(reason);});}
      catch(e){setError(writeErrorMessage(e));}
    }}/>;
}
