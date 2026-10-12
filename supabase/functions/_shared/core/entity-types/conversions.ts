import type { MigrationPlan, SchemaAnalysisRow, SchemaDefinition } from "../../contracts/entity-schema-change.ts";
import { AppError, invalidInput } from "../shared/errors.ts";
import { canonical } from "./evolution.ts";
import { compileEntityFieldValue, compileEntityProperties, jsonbText } from "./schema-rules.ts";
/** Restricted literal operations; no defaults, expressions, URLs or cross-property execution. */
export function compileMigration(target: SchemaDefinition, plan: MigrationPlan) {
  const validate = compileEntityProperties(target);
  const keys = new Set<string>();
  for (const rule of plan.rules) {
    if (rule.op !== "remove" && !Object.hasOwn(target.schema.properties, rule.key)) {
      throw invalidInput("변환 대상 속성이 없습니다");
    }
    const identity = `${
      rule.op === "replace_failure" ? "replace" : rule.op === "fill" ? "fill" : "transform"
    }:${rule.key}`;
    if (keys.has(identity)) throw invalidInput("같은 속성의 변환은 하나만 지정하세요");
    keys.add(identity);
    if (rule.op === "remove" && Object.hasOwn(target.schema.properties, rule.key)) {
      throw invalidInput("삭제된 속성에만 제거를 지정하세요");
    }
    if (rule.op === "fill" || rule.op === "replace_failure") {
      compileEntityFieldValue(target.schema.properties[rule.key])(rule.value);
    }
    if (rule.op === "map") {
      for (const value of Object.values(rule.mapping)) {
        compileEntityFieldValue(target.schema.properties[rule.key])(value);
      }
    }
    if (rule.op === "convert") {
      const f = target.schema.properties[rule.key];
      const type = Array.isArray(f.type) ? f.type.find((t) => t !== "null") : f.type;
      if ((rule.to === "date" ? type !== "string" || f.format !== "date" : type !== rule.to)) {
        throw invalidInput("변환 대상 타입이 정의와 다릅니다");
      }
    }
  }
  const overrides = new Map<string, Map<string, unknown>>();
  for (const o of plan.overrides) {
    if (!Object.hasOwn(target.schema.properties, o.key)) throw invalidInput("보완 대상 속성이 없습니다");
    compileEntityFieldValue(target.schema.properties[o.key])(o.value);
    const row = overrides.get(o.entity_id) ?? new Map();
    if (row.has(o.key)) throw invalidInput("같은 자료와 속성의 보완은 하나만 지정하세요");
    row.set(o.key, o.value);
    overrides.set(o.entity_id, row);
  }
  return (entityId: string, before: Record<string, unknown>): SchemaAnalysisRow => {
    const after = { ...before }, errors: SchemaAnalysisRow["errors"] = [];
    let removed = 0, replacements = 0;
    for (const rule of [...plan.rules.filter((r) => r.op !== "fill"), ...plan.rules.filter((r) => r.op === "fill")]) {
      if (rule.op === "replace_failure") continue;
      const present = Object.hasOwn(after, rule.key), value = after[rule.key];
      const fail = (message: string) => errors.push({ path: `properties.${rule.key}`, message });
      if (rule.op === "remove") {
        if (present) {
          delete after[rule.key];
          removed++;
        }
        continue;
      }
      if (rule.op === "fill") {
        if (!present || (rule.include_null && value === null)) {
          after[rule.key] = rule.value;
          replacements++;
        }
        continue;
      }
      if (!present || value === null) continue;
      if (rule.op === "map") {
        if (typeof value === "string" && Object.hasOwn(rule.mapping, value)) after[rule.key] = rule.mapping[value];
        else if (!(rule.identity && target.schema.properties[rule.key].enum?.includes(value as string))) {
          fail("선택 코드 매핑이 없습니다");
        }
      } else if (rule.to === "integer" || rule.to === "number") {
        if (typeof value === "number") {
          after[rule.key] = value;
          continue;
        }
        const pattern = rule.to === "integer" ? /^-?(0|[1-9][0-9]*)$/ : /^-?(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/;
        if (typeof value !== "string" || !pattern.test(value)) {
          fail("전체 ASCII 십진수만 변환할 수 있습니다. 공백·앞자리 0·지수·정밀도 손실은 허용하지 않습니다");
        } else {
          const number = Number(value);
          if (
            !Number.isFinite(number) || (rule.to === "integer" ? !Number.isSafeInteger(number) : Math.abs(number) > 1e9)
          ) fail("숫자 범위 또는 정밀도를 초과했습니다");
          else if (
            rule.to === "number" &&
            jsonbText(number) !== value.replace(/(\.[0-9]*?)0+$/, "$1").replace(/\.$/, "").replace(/^-0$/, "0")
          ) fail("십진수 정밀도를 손실 없이 표현할 수 없습니다");
          else after[rule.key] = number;
        }
      } else if (rule.to === "string") {
        if (typeof value === "number") after[rule.key] = jsonbText(value);
        else if (typeof value !== "string") fail("텍스트 변환은 숫자와 문자열만 지원합니다");
      } else if (typeof value !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) {
        fail("날짜는 YYYY-MM-DD 형식이어야 합니다");
      }
    }
    for (const [key, value] of overrides.get(entityId) ?? []) {
      after[key] = value;
      replacements++;
      for (let i = errors.length - 1; i >= 0; i--) if (errors[i].path === `properties.${key}`) errors.splice(i, 1);
    }
    const check = () => {
      try {
        validate(after);
        return [];
      } catch (e) {
        if (!(e instanceof AppError)) throw e;
        return e.fields ?? [{ path: "properties", message: e.message }];
      }
    };
    errors.push(...check());
    for (const rule of plan.rules) {
      if (
        rule.op === "replace_failure" && errors.some((e) => e.path === `properties.${rule.key}`) &&
        !overrides.get(entityId)?.has(rule.key)
      ) {
        after[rule.key] = rule.value;
        replacements++;
        for (let i = errors.length - 1; i >= 0; i--) {
          if (errors[i].path === `properties.${rule.key}`) errors.splice(i, 1);
        }
      }
    }
    const finalErrors = [...errors, ...check()].filter((e, i, a) =>
      a.findIndex((x) => x.path === e.path && x.message === e.message) === i
    );
    return {
      entity_id: entityId,
      before,
      after: new TextEncoder().encode(jsonbText(after)).length > 65536 ? null : after,
      after_bytes: new TextEncoder().encode(jsonbText(after)).length,
      changed: canonical(before) !== canonical(after),
      removed,
      replacements,
      errors: finalErrors,
    };
  };
}
