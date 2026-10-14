import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { BodyAction } from "../components/BodyAction.tsx";
import { CollectionList } from "../components/Collection.tsx";
import { ConfirmDialog } from "../components/ConfirmDialog.tsx";
import { Field } from "../components/Field.tsx";
import { MaterialSettingsSection } from "../features/settings/MaterialSettingsSection.tsx";

import { SchemaDefinitionRead } from "../features/settings/SchemaDefinitionRead.tsx";
import { ENTITY_SCHEMA_DIALECT, type EntityField } from "@contracts/entity-type.ts";

type Property = {
  id: string;
  label: string;
  type: "text" | "number";
  required: boolean;
  listed: boolean;
  maxLength: string;
};
const initialFields: Property[] = [
  { id: "prop_1", label: "상품명", type: "text", required: true, listed: true, maxLength: "80" },
  { id: "prop_2", label: "수량", type: "number", required: false, listed: true, maxLength: "" },
];
type Plan = {
  id: number;
  version: number;
  status: "reviewed" | "applied" | "discarded";
  before: Property[];
  after: Property[];
};
const equal = (left: Property[], right: Property[]) => JSON.stringify(left) === JSON.stringify(right);

function OrderIcon({ direction }: { direction: "up" | "down" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={direction === "up" ? "M12 19V5m-5 5 5-5 5 5" : "M12 5v14m-5-5 5 5 5-5"} />
    </svg>
  );
}

function PropertyList(
  { fields, onChange, errors }: {
    fields: Property[];
    onChange: (fields: Property[]) => void;
    errors: Record<string, string>;
  },
) {
  const [expanded, setExpanded] = useState<string[]>(["prop_2"]);
  const root = useRef<HTMLDivElement>(null);
  const movement = useRef<{ id: string; direction: number } | null>(null);
  useLayoutEffect(() => {
    const moved = movement.current;
    if (!moved) return;
    movement.current = null;
    const row = root.current?.querySelector(`[data-property-id="${moved.id}"]`);
    const buttons = row?.querySelectorAll<HTMLButtonElement>(".schema-order-actions button");
    const preferred = buttons?.[moved.direction < 0 ? 0 : 1];
    const other = buttons?.[moved.direction < 0 ? 1 : 0];
    const target = preferred && !preferred.disabled
      ? preferred
      : other && !other.disabled
      ? other
      : row?.querySelector<HTMLButtonElement>(".schema-field-title");
    target?.focus();
  }, [fields]);
  useEffect(() => {
    const ids = Object.keys(errors).map((key) => key.split(".")[0]);
    if (ids.length) setExpanded((prior) => [...new Set([...prior, ...ids])]);
  }, [errors]);
  useEffect(() => {
    if (Object.keys(errors).length) {
      const invalid = root.current?.querySelector<HTMLElement>("[aria-invalid='true']");
      const advanced = invalid?.closest("details");
      if (advanced) advanced.open = true;
      invalid?.focus();
    }
  }, [errors, expanded]);
  const edit = (id: string, patch: Partial<Property>) =>
    onChange(fields.map((field) => field.id === id ? { ...field, ...patch } : field));
  const toggle = (id: string) =>
    setExpanded((values) => values.includes(id) ? values.filter((value) => value !== id) : [...values, id]);
  const move = (index: number, delta: number) => {
    movement.current = { id: fields[index].id, direction: delta };
    const next = [...fields];
    [next[index], next[index + delta]] = [next[index + delta], next[index]];
    onChange(next);
  };
  return (
    <div ref={root}>
      <CollectionList label="입력 항목 예시">
        {fields.map((field, index) => {
          const open = expanded.includes(field.id);
          const bodyId = `sample-${field.id}-body`;
          return (
            <li key={field.id}>
              <div className="related-item schema-field" data-property-id={field.id} data-expanded={open || undefined}>
                <div className="schema-field-heading">
                  <h3>
                    <button
                      type="button"
                      className="schema-field-title related-toggle item-title"
                      aria-expanded={open}
                      aria-controls={bodyId}
                      onClick={() => toggle(field.id)}
                    >
                      <span>{field.label || "새 항목"}</span>
                      <span className="secondary">
                        {field.type === "text" ? "텍스트" : "숫자"}
                        {field.required ? " · 필수" : ""}
                      </span>
                    </button>
                  </h3>
                  <div className="schema-order-actions">
                    <BodyAction
                      type="button"
                      className="item-icon"
                      aria-label={`${field.label || "새 항목"} 위로 이동`}
                      disabled={index === 0}
                      onClick={() => move(index, -1)}
                    >
                      <OrderIcon direction="up" />
                    </BodyAction>
                    <BodyAction
                      type="button"
                      className="item-icon"
                      aria-label={`${field.label || "새 항목"} 아래로 이동`}
                      disabled={index === fields.length - 1}
                      onClick={() => move(index, 1)}
                    >
                      <OrderIcon direction="down" />
                    </BodyAction>
                  </div>
                  <button
                    type="button"
                    className="material-section-toggle schema-field-disclosure"
                    aria-label={`${field.label || "새 항목"} ${open ? "접기" : "펼치기"}`}
                    aria-expanded={open}
                    aria-controls={bodyId}
                    onClick={() => toggle(field.id)}
                  >
                  </button>
                </div>
                <fieldset id={bodyId} hidden={!open} className="plain-fieldset">
                  <legend className="visually-hidden">{field.label || "새 항목"} 편집</legend>
                  <Field label="항목 이름" required error={errors[`${field.id}.label`]}>
                    {(props) => (
                      <input
                        {...props}
                        className="input"
                        value={field.label}
                        onChange={(event) => edit(field.id, { label: event.target.value })}
                      />
                    )}
                  </Field>
                  <Field label="데이터 타입">
                    {(props) => (
                      <select
                        {...props}
                        className="input"
                        value={field.type}
                        onChange={(event) => edit(field.id, { type: event.target.value as Property["type"] })}
                      >
                        <option value="text">텍스트</option>
                        <option value="number">숫자</option>
                      </select>
                    )}
                  </Field>
                  <details className="schema-advanced">
                    <summary className="secondary">추가 설정</summary>
                    <div className="form">
                      <label className="samples-choice">
                        <input
                          type="checkbox"
                          checked={field.required}
                          onChange={(event) => edit(field.id, { required: event.target.checked })}
                        />필수 입력
                      </label>
                      <label className="samples-choice">
                        <input
                          type="checkbox"
                          checked={field.listed}
                          onChange={(event) => edit(field.id, { listed: event.target.checked })}
                        />목록에 표시
                      </label>
                      {field.type === "text" && (
                        <Field label="최대 길이" error={errors[`${field.id}.maxLength`]}>
                          {(props) => (
                            <input
                              {...props}
                              className="input"
                              type="number"
                              min="1"
                              value={field.maxLength}
                              onChange={(event) => edit(field.id, { maxLength: event.target.value })}
                            />
                          )}
                        </Field>
                      )}
                      <div className="actions schema-actions">
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={() => onChange(fields.filter((value) => value.id !== field.id))}
                        >
                          항목 삭제
                        </button>
                      </div>
                    </div>
                  </details>
                </fieldset>
              </div>
            </li>
          );
        })}
      </CollectionList>
    </div>
  );
}

