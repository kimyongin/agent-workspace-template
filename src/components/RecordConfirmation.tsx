import type { ReactNode } from "react";
import { Field, Notice } from "./Field.tsx";
import { TagPicker } from "../features/tags/TagPicker.tsx";

export interface RecordMemo { change_note?: string; change_tag_ids?: string[] }
export function RecordConfirmation({note, tags, onNote, onTags, errors, failure, frozen, message, record=true, excludeTag}: {
  note: string; tags: string[]; onNote: (value: string) => void; onTags: (value: string[]) => void;
  errors: Record<string,string>; failure?: string | null; frozen: boolean; message?: ReactNode; record?: boolean; excludeTag?: string;
}) {
  return <div className="form">
    {message && <div className="secondary action-explanation">{message}</div>}
    {failure && <Notice kind="error">{failure}</Notice>}
    {record && <fieldset disabled={frozen} className="form plain-fieldset">
      <Field label="기록 메모" error={errors.change_note}>{p => <textarea {...p} className="input" rows={4} value={note} onChange={e=>onNote(e.target.value)} placeholder="변경 내용과 이유를 작성하세요"/>}</Field>
      <TagPicker label="기록 태그" value={tags} error={errors.change_tag_ids} onChange={onTags} excludeId={excludeTag}/>
    </fieldset>}
  </div>;
}
