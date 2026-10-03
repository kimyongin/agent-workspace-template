import { principleCreate, principleLabels, type PrincipleCreate } from "@contracts/principle.ts";
import { useState } from "react";
import { FormModal, TextFields } from "../../components/ContentForm.tsx";
import { Field } from "../../components/Field.tsx";
import { fieldErrors } from "../../lib/format.ts";
import {TagPicker} from "../tags/TagPicker.tsx";

export type PrincipleDraft = Pick<PrincipleCreate, "title" | "summary" | "body" | "applies_when" | "tag_ids">;
export const emptyPrinciple: PrincipleDraft = {title:"", summary:"", body:"", applies_when:"",tag_ids:[]};
export function PrincipleFormModal({initial, editing=false, onClose, onSave}: {
  initial: PrincipleDraft; editing?: boolean; onClose:()=>void; onSave:(draft:PrincipleDraft)=>Promise<void>;
}) {
  const initialDraft = {title:initial.title,summary:initial.summary,body:initial.body,applies_when:initial.applies_when,tag_ids:initial.tag_ids??[]};
  const [draft,setDraft]=useState(initialDraft);
  return <FormModal title={editing?"원칙 편집":"원칙 추가"} open submitLabel="저장"
    dirty={JSON.stringify(draft)!==JSON.stringify(initialDraft)} onClose={onClose}
    validate={()=>{const r=principleCreate.safeParse(draft); return r.success?null:fieldErrors(r.error.issues);}}
    onSubmit={()=>onSave(principleCreate.parse(draft))}>
    {errors=><>
      {editing&&<p className="help">표현을 정정합니다. 의미가 바뀌면 새 원칙을 만들고 기존 원칙을 비활성·대체 연결하세요.</p>}
      <TextFields draft={draft} set={patch=>setDraft(d=>({...d,...patch}))} errors={errors}/>
      <TagPicker value={draft.tag_ids} error={errors.tag_ids} onChange={tag_ids=>setDraft(d=>({...d,tag_ids}))}/>
      <Field label={principleLabels.applies_when} error={errors.applies_when} help="이 원칙을 적용할 상황, 300자 이하">
        {p=><textarea {...p} className="input" rows={3} value={draft.applies_when} onChange={e=>setDraft(d=>({...d,applies_when:e.target.value}))}/>}
      </Field>
    </>}
  </FormModal>;
}
