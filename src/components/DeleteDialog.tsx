import { useState, type ReactNode } from "react";
import { ConfirmDialog } from "./Modal.tsx";
import { ChangeNoteField, changeNoteErrors } from "./ContentForm.tsx";
import { changeMemo, type ChangeMemo } from "@contracts/change.ts";
import { Field } from "./Field.tsx";

export function DeleteDialog({title,message,busy,onCancel,onConfirm,prepare}: {title:string;message:ReactNode;busy:boolean;onCancel:()=>void;onConfirm:(reason:string,memo?:ChangeMemo)=>void;prepare?:()=>Promise<ChangeMemo>}) {
  const [reason,setReason]=useState(""),[error,setError]=useState<string|undefined>();
  const [memo,setMemo]=useState<ChangeMemo|null>(null),[preparing,setPreparing]=useState(false);
  return <ConfirmDialog open title={title} message={<div className="form">{message}<fieldset disabled={busy||preparing} style={{border:0,padding:0,margin:0,minWidth:0}}><ChangeNoteField value={reason} onChange={setReason} error={error}/>
    {memo&&<section aria-label="저장할 기록 메모"><p className="help">아직 삭제하지 않았습니다. 최종 메모와 삭제를 함께 저장합니다.</p>
      <Field label="기록 제목" required>{p=><input {...p} className="input" value={memo.title} onChange={e=>setMemo({...memo,title:e.target.value})}/>}</Field>
      <Field label="기록 요약" required>{p=><textarea {...p} className="input" value={memo.summary} onChange={e=>setMemo({...memo,summary:e.target.value})}/>}</Field>
      <Field label="기록 본문">{p=><textarea {...p} className="input" rows={5} value={memo.body} onChange={e=>setMemo({...memo,body:e.target.value})}/>}</Field></section>}
    </fieldset></div>}
    confirmLabel={prepare&&!memo?"기록 메모 확인":"삭제"} danger busy={busy||preparing} onCancel={onCancel} onConfirm={async()=>{const errors=changeNoteErrors(reason,false);setError(errors?.change_note);if(errors)return;if(prepare&&!memo){setPreparing(true);try{setMemo(changeMemo.parse(await prepare()));}catch(e){setError(e instanceof Error?e.message:"메모를 확인하지 못했습니다.");}finally{setPreparing(false);}return;}if(memo&&!changeMemo.safeParse(memo).success){setError("기록 제목·요약과 길이를 확인하세요.");return;}onConfirm(reason.trim(),memo??undefined);}}/>;
}
