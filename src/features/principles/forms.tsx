import type { DeletionOptions } from "../../components/DeleteAction.tsx";
import { type ReactNode, useState } from "react";
import { body, title } from "@contracts/common.ts";
import { z } from "zod";
import { FormModal, TextFields, type TextDraft } from "../../components/ContentForm.tsx";
import { fieldErrors } from "../../lib/format.ts";

export type PrincipleDraft = TextDraft & {change_note?: string; change_tag_ids?: string[]};
export const emptyPrinciple: PrincipleDraft = {title:"",body:"",change_note:""};
const content = z.object({title,body});
export function PrincipleFormModal({initial,editing=false,details,deletion,onClose,onRouteDiscard,onSave}: {
  initial: PrincipleDraft; editing?: boolean; onClose:()=>void; onRouteDiscard?:()=>void; onSave:(draft:PrincipleDraft, creationId: () => string)=>Promise<void>;
  deletion?: DeletionOptions; details?: ReactNode;
}) {
  const [baseline] = useState({title:initial.title,body:initial.body});
  const [draft,setDraft]=useState(baseline);
  return <FormModal title={editing?"현재 원칙 편집":"현재 원칙 등록"} open submitLabel="저장"
    deletion={deletion}
    mutation={{target:draft.title, action:editing ? "수정" : "등록"}}
    dirty={JSON.stringify(draft)!==JSON.stringify(baseline)} onClose={onClose} onRouteDiscard={onRouteDiscard}
    validate={()=>{const r=content.safeParse(draft);return r.success?null:fieldErrors(r.error.issues);}}
    onSubmit={(creationId,memo)=>onSave({...content.parse(draft),...memo}, creationId)}>
    {errors=><>

      <TextFields draft={draft} set={patch=>setDraft(d=>({...d,...patch}))} errors={errors}/>
      {details}
    </>}
  </FormModal>;
}
