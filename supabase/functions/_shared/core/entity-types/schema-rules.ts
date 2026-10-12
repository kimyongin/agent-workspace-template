import { Ajv2020 } from "ajv/2020";
import addFormats from "ajv-formats";
import { z } from "zod";
import {
  ENTITY_SCHEMA_DIALECT,
  type EntityField,
  entitySchemaLimits as limits,
  type EntitySchemaVersion,
  propertyKey,
} from "../../contracts/entity-type.ts";
import { invalidInput } from "../shared/errors.ts";
const scalarType = z.enum(["string", "integer", "number", "boolean"]);
const field = z.strictObject({
  type: z.union([scalarType, z.array(z.union([scalarType, z.literal("null")])).min(2).max(2)]),
  title: z.string().max(80).optional(),
  description: z.string().max(1000).optional(),
  format: z.literal("date").optional(),
  minLength: z.number().int().min(0).max(limits.string_length).optional(),
  maxLength: z.number().int().min(0).max(limits.string_length).optional(),
  minimum: z.number().finite().optional(),
  maximum: z.number().finite().optional(),
  enum: z.array(z.union([z.string().max(limits.string_length), z.null()])).min(1).max(limits.enum_values).optional(),
  default: z.union([z.string(), z.number().finite(), z.boolean(), z.null()]).optional(),
});
const definition = z.strictObject({
  schema: z.strictObject({
    $schema: z.literal(ENTITY_SCHEMA_DIALECT),
    type: z.literal("object"),
    additionalProperties: z.literal(false),
    properties: z.record(propertyKey, field),
    required: z.array(propertyKey).max(limits.fields),
  }),
  display: z.strictObject({
    representative: propertyKey,
    order: z.array(propertyKey).max(limits.fields),
    list_columns: z.array(propertyKey).max(limits.fields),
    archived: z.array(propertyKey).max(limits.fields),
    option_labels: z.record(propertyKey, z.record(z.string(), z.string().min(1).max(80))),
  }),
});
/** An instance lives for one validation; compiled owner definitions cannot accumulate. */
function validator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: true });
  (addFormats as unknown as (a: Ajv2020, options: { mode: string }) => void)(ajv, { mode: "full" });
  return ajv;
}
function fail(path: string, message: string): never {
  throw invalidInput(message, [{ path, message }]);
}
function typeOf(f: EntityField) {
  return Array.isArray(f.type) ? f.type.find((t) => t !== "null")! : f.type;
}
function decimalPlaces(value: number) {
  const [fraction, exponent] = String(value).toLowerCase().split("e");
  return Math.max(0, (fraction.split(".")[1]?.length ?? 0) - Number(exponent ?? 0));
}
function numeric(f: EntityField, value: unknown, path: string) {
  if (typeof value !== "number") return;
  if (typeOf(f) === "integer" && !Number.isSafeInteger(value)) fail(path, "정수는 안전한 정수 범위여야 합니다");
  if (typeOf(f) === "number" && (Math.abs(value) > limits.number_abs || decimalPlaces(value) > limits.decimal_places)) {
    fail(path, "숫자는 절댓값 10억 이하, 소수점 6자리 이하입니다");
  }
}
export function validateEntityDefinition(raw: unknown): Pick<EntitySchemaVersion, "schema" | "display"> {
  const ajv = validator();
  if (new TextEncoder().encode(JSON.stringify(raw)).length > limits.definition_bytes) {
    fail("schema", "정의는 64 KiB 이하입니다");
  }
  const parsed = definition.safeParse(raw);
  if (!parsed.success) {
    throw invalidInput(
      "지원하지 않는 속성 정의입니다",
      parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    );
  }
  const { schema, display } = parsed.data;
  const keys = Object.keys(schema.properties);
  if (!keys.length || keys.length > limits.fields) fail("schema.properties", "속성은 1~64개입니다");
  for (const [key, f] of Object.entries(schema.properties)) {
    const type = typeOf(f);
    if (Array.isArray(f.type) && (new Set(f.type).size !== 2 || !f.type.includes("null"))) {
      fail(`schema.properties.${key}.type`, "nullable은 한 데이터 타입과 null의 조합입니다");
    }
    if ((f.format || f.enum || f.minLength !== undefined || f.maxLength !== undefined) && type !== "string") {
      fail(`schema.properties.${key}`, "문자열 제약은 문자열에만 적용합니다");
    }
    if ((f.minimum !== undefined || f.maximum !== undefined) && !["integer", "number"].includes(type)) {
      fail(`schema.properties.${key}`, "범위는 숫자 속성에만 적용합니다");
    }
    if (f.minLength !== undefined && f.maxLength !== undefined && f.minLength > f.maxLength) {
      fail(`schema.properties.${key}`, "최소 길이가 최대 길이보다 큽니다");
    }
    if (f.minimum !== undefined && f.maximum !== undefined && f.minimum > f.maximum) {
      fail(`schema.properties.${key}`, "최소값이 최대값보다 큽니다");
    }
    if (
      f.enum && (new Set(f.enum).size !== f.enum.length || f.enum.some((v) => v === null && !Array.isArray(f.type)))
    ) fail(`schema.properties.${key}.enum`, "선택 코드는 중복되지 않고 null 허용과 일치해야 합니다");
    for (const value of [f.minimum, f.maximum, f.default]) numeric(f, value, `schema.properties.${key}`);
  }
  for (
    const [name, refs] of Object.entries({
      required: schema.required,
      order: display.order,
      list_columns: display.list_columns,
      archived: display.archived,
    })
  ) {
    if (new Set(refs).size !== refs.length || refs.some((key) => !keys.includes(key))) {
      fail(name, "속성 참조는 존재하고 중복되지 않아야 합니다");
    }
  }
  if (display.order.length !== keys.length) fail("display.order", "모든 속성의 순서가 필요합니다");
  const rep = schema.properties[display.representative];
  if (
    !rep || rep.type !== "string" || rep.format !== undefined || rep.enum !== undefined ||
    !schema.required.includes(display.representative) ||
    display.archived.includes(display.representative) || (rep.minLength ?? 0) < 1
  ) fail("display.representative", "대표 속성은 활성 필수 텍스트이며 빈 문자열을 허용하지 않습니다");
  if (display.list_columns.some((k) => display.archived.includes(k))) {
    fail("display.list_columns", "보관 속성은 목록에서 제외하세요");
  }
  for (const [key, labels] of Object.entries(display.option_labels)) {
    if (
      !schema.properties[key]?.enum || Object.keys(labels).some((code) => !schema.properties[key].enum!.includes(code))
    ) fail(`display.option_labels.${key}`, "현재 선택 코드만 표시 라벨을 가질 수 있습니다");
  }
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch {
    fail("schema", "유효하지 않은 Draft 2020-12 스키마입니다");
  }
  for (const [key, f] of Object.entries(schema.properties)) {
    if (f.default !== undefined) {
      const check = ajv.compile({ $schema: ENTITY_SCHEMA_DIALECT, ...f });
      if (!check(f.default)) fail(`schema.properties.${key}.default`, "기본값이 속성 제약을 만족하지 않습니다");
    }
  }
  const representativeDefault = schema.properties[display.representative].default;
  if (typeof representativeDefault === "string" && !representativeDefault.trim()) {
    fail(`schema.properties.${display.representative}.default`, "대표 이름은 공백만 입력할 수 없습니다");
  }
  void validate;
  return parsed.data as Pick<EntitySchemaVersion, "schema" | "display">;
}
export function validateEntityProperties(
  raw: unknown,
  values: Record<string, unknown>,
  creation = false,
): Record<string, unknown> {
  const { schema, display } = validateEntityDefinition(raw);
  const result = { ...values };
  if (creation) {
    for (const [key, f] of Object.entries(schema.properties)) {
      if (result[key] === undefined && !display.archived.includes(key) && f.default !== undefined) {
        result[key] = f.default;
      }
    }
  }
  // JSONB's canonical text adds a space after each colon/comma. Properties contain
  // scalar values only, so this matches the database guard without parsing strings.
  const canonicalBytes = new TextEncoder().encode(JSON.stringify(result)).length +
    Math.max(0, 2 * Object.keys(result).length - 1);
  if (canonicalBytes > limits.properties_bytes) {
    fail("properties", "속성 값은 64 KiB 이하입니다");
  }
  const check = validator().compile(schema);
  if (!check(result)) {
    throw invalidInput(
      "속성 값을 확인하세요",
      (check.errors ?? []).map((e) => ({
        path: [
          "properties",
          ...e.instancePath.split("/").filter(Boolean),
          ...(e.keyword === "required"
            ? [String(e.params.missingProperty)]
            : e.keyword === "additionalProperties"
            ? [String(e.params.additionalProperty)]
            : []),
        ].join("."),
        message: e.message ?? "유효하지 않은 값",
      })),
    );
  }
  const representative = result[display.representative];
  if (typeof representative === "string" && !representative.trim()) {
    fail(`properties.${display.representative}`, "대표 이름은 공백만 입력할 수 없습니다");
  }
  for (const [key, value] of Object.entries(result)) {
    numeric(schema.properties[key], value, `properties.${key}`);
    if (typeof value === "string" && Array.from(value).length > limits.string_length) {
      fail(`properties.${key}`, "텍스트는 4096자 이하입니다");
    }
  }
  return result;
}
