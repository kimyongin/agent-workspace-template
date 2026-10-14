import { MaterialSettingsSection } from "./MaterialSettingsSection.tsx";
import type { EntitySchemaChange } from "@contracts/entity-schema-change.ts";
import { materialSettingsPath } from "./material-settings-path.ts";
import {
  fieldSummary,
  fieldTypeLabel,
  schemaChangeLabels,
  schemaDiffLabel,
  schemaDiffValueLabel,
  schemaValueLabel,
} from "./schema-labels.ts";
import { SchemaRepresentativeSetting } from "./SchemaRepresentativeSetting.tsx";
import { MigrationStart } from "./SchemaMigrationJobs.tsx";
import { Link, useLocation, useNavigate } from "react-router";
import { ConversionEditor } from "./ConversionEditor.tsx";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { EntityField, EntitySchemaVersion, EntityType } from "@contracts/entity-type.ts";
import { useSchemaChangeEditor } from "./schema-change-editor.ts";
import type { EditState } from "./schema-change-editor.ts";
import { Field } from "../../components/Field.tsx";
import { fieldInputPolicy } from "./field-input-policy.ts";
import { ConfirmDialog } from "../../components/Modal.tsx";
import { fieldType } from "../entity/property-fields.tsx";
const optionLabel = (labels: Record<string, string> | undefined, code: string) =>
  labels && Object.hasOwn(labels, code) ? labels[code] : code;