function PropertyDefinition({ fields }: { fields: Property[] }) {
  const properties: Record<string, EntityField> = Object.fromEntries(fields.map((field) => [field.id, {
    title: field.label,
    type: field.type === "text" ? "string" : "number",
    ...(field.type === "text" && field.maxLength ? { maxLength: Number(field.maxLength) } : {}),
  }]));
  return (
    <SchemaDefinitionRead
      definition={{
        schema: {
          $schema: ENTITY_SCHEMA_DIALECT,
          type: "object",
          additionalProperties: false,
          properties,
          required: fields.filter((field) => field.required).map((field) => field.id),
        },
        display: {
          representative: fields.find((field) => field.type === "text")?.id ?? "",
          order: fields.map((field) => field.id),
          list_columns: fields.filter((field) => field.listed).map((field) => field.id),
          archived: [],
          option_labels: {},
        },
      }}
    />
  );
}

function changes(plan: Plan) {
  const result: string[] = [];
  for (const field of plan.after) {
    const prior = plan.before.find((value) => value.id === field.id);
    if (!prior) {
      result.push(`${field.label} 항목 추가`);
      continue;
    }
    if (prior.label !== field.label) result.push(`${prior.label} → ${field.label}`);
    if (prior.type !== field.type) {
      result.push(
        `${field.label} · ${prior.type === "text" ? "텍스트" : "숫자"} → ${field.type === "text" ? "텍스트" : "숫자"}`,
      );
    }
    if (prior.required !== field.required) {
      result.push(`${field.label} · 필수 입력 ${field.required ? "사용" : "해제"}`);
    }
    if (prior.listed !== field.listed) result.push(`${field.label} · 목록 표시 ${field.listed ? "사용" : "해제"}`);
    if (prior.maxLength !== field.maxLength) {
      result.push(`${field.label} · 최대 길이 ${prior.maxLength || "제한 없음"} → ${field.maxLength || "제한 없음"}`);
    }
  }
  for (const prior of plan.before) {
    if (!plan.after.some((value) => value.id === prior.id)) result.push(`${prior.label} 항목 삭제`);
  }
  if (plan.before.map((value) => value.id).join() !== plan.after.map((value) => value.id).join()) {
    result.push(`표시 순서: ${plan.after.map((value) => value.label).join(", ") || "항목 없음"}`);
  }
  return result;
}

