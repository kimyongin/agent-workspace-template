import { api } from "../../lib/api.ts";
import type { ChangeMemo } from "@contracts/change.ts";
import { type ReactNode, useState } from "react";
import { body, summary, title } from "@contracts/common.ts";
import { z } from "zod";
import { changeNoteErrors, ChangeNoteField, FormModal, TextFields, type TextDraft } from "../../components/ContentForm.tsx";
import { fieldErrors } from "../../lib/format.ts";

export type PrincipleDraft = TextDraft & {change_note?: string;change_memo?:ChangeMemo};
export const emptyPrinciple: PrincipleDraft = {title:"",summary:"",body:"",change_note:""};
const content = z.object({title,summary,body});
export function PrincipleFormModal({initial,editing=false,correcting=false,details,id,version,onClose,onRouteDiscard,onSave}: {
  initial: PrincipleDraft; editing?: boolean; correcting?: boolean; onClose:()=>void; onRouteDiscard?:()=>void; onSave:(draft:PrincipleDraft)=>Promise<void>;
  details?: ReactNode; id?:string; version?:number;
}) {
  const [baseline] = useState({title:initial.title,summary:initial.summary,body:initial.body,change_note: correcting ? initial.change_note??"" : ""});
  const [draft,setDraft]=useState(baseline);
  return <FormModal title={correcting?"과거 원칙 정정":editing?"현재 원칙 편집":"현재 원칙 등록"} open submitLabel="저장"
    dirty={JSON.stringify(draft)!==JSON.stringify(baseline)} onClose={onClose} onRouteDiscard={onRouteDiscard}
    previewKey={JSON.stringify(draft)} prepare={async()=> (await api<{memo:ChangeMemo}>("POST","/principles/preview",editing?{action:"update",id,input:{...content.parse(draft),expected_version:version,change_note:draft.change_note.trim()||undefined}}:{action:"create",input:{...content.parse(draft),change_note:draft.change_note.trim()||undefined}})).memo}
    validate={()=>{const noteErrors=changeNoteErrors(draft.change_note,false);if(noteErrors)return noteErrors; const r=content.safeParse(draft);return r.success?null:fieldErrors(r.error.issues);}}
    onSubmit={change_memo=>onSave({...content.parse(draft),change_note:draft.change_note.trim()||undefined,change_memo})}>
    {errors=><>
      {editing&&<p className="help">{correcting?"이 저장본의 본문과 메모를 정정합니다. 저장 순서와 현재 원칙은 바뀌지 않습니다.":"현재 문서를 갱신하고 확인한 메모를 통합 기록에 함께 저장합니다."}</p>}
      <TextFields draft={draft} set={patch=>setDraft(d=>({...d,...patch}))} errors={errors}/>
      <ChangeNoteField required={false} value={draft.change_note} error={errors.change_note} onChange={change_note=>setDraft(d=>({...d,change_note}))}/>
      {details}
    </>}
  </FormModal>;
}
