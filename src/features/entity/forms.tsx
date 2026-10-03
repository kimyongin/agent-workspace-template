import {
  type EntityCreate,
  entityCreate,
  entityLabels,
  type EntityResult,
} from "@contracts/entity.ts";
import { useState } from "react";
import { FormModal } from "../../components/ContentForm.tsx";
import { Field } from "../../components/Field.tsx";
import { fieldErrors } from "../../lib/format.ts";
export function EntityForm(
  { initial, onClose, onSave }: {
    initial?: EntityResult;
    onClose: () => void;
    onSave: (value: EntityCreate) => Promise<void>;
  },
) {
  const baseline = {
    prop1: initial?.prop1 ?? "",
    prop2: initial?.prop2 == null ? "" : String(initial.prop2),
    prop3: initial?.prop3 ?? "",
    prop4: initial?.prop4 ?? "a",
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
      onClose={onClose}
      dirty={JSON.stringify(draft) !== JSON.stringify(baseline)}
      validate={() => {
        const parsed = entityCreate.safeParse(value());
        return parsed.success ? null : fieldErrors(parsed.error.issues);
      }}
      onSubmit={() => onSave(entityCreate.parse(value()))}
    >
      {(errors) => (
        <>
          <Field
            label={entityLabels.prop1}
            required
            error={errors.prop1}
            help="1~100자"
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
            help="0~1,000,000 정수, 비우면 미지정"
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
        </>
      )}
    </FormModal>
  );
}
