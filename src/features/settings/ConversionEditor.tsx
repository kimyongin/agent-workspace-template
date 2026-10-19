import { useApi } from "../../lib/api-context.tsx";
import { Fragment } from "react";
import { BusinessTable, BusinessRow, BusinessCell, BusinessDetails } from "../../components/BusinessTable.tsx";
import { Button } from "../../components/ui/button.tsx";
import { RotateCcwIcon } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FieldSet, FieldGroup, FieldLabel, FieldLegend } from "@/components/ui/field";
import { Checkbox } from "@/components/ui/checkbox";
import { NativeSelect, NativeSelectOption } from "../../components/ui/native-select.tsx";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.tsx";
import { Input } from "../../components/ui/input.tsx";
import { DateInput } from "../../components/DateInput.tsx";
import { isCivilDateInput } from "../../lib/civil-date-input.ts";
import { fieldChoices } from "../../lib/schema-document.ts";
import { schemaPresentation } from "../../lib/schema-document.ts";
import { FilterPanel } from "../../components/TabSearch.tsx";

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

import { fieldType } from "../entity/property-fields.tsx";
type Rule = MigrationPlan["rules"][number];
function propertyValue(value: unknown, key: string, definition?: SchemaDefinition, showType = false) {
  const label = typeof value === "string"
    ? schemaOptionLabel(definition ? schemaPresentation(definition).option_labels[key] : undefined, value)
    : schemaValueLabel(value);
  const kind = typeof value === "string"
    ? "텍스트"
    : typeof value === "number"
    ? Number.isInteger(value) ? "정수" : "숫자"
    : typeof value === "boolean"
    ? "참·거짓"
    : "";
  return showType && kind ? `${label} (${kind})` : label;
}
function previewKeys(row: SchemaAnalysisRow) {
  const keys = [...new Set([...Object.keys(row.before), ...Object.keys(row.after ?? {})])];
  const changed = (key: string) =>
    !row.after || Object.hasOwn(row.before, key) !== Object.hasOwn(row.after, key) ||
    JSON.stringify(row.before[key]) !== JSON.stringify(row.after[key]);
  return keys.sort((a, b) => Number(changed(b)) - Number(changed(a)));
}
function analysisRowTitle(row: SchemaAnalysisRow, target: SchemaDefinition, source?: SchemaDefinition) {
  const before = source ? row.before[schemaPresentation(source).representative] : undefined;
  const after = row.after?.[schemaPresentation(target).representative];
  const title = typeof before === "string" && before.length
    ? before
    : typeof after === "string" && after.length
    ? after
    : null;
  const identifier = schemaEntityLabel(row.entity_id);
  return title ? `${title} · ${identifier}` : identifier;
}
function Literal(
  { field, value, onChange, disabled, optionLabels = {} }: {
    field: EntityField;
    value: unknown;
    onChange: (v: unknown) => void;
    optionLabels?: Record<string, string>;
    disabled: boolean;
  },
) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  const scalar = fieldType(field);
  const nullable = Array.isArray(field.type) && field.type.includes("null");
  return (
    <>
      <Field label="보완값 상태">
        {(props) => (
          <Select disabled={disabled} open={open && !disabled} onOpenChange={setOpen}
            value={value === null ? "null" : "value"}
            onValueChange={(next) => {
              if (disabled) return;
              onChange(
                next === "null"
                  ? null
                  : scalar === "boolean"
                  ? false
                  : scalar === "integer" || scalar === "number"
                  ? 0
                  : "",
              );
            }}
          >
            <SelectTrigger {...props} aria-label="보완값 상태"
              className="w-full data-[size=default]:h-auto whitespace-normal @max-[16rem]/business:flex-col @max-[16rem]/business:px-1 [&_[data-slot=select-value]]:line-clamp-none [&_[data-slot=select-value]]:block [&_[data-slot=select-value]]:wrap-anywhere">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              <SelectGroup>
                <SelectItem value="value">값 지정</SelectItem>
                {nullable && <SelectItem value="null">명시적 값 없음</SelectItem>}
              </SelectGroup>
            </SelectContent>
          </Select>
        )}
      </Field>
      {value !== null && (
        <Field label="보완값" error={field.format === "date" && !isCivilDateInput(String(value ?? ""))
          ? "올바른 날짜를 YYYY-MM-DD 형식으로 입력하세요." : undefined}>
          {(props) => (scalar === "boolean"
            ? (
              <NativeSelect
                {...props}

                aria-label="보완값"
                value={String(value)}
                onChange={(e) => onChange(e.target.value === "true")}
              >
                <NativeSelectOption value="false">거짓</NativeSelectOption>
                <NativeSelectOption value="true">참</NativeSelectOption>
              </NativeSelect>
            )
            : fieldChoices(field)
            ? (
              <NativeSelect
                {...props}

                aria-label="보완값"
                value={String(value)}
                onChange={(e) => onChange(e.target.value)}
              >
                <NativeSelectOption value="">선택하세요</NativeSelectOption>
                {fieldChoices(field)!.filter((v) => v !== null).map((code) => (
                  <NativeSelectOption key={code!} value={code!}>{schemaOptionLabel(optionLabels, code!)}</NativeSelectOption>
                ))}
              </NativeSelect>
            )
            : field.format === "date"
            ? (
              <DateInput
                {...props}
                aria-label="보완값"
                label={`${field.title ?? "날짜"} 보완값`}
                disabled={disabled}
                value={String(value ?? "")}
                onValueChange={onChange}
              />
            )
            : (
              <Input
                {...props}

                aria-label="보완값"
                value={String(value ?? "")}
                type="text"
                inputMode={scalar === "number" || scalar === "integer" ? "decimal" : undefined}
                step="any"
                onChange={(e) =>
                  onChange(
                    scalar === "number" || scalar === "integer" ? e.target.value : e.target.value,
                  )}
              />
            ))}
        </Field>
      )}
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
  const api = useApi();
  const [page, setPage] = useState<SchemaAnalysisPage>(),
    [failures, setFailures] = useState(false),
    [draftFailures, setDraftFailures] = useState(false),
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
  useEffect(() => {
    setDraftFailures(failures);
  }, [failures, plan.id, plan.analysis?.id]);
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
          <h3 className="text-base font-semibold">명시적인 변환 규칙</h3>
          <p>
            기본값은 기존 자료에 채우지 않습니다. 변환 → 행 보완 → 실패 대체 → 최종 검증 순으로 처리합니다. 보완 저장 후
            다시 분석하세요.
          </p>
          <FieldSet disabled={disabled}>
            <FieldGroup className="min-w-0">
              {[
                ...new Set([
                  ...schemaPresentation(plan.target).order,
                  ...plan.diff.filter((d) =>
                    d.after_present === false && /^properties\.(prop_[1-9][0-9]*)$/.test(d.path)
                  ).map(
                    (d) => d.path.split(".").at(-1)!,
                  ),
                ]),
              ].map((key) => {
                const sourceField = sourceDefinition?.schema.properties[key] ??
                  plan.diff.find((diff) => diff.path === `properties.${key}`)?.before as EntityField | undefined;
                const f = plan.target.schema.properties[key],
                  r = migration.rules.find((r) => r.key === key && group(r) === "transform"),
                  fill = migration.rules.find((r) => r.key === key && r.op === "fill"),
                  replacement = migration.rules.find((r) => r.key === key && r.op === "replace_failure"),
                  scalar = fieldType(f);
                return (
                  <section className="min-w-0 grid gap-4 sm:grid-cols-2 [&_dt]:text-sm [&_dt]:text-muted-foreground [&_dd]:min-w-0 [&_dd]:[overflow-wrap:anywhere]" key={key}>
                    <Field label={f?.title ?? sourceField?.title ?? "삭제한 입력 항목"}>
                      {(p) => (
                        <NativeSelect
                          {...p}

                          aria-label={`${f?.title ?? sourceField?.title ?? "삭제한 항목"} 변환 방식`}
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
                          <NativeSelectOption value="none">유지 · 최종 정의로 검증</NativeSelectOption>
                          {!f ? <NativeSelectOption value="remove">입력 항목 값을 명시적으로 제거</NativeSelectOption> : (
                            <>
                              {scalar !== "boolean" && (
                                <NativeSelectOption value="convert">
                                  {f.format === "date"
                                    ? "날짜"
                                    : scalar === "string"
                                    ? "텍스트"
                                    : scalar === "integer"
                                    ? "정수"
                                    : "숫자"}로 변환
                                </NativeSelectOption>
                              )}
                              {fieldChoices(f) && <NativeSelectOption value="map">선택 코드 매핑</NativeSelectOption>}
                            </>
                          )}
                        </NativeSelect>
                      )}
                    </Field>
                    {f && (["fill", "replace_failure"] as const).map((op) => {
                      const rule = op === "fill" ? fill : replacement;
                      return (
                        <section key={op}>
                          <FieldLabel className="flex min-h-11 cursor-pointer items-center gap-3">
                            <Checkbox

                              checked={!!rule}
                              onCheckedChange={(checked) =>
                                setRule(
                                  key,
                                  checked === true
                                    ? {
                                      op,
                                      key,
                                      value: scalar === "boolean"
                                        ? false
                                        : scalar === "number" || scalar === "integer"
                                        ? 0
                                        : fieldChoices(f)?.find((v) => v !== null) ?? "",
                                      ...(op === "fill" ? { include_null: false } : {}),
                                    } as Rule
                                    : undefined,
                                  op,
                                )}
                            />{" "}
                            {op === "fill" ? "누락값 채우기" : "실패값 명시 대체"}
                          </FieldLabel>
                          {rule && (rule.op === "fill" || rule.op === "replace_failure") && (
                            <Literal
                              disabled={disabled}
                              field={f}
                              optionLabels={schemaPresentation(plan.target).option_labels[key]}
                              value={rule.value}
                              onChange={(value) =>
                                setRule(key, { ...rule, value: value as string | number | boolean | null })}
                            />
                          )}
                          {rule?.op === "fill" && (
                            <FieldLabel className="flex min-h-11 cursor-pointer items-center gap-3">
                              <Checkbox

                                checked={rule.include_null}
                                onCheckedChange={(checked) => setRule(key, { ...rule, include_null: checked === true })}
                              />{" "}
                              명시적 값 없음도 채우기
                            </FieldLabel>
                          )}
                        </section>
                      );
                    })}
                    {r?.op === "map" && (
                      <>
                        <FieldLabel className="flex min-h-11 cursor-pointer items-center gap-3">
                          <Checkbox

                            checked={r.identity}
                            onCheckedChange={(checked) => setRule(key, { ...r, identity: checked === true })}
                          />{" "}
                          이미 허용된 코드는 유지
                        </FieldLabel>
                        <Field label="이전 코드">
                          {(p) => (
                            <Input
                              {...p}

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
                              <NativeSelect
                                {...p}

                                aria-label={`${code} 매핑`}
                                value={to}
                                onChange={(e) =>
                                  setRule(key, { ...r, mapping: { ...r.mapping, [code]: e.target.value } })}
                              >
                                <NativeSelectOption value="">선택</NativeSelectOption>
                                {fieldChoices(f)?.filter((v) => v !== null).map((v) => (
                                  <NativeSelectOption key={v!} value={v!}>{v}</NativeSelectOption>
                                ))}
                              </NativeSelect>
                            )}
                          </Field>
                        ))}
                      </>
                    )}
                  </section>
                );
              })}
            </FieldGroup>
          </FieldSet>
        </>
      )}
      <h3 className="text-base font-semibold">{plan.recovery ? "복구 값 영향 미리보기" : "분석 결과"}</h3>
      {unsaved
        ? (
          <Alert role="status"><AlertDescription>
            보완을 변경했습니다. 초안을 저장하고 다시 분석하세요. 표시된 이전 결과는 저장 전 계획의 결과입니다.
          </AlertDescription></Alert>
        )
        : null}
      {plan.analysis?.status !== "succeeded" ? <p>분석 완료 후 원본과 변환값을 확인할 수 있습니다.</p> : (
        <>
          <FilterPanel
            dirty={draftFailures !== failures}
            onReset={() => setDraftFailures(false)}
            onApply={() => setFailures(draftFailures)}
          >
            <FieldLabel className="flex min-h-11 cursor-pointer items-center gap-3">
              <Checkbox  checked={draftFailures} onCheckedChange={(checked) => setDraftFailures(checked === true)} />
              {" "}
              실패한 자료만 보기
            </FieldLabel>
          </FilterPanel>
          {page?.items.length === 0 && <p>표시할 자료가 없습니다. 전체 대상 {plan.analysis.total}개</p>}
          <BusinessTable label="자료 값 변환 결과 목록" columns={["자료", "결과", "입력값 변경"]} disclosureColumn={false}>
          {page?.items.map((row) => (
            <Fragment key={row.entity_id}>
            <BusinessRow>
              <BusinessCell index={0}>
                {analysisRowTitle(row, plan.target, sourceDefinition)}
              </BusinessCell>
              <BusinessCell index={1}>{row.errors.length ? "변환 실패" : row.changed ? "변경" : "무변경"}</BusinessCell>
              <BusinessCell index={2}>
<BusinessTable label={`${analysisRowTitle(row, plan.target, sourceDefinition)} 입력값 변경`} columns={["입력 항목", "변경 전후"]} disclosureColumn={false}>
                {previewKeys(row).map((key) => (
                  <BusinessRow key={key}>
                    <BusinessCell index={0}>
                      {plan.target.schema.properties[key]?.title ?? sourceDefinition?.schema.properties[key]?.title ??
                        "삭제한 입력 항목"}
                    </BusinessCell>
                    <BusinessCell index={1}>
                      {plan.recovery ? "현재 값" : "원본"} {Object.hasOwn(row.before, key)
                        ? propertyValue(
                          row.before[key],
                          key,
                          sourceDefinition,
                          row.after !== null && Object.hasOwn(row.after, key) &&
                            typeof row.before[key] !== typeof row.after[key],
                        )
                        : "누락"} → {plan.recovery ? "복구" : "변환"}{" "}
                      {row.after === null ? "미리보기 크기 초과" : Object.hasOwn(row.after, key)
                        ? propertyValue(
                          row.after[key],
                          key,
                          plan.target,
                          Object.hasOwn(row.before, key) && typeof row.before[key] !== typeof row.after[key],
                        )
                        : "제거"}
                    </BusinessCell>
                  </BusinessRow>
                ))}
              </BusinessTable>
              </BusinessCell>
            </BusinessRow>
            {row.errors.length > 0 && <BusinessDetails>
              {row.errors.map((e, i) => (
                <Alert variant="destructive" role="alert" className="text-sm text-destructive" key={i}><AlertDescription>
                  {schemaDiffLabel(e.path, plan.target, sourceDefinition ?? plan.target)}: {e.message}
                </AlertDescription></Alert>
              ))}
              {!plan.recovery &&
                [...new Set(row.errors.map((e) => e.path.split(".").at(-1)!))].filter((key) =>
                  plan.target.schema.properties[key]
                ).map((key) => {
                  const o = migration.overrides.find((o) => o.entity_id === row.entity_id && o.key === key);
                  return (
                    <FieldSet className="min-w-0" disabled={disabled} key={key}>
                      <FieldLegend>{plan.target.schema.properties[key]?.title ?? "입력 항목"} 직접 보완</FieldLegend>
                      <Button variant="ghost" type="button" className="h-auto min-h-11 max-w-full whitespace-normal @max-[16rem]/business:px-1"
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
                      </Button>
                      {o && (
                        <>
                          <Literal
                            disabled={disabled}
                            field={plan.target.schema.properties[key]}
                            optionLabels={schemaPresentation(plan.target).option_labels[key]}
                            value={o.value}
                            onChange={(v) => setOverride(row, key, v)}
                          />
                          <Button variant="ghost" type="button" className="h-auto min-h-11 max-w-full whitespace-normal @max-[16rem]/business:px-1"
                            onClick={() =>
                              onChange({
                                ...migration,
                                overrides: migration.overrides.filter((x) => x !== o),
                              })}
                          >
                            보완 취소
                          </Button>
                        </>
                      )}
                    </FieldSet>
                  );
                })}
            </BusinessDetails>}
            </Fragment>
          ))}
          </BusinessTable>
          {page?.next_after && <Button variant="ghost" type="button" className="h-auto min-h-11 max-w-full whitespace-normal @max-[16rem]/business:px-1" onClick={() => void load(page.next_after!)}>다음 결과</Button>}
          <Button variant="ghost" type="button" className="h-auto min-h-11 max-w-full whitespace-normal @max-[16rem]/business:px-1"  onClick={() => void load()}><RotateCcwIcon data-icon="inline-start" />첫 결과 다시 조회</Button>
        </>
      )}
      {error && <Alert variant="destructive" role="alert" className="text-sm text-destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    </section>
  );
}
