import { type ReactNode, useState } from "react";
import { body, title } from "@contracts/common.ts";
import { z } from "zod";
import { changeNoteErrors, FormModal, TextFields, type TextDraft } from "../../components/ContentForm.tsx";
import { Field } from "../../components/Field.tsx";
import { fieldErrors } from "../../lib/format.ts";

export type PrincipleDraft = TextDraft & {change_note?: string};
export const emptyPrinciple: PrincipleDraft = {title:"",body:"",change_note:""};
const content = z.object({title,body});
export function PrincipleFormModal({initial,editing=false,details,onDelete,onClose,onRouteDiscard,onSave}: {
  initial: PrincipleDraft; editing?: boolean; onClose:()=>void; onRouteDiscard?:()=>void; onSave:(draft:PrincipleDraft, creationId: () => string)=>Promise<void>;
  onDelete?: () => void; details?: ReactNode;
}) {
  const [baseline] = useState({title:initial.title,body:initial.body,change_note: ""});
  const [draft,setDraft]=useState(baseline);
  return <FormModal title={editing?"현재 원칙 편집":"현재 원칙 등록"} open submitLabel="저장"
    onDelete={onDelete}
    dirty={JSON.stringify(draft)!==JSON.stringify(baseline)} onClose={onClose} onRouteDiscard={onRouteDiscard}
    validate={()=>{const noteErrors=changeNoteErrors(draft.change_note,false);if(noteErrors)return noteErrors; const r=content.safeParse(draft);return r.success?null:fieldErrors(r.error.issues);}}
    onSubmit={(creationId)=>onSave({...content.parse(draft),change_note:draft.change_note.trim()?draft.change_note:undefined}, creationId)}>
    {errors=><>

      <TextFields draft={draft} set={patch=>setDraft(d=>({...d,...patch}))} errors={errors}/>
      <section className="detail-section form"><Field label="편집 메모" error={errors.change_note}>{props=><textarea {...props} className="input" value={draft.change_note} onChange={event=>setDraft(d=>({...d,change_note:event.target.value}))}/>}</Field></section>
      {details}
    </>}
  </FormModal>;
}