const numericConditionNames: Record<string, string> = {
  minLength: "최소 길이",
  maxLength: "최대 길이",
  minimum: "최소값",
  maximum: "최대값",
  default: "기본값",
};
export function SchemaEditor(
  {
    type,
    definition,
    onApplied,
    onState,
    disabled = false,
    betweenSections,
    historyContent,
    historyInitiallyOpen = false,
  }: {
    type: EntityType;
    definition: EntitySchemaVersion;
    onApplied: (change?: EntitySchemaChange) => Promise<string>;
    onState: (state: EditState) => void;
    disabled?: boolean;
    betweenSections?: ReactNode;
    historyContent?: ReactNode;
    historyInitiallyOpen?: boolean;
  },
) {
  const location = useLocation(), navigate = useNavigate();
  const [propertiesOpen, setPropertiesOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(historyInitiallyOpen);
  const [reviewOpen, setReviewOpen] = useState(true);
  const [discardConfirm, setDiscardConfirm] = useState(false);
  const [openFields, setOpenFields] = useState<string[]>([]);
  const [advancedFields, setAdvancedFields] = useState<string[]>([]);
  const [deleteKey, setDeleteKey] = useState<string | null>(null);
  const propertiesHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const fieldElements = useRef<Record<string, HTMLElement | null>>({});
  const onFieldKeysChanged = (replacements: Record<string, string>) => {
    setOpenFields((keys) => keys.map((key) => replacements[key] ?? key));
    setAdvancedFields((keys) => keys.map((key) => replacements[key] ?? key));
  };
  const onInvalidField = (key: string, includeSelect: boolean, condition?: string) => {
    setPropertiesOpen(true);
    setAdvancedFields((keys) => keys.includes(key) ? keys : [...keys, key]);
    setOpenFields((keys) => keys.includes(key) ? keys : [...keys, key]);
    requestAnimationFrame(() => {
      const element = fieldElements.current[key];
      element?.scrollIntoView({ block: "nearest" });
      if (!element) return;
      const input = [...element.querySelectorAll<HTMLInputElement>("[data-schema-setting]")].find((input) =>
        input.dataset.schemaSetting === condition
      ) ??
        element.querySelector<HTMLInputElement>(
          includeSelect ? "input:not([disabled]),select:not([disabled])" : "input:not([disabled])",
        );
      input?.scrollIntoView({ block: "nearest" });
      input?.focus();
    });
  };
  const editor = useSchemaChangeEditor({
    type,
    definition,
    onApplied,
    onState,
    disabled,
    selectionSearch: location.search,
    onFieldKeysChanged,
    onInvalidField,
    onReviewed: () => {
      setPropertiesOpen(false);
      setHistoryOpen(true);
      setReviewOpen(true);
      requestAnimationFrame(() => {
        reviewHeading.current?.scrollIntoView({ block: "start" });
        reviewHeading.current?.focus();
      });
    },
  });
  const {
    draft,
    unreservedFields,
    changedFields,
    changeCount,
    unsupportedNumericInputs,
    plan,
    changes,
    numericDrafts,
    migration,
    fieldError,
    error,
    message,
    dirty,
    busy,
    uncertain,
    readBusy,
    startState,
    analysisPending,
  } = editor.view;
  const {
    editField,
    editNumeric,
    editFlag,
    moveField,
    loadPlan,
  } = editor;
  useEffect(() => {
    if (plan?.id) {
      setHistoryOpen(true);
      setReviewOpen(true);
    }
  }, [plan?.id]);
  useEffect(() => {
    if (historyInitiallyOpen) setHistoryOpen(true);
  }, [historyInitiallyOpen]);
  const reviewSaved = propertiesOpen && plan?.status === "invalid" && plan.analysis?.status === "succeeded";
  const analysisNeeded = plan && !dirty && !["analyzing", "applied", "cancelled", "stale"].includes(plan.status) &&
    (!plan.analysis || plan.analysis.status === "failed");
  const openEditing = () => {
    setPropertiesOpen(true);
    requestAnimationFrame(() => {
      propertiesHeading.current?.scrollIntoView({ block: "start" });
      propertiesHeading.current?.focus();
    });
  };
  const moveInput = (key: string, offset: number) => {
    moveField(key, offset);
    requestAnimationFrame(() => {
      const element = fieldElements.current[key];
      const buttons = element?.querySelectorAll<HTMLButtonElement>(".schema-order-actions button");
      const same = buttons?.[offset < 0 ? 0 : 1];
      if (same && !same.matches(":disabled")) same.focus();
      else {(element?.querySelector<HTMLButtonElement>(".schema-order-actions button:not(:disabled)") ??
          element?.querySelector<HTMLButtonElement>("h3 button"))?.focus();}
    });
  };
  const newEditing = async () => {
    if (busy || uncertain || dirty || readBusy || disabled || !await editor.refreshDefinition()) return;
    requestAnimationFrame(() => {
      if (!propertiesHeading.current) return;
      editor.startNewChange();
      const params = new URLSearchParams(location.search);
      params.delete("change_id");
      navigate(`${location.pathname}?${params}`);
      openEditing();
    });
  };
  return (
    <div className="schema-settings">
      {error && <p role="alert" className="error-text">{error}</p>}
      {message && <p role="status">{message}</p>}
      <div className="schema-settings-grid">
        <section className="schema-work-area" aria-label="입력 항목">
          <div className="schema-area-heading">
            <h2
              id="schema-properties-title"
              ref={propertiesHeading}
              tabIndex={-1}
            >
              <button
                className="material-section-toggle"
                type="button"
                aria-expanded={propertiesOpen}
                aria-label="입력 항목"
                aria-controls="schema-property-inputs"
                onClick={() => {
                  if (
                    !propertiesOpen && plan && ["applied", "cancelled", "stale"].includes(plan.status)
                  ) void newEditing();
                  else setPropertiesOpen(!propertiesOpen);
                }}
              >
                <span>입력 항목</span>
                <span className="secondary">
                  {busy
                    ? "저장 중…"
                    : uncertain
                    ? "결과 확인 필요"
                    : dirty
                    ? "수정 중"
                    : `${draft.display.order.length}개 항목`}
                </span>
              </button>
            </h2>
          </div>
          <div hidden={!propertiesOpen} className="schema-input-content">
            <p className="secondary">수량·단위처럼 자료에 입력할 항목을 설정하세요.</p>
            <fieldset
              id="schema-property-inputs"
              hidden={!propertiesOpen}
              className="settings-fields"
              disabled={busy || uncertain || disabled || readBusy || startState.busy || startState.uncertain}
            >
              <SchemaRepresentativeSetting
                draft={draft}
                disabled={Boolean(plan?.recovery)}
                chooseRepresentative={editor.chooseRepresentative}
              />
              {draft.display.order.map((key, index) => {
                const f = draft.schema.properties[key],
                  scalar = fieldType(f) ?? "string";
                return (
                  <section
                    className="schema-field"
                    key={key}
                    aria-label={`${f.title || "새 항목"} 속성`}
                    ref={(element) => {
                      fieldElements.current[key] = element;
                    }}
                  >
                    <div className="schema-field-heading">
                      <h3>
                        <button
                          className="material-section-toggle"
                          type="button"
                          aria-label={`${f.title || "새 항목"} 속성 편집`}
                          aria-expanded={openFields.includes(key)}
                          aria-controls={`schema-field-${key}`}
                          onClick={() =>
                            setOpenFields((keys) =>
                              keys.includes(key) ? keys.filter((value) => value !== key) : [...keys, key]
                            )}
                        >
                          <span>{f.title || "새 항목"}</span>
                          <span className="secondary">
                            <span>{fieldTypeLabel(f)}</span>
                            {draft.schema.required.includes(key) && <span className="schema-badge">필수</span>}
                            {draft.display.archived.includes(key) && <span className="schema-badge">사용 중지</span>}
                            {changedFields.includes(key) && <span className="schema-badge">변경됨</span>}
                            {fieldError === key && <span className="schema-badge error-text">오류</span>}
                          </span>
                        </button>
                      </h3>
                      <div className="schema-order-actions">
                        <button
                          type="button"
                          className="btn"
                          aria-label={`${f.title || "새 항목"} 위로`}
                          disabled={index === 0 || Boolean(plan?.recovery)}
                          onClick={() => moveInput(key, -1)}
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn"
                          aria-label={`${f.title || "새 항목"} 아래로`}
                          disabled={index === draft.display.order.length - 1 || Boolean(plan?.recovery)}
                          onClick={() => moveInput(key, 1)}
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                    <fieldset
                      className="settings-fields"
                      id={`schema-field-${key}`}
                      hidden={!openFields.includes(key)}
                      disabled={Boolean(plan?.recovery)}
                    >
                      <Field label="항목 이름">
                        {(p) => (
                          <input
                            {...p}
                            className="input"
                            maxLength={80}
                            data-schema-setting="title"
                            value={f.title ?? ""}
                            onChange={(e) => editField(key, { ...f, title: e.target.value })}
                          />
                        )}
                      </Field>
                      <Field label="데이터 타입">
                        {(p) => (
                          <select
                            {...p}
                            className="input"
                            data-schema-setting="type"
                            value={f.enum ? "select" : f.format === "date" ? "date" : scalar}
                            onChange={(e) => {
                              const value = e.target.value;
                              editField(
                                key,
                                fieldInputPolicy({
                                  type: value === "date" || value === "select" ? "string" : value as "string",
                                  title: f.title,
                                  description: f.description,
                                  ...(value === "date"
                                    ? { format: "date" as const }
                                    : value === "select"
                                    ? { enum: ["option_1"] }
                                    : {}),
                                  ...(key === draft.display.representative ? { minLength: 1 } : {}),
                                }, draft.schema.required.includes(key)),
                              );
                            }}
                          >
                            <option value="string">텍스트</option>
                            <option value="integer">정수</option>
                            <option value="number">숫자</option>
                            <option value="date">날짜</option>
                            <option value="boolean">참·거짓</option>
                            <option value="select">단일 선택</option>
                          </select>
                        )}
                      </Field>
                      {f.enum && (
                        <div className="schema-options">
                          <h4>선택 항목</h4>
                          {f.enum.filter((value) => value !== null).map((code, i) => (
                            <div className="schema-option-row" key={code!}>
                              <Field label={`선택 항목 ${i + 1}`}>
                                {(props) => (
                                  <input
                                    {...props}
                                    className="input"
                                    maxLength={80}
                                    disabled={unreservedFields.includes(key)}
                                    value={optionLabel(draft.display.option_labels[key], code!)}
                                    onChange={(event) => editor.editOptionLabel(key, code!, event.target.value)}
                                  />
                                )}
                              </Field>
                              <button
                                type="button"
                                className="btn"
                                aria-label={`선택 항목 ${i + 1} 제거`}
                                disabled={f.enum!.filter((value) =>
                                  value !== null
                                ).length <= 1}
                                onClick={() =>
                                  editField(key, { ...f, enum: f.enum!.filter((value) => value !== code) })}
                              >
                                제거
                              </button>
                            </div>
                          ))}
                          <button
                            type="button"
                            className="btn"
                            disabled={f.enum.filter((value) => value !== null).length >= 128}
                            onClick={() => {
                              let number = 1;
                              while (f.enum!.includes(`option_${number}`)) {
                                number++;
                              }
                              editField(key, { ...f, enum: [...f.enum!, `option_${number}`] });
                            }}
                          >
                            선택 항목 추가
                          </button>
                          <p className="secondary">
                            선택 항목을 제거하면 기존 자료의 해당 값을 검토해야 합니다.
                          </p>
                          {unreservedFields.includes(key) && (
                            <p className="secondary">새 속성의 표시 이름은 변경 검토 후 편집할 수 있습니다.</p>
                          )}
                        </div>
                      )}
                      <details
                        className="schema-advanced"
                        open={advancedFields.includes(key)}
                        onToggle={(event) => {
                          const open = event.currentTarget.open;
                          setAdvancedFields((keys) =>
                            open ? keys.includes(key) ? keys : [...keys, key] : keys.filter((value) => value !== key)
                          );
                        }}
                      >
                        <summary>추가 설정</summary>
                        <div className="form">
                          <label>
                            <input
                              type="checkbox"
                              checked={draft.schema.required.includes(key)}
                              onChange={(e) => editFlag(key, "required", e.target.checked)}
                            />{" "}
                            필수 입력
                          </label>
                          <label>
                            <input
                              type="checkbox"
                              aria-label={`${f.title || "새 항목"} 목록에 표시`}
                              checked={draft.display.list_columns.includes(key)}
                              disabled={unreservedFields.includes(key) || draft.display.archived.includes(key)}
                              onChange={(event) => editFlag(key, "list_columns", event.target.checked)}
                            />{" "}
                            목록에 표시
                          </label>
                          {unreservedFields.includes(key) && (
                            <p className="secondary">
                              새 항목은 변경 검토 후 자료 이름과 목록 표시를 선택할 수 있습니다.
                            </p>
                          )}

                          <Field label="설명">
                            {(p) => (
                              <textarea
                                {...p}
                                className="input"
                                maxLength={1000}
                                value={f.description ?? ""}
                                onChange={(e) => editField(key, { ...f, description: e.target.value })}
                              />
                            )}
                          </Field>
                          {unsupportedNumericInputs.filter(([address]) => address.startsWith(key + ":")).map(
                            ([address, raw]) => {
                              const label = numericConditionNames[address.split(":")[1]];
                              return (
                                <div key={address}>
                                  <p className="error-text">
                                    현재 타입에서 사용할 수 없는 이전 조건 입력입니다. 입력을 확인하고 제거하세요.
                                  </p>
                                  <Field label={`이전 ${label} 입력`}>
                                    {(props) => <input {...props} className="input" value={raw} readOnly />}
                                  </Field>
                                  <button
                                    className="btn"
                                    type="button"
                                    aria-label={`${f.title ?? "속성"} 이전 ${label} 입력 제거`}
                                    onClick={() => editor.removeNumericInput(address)}
                                  >
                                    이전 조건 입력 제거
                                  </button>
                                </div>
                              );
                            },
                          )}
                          {scalar === "string" && !f.format && (
                            <div className="schema-constraints">
                              {(["minLength", "maxLength"] as const).map((name) => (
                                <Field key={name} label={name === "minLength" ? "최소 길이" : "최대 길이"}>
                                  {(p) => (
                                    <input
                                      {...p}
                                      className="input"
                                      type="text"
                                      inputMode="decimal"
                                      min={0}
                                      max={4096}
                                      data-schema-setting={name}
                                      value={numericDrafts[key + ":" + name] ?? f[name] ?? ""}
                                      onChange={(e) => editNumeric(key, name, e.target.value)}
                                    />
                                  )}
                                </Field>
                              ))}
                            </div>
                          )}
                          {["integer", "number"].includes(scalar) && (
                            <div className="schema-constraints">
                              {(["minimum", "maximum"] as const).map((name) => (
                                <Field key={name} label={name === "minimum" ? "최소값" : "최대값"}>
                                  {(p) => (
                                    <input
                                      {...p}
                                      className="input"
                                      type="text"
                                      inputMode="decimal"
                                      step="any"
                                      data-schema-setting={name}
                                      value={numericDrafts[key + ":" + name] ?? f[name] ?? ""}
                                      onChange={(e) => editNumeric(key, name, e.target.value)}
                                    />
                                  )}
                                </Field>
                              ))}
                            </div>
                          )}
                          <Field label="생성 기본값 (기존 자료에는 채우지 않음)">
                            {(p) => (
                              <select
                                {...p}
                                className="input"
                                value={f.default === undefined ||
                                    f.default === null
                                  ? "unset"
                                  : "value"}
                                onChange={(e) =>
                                  editField(key, {
                                    ...f,
                                    default: e.target.value === "unset"
                                      ? undefined
                                      : e.target.value === "null"
                                      ? null
                                      : scalar === "boolean"
                                      ? false
                                      : ["integer", "number"].includes(scalar)
                                      ? 0
                                      : f.enum?.find((v) => v !== null) ?? "",
                                  })}
                              >
                                <option value="unset">설정 안 함</option>
                                <option value="value">값 지정</option>
                              </select>
                            )}
                          </Field>
                          {f.default !== undefined && f.default !== null && (
                            <Field label="기본값">
                              {(p) =>
                                scalar === "boolean"
                                  ? (
                                    <select
                                      {...p}
                                      className="input"
                                      value={String(f.default)}
                                      onChange={(e) => editField(key, { ...f, default: e.target.value === "true" })}
                                    >
                                      <option value="false">거짓</option>
                                      <option value="true">참</option>
                                    </select>
                                  )
                                  : f.enum
                                  ? (
                                    <select
                                      {...p}
                                      className="input"
                                      value={String(f.default)}
                                      onChange={(e) => editField(key, { ...f, default: e.target.value })}
                                    >
                                      {f.enum!.filter((v) => v !== null).map((code) => (
                                        <option key={code} value={code!}>
                                          {optionLabel(draft.display.option_labels[key], code!)}
                                        </option>
                                      ))}
                                    </select>
                                  )
                                  : (
                                    <input
                                      {...p}
                                      className="input"
                                      type={f.format === "date" ? "date" : "text"}
                                      inputMode={["integer", "number"].includes(scalar) ? "decimal" : undefined}
                                      data-schema-setting="default"
                                      value={numericDrafts[key + ":default"] ?? String(f.default)}
                                      onChange={(e) =>
                                        ["integer", "number"].includes(scalar)
                                          ? editNumeric(key, "default", e.target.value)
                                          : editField(key, { ...f, default: e.target.value })}
                                    />
                                  )}
                            </Field>
                          )}
                          <p className="secondary">
                            사용 중지는 기존 값을 유지합니다. 삭제는 검토·적용 후 반영됩니다.
                          </p>
                          <div className="schema-actions">
                            <button
                              className="btn"
                              type="button"
                              disabled={unreservedFields.includes(key) ||
                                key === draft.display.representative}
                              onClick={() =>
                                editor.setFieldInactive(
                                  key,
                                  !draft.display.archived.includes(key),
                                )}
                            >
                              {draft.display.archived.includes(key) ? "다시 사용" : "사용 중지"}
                            </button>
                            <button
                              className="btn btn-danger"
                              type="button"
                              disabled={key === draft.display.representative}
                              onClick={() => setDeleteKey(key)}
                            >
                              <svg
                                width="18"
                                height="18"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.5"
                                aria-hidden="true"
                              >
                                <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7" />
                              </svg>항목 삭제
                            </button>
                          </div>
                          {key === draft.display.representative && (
                            <p className="secondary">
                              자료 이름으로 쓰는 항목입니다. 위에서 자료 이름으로 사용할 다른 항목을 선택한 뒤 사용
                              중지하거나 삭제하세요.
                            </p>
                          )}
                        </div>
                      </details>
                    </fieldset>
                  </section>
                );
              })}
            </fieldset>
            <div className="schema-actions">
              <button
                className="btn"
                type="button"
                disabled={busy || uncertain || disabled || readBusy || startState.busy || startState.uncertain ||
                  Boolean(plan?.recovery) || Object.keys(draft.schema.properties).length >= 64}
                onClick={() => {
                  setPropertiesOpen(true);
                  const key = editor.addField();
                  if (key) setOpenFields((keys) => [...keys, key]);
                }}
              >
                항목 추가
              </button>
            </div>
            <p className="secondary">항목 순서는 입력·상세·목록에 함께 적용됩니다.</p>
            {!plan?.recovery && (!plan || dirty || reviewSaved) && (
              <div className="settings-section-footer schema-review-actions">
                <p className="secondary">
                  {dirty
                    ? `변경 ${changeCount}개 · 검토 후 자료에 적용됩니다.`
                    : plan && plan.status !== "applied"
                    ? "저장한 변경안입니다. 아직 자료에 적용되지 않았습니다."
                    : "현재 적용된 설정입니다."}
                </p>
                <div className="actions">
                  <button
                    className="btn"
                    disabled={busy || uncertain || !dirty}
                    onClick={editor.cancelEditing}
                  >
                    변경 취소
                  </button>
                  <button
                    className="btn btn-primary"
                    disabled={busy || disabled || readBusy || startState.busy || startState.uncertain ||
                      Boolean(plan?.recovery) || (!dirty && !uncertain && !reviewSaved)}
                    onClick={() => void editor.review()}
                  >
                    {busy ? "처리 중…" : uncertain ? "같은 요청 다시 확인" : "변경 검토"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
      {betweenSections}
      <MaterialSettingsSection
        title="변경 이력"
        summary={uncertain
          ? "결과 확인 필요"
          : busy
          ? "처리 중…"
          : changes.some((c) => c.status === "analyzing")
          ? "검토 중"
          : changes.filter((c) => !["applied", "cancelled"].includes(c.status)).length
          ? `미적용 ${changes.filter((c) => !["applied", "cancelled"].includes(c.status)).length}건`
          : `현재 버전 ${definition.schema_version}`}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      >
        <div className="schema-history-list">
          {changes.map((c) => (
            <section
              className="schema-history-row"
              key={c.id}
              aria-label={`변경안 ${new Date(c.created_at).toLocaleString()}`}
            >
              <button
                type="button"
                className="material-section-toggle"
                aria-expanded={plan?.id === c.id && reviewOpen}
                aria-controls={`schema-review-${c.id}`}
                disabled={plan?.id !== c.id && (busy || uncertain || readBusy || dirty)}
                onClick={() => {
                  if (plan?.id === c.id) {
                    setReviewOpen(!reviewOpen);
                    return;
                  }
                  const params = new URLSearchParams(location.search);
                  params.set("change_id", c.id);
                  navigate(`${location.pathname}?${params}`);
                  void loadPlan(c.id);
                }}
              >
                <span>
                  입력 항목 변경 <span className="secondary">{new Date(c.created_at).toLocaleString()}</span>
                </span>
                <span className="secondary">{schemaChangeLabels[c.status]}</span>
              </button>
              <div id={`schema-review-${c.id}`} hidden={plan?.id !== c.id || !reviewOpen}>
                {plan?.id === c.id && (
                  <section className="schema-summary" aria-label="속성 변경 요약" data-change-version={plan.version}>
                    <h3 ref={reviewHeading} tabIndex={-1}>변경 검토</h3>
                    {!["applied", "cancelled"].includes(plan.status) && (
                      <p>
                        아직 적용되지 않았습니다. 변경 내용과 기존 자료에 미치는 영향을 확인하세요.
                      </p>
                    )}
                    <Link
                      to={{
                        pathname: location.pathname,
                        search: (() => {
                          const params = new URLSearchParams(location.search);
                          params.set("change_id", plan.id);
                          return `?${params}`;
                        })(),
                      }}
                    >
                      이 변경안 직접 링크
                    </Link>
                    {plan.recovery && (
                      <section aria-label="복구안 원본">
                        <p>
                          보존 원본을 사용하는 새 버전의 복구안입니다. 영향 분석 후 현재 값 → 복구 값 미리보기를
                          확인하고 실행하세요.
                        </p>
                        <Link
                          to={materialSettingsPath(plan.type_id, location.search, {
                            job_id: plan.recovery.source_job_id,
                          })}
                        >
                          원본 작업 확인
                        </Link>
                        <p className="secondary">
                          원본 보존 만료:{" "}
                          <time dateTime={plan.recovery.source_expires_at}>
                            {new Date(plan.recovery.source_expires_at).toLocaleString()}
                          </time>
                        </p>
                        <p>
                          복구안의 속성과 변환 규칙은 원본 기준으로 유지됩니다. 보완이 필요하면 현재 자료를 직접
                          수정하거나 새 변경안을 준비하고 다시 분석하세요.
                        </p>
                      </section>
                    )}
                    <p>
                      상태: {schemaChangeLabels[plan.status]} ·{" "}
                      {plan.change_kind === "compatible" ? "검토 완료 후 적용 가능" : "자료 값 변환 필요"}
                    </p>
                    <dl className="schema-change-list">
                      {plan.diff.map((d, i) => (
                        <div key={i}>
                          <dt>{schemaDiffLabel(d.path, plan.target, definition)}</dt>
                          <dd>
                            {d.before_present ? schemaDiffValueLabel(d.path, d.before, definition) : "설정 안 함"}
                            {" → "}
                            {d.after_present ? schemaDiffValueLabel(d.path, d.after, plan.target) : "설정 안 함"}
                            {d.kind === "migration_required" && <span className="secondary">· 값 변환 필요</span>}
                          </dd>
                        </div>
                      ))}
                    </dl>
                    {plan.analysis && plan.status !== "cancelled" && (
                      <div className="schema-analysis-status" role="status">
                        <strong>
                          {{
                            queued: "검토 접수",
                            running: "기존 자료 확인 중",
                            succeeded: plan.analysis.failed ? "보완 필요" : "검토 완료",
                            failed: "검토 실패",
                          }[plan.analysis.status]}
                        </strong>
                        <p>
                          확인한 자료 {plan.analysis.processed}/{plan.analysis.total}개 · 문제 {plan.analysis.failed}개
                        </p>
                        {plan.analysis.status === "succeeded" &&
                          plan.analysis.failed === 0 && (
                          <p className="secondary">
                            기존 자료가 새 입력 조건을 충족합니다.
                          </p>
                        )}
                        {dirty && (
                          <p className="error-text">
                            검토 이후 입력이 바뀌었습니다. 변경 검토를 다시 진행하세요.
                          </p>
                        )}
                      </div>
                    )}
                    {plan.analysis && plan.status !== "cancelled" && (
                      <details className="schema-result-details">
                        <summary>자료별 결과</summary>
                        <p>
                          변경 {plan.analysis.changed}개 · 무변경 {plan.analysis.unchanged}개 · 값 제거{" "}
                          {plan.analysis.removed}개 · 값 보완 {plan.analysis.replacements}개
                        </p>
                        {plan.analysis.errors.map((result) => (
                          <div key={result.entity_id}>
                            <strong>{result.entity_id}</strong>
                            <ul>
                              {result.fields.map((field, index) => (
                                <li key={index}>
                                  {schemaDiffLabel(field.path, plan.target, definition)}: {field.message}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                        {!plan.analysis.errors.length && <p>표시할 문제 항목이 없습니다.</p>}
                      </details>
                    )}
                    {plan.change_kind === "migration_required" || plan.recovery || migration.rules.length > 0 ||
                        migration.overrides.length > 0 || (plan.analysis?.failed ?? 0) > 0
                      ? (
                        <ConversionEditor
                          key={plan.id}
                          plan={plan}
                          migration={migration}
                          onChange={editor.editMigration}
                          disabled={busy || uncertain || disabled || Boolean(plan.recovery) ||
                            ["applied", "cancelled", "stale"].includes(plan.status)}
                        />
                      )
                      : null}
                    {plan.analysis && plan.analysis.failed > 0 && (
                      <p>
                        실패한 자료 값을 확인하여 직접 수정하거나 값 변환 변경을 준비한 뒤 다시 분석하세요. 실패가
                        있으면 게시할 수 없습니다.
                      </p>
                    )}
                    {plan.change_kind === "migration_required" && plan.executable && !dirty && !analysisPending && (
                      <MigrationStart
                        plan={plan}
                        disabled={busy || uncertain || dirty || disabled}
                        onState={editor.migrationStateChanged}
                      />
                    )}
                    {plan.change_kind === "migration_required" && (
                      <p>현재 자료와 활성 정의는 유지됩니다. 영향 분석 결과를 확인하고 값 변환 작업을 준비하세요.</p>
                    )}
                    {plan.analysis?.status === "failed" && plan.status !== "cancelled" && (
                      <p role="alert">
                        분석 작업 실패: {plan.analysis.failure_reason}. 원본은 유지됩니다. 다시 분석하세요.
                      </p>
                    )}
                    {plan.status === "stale" && (
                      <p>
                        {plan.recovery
                          ? "정의나 자료·연결이 변경되었습니다. 입력은 유지됩니다. 현재 상태를 확인하고 보완한 뒤 새 변경안을 분석하세요."
                          : "정의나 자료가 변경되었습니다. 최신 정의를 확인하고 새 변경을 만드세요."}
                      </p>
                    )}
                    <div className="schema-actions">
                      {["applied", "cancelled"].includes(plan.status)
                        ? (
                          <>
                            {plan.status === "applied" && definition.schema_version <= plan.source_schema_version && (
                              <button
                                className="btn"
                                disabled={busy || uncertain || readBusy}
                                onClick={() => void editor.refreshDefinition()}
                              >
                                최신 설정 다시 조회
                              </button>
                            )}
                          </>
                        )
                        : (
                          <>
                            <button
                              className="btn btn-danger"
                              disabled={busy || uncertain || dirty || disabled || startState.busy ||
                                startState.uncertain}
                              onClick={() => setDiscardConfirm(true)}
                            >
                              폐기
                            </button>
                            {uncertain && !dirty
                              ? (
                                <button
                                  className="btn btn-primary"
                                  disabled={busy || disabled}
                                  onClick={() => void editor.review()}
                                >
                                  같은 요청 다시 확인
                                </button>
                              )
                              : dirty
                              ? (
                                <button
                                  className="btn btn-primary"
                                  disabled={busy || disabled || readBusy}
                                  onClick={() => void editor.review()}
                                >
                                  보완 내용 검토
                                </button>
                              )
                              : analysisPending || plan.status === "analyzing"
                              ? <button className="btn btn-primary" disabled>검토 중…</button>
                              : analysisNeeded
                              ? (
                                <button
                                  className="btn btn-primary"
                                  disabled={busy || uncertain || disabled || readBusy}
                                  onClick={() => void editor.analyze()}
                                >
                                  {plan.analysis ? "검토 재시도" : "변경 검토"}
                                </button>
                              )
                              : plan.change_kind === "compatible" && plan.status !== "stale" && (
                                <button
                                  className="btn btn-primary"
                                  disabled={busy || uncertain || dirty || disabled || readBusy ||
                                    plan.status !== "ready" ||
                                    plan.analysis?.failed !== 0}
                                  onClick={() => void editor.publish()}
                                >
                                  변경 적용
                                </button>
                              )}
                          </>
                        )}
                    </div>
                  </section>
                )}
              </div>
            </section>
          ))}
          {changes.length === 0 && <p className="secondary">저장한 변경안이 없습니다.</p>}
          {editor.view.changesBefore && (
            <button
              className="btn"
              disabled={readBusy || busy || uncertain}
              onClick={() => void editor.moreChanges()}
            >
              이전 변경안 더 보기
            </button>
          )}
          <button className="btn" disabled={busy || readBusy || uncertain} onClick={() => void editor.refreshChanges()}>
            변경 이력 다시 조회
          </button>
          {historyContent}
        </div>
      </MaterialSettingsSection>
      <ConfirmDialog
        open={discardConfirm}
        title="변경안을 폐기할까요?"
        message="이 변경안은 다시 적용할 수 없습니다. 현재 자료와 적용된 설정은 유지되며 변경 이력은 남습니다."
        confirmLabel="폐기"
        danger
        confirmDisabled={busy || uncertain || dirty || disabled}
        onCancel={() => setDiscardConfirm(false)}
        onConfirm={() => {
          setDiscardConfirm(false);
          void editor.discard();
        }}
      />
      <ConfirmDialog
        open={deleteKey !== null}
        title="항목을 삭제할까요?"
        message={`‘${
          deleteKey ? draft.schema.properties[deleteKey]?.title ?? "항목" : "항목"
        }’을 삭제하는 변경안을 만듭니다. 적용하면 현재 자료의 해당 값도 제거되며 과거 기록은 유지됩니다. 아직 실제 자료는 변경되지 않습니다.`}
        confirmLabel="삭제 변경안 만들기"
        danger
        confirmDisabled={busy || uncertain || disabled || readBusy}
        onCancel={() => setDeleteKey(null)}
        onConfirm={() => {
          if (deleteKey) editor.removeField(deleteKey);
          setDeleteKey(null);
          requestAnimationFrame(() => propertiesHeading.current?.focus());
        }}
      />
    </div>
  );
}
export function SchemaVersionDiff({ before, after }: { before: EntitySchemaVersion; after: EntitySchemaVersion }) {
  const paths = [...new Set([...Object.keys(before.schema.properties), ...Object.keys(after.schema.properties)])];
  const names: Record<string, string> = {
    title: "이름",
    description: "설명",
    type: "타입",
    format: "형식",
    minLength: "최소 길이",
    maxLength: "최대 길이",
    minimum: "최소값",
    maximum: "최대값",
    enum: "선택값",
    default: "생성 기본값",
  };
  const displayNames = { representative: "대표 속성", order: "순서", list_columns: "목록 표시", archived: "보관 속성" };
  return (
    <section className="schema-version-diff" aria-label="버전 차이">
      <h3>버전 {before.schema_version} → {after.schema_version} 차이</h3>
      <ul>
        {paths.filter((key) =>
          JSON.stringify(before.schema.properties[key]) !== JSON.stringify(after.schema.properties[key]) ||
          before.schema.required.includes(key) !== after.schema.required.includes(key)
        ).map((key) => {
          const prior = before.schema.properties[key], next = after.schema.properties[key];
          const label = next?.title ?? prior?.title ?? "이름 없는 속성";
          return (
            <li key={key}>
              <strong>{label}</strong>
              {!prior ? ` · 새 속성 · ${fieldSummary(next)}` : !next ? " · 영구 삭제 (변경안)" : (
                <ul>
                  {Object.entries(names).filter(([name]) =>
                    JSON.stringify(prior[name as keyof EntityField]) !== JSON.stringify(next[name as keyof EntityField])
                  ).map(([name, title]) => (
                    <li key={name}>
                      {title}:{" "}
                      {name === "type" ? fieldSummary(prior) : schemaValueLabel(prior[name as keyof EntityField])} →
                      {" "}
                      {name === "type" ? fieldSummary(next) : schemaValueLabel(next[name as keyof EntityField])}
                    </li>
                  ))}
                </ul>
              )}
              {before.schema.required.includes(key) !== after.schema.required.includes(key) && (
                <p>
                  필수 입력: {before.schema.required.includes(key) ? "필수" : "선택"} →{" "}
                  {after.schema.required.includes(key) ? "필수" : "선택"}
                </p>
              )}
            </li>
          );
        })}
        {Object.entries(displayNames).filter(([name]) =>
          JSON.stringify(before.display[name as keyof typeof displayNames]) !==
            JSON.stringify(after.display[name as keyof typeof displayNames])
        ).map(([name, label]) => (
          <li key={name}>
            {label}: {schemaValueLabel(before.display[name as keyof typeof displayNames], before)} →{" "}
            {schemaValueLabel(after.display[name as keyof typeof displayNames], after)}
          </li>
        ))}
        {[...new Set([...Object.keys(before.display.option_labels), ...Object.keys(after.display.option_labels)])]
          .filter((key) =>
            JSON.stringify(before.display.option_labels[key]) !== JSON.stringify(after.display.option_labels[key])
          ).map((key) => (
            <li key={`options-${key}`}>
              {after.schema.properties[key]?.title ?? before.schema.properties[key]?.title ?? "선택 속성"} 표시 이름:
              {" "}
              {Object.entries(before.display.option_labels[key] ?? {}).map(([code, label]) => `${code}: ${label}`).join(
                ", ",
              ) || "없음"} →{" "}
              {Object.entries(after.display.option_labels[key] ?? {}).map(([code, label]) => `${code}: ${label}`).join(
                ", ",
              ) || "없음"}
            </li>
          ))}
      </ul>
    </section>
  );
}
