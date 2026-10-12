import { migrationNumericValues, schemaNumericValues } from "./numeric-drafts.ts";
import { MigrationStart } from "./SchemaMigrationJobs.tsx";
import { recoveryErrorMessage } from "./SchemaRecovery.tsx";
import { Link, useLocation } from "react-router";
import { ConversionEditor } from "./ConversionEditor.tsx";
import { useEffect, useRef, useState } from "react";
import type { EntityField, EntitySchemaVersion, EntityType } from "@contracts/entity-type.ts";
import type {
  EntitySchemaChange,
  EntitySchemaChangeSummary,
  MigrationPlan,
  SchemaAnalysisAccepted,
  SchemaDefinition,
  SchemaEdit,
} from "@contracts/entity-schema-change.ts";
import { api } from "../../lib/api.ts";
import { useWriteAttempt, writeErrorMessage } from "../../lib/write-attempt.ts";
import { Field } from "../../components/Field.tsx";
import { fieldType } from "../entity/property-fields.tsx";
const optionLabel = (labels: Record<string, string> | undefined, code: string) =>
  labels && Object.hasOwn(labels, code) ? labels[code] : code;
const clone = (v: SchemaDefinition) => structuredClone({ schema: v.schema, display: v.display });
type EditState = { dirty: boolean; busy: boolean; uncertain: boolean };
export function SchemaEditor(
  { type, definition, onApplied, onState, disabled = false }: {
    type: EntityType;
    definition: EntitySchemaVersion;
    onApplied: () => Promise<void>;
    onState: (state: EditState) => void;
    disabled?: boolean;
  },
) {
  const location = useLocation();
  const [draft, setDraft] = useState<SchemaDefinition>(() => clone(definition)),
    [saved, setSaved] = useState<SchemaDefinition>(() => clone(definition));
  const [plan, setPlan] = useState<EntitySchemaChange | null>(null),
    [changes, setChanges] = useState<EntitySchemaChangeSummary[]>([]),
    [refs, setRefs] = useState<Record<string, string>>({});
  const [numericDrafts, setNumericDrafts] = useState<Record<string, string>>({});
  const [migration, setMigration] = useState<MigrationPlan>({ rules: [], overrides: [] });
  const [acceptedAnalysis, setAcceptedAnalysis] = useState<string | null>(null);
  const [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [readBusy, setReadBusy] = useState(false);
  const { attempt, busy, uncertain } = useWriteAttempt();
  const mounted = useRef(true);
  const planRead = useRef<{ epoch: number; controller: AbortController | null }>({ epoch: 0, controller: null });
  const dirty = Object.keys(numericDrafts).length > 0 || JSON.stringify(draft) !== JSON.stringify(saved) ||
    JSON.stringify(migration) !== JSON.stringify(plan?.migration ?? { rules: [], overrides: [] });
  const protectedDraft = useRef({ dirty, busy, uncertain });
  protectedDraft.current = { dirty, busy, uncertain };
  const cancelPlanRead = () => {
    planRead.current.controller?.abort();
    planRead.current = { epoch: planRead.current.epoch + 1, controller: null };
  };
  const applyPlan = (value: EntitySchemaChange | null) => {
    const target = value?.target ?? definition;
    setPlan(value);
    setMigration(value?.migration ?? { rules: [], overrides: [] });
    setAcceptedAnalysis(null);
    setDraft(clone(target));
    setSaved(clone(target));
    setNumericDrafts({});
    setRefs(Object.fromEntries(Object.entries(value?.reservations ?? {}).map(([ref, key]) => [key, ref])));
  };
  useEffect(() => {
    onState({ dirty, busy, uncertain });
  }, [dirty, busy, uncertain, onState]);
  useEffect(() => () => onState({ dirty: false, busy: false, uncertain: false }), [onState]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelPlanRead();
    };
  }, []);
  useEffect(() => {
    cancelPlanRead();
    setReadBusy(false);
    applyPlan(null);
  }, [type.id, definition.schema_version]);
  const base = `/entity-types/${type.id}/schema-changes`;
  const list = (signal?: AbortSignal) =>
    api<{ items: EntitySchemaChangeSummary[] }>("GET", base, undefined, signal).then((r) => {
      if (mounted.current && !signal?.aborted) setChanges(r.items);
    });
  useEffect(() => {
    const controller = new AbortController();
    void list(controller.signal).catch((e) => {
      if (!controller.signal.aborted && mounted.current) setError(e.message);
    });
    return () => controller.abort();
  }, [type.id, definition.schema_version]);
  useEffect(() => {
    if (!plan || (plan.status !== "analyzing" && !acceptedAnalysis)) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const value = await api<EntitySchemaChange>("GET", `${base}/${plan.id}`, undefined, controller.signal);
        if (!controller.signal.aborted) {
          setPlan(value);
          if (value.status !== "analyzing") setAcceptedAnalysis(null);
          if (value.status === "analyzing") timer = setTimeout(() => void poll(), 1200);
        }
      } catch (e) {
        if (!controller.signal.aborted) {
          setError(e instanceof Error ? e.message : "분석 상태 조회 실패");
          timer = setTimeout(() => void poll(), 1200);
        }
      }
    };
    timer = setTimeout(() => void poll(), 1200);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [plan?.id, plan?.status, acceptedAnalysis]);
  const setField = (key: string, field: EntityField) =>
    setDraft((d) => ({ ...d, schema: { ...d.schema, properties: { ...d.schema.properties, [key]: field } } }));
  const setNumericField = (
    key: string,
    name: "minLength" | "maxLength" | "minimum" | "maximum" | "default",
    raw: string,
  ) => {
    setNumericDrafts((values) => ({ ...values, [key + ":" + name]: raw }));
  };
  const flag = (key: string, name: "required" | "archived" | "list_columns", value: boolean) =>
    setDraft((d) => {
      if (name === "required") {
        return {
          ...d,
          schema: {
            ...d.schema,
            required: value
              ? [...d.schema.required.filter((k) => k !== key), key]
              : d.schema.required.filter((k) => k !== key),
          },
        };
      }
      return {
        ...d,
        display: {
          ...d.display,
          [name]: value ? [...d.display[name].filter((k) => k !== key), key] : d.display[name].filter((k) => k !== key),
        },
      };
    });
  const edits = (draft: SchemaDefinition): SchemaEdit[] => {
    const result: SchemaEdit[] = [];
    for (const [key, field] of Object.entries(draft.schema.properties)) {
      const required = draft.schema.required.includes(key);
      if (refs[key]) result.push({ op: "add_property", client_ref: refs[key], field, required });
      else if (
        JSON.stringify(field) !== JSON.stringify(definition.schema.properties[key]) ||
        required !== definition.schema.required.includes(key)
      ) result.push({ op: "update_property", key, field, required });
    }
    for (const key of Object.keys(definition.schema.properties)) {
      if (!draft.schema.properties[key]) result.push({ op: "remove_property", key });
    }
    const display = {
      ...draft.display,
      option_labels: Object.fromEntries(
        Object.entries(draft.display.option_labels).filter(([key]) => !key.startsWith("new_")).map((
          [key, labels],
        ) => [
          key,
          Object.fromEntries(
            Object.entries(labels).filter(([code]) => draft.schema.properties[key]?.enum?.includes(code)),
          ),
        ]),
      ),
      order: draft.display.order.filter((k) => !k.startsWith("new_")),
      list_columns: draft.display.list_columns.filter((k) => !k.startsWith("new_")),
      archived: draft.display.archived.filter((k) => !k.startsWith("new_")),
    };
    // New keys are reserved in the first save; subsequent edits can select them for display.
    if (JSON.stringify(display) !== JSON.stringify(definition.display)) {
      const operation: SchemaEdit = { op: "set_display", display };
      if (Object.keys(draft.schema.properties).some((k) => k.startsWith("new_"))) result.unshift(operation);
      else result.push(operation);
    }
    return result;
  };
  const write = async (action: "save" | "analyze" | "apply") => {
    if (busy) return;
    setError("");
    setMessage("");
    let payload;
    try {
      payload = action === "save"
        ? {
          expected_type_version: type.version,
          expected_schema_version: definition.schema_version,
          edits: edits(schemaNumericValues(draft, numericDrafts)),
          migration: migrationNumericValues(plan?.target ?? draft, migration),
          ...(plan ? { expected_change_version: plan.version } : {}),
        }
        : action === "apply"
        ? { expected_change_version: plan!.version, analysis_id: plan!.analysis!.id }
        : { expected_change_version: plan!.version };
    } catch (e) {
      setError(e instanceof Error ? e.message : "숫자를 확인하세요.");
      return;
    }
    const path = action === "save" ? (plan ? `${base}/${plan.id}` : base) : `${base}/${plan!.id}/${action}`;
    try {
      await attempt.run(async () => {
        if (action === "analyze") {
          const accepted = await api<SchemaAnalysisAccepted>("POST", path, payload, undefined, attempt.requestKey());
          if (mounted.current) {
            setAcceptedAnalysis(accepted.analysis_id);
            setMessage("영향 분석을 접수했습니다.");
          }
          return;
        }
        const value = await api<EntitySchemaChange>(
          action === "save" && plan ? "PATCH" : "POST",
          path,
          payload,
          undefined,
          attempt.requestKey(),
        );
        if (!mounted.current) return;
        cancelPlanRead();
        setReadBusy(false);
        if (action === "save") {
          applyPlan(value);
          setMessage("변경 초안을 저장했습니다. 영향 분석을 실행하세요.");
        } else {
          setPlan(value);
          setMigration(value.migration);
          setMessage("새 속성 버전을 게시했습니다.");
          try {
            await onApplied();
          } catch {
            if (mounted.current) {
              setError("게시가 완료되었습니다. 최신 정의 조회에 실패했습니다. 정의를 다시 조회하세요.");
            }
          }
        }
      });
    } catch (e) {
      if (mounted.current) setError(plan?.recovery ? recoveryErrorMessage(e) : writeErrorMessage(e));
    }
  };
  const loadPlan = async (id: string) => {
    if (protectedDraft.current.dirty || protectedDraft.current.busy || protectedDraft.current.uncertain) {
      setReadBusy(false);
      return;
    }
    cancelPlanRead();
    const controller = new AbortController(), epoch = planRead.current.epoch;
    planRead.current.controller = controller;
    const current = () => mounted.current && !controller.signal.aborted && epoch === planRead.current.epoch;
    setReadBusy(true);
    setError("");
    try {
      const fresh = await api<EntitySchemaChange>("GET", `${base}/${id}`, undefined, controller.signal);
      if (
        current() && !protectedDraft.current.dirty && !protectedDraft.current.busy && !protectedDraft.current.uncertain
      ) {
        applyPlan(fresh);
      }
    } catch (e) {
      if (current()) setError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      if (current()) {
        planRead.current.controller = null;
        setReadBusy(false);
      }
    }
  };
  useEffect(() => {
    const selected = new URLSearchParams(location.search).get("change_id");
    if (selected && selected !== plan?.id) void loadPlan(selected);
    else setReadBusy(false);
    return cancelPlanRead;
  }, [location.search, type.id, definition.schema_version]);
  const reorder = (key: string, offset: number) =>
    setDraft((d) => {
      const order = [...d.display.order], at = order.indexOf(key), other = at + offset;
      if (other < 0 || other >= order.length) return d;
      [order[at], order[other]] = [order[other], order[at]];
      return { ...d, display: { ...d.display, order } };
    });
  return (
    <section className="settings-section" aria-labelledby="schema-editor-title">
      <h2 id="schema-editor-title" className="settings-section-title">속성·표시 · 버전 {definition.schema_version}</h2>
      <p className="secondary">
        속성 키는 바뀌지 않습니다. 보관할 필수 속성은 필수를 직접 해제하세요. 새 속성을 저장하면 키가 발급됩니다.
      </p>
      {error && <p role="alert" className="error-text">{error}</p>}
      {message && <p role="status">{message}</p>}
      <fieldset
        className="settings-fields"
        disabled={busy || uncertain || disabled || readBusy || Boolean(plan?.recovery)}
      >
        {draft.display.order.map((key, index) => {
          const f = draft.schema.properties[key],
            scalar = fieldType(f) ?? "string",
            nullable = Array.isArray(f.type) && f.type.includes("null");
          return (
            <section className="schema-field" key={key} aria-label={`${f.title ?? key} 속성`}>
              <h3>
                {f.title ?? "새 속성"}{" "}
                <span className="secondary">{key.startsWith("new_") ? "저장 시 키 발급" : key}</span>
              </h3>
              <Field label="속성 이름">
                {(p) => (
                  <input
                    {...p}
                    className="input"
                    maxLength={80}
                    value={f.title ?? ""}
                    onChange={(e) => setField(key, { ...f, title: e.target.value })}
                  />
                )}
              </Field>
              <Field label="설명">
                {(p) => (
                  <textarea
                    {...p}
                    className="input"
                    maxLength={1000}
                    value={f.description ?? ""}
                    onChange={(e) => setField(key, { ...f, description: e.target.value })}
                  />
                )}
              </Field>
              <Field label="데이터 타입">
                {(p) => (
                  <select
                    {...p}
                    className="input"
                    value={f.enum ? "select" : f.format === "date" ? "date" : scalar}
                    onChange={(e) => {
                      const value = e.target.value;
                      setField(key, {
                        type: nullable
                          ? [value === "date" || value === "select" ? "string" : value as "string", "null"]
                          : value === "date" || value === "select"
                          ? "string"
                          : value as "string",
                        title: f.title,
                        description: f.description,
                        ...(value === "date"
                          ? { format: "date" as const }
                          : value === "select"
                          ? { enum: ["option_1"] }
                          : {}),
                        ...(key === draft.display.representative ? { minLength: 1 } : {}),
                      });
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
              <label>
                <input
                  type="checkbox"
                  checked={draft.schema.required.includes(key)}
                  onChange={(e) => flag(key, "required", e.target.checked)}
                />{" "}
                필수 입력
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={nullable}
                  onChange={(e) => setField(key, { ...f, type: e.target.checked ? [scalar, "null"] : scalar })}
                />{" "}
                값 없음 허용{f.enum && !f.enum.includes(null) ? " (선택 코드에 값 없음도 추가해야 적용)" : ""}
              </label>
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
                          value={numericDrafts[key + ":" + name] ?? f[name] ?? ""}
                          onChange={(e) => setNumericField(key, name, e.target.value)}
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
                          value={numericDrafts[key + ":" + name] ?? f[name] ?? ""}
                          onChange={(e) => setNumericField(key, name, e.target.value)}
                        />
                      )}
                    </Field>
                  ))}
                </div>
              )}
              {f.enum && (
                <>
                  <Field label="선택 코드 (줄마다 하나)">
                    {(p) => (
                      <textarea
                        {...p}
                        className="input"
                        value={f.enum!.filter((v) => v !== null).join("\n")}
                        onChange={(e) =>
                          setField(key, {
                            ...f,
                            enum: [...e.target.value.split("\n"), ...(f.enum!.includes(null) ? [null] : [])],
                          })}
                      />
                    )}
                  </Field>
                  {nullable && (
                    <label>
                      <input
                        type="checkbox"
                        checked={f.enum!.includes(null)}
                        onChange={(e) =>
                          setField(key, {
                            ...f,
                            enum: e.target.checked ? [...f.enum!, null] : f.enum!.filter((v) => v !== null),
                          })}
                      />{" "}
                      값 없음을 선택 코드로 허용
                    </label>
                  )}
                  {f.enum.filter((v) => v !== null).map((code, i) => (
                    <Field key={i} label={`${code} 표시 이름`}>
                      {(p) => (
                        <input
                          {...p}
                          className="input"
                          maxLength={80}
                          disabled={key.startsWith("new_")}
                          value={optionLabel(draft.display.option_labels[key], code!)}
                          onChange={(e) =>
                            setDraft((d) => ({
                              ...d,
                              display: {
                                ...d.display,
                                option_labels: {
                                  ...d.display.option_labels,
                                  [key]: { ...d.display.option_labels[key], [code!]: e.target.value },
                                },
                              },
                            }))}
                        />
                      )}
                    </Field>
                  ))}
                </>
              )}
              <Field label="생성 기본값 (기존 자료에는 채우지 않음)">
                {(p) => (
                  <select
                    {...p}
                    className="input"
                    value={f.default === undefined ? "unset" : f.default === null ? "null" : "value"}
                    onChange={(e) =>
                      setField(key, {
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
                    <option value="unset">기본값 없음</option>
                    <option value="value">값 지정</option>
                    {nullable && (!f.enum || f.enum.includes(null)) && <option value="null">값 없음</option>}
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
                          onChange={(e) => setField(key, { ...f, default: e.target.value === "true" })}
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
                          onChange={(e) => setField(key, { ...f, default: e.target.value })}
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
                          value={numericDrafts[key + ":default"] ?? String(f.default)}
                          onChange={(e) =>
                            ["integer", "number"].includes(scalar)
                              ? setNumericField(key, "default", e.target.value)
                              : setField(key, { ...f, default: e.target.value })}
                        />
                      )}
                </Field>
              )}
              <label>
                <input
                  type="radio"
                  name="representative"
                  checked={draft.display.representative === key}
                  disabled={key.startsWith("new_")}
                  onChange={() => setDraft((d) => ({ ...d, display: { ...d.display, representative: key } }))}
                />{" "}
                대표 이름
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.display.list_columns.includes(key)}
                  disabled={key.startsWith("new_")}
                  onChange={(e) => flag(key, "list_columns", e.target.checked)}
                />{" "}
                목록에 표시
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={draft.display.archived.includes(key)}
                  disabled={key.startsWith("new_")}
                  onChange={(e) => flag(key, "archived", e.target.checked)}
                />{" "}
                속성 보관 (값 유지)
              </label>
              <div className="schema-actions">
                <button
                  className="btn"
                  type="button"
                  aria-label={`${f.title ?? key} 위로`}
                  disabled={index === 0}
                  onClick={() => reorder(key, -1)}
                >
                  위로
                </button>
                <button
                  className="btn"
                  type="button"
                  aria-label={`${f.title ?? key} 아래로`}
                  disabled={index === draft.display.order.length - 1}
                  onClick={() => reorder(key, 1)}
                >
                  아래로
                </button>
                <button
                  className="btn"
                  type="button"
                  onClick={() =>
                    setDraft((d) => {
                      const properties = { ...d.schema.properties };
                      delete properties[key];
                      return {
                        ...d,
                        schema: { ...d.schema, properties, required: d.schema.required.filter((k) => k !== key) },
                        display: {
                          ...d.display,
                          order: d.display.order.filter((k) => k !== key),
                          list_columns: d.display.list_columns.filter((k) => k !== key),
                          archived: d.display.archived.filter((k) => k !== key),
                          option_labels: Object.fromEntries(
                            Object.entries(d.display.option_labels).filter(([k]) => k !== key),
                          ),
                        },
                      };
                    })}
                >
                  영구 삭제 초안
                </button>
              </div>
            </section>
          );
        })}
        <button
          className="btn"
          type="button"
          disabled={Object.keys(draft.schema.properties).length >= 64}
          onClick={() => {
            const ref = crypto.randomUUID(), key = `new_${ref}`;
            setRefs((r) => ({ ...r, [key]: ref }));
            setDraft((d) => ({
              ...d,
              schema: {
                ...d.schema,
                properties: { ...d.schema.properties, [key]: { type: "string", title: "새 속성" } },
              },
              display: { ...d.display, order: [...d.display.order, key] },
            }));
          }}
        >
          속성 추가
        </button>
      </fieldset>
      {!plan?.recovery && (
        <div className="settings-section-footer">
          <button
            className="btn"
            disabled={busy || uncertain || !dirty}
            onClick={() => {
              setDraft(clone(saved));
              setNumericDrafts({});
              setMigration(plan?.migration ?? { rules: [], overrides: [] });
              setError("");
            }}
          >
            편집 취소
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || disabled || Boolean(plan?.recovery) || (!dirty && !uncertain)}
            onClick={() => void write("save")}
          >
            {busy ? "처리 중…" : uncertain ? "같은 요청 다시 확인" : "변경 초안 저장"}
          </button>
        </div>
      )}
      {plan && (
        <section className="schema-summary" aria-label="속성 변경 요약">
          <h3>변경 요약 · 초안 버전 {plan.version}</h3>
          <Link to={`?change_id=${plan.id}`}>이 변경안 직접 링크</Link>
          {plan.recovery && (
            <section aria-label="복구안 원본">
              <p>
                보존 원본을 사용하는 새 버전의 복구안입니다. 영향 분석 후 현재 값 → 복구 값 미리보기를 확인하고
                실행하세요.
              </p>
              <Link to={`/settings/entity-types/${plan.type_id}/migrations/${plan.recovery.source_job_id}`}>
                원본 작업 확인
              </Link>
              <p className="secondary">
                원본 보존 만료:{" "}
                <time dateTime={plan.recovery.source_expires_at}>
                  {new Date(plan.recovery.source_expires_at).toLocaleString()}
                </time>
              </p>
              <p>
                복구안의 속성과 변환 규칙은 원본 기준으로 유지됩니다. 보완이 필요하면 현재 자료를 직접 수정하거나 새
                변경안을 준비하고 다시 분석하세요.
              </p>
            </section>
          )}
          <p>상태: {plan.status} · {plan.change_kind === "compatible" ? "호환 가능한 게시" : "자료 값 변환 필요"}</p>
          <ul>
            {plan.diff.map((d, i) => (
              <li key={i}>
                <strong>{d.path}</strong>: {d.before_present ? JSON.stringify(d.before) : "미지정"} →{" "}
                {d.after_present ? JSON.stringify(d.after) : "미지정"} · {d.reason} · {d.next_action}
              </li>
            ))}
          </ul>
          {plan.analysis && (
            <p role="status">
              분석: {plan.analysis.status} · {plan.analysis.processed}/{plan.analysis.total} · 실패{" "}
              {plan.analysis.failed} · 성공 {plan.analysis.processed - plan.analysis.failed} · 변경{" "}
              {plan.analysis.changed} · 무변경 {plan.analysis.unchanged} · 제거 {plan.analysis.removed} · 명시 보완{" "}
              {plan.analysis.replacements}
            </p>
          )}
          <ConversionEditor
            key={plan.id}
            plan={plan}
            migration={migration}
            onChange={setMigration}
            disabled={busy || uncertain || disabled || Boolean(plan.recovery)}
          />
          {plan.analysis?.errors.map((r) => (
            <div key={r.entity_id}>
              <strong>{r.entity_id}</strong>
              <ul>{r.fields.map((f, i) => <li key={i}>{f.path}: {f.message}</li>)}</ul>
            </div>
          ))}
          {plan.analysis && plan.analysis.failed > 0 && (
            <p>
              실패한 자료 값을 확인하여 직접 수정하거나 값 변환 변경을 준비한 뒤 다시 분석하세요. 실패가 있으면 게시할
              수 없습니다.
            </p>
          )}
          {plan.change_kind === "migration_required" && (
            <MigrationStart plan={plan} disabled={busy || uncertain || dirty || disabled} />
          )}
          {plan.change_kind === "migration_required" && (
            <p>현재 자료와 활성 정의는 유지됩니다. 영향 분석 결과를 확인하고 값 변환 작업을 준비하세요.</p>
          )}
          {plan.analysis?.status === "failed" && (
            <p role="alert">분석 작업 실패: {plan.analysis.failure_reason}. 원본은 유지됩니다. 다시 분석하세요.</p>
          )}
          {plan.status === "stale" && (
            <p>
              {plan.recovery
                ? "정의나 자료·연결이 변경되었습니다. 입력은 유지됩니다. 현재 상태를 확인하고 보완한 뒤 새 변경안을 분석하세요."
                : "정의나 자료가 변경되었습니다. 최신 정의를 확인하고 새 변경을 만드세요."}
            </p>
          )}
          {plan.status === "applied" && (
            <button
              className="btn"
              disabled={readBusy}
              onClick={() => {
                setReadBusy(true);
                void onApplied().catch((e) => setError(e.message)).finally(() => setReadBusy(false));
              }}
            >
              최신 정의 다시 조회
            </button>
          )}
          <div className="schema-actions">
            <button
              className="btn"
              disabled={busy || uncertain || dirty ||
                ["analyzing", "applied", "cancelled", "stale"].includes(plan.status)}
              onClick={() => void write("analyze")}
            >
              영향 분석
            </button>
            <button
              className="btn btn-primary"
              disabled={busy || uncertain || dirty || plan.status !== "ready" || plan.change_kind !== "compatible" ||
                plan.analysis?.failed !== 0}
              onClick={() => void write("apply")}
            >
              새 버전 게시
            </button>
            <button
              className="btn"
              disabled={busy || uncertain || dirty}
              onClick={() => {
                cancelPlanRead();
                setReadBusy(false);
                applyPlan(null);
              }}
            >
              새 변경 시작
            </button>
          </div>
        </section>
      )}
      <button
        className="btn"
        disabled={busy || readBusy}
        onClick={() => {
          setReadBusy(true);
          void list().then(() => {
            if (mounted.current) setError("");
          }).catch((e) => {
            if (mounted.current) setError(e.message);
          }).finally(() => {
            if (mounted.current) setReadBusy(false);
          });
        }}
      >
        초안 목록 다시 조회
      </button>
      {changes.length > 0 && (
        <details>
          <summary>저장한 변경 초안</summary>
          <ul>
            {changes.map((c) => (
              <li key={c.id}>
                <button
                  className="btn"
                  disabled={dirty || busy || uncertain || readBusy}
                  onClick={() => void loadPlan(c.id)}
                >
                  초안 {c.id.slice(0, 8)} · {c.status}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
export function SchemaVersionDiff({ before, after }: { before: EntitySchemaVersion; after: EntitySchemaVersion }) {
  const paths = [...new Set([...Object.keys(before.schema.properties), ...Object.keys(after.schema.properties)])];
  return (
    <section className="schema-version-diff" aria-label="버전 차이">
      <h3>버전 {before.schema_version} → {after.schema_version} 차이</h3>
      <ul>
        {paths.filter((k) =>
          JSON.stringify(before.schema.properties[k]) !== JSON.stringify(after.schema.properties[k]) ||
          before.schema.required.includes(k) !== after.schema.required.includes(k)
        ).map((k) => (
          <li key={k}>
            {k}: {JSON.stringify({ ...before.schema.properties[k], required: before.schema.required.includes(k) })} →
            {" "}
            {JSON.stringify({ ...after.schema.properties[k], required: after.schema.required.includes(k) })}
          </li>
        ))}
        {JSON.stringify(before.display) !== JSON.stringify(after.display) && (
          <li>표시 설정: {JSON.stringify(before.display)} → {JSON.stringify(after.display)}</li>
        )}
      </ul>
    </section>
  );
}
