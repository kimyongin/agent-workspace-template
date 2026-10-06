import {
  type EntityCreate,
  entityCreate,
  entityLabels,
  type EntityResult,
} from "@contracts/entity.ts";
import { type ReactNode, useState } from "react";
import { changeNoteErrors, ChangeNoteField, FormModal } from "../../components/ContentForm.tsx";
import { Field } from "../../components/Field.tsx";
import { fieldErrors } from "../../lib/format.ts";
import { TagPicker } from "../tags/TagPicker.tsx";
import { api } from "../../lib/api.ts";
import type { ChangeMemo } from "@contracts/change.ts";
export function EntityForm(
  { initial, details, onDelete, onClose, onRouteDiscard, onSave }: {
    initial?: EntityResult;
    details?: ReactNode;
    onDelete?: () => void;
    onClose: () => void;
    onRouteDiscard?: () => void;
    onSave: (value: Omit<EntityCreate,"id"> & {tag_ids: string[]; change_note?: string}, creationId: () => string) => Promise<void>;
  },
) {
  const baseline = {
    prop1: initial?.prop1 ?? "",
    prop2: initial?.prop2 == null ? "" : String(initial.prop2),
    prop3: initial?.prop3 ?? "",
    prop4: initial?.prop4 ?? "a",
    tag_ids: (initial as EntityResult & {tag_ids?: string[]})?.tag_ids ?? [],
    change_note: "",
  };
  const [draft, setDraft] = useState(baseline);
  const value = () => ({
    ...draft,
    prop2: draft.prop2 === "" ? null : Number(draft.prop2),
    prop3: draft.prop3 || null,
  });
  return (
    <FormModal
      open
      title={initial ? "엔터티 편집" : "엔터티 추가"}
      submitLabel="저장"
      onDelete={onDelete}
      onClose={onClose}
      onRouteDiscard={onRouteDiscard}
      dirty={JSON.stringify(draft) !== JSON.stringify(baseline)}
      previewKey={JSON.stringify(draft)}
      prepare={async()=>{
        const input={...value(),change_note:draft.change_note.trim()||undefined};
        const result=await api<{memo:ChangeMemo}>("POST","/entities/preview",initial?{action:"update",id:initial.id,input:{...input,expected_version:initial.version}}:{action:"create",input});
        return result.memo;
      }}
      validate={() => {
        const noteErrors=changeNoteErrors(draft.change_note,false);if(noteErrors)return noteErrors;
        const {tag_ids, change_note, ...fields} = value();
        const parsed = entityCreate.omit({id:true}).safeParse(fields);
        return parsed.success ? null : fieldErrors(parsed.error.issues);
      }}
      onSubmit={(change_memo, creationId) => {const {tag_ids,change_note,...fields}=value(); return onSave({...entityCreate.omit({id:true}).parse(fields),tag_ids,change_note:change_note.trim()||undefined,change_memo}, creationId);}}
    >
      {(errors) => (
        <>
          <section className="detail-section form"><h2 className="section-title">기본 정보</h2>
          <Field
            label={entityLabels.prop1}
            required
            error={errors.prop1}

          >
            {(p) => (
              <input
                {...p}
                className="input"
                value={draft.prop1}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, prop1: e.target.value }))}
              />
            )}
          </Field>
          <Field
            label={entityLabels.prop2}
            error={errors.prop2}

          >
            {(p) => (
              <input
                {...p}
                className="input"
                type="number"
                min="0"
                max="1000000"
                step="1"
                value={draft.prop2}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, prop2: e.target.value }))}
              />
            )}
          </Field>
          <Field label={entityLabels.prop3} error={errors.prop3}>
            {(p) => (
              <input
                {...p}
                className="input"
                type="date"
                value={draft.prop3}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, prop3: e.target.value }))}
              />
            )}
          </Field>
          <Field label={entityLabels.prop4} required error={errors.prop4}>
            {(p) => (
              <select
                {...p}
                className="input"
                value={draft.prop4}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    prop4: e.target.value as EntityResult["prop4"],
                  }))}
              >
                {["a", "b", "c"].map((v) => <option key={v}>{v}</option>)}
              </select>
            )}
          </Field>
          </section><section className="detail-section form"><h2 className="section-title">관련 정보</h2>
          <TagPicker scope="entity" value={draft.tag_ids} error={errors.tag_ids} onChange={tag_ids=>setDraft(d=>({...d,tag_ids}))}/>
          </section><section className="detail-section form"><ChangeNoteField label="편집 메모" value={draft.change_note} required={false} error={errors.change_note} onChange={change_note=>setDraft(d=>({...d,change_note}))}/></section>
          {details}
        </>
      )}
    </FormModal>
  );
}
