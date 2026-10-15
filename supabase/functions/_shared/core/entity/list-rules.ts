import { entitySchemaPresentation } from "../../contracts/entity-type.ts";
import type { EntityQuery } from "../../contracts/entity.ts";
import type { EntityField } from "../../contracts/entity-type.ts";
import type { EntityDefinition } from "./values.ts";
import { invalidInput } from "../shared/errors.ts";
export interface EntityKeyset {
  at: string | number | boolean | null;
  category: 0 | 1 | 2;
  id: string;
}
export function fieldKind(field: EntityField) {
  return Array.isArray(field.type) ? field.type.find((kind) => kind !== "null")! : field.type;
}
/** Filters compare scalars without imposing save-time requiredness/defaults or range constraints. */
export function validFilterScalar(field: EntityField, value: unknown) {
  const kind = fieldKind(field);
  if (kind === "integer") return typeof value === "number" && Number.isSafeInteger(value);
  if (kind === "number") {
    return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= 1e9 &&
      /^-?\d+(?:\.\d{1,6})?$/.test(String(value));
  }
  if (kind === "boolean") return typeof value === "boolean";
  if (
    typeof value !== "string" || Array.from(value).length > 4096 || value.includes("\u0000") ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value)
  ) return false;
  if (field.oneOf) return field.oneOf.some((option) => option.const === value);
  if (field.format !== "date") return true;
  if (!/^(?!0000)\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T00:00:00.000Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validateEntityQuery(q: EntityQuery, definition: EntityDefinition | null) {
  const propertySort = typeof q.sort === "object" ? q.sort : null;
  if (!propertySort && q.filters === undefined) return;
  if (!q.entity_type_id || !definition) throw invalidInput("속성 조건에는 자료 종류를 선택하세요");
  const field = (key: string) => {
    const value = definition.schema.properties[key];
    if (!value || entitySchemaPresentation(definition.schema).archived.includes(key)) {
      throw invalidInput("없거나 보관된 속성 조건입니다", [{ path: "filters", message: key }]);
    }
    return value;
  };
  if (propertySort) field(propertySort.key);
  for (const filter of q.filters ?? []) {
    const f = field(filter.key), kind = fieldKind(f);
    if (!("value" in filter)) continue;
    if (!validFilterScalar(f, filter.value)) throw invalidInput("속성 조건 값의 타입을 확인하세요");
    const allowed = f.oneOf || kind === "boolean"
      ? ["eq"]
      : kind === "string" && !f.format
      ? ["eq", "contains"]
      : ["eq", "gt", "gte", "lt", "lte"];
    if (!allowed.includes(filter.operator)) throw invalidInput("이 속성 타입에서 지원하지 않는 비교입니다");
  }
  const groups = Map.groupBy(q.filters ?? [], (filter) => filter.key);
  for (const filters of groups.values()) {
    if (new Set(filters.map((filter) => filter.operator)).size !== filters.length) {
      throw invalidInput("같은 속성·비교 조건을 중복할 수 없습니다");
    }
    if (filters.length > 1 && filters.some((filter) => filter.operator === "unset")) {
      throw invalidInput("미지정 조건과 값 비교는 함께 사용할 수 없습니다");
    }
    const equal = filters.find((filter) => filter.operator === "eq");
    const lower = filters.filter((filter) => filter.operator === "gt" || filter.operator === "gte");
    const upper = filters.filter((filter) => filter.operator === "lt" || filter.operator === "lte");
    for (const min of lower) {
      for (const max of upper) {
        if (
          "value" in min && "value" in max &&
          (min.value > max.value || (min.value === max.value && (min.operator === "gt" || max.operator === "lt")))
        ) throw invalidInput("서로 모순되는 범위 조건입니다");
      }
    }
    if (equal && "value" in equal) {
      for (const filter of filters) {
        if (!("value" in filter)) continue;
        const value = equal.value, bound = filter.value;
        const impossible = filter.operator === "gt"
          ? value <= bound
          : filter.operator === "gte"
          ? value < bound
          : filter.operator === "lt"
          ? value >= bound
          : filter.operator === "lte"
          ? value > bound
          : filter.operator === "contains" && typeof value === "string" && typeof bound === "string"
          ? !value.includes(bound)
          : false;
        if (impossible) throw invalidInput("서로 모순되는 조건입니다");
      }
    }
  }
}
