import type { SchemaDefinition, SchemaDiff, SchemaEdit } from "../../contracts/entity-schema-change.ts";
import { invalidInput } from "../shared/errors.ts";
import { exactMultipleOf, validateEntityDefinition } from "./schema-rules.ts";
export function canonical(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === "object"
      ? Object.fromEntries(
        Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map((
          [k, x],
        ) => [k, sort(x)]),
      )
      : v;
  return JSON.stringify(sort(value));
}
export async function definitionFingerprint(value: unknown) {
  return Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)))),
    (x) => x.toString(16).padStart(2, "0"),
  ).join("");
}
/** Resolve same-request additions without admitting temporary keys into a stored definition. */
export function resolvePropertyReference(key: string, edits: SchemaEdit[], reservations: Record<string, string>) {
  if (!key.startsWith("new_")) return key;
  const ref = key.slice(4);
  if (
    !edits.some((item) => item.op === "add_property" && item.client_ref === ref) ||
    !Object.hasOwn(reservations, ref)
  ) throw invalidInput("새 항목의 참조를 확인하세요");
  return reservations[ref];
}
export function resolveSchemaEdits(
  source: SchemaDefinition,
  edits: SchemaEdit[],
  reservations: Record<string, string>,
): { target: SchemaDefinition; diff: SchemaDiff[]; kind: "compatible" | "migration_required" } {
  const target = structuredClone(source);
  const touched = new Set<string>();
  const additions = new Set<string>();
  for (const edit of edits) {
    if (edit.op === "set_metadata") {
      const { op: _op, ...metadata } = edit;
      Object.assign(target.schema, metadata);
      if (metadata.description === null) delete target.schema.description;
      continue;
    }
    if (edit.op === "archive_property" || edit.op === "restore_property") {
      if (!source.schema.properties[edit.key]) throw invalidInput("현재 정의에 없는 속성은 보관할 수 없습니다");
      target.schema.properties[edit.key].deprecated = edit.op === "archive_property";
      if (edit.op === "archive_property") {
        target.schema.properties[edit.key]["x-show-in-list"] = false;
        target.schema.properties[edit.key]["x-search-text"] = false;
      }
      continue;
    }
    const key = edit.op === "add_property"
      ? (Object.hasOwn(reservations, edit.client_ref) ? reservations[edit.client_ref] : undefined)
      : edit.key;
    if (!key || touched.has(key)) throw invalidInput("속성당 하나의 변경만 지정하세요");
    touched.add(key);
    if (edit.op === "add_property") {
      if (source.schema.properties[key] || additions.has(edit.client_ref)) {
        throw invalidInput("속성 키나 추가 참조를 재사용할 수 없습니다");
      }
      additions.add(edit.client_ref);
      target.schema.properties[key] = edit.field;
    } else if (!source.schema.properties[key]) {
      throw invalidInput("현재 정의에 없는 속성은 수정할 수 없습니다", [{
        path: `properties.${key}`,
        message: "속성이 없습니다",
      }]);
    } else if (edit.op === "remove_property") {
      delete target.schema.properties[key];
      target.schema.required = target.schema.required.filter((k) => k !== key);
      continue;
    } else target.schema.properties[key] = edit.field;
    target.schema.required = target.schema.required.filter((k) => k !== key);
    if (edit.required) target.schema.required.push(key);
  }
  for (const edit of edits) {
    if (edit.op === "archive_property" || edit.op === "restore_property") {
      target.schema.properties[edit.key].deprecated = edit.op === "archive_property";
      if (edit.op === "archive_property") {
        target.schema.properties[edit.key]["x-show-in-list"] = false;
        target.schema.properties[edit.key]["x-search-text"] = false;
      }
    }
  }
  validateEntityDefinition(target);
  const diff = schemaDefinitionDiff(source, target);
  return {
    target,
    diff,
    kind: diff.some((d) => d.kind === "migration_required") ? "migration_required" : "compatible",
  };
}
/** The same per-field comparison describes edits and source-preserving recovery proposals. */
export function schemaDefinitionDiff(source: SchemaDefinition, target: SchemaDefinition): SchemaDiff[] {
  const diff: SchemaDiff[] = [];
  const add = (path: string, before: unknown, after: unknown, migration: boolean, reason: string) => {
    if (canonical(before) === canonical(after)) return;
    diff.push({
      path,
      before: before ?? null,
      before_present: before !== undefined,
      after_present: after !== undefined,
      after: after ?? null,
      kind: migration ? "migration_required" : "compatible",
      reason,
      next_action: migration ? "영향 분석 후 명시적인 값 변환을 준비하세요" : "새 버전으로 게시할 수 있습니다",
    });
  };
  for (const key of new Set([...Object.keys(source.schema.properties), ...Object.keys(target.schema.properties)])) {
    const a = source.schema.properties[key], b = target.schema.properties[key];
    if (!a || !b) {
      add(
        `properties.${key}`,
        a,
        b,
        !b || target.schema.required.includes(key),
        !b ? "속성 영구 삭제" : target.schema.required.includes(key) ? "필수 속성 추가" : "선택 속성 추가",
      );
      continue;
    }
    for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const booleans = ["deprecated", "readOnly", "x-representative", "x-show-in-list", "x-search-text"];
      const old = (a as unknown as Record<string, unknown>)[name] ??
          (booleans.includes(name) ? false : name === "x-list-order" ? a["x-order"] : undefined),
        next = (b as unknown as Record<string, unknown>)[name] ??
          (booleans.includes(name) ? false : name === "x-list-order" ? b["x-order"] : undefined);
      let migration = false;
      let reason = "표시 또는 생성 기본값 변경";
      if (name === "type") {
        const aa = Array.isArray(a.type) ? a.type : [a.type], bb = Array.isArray(b.type) ? b.type : [b.type];
        if (canonical([...aa].sort()) === canonical([...bb].sort())) continue;
        migration = aa.some((t) => !bb.includes(t) && !(t === "integer" && bb.includes("number")));
        if (
          aa.includes("integer") && bb.includes("number") &&
          ((a.minimum ?? -Number.MAX_SAFE_INTEGER) < -1e9 || (a.maximum ?? Number.MAX_SAFE_INTEGER) > 1e9)
        ) migration = true;
        reason = migration ? "데이터 타입 또는 유효 숫자 범위 변환" : "데이터 타입 범위 확대";
      } else if (name === "format") {
        migration = next !== undefined;
        reason = migration ? "날짜 형식 제약 추가" : "날짜 제약 해제";
      } else if (["minLength", "minimum", "maxLength", "maximum"].includes(name)) {
        const min = name.startsWith("min");
        const scalar = Array.isArray(a.type) ? a.type.find((t) => t !== "null") : a.type;
        const fallback = name === "minLength"
          ? 0
          : name === "maxLength"
          ? 4096
          : scalar === "integer"
          ? Number.MAX_SAFE_INTEGER * (min ? -1 : 1)
          : 1e9 * (min ? -1 : 1);
        const previous = typeof old === "number" ? old : fallback;
        const following = typeof next === "number" ? next : fallback;
        migration = min ? following > previous : following < previous;
        reason = migration ? "허용 범위 축소" : "허용 범위 확대";
      } else if (name === "multipleOf") {
        migration = typeof next === "number" && (typeof old !== "number" || !exactMultipleOf(old, next));
        reason = migration ? "배수 제약 축소" : "배수 제약 확대";
      } else if (name === "oneOf") {
        const previous = a.oneOf?.map((o) => o.const), following = b.oneOf?.map((o) => o.const);
        migration = !!following && (!previous || previous.some((x) => !following.includes(x)));
        reason = migration ? "선택 코드 제거 또는 선택 제약 추가" : "선택 코드 추가 또는 제약 해제";
      }
      add(`properties.${key}.${name}`, old, next, migration, reason);
    }
    add(
      `properties.${key}.required`,
      source.schema.required.includes(key),
      target.schema.required.includes(key),
      !source.schema.required.includes(key) && target.schema.required.includes(key),
      "필수 입력 변경",
    );
  }
  for (const key of ["title", "description", "x-icon", "deprecated"] as const) {
    add(
      key,
      source.schema[key] ?? (key === "deprecated" ? false : undefined),
      target.schema[key] ?? (key === "deprecated" ? false : undefined),
      false,
      "종류 정보 변경",
    );
  }
  return diff;
}
