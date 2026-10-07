import { useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { SurfaceActionContext } from "./Modal.tsx";
import { RecordConfirmation } from "./RecordConfirmation.tsx";
import { changeNoteErrors } from "./change-note.ts";
import { useWriteAttempt, writeErrorMessage } from "../lib/write-attempt.ts";

export interface DeletionOptions {
  message: ReactNode;
  onConfirm: (reason: string, tags?: string[]) => void | Promise<void>;
  note?: boolean;
}
export interface DeletionState { armed: boolean; busy: boolean; uncertain: boolean }
/** A management action replaces its dialog's content with a short confirmation stage. */
export function DeleteAction({message,onConfirm,note=true,onStateChange,label="삭제",disabled=false,excludeTag}: DeletionOptions & {
  onStateChange?: (state: DeletionState) => void; label?: string; disabled?: boolean; excludeTag?: string;
}) {
  const [armed,setArmed]=useState(false),[reason,setReason]=useState(label === "삭제" ? "항목 삭제" : label),[tags,setTags]=useState<string[]>([]);
  const [error,setError]=useState<string>(),[errors,setErrors]=useState<Record<string,string>>({});
  const {attempt,busy,uncertain}=useWriteAttempt();
  const register = useContext(SurfaceActionContext);
  const callbacks=useRef({onConfirm,message});callbacks.current={onConfirm,message};
  useEffect(()=>{onStateChange?.({armed,busy,uncertain});},[armed,busy,uncertain,onStateChange]);
  const cancel=()=>{if(busy)return;setArmed(false);setError(undefined);setErrors({});};
  const confirm=async()=>{
    if(attempt.snapshot().busy)return;
    const local=note?changeNoteErrors(reason,false):null;setErrors(local??{});if(local)return;
    setError(undefined);
    const submit=callbacks.current.onConfirm, memo=reason, selected=[...tags];
    try{await attempt.run(async()=>{await submit(memo,selected);});setArmed(false);}
    catch(e){setError(writeErrorMessage(e));}
  };
  useLayoutEffect(()=>{
    if(!armed||!register)return;
    register({title:"정말 삭제하시겠습니까?",busy,
      body:<RecordConfirmation note={reason} tags={tags} onNote={setReason} onTags={setTags} errors={errors} failure={error}
        frozen={busy||uncertain} message={callbacks.current.message} record={note} excludeTag={excludeTag}/>,
      footer:<><button type="button" className="btn" disabled={busy} onClick={cancel}>취소</button>
        <button type="button" className="btn btn-danger" disabled={busy} onClick={()=>void confirm()}>{busy?"삭제 중…":uncertain?"같은 내용 다시 시도":"삭제하고 기록"}</button></>,onCancel:cancel});
    return()=>register(null);
  },[register,armed,reason,tags,error,errors,busy,uncertain,note,excludeTag]);
  return <button type="button" className="btn btn-text" aria-label={label} disabled={busy||disabled} onClick={()=>setArmed(true)}>{label === "삭제" ? label : "삭제"}</button>;
}