export function MaterialWorkspaceSample() {
  const [current, setCurrent] = useState(initialFields);
  const [draft, setDraft] = useState(
    initialFields.map((field) => field.id === "prop_2" ? { ...field, label: "재고 수량" } : field),
  );
  const [version, setVersion] = useState(1);
  const [history, setHistory] = useState<Plan[]>([{
    id: 1,
    version: 1,
    status: "applied",
    before: [],
    after: initialFields,
  }]);
  const nextField = useRef(3), nextPlan = useRef(2);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expanded, setExpanded] = useState<number[]>([]);
  const [action, setAction] = useState<{ kind: "apply" | "discard"; plan: Plan } | null>(null);
  const [message, setMessage] = useState("예: ‘수량’을 ‘재고 수량’으로 바꾼 초안입니다. 변경 검토를 눌러보세요.");
  const [template, setTemplate] = useState("{{이름}} 변경");
  const [savedTemplate, setSavedTemplate] = useState(template);
  const [typeName, setTypeName] = useState("상품"), [savedTypeName, setSavedTypeName] = useState("상품");
  const review = () => {
    const invalid: Record<string, string> = {};
    for (const field of draft) {
      if (!field.label.trim()) invalid[`${field.id}.label`] = "항목 이름을 입력하세요.";
      if (
        field.type === "text" && field.maxLength !== "" &&
        (!Number.isInteger(Number(field.maxLength)) || Number(field.maxLength) < 1)
      ) invalid[`${field.id}.maxLength`] = "최대 길이는 1 이상의 정수로 입력하세요.";
    }
    setErrors(invalid);
    if (Object.keys(invalid).length) {
      setMessage("항목 이름과 최대 길이를 확인하세요.");
      return;
    }
    if (equal(current, draft)) {
      setMessage("바뀐 항목이 없습니다. 입력 항목을 수정해보세요.");
      return;
    }
    const plan: Plan = {
      id: nextPlan.current++,
      version: version + 1,
      status: "reviewed",
      before: structuredClone(current),
      after: structuredClone(draft),
    };
    setHistory((prior) => [plan, ...prior]);
    setExpanded((prior) => [...prior, plan.id]);
    setHistoryOpen(true);
    setMessage("변경 이력에 검토할 변경안을 추가했습니다. 입력을 더 수정해도 이 변경안은 유지됩니다.");
  };
  const execute = () => {
    if (!action) return;
    const { kind, plan } = action;
    if (kind === "apply" && plan.version !== version + 1) {
      setMessage("현재 버전이 바뀌었습니다. 입력 항목에서 다시 검토하세요.");
      setAction(null);
      return;
    }
    setHistory((prior) =>
      prior.map((value) =>
        value.id === plan.id ? { ...value, status: kind === "apply" ? "applied" : "discarded" } : value
      )
    );
    if (kind === "apply") {
      setCurrent(structuredClone(plan.after));
      setVersion(plan.version);
    }
    setMessage(
      kind === "apply"
        ? `예시 버전 ${plan.version}을 적용했습니다.`
        : "변경안을 폐기했습니다. 현재 입력 초안과 적용된 버전은 유지됩니다.",
    );
    setAction(null);
  };
  return (
    <div className="settings samples-stack">
      <MaterialSettingsSection
        title="기본 정보"
        summary={`${savedTypeName} · 사용 중`}
        state={{ dirty: typeName !== savedTypeName, busy: false }}
      >
        <Field label="종류 이름">
          {(props) => (
            <input
              {...props}
              className="input"
              value={typeName}
              onChange={(event) => setTypeName(event.target.value)}
            />
          )}
        </Field>
        <div className="settings-section-footer">
          <div className="actions schema-actions">
            <button type="button" className="btn" onClick={() => setTypeName(savedTypeName)}>변경 취소</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSavedTypeName(typeName);
                setMessage("예시 기본 정보를 저장했습니다.");
              }}
            >
              저장
            </button>
          </div>
        </div>
      </MaterialSettingsSection>
      <MaterialSettingsSection
        title="입력 항목"
        summary={`${draft.length}개 항목`}
        initialOpen
        state={{ dirty: !equal(current, draft), busy: false }}
      >
        <PropertyList
          fields={draft}
          errors={errors}
          onChange={(fields) => {
            setDraft(fields);
            setErrors({});
          }}
        />
        <div>
          <BodyAction
            icon="create"
            onClick={() =>
              setDraft([...draft, {
                id: `prop_${nextField.current++}`,
                label: "새 항목",
                type: "text",
                required: false,
                listed: false,
                maxLength: "",
              }])}
          >
            항목 추가
          </BodyAction>
        </div>
        <div className="settings-section-footer">
          <div className="actions schema-actions">
            <button type="button" className="btn" onClick={() => setDraft(structuredClone(current))}>변경 취소</button>
            <button type="button" className="btn btn-primary" onClick={review}>변경 검토</button>
          </div>
        </div>
      </MaterialSettingsSection>
      <MaterialSettingsSection
        title="기록 자동 완성"
        summary="종류별 문구"
        state={{ dirty: template !== savedTemplate, busy: false }}
      >
        <Field label="변경 기록 문구">
          {(props) => (
            <textarea
              {...props}
              className="input"
              rows={3}
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
            />
          )}
        </Field>
        <div>
          <BodyAction icon="reset" onClick={() => setTemplate("{{이름}} 변경")}>기본 문구로 되돌리기</BodyAction>
        </div>
        <div className="settings-section-footer">
          <div className="actions schema-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                setSavedTemplate(template);
                setMessage("예시 기록 문구를 저장했습니다.");
              }}
            >
              저장
            </button>
          </div>
        </div>
      </MaterialSettingsSection>
      <MaterialSettingsSection
        title="변경 이력"
        summary={`현재 버전 ${version}`}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      >
        <CollectionList label="변경 이력 예시">
          {history.map((plan) => {
            const open = expanded.includes(plan.id);
            const id = `sample-plan-${plan.id}`;
            return (
              <li key={plan.id}>
                <div className="related-item schema-history-row" data-expanded={open || undefined}>
                  <h3 className="related-item-title">
                    <button
                      type="button"
                      className="material-section-toggle"
                      aria-expanded={open}
                      aria-controls={id}
                      onClick={() =>
                        setExpanded((prior) => open ? prior.filter((value) => value !== plan.id) : [...prior, plan.id])}
                    >
                      <span>입력 항목 변경</span>
                      <span className="secondary">
                        버전 {plan.version} ·{" "}
                        {plan.status === "applied" ? "적용됨" : plan.status === "discarded" ? "폐기됨" : "검토 완료"}
                      </span>
                    </button>
                  </h3>
                  <div id={id} hidden={!open} className="related-preview">
                    <PropertyDefinition fields={plan.after} />
                    <div className="schema-history-result">
                      <h4 className="section-title">변경 결과 · 버전 {plan.version - 1} → {plan.version}</h4>
                      <ul>{changes(plan).map((change, index) => <li key={index}>{change}</li>)}</ul>
                      <p className="secondary">
                        {plan.status === "applied"
                          ? "예시 입력 항목에 적용했습니다."
                          : plan.status === "discarded"
                          ? "폐기한 변경안입니다. 적용된 버전은 유지됩니다."
                          : "당시 입력 항목의 읽기 전용 사본입니다. 아직 적용하지 않았습니다."}
                      </p>
                    </div>
                    {plan.status === "reviewed" && (
                      <div className="settings-section-footer">
                        <div className="actions schema-actions">
                          <button
                            type="button"
                            className="btn btn-danger"
                            onClick={() => setAction({ kind: "discard", plan })}
                          >
                            폐기
                          </button>
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => setAction({ kind: "apply", plan })}
                          >
                            변경 적용
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </CollectionList>
      </MaterialSettingsSection>
      <p className="secondary samples-status" role="status">{message}</p>
      <ConfirmDialog
        open={!!action}
        title={action?.kind === "discard" ? "변경안을 폐기할까요?" : "변경안을 적용할까요?"}
        message={action?.kind === "discard"
          ? "이 변경안을 더 이상 적용하지 않습니다. 입력 초안과 현재 버전은 유지됩니다."
          : `예시 버전 ${action?.plan.version}의 입력 항목을 적용합니다.`}
        danger={action?.kind === "discard"}
        confirmLabel={action?.kind === "discard" ? "변경안 폐기" : "변경 적용"}
        onCancel={() => setAction(null)}
        onConfirm={execute}
      />
    </div>
  );
}
