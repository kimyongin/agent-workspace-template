import { BodyAction } from "../../components/BodyAction.tsx";
import { schemaDiffLabel, schemaEntityLabel, schemaOptionLabel, schemaValueLabel } from "./schema-labels.ts";
import { useEffect, useRef, useState } from "react";
import type {
  EntitySchemaChange,
  MigrationPlan,
  SchemaAnalysisPage,
  SchemaAnalysisRow,
} from "@contracts/entity-schema-change.ts";
import type { EntityField } from "@contracts/entity-type.ts";
import type { SchemaDefinition } from "@contracts/entity-schema-change.ts";
import { recoveryErrorMessage } from "./SchemaRecovery.tsx";
import { Field } from "../../components/Field.tsx";
import { api } from "../../lib/api.ts";
import { fieldType } from "../entity/property-fields.tsx";
type Rule = MigrationPlan["rules"][number];
function propertyValue(value: unknown, key: string, definition?: SchemaDefinition) {
  return typeof value === "string" ? schemaOptionLabel(definition?.display.option_labels[key], value) : schemaValueLabel(value);
}
function analysisRowTitle(row: SchemaAnalysisRow, target: SchemaDefinition, source?: SchemaDefinition) {
  const before = source ? row.before[source.display.representative] : undefined;
  const after = row.after?.[target.display.representative];
  const title = typeof before === "string" && before.length
    ? before
    : typeof after === "string" && after.length
    ? after
    : null;
  const identifier = schemaEntityLabel(row.entity_id);
  return title ? `${title} · ${identifier}` : identifier;
}
function Literal(
  { field, value, onChange, optionLabels = {} }: {
    field: EntityField;
    value: unknown;
    onChange: (v: unknown) => void;
    optionLabels?: Record<string, string>;
  },
) {
  const scalar = fieldType(field);
  const nullable = Array.isArray(field.type) && field.type.includes("null");
  return (
    <>
      <select
        className="input"
        aria-label="보완값 상태"
        value={value === null ? "null" : "value"}
        onChange={(e) =>
          onChange(
            e.target.value === "null"
              ? null
              : scalar === "boolean"
              ? false
              : scalar === "integer" || scalar === "number"
              ? 0
              : "",
          )}
      >
        <option value="value">값 지정</option>
        {nullable && <option value="null">명시적 값 없음</option>}
      </select>
      {value !== null && (scalar === "boolean"
        ? (
          <select
            className="input"
            aria-label="보완값"
            value={String(value)}
            onChange={(e) => onChange(e.target.value === "true")}
          >
            <option value="false">거짓</option>
            <option value="true">참</option>
          </select>
        )
        : field.enum
        ? (
          <select
            className="input"
            aria-label="보완값"
            value={String(value)}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">선택하세요</option>
            {field.enum.filter((v) => v !== null).map((code) => (
              <option key={code!} value={code!}>{schemaOptionLabel(optionLabels, code!)}</option>
            ))}
          </select>
        )
        : (
          <input
            className="input"
            aria-label="보완값"
            value={String(value ?? "")}
            type={field.format === "date" ? "date" : "text"}
            inputMode={scalar === "number" || scalar === "integer" ? "decimal" : undefined}
            step="any"
            onChange={(e) =>
              onChange(
                scalar === "number" || scalar === "integer" ? e.target.value : e.target.value,
              )}
          />
        ))}
    </>
  );
}
export function ConversionEditor(
  { plan, migration, onChange, disabled, sourceDefinition }: {
    plan: EntitySchemaChange;
    migration: MigrationPlan;
    onChange: (p: MigrationPlan) => void;
    disabled: boolean;
    sourceDefinition?: SchemaDefinition;
  },
) {
  const [page, setPage] = useState<SchemaAnalysisPage>(),
    [failures, setFailures] = useState(false),
    [error, setError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const unsaved = JSON.stringify(migration) !== JSON.stringify(plan.migration);
  const base = `/entity-types/${plan.type_id}/schema-changes/${plan.id}/rows`;
  const load = async (after?: string) => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    try {
      const p = await api<SchemaAnalysisPage>(
        "GET",
        `${base}?analysis_id=${plan.analysis!.id}&failures_only=${failures}${
          after ? `&after=${encodeURIComponent(after)}` : ""
        }`,
        undefined,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      setPage(p);
      setError("");
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(plan.recovery ? recoveryErrorMessage(e) : e instanceof Error ? e.message : "결과 조회 실패");
    }
  };
  useEffect(() => {
    setPage(undefined);
    if (plan.analysis?.status === "succeeded") void load();
    return () => pending.current?.abort();
  }, [plan.id, plan.type_id, plan.analysis?.id, plan.analysis?.status, failures]);
  const group = (rule: Rule) =>
    rule.op === "fill" ? "fill" : rule.op === "replace_failure" ? "replace_failure" : "transform";
  const setRule = (key: string, rule: Rule | undefined, kind = "transform") =>
    onChange({
      ...migration,
      rules: [
        ...migration.rules.filter((r) => r.key !== key || group(r) !== (rule ? group(rule) : kind)),
        ...(rule ? [rule] : []),
      ],
    });
  const setOverride = (row: SchemaAnalysisRow, key: string, value: unknown) =>
    onChange({
      ...migration,
      overrides: [...migration.overrides.filter((o) => o.entity_id !== row.entity_id || o.key !== key), {
        entity_id: row.entity_id,
        key,
        value: value as string | number | boolean | null,
      }],
    });
  return (
    <section aria-label="변환 규칙과 영향 미리보기">
      {!plan.recovery && (
        <>
          <h3 className="section-title">명시적인 변환 규칙</h3>
          <p>
            기본값은 기존 자료에 채우지 않습니다. 변환 → 행 보완 → 실패 대체 → 최종 검증 순으로 처리합니다. 보완 저장 후
            다시 분석하세요.
          </p>
          <fieldset disabled={disabled}>
            <div className="settings-fields">
              {[
                ...new Set([
                  ...plan.target.display.order,
                  ...plan.diff.filter((d) =>
                    d.after_present === false && /^properties\.(prop_[1-9][0-9]*)$/.test(d.path)
                  ).map(
                    (d) => d.path.split(".").at(-1)!,
                  ),
                ]),
              ].map((key) => {
                const f = plan.target.schema.properties[key],
                  r = migration.rules.find((r) => r.key === key && group(r) === "transform"),
                  fill = migration.rules.find((r) => r.key === key && r.op === "fill"),
                  replacement = migration.rules.find((r) => r.key === key && r.op === "replace_failure"),
                  scalar = fieldType(f);
                return (
                  <section className="schema-field" key={key}>
                    <Field label={f?.title ?? "삭제한 속성"}>
                      {(p) => (
                        <select
                          {...p}
                          className="input"
                          aria-label={`${key} 변환 방식`}
                          value={r?.op ?? "none"}
                          onChange={(e) => {
                            const op = e.target.value;
                            setRule(
                              key,
                              op === "none"
                                ? undefined
                                : op === "remove"
                                ? { op, key }
                                : op === "map"
                                ? { op, key, mapping: {}, identity: false }
                                : op === "convert"
                                ? {
                                  op,
                                  key,
                                  to: f?.format === "date" ? "date" : scalar as "string" | "integer" | "number",
                                }
                                : {
                                  op: op as "fill" | "replace_failure",
                                  key,
                                  value: scalar === "boolean"
                                    ? false
                                    : scalar === "integer" || scalar === "number"
                                    ? 0
                                    : "",
                                  include_null: false,
                                },
                            );
                          }}
                        >
                          <option value="none">유지 · 최종 정의로 검증</option>
                          {!f ? <option value="remove">속성 값을 명시적으로 제거</option> : (
                            <>
                              {scalar !== "boolean" && (
                                <option value="convert">
                                  {f.format === "date"
                                    ? "날짜"
                                    : scalar === "string"
                                    ? "텍스트"
                                    : scalar === "integer"
                                    ? "정수"
                                    : "숫자"}로 변환
                                </option>
                              )}
                              {f.enum && <option value="map">선택 코드 매핑</option>}
                            </>
                          )}
                        </select>
                      )}
                    </Field>
                    {f && (["fill", "replace_failure"] as const).map((op) => {
                      const rule = op === "fill" ? fill : replacement;
                      return (
                        <section key={op}>
                          <label className="choice-control">
                            <input
                              type="checkbox"
                              checked={!!rule}
                              onChange={(e) =>
                                setRule(
                                  key,
                                  e.target.checked
                                    ? {
                                      op,
                                      key,
                                      value: scalar === "boolean"
                                        ? false
                                        : scalar === "number" || scalar === "integer"
                                        ? 0
                                        : f.enum?.find((v) => v !== null) ?? "",
                                      ...(op === "fill" ? { include_null: false } : {}),
                                    } as Rule
                                    : undefined,
                                  op,
                                )}
                            />{" "}
                            {op === "fill" ? "누락값 채우기" : "실패값 명시 대체"}
                          </label>
                          {rule && (rule.op === "fill" || rule.op === "replace_failure") && (
                            <Literal
                              field={f}
                              optionLabels={plan.target.display.option_labels[key]}
                              value={rule.value}
                              onChange={(value) =>
                                setRule(key, { ...rule, value: value as string | number | boolean | null })}
                            />
                          )}
                          {rule?.op === "fill" && (
                            <label className="choice-control">
                              <input
                                type="checkbox"
                                checked={rule.include_null}
                                onChange={(e) => setRule(key, { ...rule, include_null: e.target.checked })}
                              />{" "}
                              명시적 값 없음도 채우기
                            </label>
                          )}
                        </section>
                      );
                    })}
                    {r?.op === "map" && (
                      <>
                        <label className="choice-control">
                          <input
                            type="checkbox"
                            checked={r.identity}
                            onChange={(e) => setRule(key, { ...r, identity: e.target.checked })}
                          />{" "}
                          이미 허용된 코드는 유지
                        </label>
                        <Field label="이전 코드">
                          {(p) => (
                            <input
                              {...p}
                              className="input"
                              onBlur={(e) => {
                                if (e.target.value && !Object.hasOwn(r.mapping, e.target.value)) {
                                  setRule(key, { ...r, mapping: { ...r.mapping, [e.target.value]: "" } });
                                }
                              }}
                              placeholder="코드 입력 후 다른 항목으로 이동"
                            />
                          )}
                        </Field>
                        {Object.entries(r.mapping).map(([code, to]) => (
                          <Field key={code} label={`${code} → 새 코드`}>
                            {(p) => (
                              <select
                                {...p}
                                className="input"
                                aria-label={`${code} 매핑`}
                                value={to}
                                onChange={(e) =>
                                  setRule(key, { ...r, mapping: { ...r.mapping, [code]: e.target.value } })}
                              >
                                <option value="">선택</option>
                                {f.enum?.filter((v) => v !== null).map((v) => <option key={v!} value={v!}>{v}</option>)}
                              </select>
                            )}
                          </Field>
                        ))}
                      </>
                    )}
                  </section>
                );
              })}
            </div>
          </fieldset>
        </>
      )}
      <h3 className="section-title">{plan.recovery ? "복구 값 영향 미리보기" : "분석 결과"}</h3>
      {unsaved
        ? (
          <p role="status">
            보완을 변경했습니다. 초안을 저장하고 다시 분석하세요. 표시된 이전 결과는 저장 전 계획의 결과입니다.
          </p>
        )
        : null}
      {plan.analysis?.status !== "succeeded" ? <p>분석 완료 후 원본과 변환값을 확인할 수 있습니다.</p> : (
        <>
          <label className="choice-control">
            <input type="checkbox" checked={failures} onChange={(e) => setFailures(e.target.checked)} />{" "}
            실패한 자료만 보기
          </label>
          {page?.items.length === 0 && <p>표시할 자료가 없습니다. 전체 대상 {plan.analysis.total}개</p>}
          {page?.items.map((row) => (
            <article className="schema-field" key={row.entity_id}>
              <h4 className="item-title">
                {analysisRowTitle(row, plan.target, sourceDefinition)} ·{" "}
                {row.errors.length ? "변환 실패" : row.changed ? "변경" : "무변경"}
              </h4>
              <dl className="props">
                {[...new Set([...Object.keys(row.before), ...Object.keys(row.after ?? {})])].map((key) => (
                  <div key={key}>
                    <dt>
                      {plan.target.schema.properties[key]?.title ?? sourceDefinition?.schema.properties[key]?.title ??
                        "삭제한 속성"}
                    </dt>
                    <dd style={{ overflowWrap: "anywhere" }}>
                      {plan.recovery ? "현재 값" : "원본"}{" "}
                      {Object.hasOwn(row.before, key) ? propertyValue(row.before[key], key, sourceDefinition) : "누락"}
                      {" "}
                      → {plan.recovery ? "복구" : "변환"} {row.after === null
                        ? "미리보기 크기 초과"
                        : Object.hasOwn(row.after, key)
                        ? propertyValue(row.after[key], key, plan.target)
                        : "제거"}
                    </dd>
                  </div>
                ))}
              </dl>
              {row.errors.map((e, i) => (
                <p role="alert" className="error-text" key={i}>
                  {schemaDiffLabel(e.path, plan.target, sourceDefinition ?? plan.target)}: {e.message}
                </p>
              ))}
              {!plan.recovery &&
                [...new Set(row.errors.map((e) => e.path.split(".").at(-1)!))].filter((key) =>
                  plan.target.schema.properties[key]
                ).map((key) => {
                  const o = migration.overrides.find((o) => o.entity_id === row.entity_id && o.key === key);
                  return (
                    <fieldset disabled={disabled} key={key}>
                      <legend>{plan.target.schema.properties[key]?.title ?? "속성"} 직접 보완</legend>
                      <BodyAction
                        onClick={() =>
                          setOverride(
                            row,
                            key,
                            fieldType(plan.target.schema.properties[key]) === "boolean"
                              ? false
                              : fieldType(plan.target.schema.properties[key]) === "number" ||
                                  fieldType(plan.target.schema.properties[key]) === "integer"
                              ? 0
                              : "",
                          )}
                      >
                        보완값 지정
                      </BodyAction>
                      {o && (
                        <>
                          <Literal
                            field={plan.target.schema.properties[key]}
                            optionLabels={plan.target.display.option_labels[key]}
                            value={o.value}
                            onChange={(v) => setOverride(row, key, v)}
                          />
                          <BodyAction
                            onClick={() =>
                              onChange({
                                ...migration,
                                overrides: migration.overrides.filter((x) => x !== o),
                              })}
                          >
                            보완 취소
                          </BodyAction>
                        </>
                      )}
                    </fieldset>
                  );
                })}
            </article>
          ))}
          {page?.next_after && <BodyAction onClick={() => void load(page.next_after!)}>다음 결과</BodyAction>}
          <BodyAction icon="reset" onClick={() => void load()}>첫 결과 다시 조회</BodyAction>
        </>
      )}
      {error && <p role="alert" className="error-text">{error}</p>}
    </section>
  );
}
