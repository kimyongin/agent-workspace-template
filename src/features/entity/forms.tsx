import type { DeletionOptions } from "../../components/DeleteAction.tsx";
import {
  type EntityCreate,
  entityCreate,
  entityLabels,
  type EntityResult,
} from "@contracts/entity.ts";
import { type ReactNode, useState } from "react";
import { FormModal } from "../../components/ContentForm.tsx";
import { Field } from "../../components/Field.tsx";
import { fieldErrors } from "../../lib/format.ts";
import { TagPicker } from "../tags/TagPicker.tsx";
export function EntityForm(
  { initial, details, deletion, onClose, onRouteDiscard, onSave }: {
    initial?: EntityResult;
    details?: ReactNode;
    deletion?: DeletionOptions;
    onClose: () => void;
    onRouteDiscard?: () => void;
    onSave: (value: Omit<EntityCreate,"id"> & {tag_ids: string[]; change_note?: string; change_tag_ids?: string[]}, creationId: () => string) => Promise<void>;
  },
) {
  const baseline = {
    prop1: initial?.prop1 ?? "",
    prop2: initial?.prop2 == null ? "" : String(initial.prop2),
    prop3: initial?.prop3 ?? "",
    prop4: initial?.prop4 ?? "a",
    tag_ids: (initial as EntityResult & {tag_ids?: string[]})?.tag_ids ?? [],
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
      domain="엔터티" title={initial ? "엔터티 편집" : "엔터티 추가"}
      submitLabel="저장"
      mutation={{target: draft.prop1, action: initial ? "수정" : "등록"}}
      deletion={deletion}
      onClose={onClose}
      onRouteDiscard={onRouteDiscard}
      dirty={JSON.stringify(draft) !== JSON.stringify(baseline)}
      validate={() => {
        const {tag_ids, ...fields} = value();
        const parsed = entityCreate.omit({id:true}).safeParse(fields);
        return parsed.success ? null : fieldErrors(parsed.error.issues);
      }}
      onSubmit={(creationId, memo) => {const {tag_ids,...fields}=value(); return onSave({...entityCreate.omit({id:true}).parse(fields),tag_ids,...memo}, creationId);}}
    >
      {(errors) => (
        <>
          <section className="detail-section form">
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
          </section><section className="detail-section form">
          <TagPicker scope="entity" value={draft.tag_ids} error={errors.tag_ids} onChange={tag_ids=>setDraft(d=>({...d,tag_ids}))}/>
          </section>
          {details}
        </>
      )}
    </FormModal>
  );
}
