import { decodeIdentifierValue } from "../../contracts/entity-identifiers.ts";
import { entityTitleTemplateIssues } from "../../contracts/entity-title-template.ts";
import { entityFieldInput } from "../../contracts/entity-schema-change.ts";
import { Ajv2020 } from "ajv/2020";
import addFormats from "ajv-formats";
import { z } from "zod";
import {
  ENTITY_SCHEMA_DIALECT,
  type EntityField,
  entitySchemaLimits as limits,
  entitySchemaPresentation,
  type EntitySchemaVersion,
  entityTypeIcon,
  propertyKey,
  supportsEntitySearchText,
} from "../../contracts/entity-type.ts";
import { invalidInput } from "../shared/errors.ts";
function propertyErrorMessage(keyword: string, params: Record<string, unknown>): string {
  switch (keyword) {
    case "minimum":
      return `${params.limit} 이상이어야 합니다`;
    case "maximum":
      return `${params.limit} 이하여야 합니다`;
    case "minLength":
      return `${params.limit}자 이상이어야 합니다`;
    case "maxLength":
      return `${params.limit}자 이하여야 합니다`;
    case "required":
      return "필수 항목을 입력하세요";
    case "enum":
    case "oneOf":
    case "const":
      return "현재 선택 항목에서 값을 선택하세요";
    case "format":
      return "실제로 존재하는 날짜를 입력하세요";
    case "additionalProperties":
      return "현재 입력 항목에 없는 값입니다";
    default:
      return "항목의 데이터 타입과 값을 확인하세요";
  }
}
const definition = z.strictObject({
  schema: z.strictObject({
    $schema: z.literal(ENTITY_SCHEMA_DIALECT),
    "x-type-id": z.string().uuid(),
    "x-version": z.number().int().positive().max(2147483647),
    "x-title-template": z.string(),
    "x-identity-property": propertyKey.optional(),
    title: z.string().trim().min(1).max(80),
    description: z.string().max(1000).optional(),
    "x-icon": entityTypeIcon,
    deprecated: z.boolean().default(false),
    type: z.literal("object"),
    additionalProperties: z.literal(false),
    properties: z.record(propertyKey, entityFieldInput),
    required: z.array(propertyKey).max(limits.fields),
  }),
});
/** An instance lives for one validation; compiled owner definitions cannot accumulate. */
function validator() {
  const ajv = new Ajv2020({ strict: true, allErrors: true, validateFormats: true, multipleOfPrecision: 12 });
  (addFormats as unknown as (a: Ajv2020, options: { mode: string }) => void)(ajv, { mode: "full" });
  for (
    const keyword of [
      "x-title-template",
      "x-identity-property",
      "x-identifier",
      "x-type-id",
      "x-version",
      "x-icon",
      "x-order",
      "x-search-text",
    ]
  ) ajv.addKeyword({ keyword });
  return ajv;
}
function fail(path: string, message: string): never {
  throw invalidInput(message, [{ path, message }]);
}
function typeOf(f: EntityField) {
  return Array.isArray(f.type) ? f.type.find((t) => t !== "null")! : f.type;
}
function validateIdentifierDefinition(schema: EntitySchemaVersion["schema"]) {
  const fields = Object.entries(schema.properties).filter(([, field]) => field["x-identifier"]);
  const identity = schema["x-identity-property"];
  const selected = identity && schema.properties[identity];
  if (
    !identity || !selected || !selected["x-identifier"] || selected.type !== "string" || selected.deprecated ||
    !schema.required.includes(identity) || selected.default !== undefined
  ) fail("schema.x-identity-property", "자료 식별자는 기본값 없는 필수 식별자 항목 하나로 지정하세요");
  for (const [key, field] of fields) {
    identifier(field, field.default, `schema.properties.${key}.default`);
    if (
      typeOf(field) !== "string" || field.format || field.oneOf || field.minLength !== undefined ||
      field.maxLength !== undefined
    ) {
      fail(
        `schema.properties.${key}.x-identifier`,
        "식별자 항목은 원본 1~200자를 사용하며 별도 형식·선택지·길이를 지정하지 않습니다",
      );
    }
  }
}
function decimalPlaces(value: number) {
  const [fraction, exponent] = String(value).toLowerCase().split("e");
  return Math.max(0, (fraction.split(".")[1]?.length ?? 0) - Number(exponent ?? 0));
}
export function exactMultipleOf(value: number, divisor: number): boolean {
  const scale = Math.max(decimalPlaces(value), decimalPlaces(divisor));
  const integer = (number: number) => BigInt(number.toFixed(scale).replace(".", ""));
  return integer(value) % integer(divisor) === 0n;
}
function identifier(field: EntityField, value: unknown, path: string) {
  if (!field["x-identifier"] || value === null || value === undefined) return;
  let kind: string;
  try {
    kind = decodeIdentifierValue(value as string).kind_id;
  } catch {
    fail(path, "식별자 종류와 원본 문자열의 정확한 쌍을 입력하세요");
  }
  if (!field["x-identifier"].allowed_kind_ids.includes(kind!)) fail(path, "허용된 식별자 종류를 선택하세요");
}
function numeric(f: EntityField, value: unknown, path: string) {
  if (typeof value !== "number") return;
  if (typeOf(f) === "integer" && !Number.isSafeInteger(value)) fail(path, "정수는 안전한 정수 범위여야 합니다");
  if (typeOf(f) === "number" && (Math.abs(value) > limits.number_abs || decimalPlaces(value) > limits.decimal_places)) {
    fail(path, "숫자는 절댓값 10억 이하, 소수점 6자리 이하입니다");
  }
  if (f.multipleOf !== undefined) {
    if (!exactMultipleOf(value, f.multipleOf)) fail(path, "지정한 배수의 숫자를 입력하세요");
  }
}
export function sqlSafeText(value: string): boolean {
  return !value.includes("\u0000") &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value);
}
/** PostgreSQL JSONB text spacing and decimal rendering, including nested definitions. */
export function jsonbText(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(jsonbText).join(", ") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.entries(value).filter(([, v]) =>
      v !== undefined
    ).map(([k, v]) => JSON.stringify(k) + ": " + jsonbText(v)).join(", ") + "}";
  }
  if (typeof value === "number" && String(value).includes("e")) {
    const [mantissa, exponent] = String(value).split("e"), negative = mantissa.startsWith("-");
    const plain = mantissa.replace("-", ""),
      digits = plain.replace(".", ""),
      point = (plain.indexOf(".") < 0 ? plain.length : plain.indexOf(".")) + Number(exponent);
    return (negative ? "-" : "") +
      (point <= 0
        ? "0." + "0".repeat(-point) + digits
        : point >= digits.length
        ? digits + "0".repeat(point - digits.length)
        : digits.slice(0, point) + "." + digits.slice(point));
  }
  return JSON.stringify(value);
}
export function validateEntityDefinition(raw: unknown): Pick<EntitySchemaVersion, "schema"> {
  const ajv = validator();
  if (
    new TextEncoder().encode(jsonbText((raw as { schema?: unknown })?.schema)).length > limits.definition_bytes
  ) {
    fail("schema", "정의는 256 KiB 이하입니다");
  }
  const parsed = definition.safeParse(raw);
  if (!parsed.success) {
    throw invalidInput(
      "지원하지 않는 속성 정의입니다",
      parsed.error.issues.flatMap((i) =>
        i.code === "unrecognized_keys"
          ? i.keys.map((key) => ({ path: [...i.path, key].join("."), message: i.message }))
          : [{ path: i.path.join("."), message: i.message }]
      ),
    );
  }
  const { schema } = parsed.data;
  const display = entitySchemaPresentation(schema);
  const inspectText = (value: unknown, path: string) => {
    if (typeof value === "string" && !sqlSafeText(value)) {
      fail(path, "텍스트에는 NUL 또는 잘못된 Unicode 문자를 저장할 수 없습니다");
    }
    if (value && typeof value === "object") {
      for (const [key, v] of Object.entries(value)) {
        if (!sqlSafeText(key)) fail(path, "선택 코드에 잘못된 문자가 있습니다");
        inspectText(v, `${path}.${key}`);
      }
    }
  };
  inspectText(parsed.data, "definition");
  if (schema["x-title-template"] !== undefined) {
    const issues = entityTitleTemplateIssues(schema["x-title-template"], schema);
    if (issues.length) fail("schema.x-title-template", issues.map((issue) => issue.reason).join(" · "));
  }
  const keys = Object.keys(schema.properties);
  if (!keys.length || keys.length > limits.fields) fail("schema.properties", "속성은 1~64개입니다");
  validateIdentifierDefinition(schema);
  for (const [key, f] of Object.entries(schema.properties)) {
    const type = typeOf(f);
    if (f["x-search-text"] && !supportsEntitySearchText(f)) {
      fail(`schema.properties.${key}.x-search-text`, "검색에는 사용 중인 텍스트 항목만 선택할 수 있습니다");
    }
    if (Array.isArray(f.type) && (new Set(f.type).size !== 2 || !f.type.includes("null"))) {
      fail(`schema.properties.${key}.type`, "nullable은 한 데이터 타입과 null의 조합입니다");
    }
    if ((f.format || f.oneOf || f.minLength !== undefined || f.maxLength !== undefined) && type !== "string") {
      fail(`schema.properties.${key}`, "문자열 제약은 문자열에만 적용합니다");
    }
    if (
      (f.minimum !== undefined || f.maximum !== undefined || f.multipleOf !== undefined) &&
      !["integer", "number"].includes(type)
    ) {
      fail(`schema.properties.${key}`, "범위는 숫자 속성에만 적용합니다");
    }
    if (f.minLength !== undefined && f.maxLength !== undefined && f.minLength > f.maxLength) {
      fail(`schema.properties.${key}`, "최소 길이가 최대 길이보다 큽니다");
    }
    if (f.minimum !== undefined && f.maximum !== undefined && f.minimum > f.maximum) {
      fail(`schema.properties.${key}`, "최소값이 최대값보다 큽니다");
    }
    if (
      f.oneOf &&
      (new Set(f.oneOf.map((o) => o.const)).size !== f.oneOf.length ||
        f.oneOf.some((o) => o.const === null) !== (Array.isArray(f.type) && f.type.includes("null")))
    ) fail(`schema.properties.${key}.oneOf`, "선택 코드는 중복되지 않고 null 허용과 일치해야 합니다");
    for (const value of [f.minimum, f.maximum]) {
      numeric({ ...f, multipleOf: undefined }, value, `schema.properties.${key}`);
    }
    if (
      f.multipleOf !== undefined &&
      (f.multipleOf > (type === "integer" ? limits.integer_abs : limits.number_abs) ||
        decimalPlaces(f.multipleOf) > limits.decimal_places)
    ) fail(`schema.properties.${key}.multipleOf`, "배수 제약은 안전한 숫자 범위와 소수점 6자리 이하여야 합니다");
    numeric(f, f.default, `schema.properties.${key}.default`);
    if (f.deprecated && schema.required.includes(key)) {
      fail(`schema.properties.${key}.deprecated`, "사용 중지 속성은 필수일 수 없습니다");
    }
    if (f.readOnly && schema.required.includes(key) && f.default === undefined) {
      fail(`schema.properties.${key}.default`, "필수 읽기 전용 속성에는 유효한 기본값이 필요합니다");
    }
  }
  for (
    const [name, refs] of Object.entries({
      required: schema.required,
      order: display.order,
      archived: display.archived,
    })
  ) {
    if (new Set(refs).size !== refs.length || refs.some((key) => !keys.includes(key))) {
      fail(name, "속성 참조는 존재하고 중복되지 않아야 합니다");
    }
  }
  if (display.order.length !== keys.length) fail("schema.properties", "모든 속성의 순서가 필요합니다");
  if (new Set(Object.values(schema.properties).map((f) => f["x-order"])).size !== keys.length) {
    fail("schema.properties", "입력 순서는 중복될 수 없습니다");
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
      if (f.format === "date" && typeof f.default === "string" && f.default.startsWith("0000-")) {
        fail(`schema.properties.${key}.default`, "날짜의 연도는 0001~9999입니다");
      }
      if (!check(f.default)) fail(`schema.properties.${key}.default`, "기본값이 속성 제약을 만족하지 않습니다");
    }
  }
  void validate;
  return parsed.data as Pick<EntitySchemaVersion, "schema">;
}
/** Validate the bytes actually published, including server-owned ID and next revision. */
export function publicationDefinition(
  definition: Pick<EntitySchemaVersion, "schema">,
  typeId: string,
  revision: number,
) {
  return validateEntityDefinition({ schema: { ...definition.schema, "x-type-id": typeId, "x-version": revision } });
}
export function compileEntityProperties(raw: unknown) {
  const { schema } = validateEntityDefinition(raw);
  const display = entitySchemaPresentation(schema);
  const check = validator().compile(schema);
  return (values: Record<string, unknown>, creation = false): Record<string, unknown> => {
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
    const canonicalBytes = new TextEncoder().encode(jsonbText(result)).length;
    if (canonicalBytes > limits.properties_bytes) {
      fail("properties", "속성 값은 64 KiB 이하입니다");
    }
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
          message: propertyErrorMessage(e.keyword, e.params),
        })),
      );
    }
    for (const [key, value] of Object.entries(result)) {
      identifier(schema.properties[key], value, `properties.${key}`);
      numeric(schema.properties[key], value, `properties.${key}`);
      if (schema.properties[key].format === "date" && typeof value === "string" && value.startsWith("0000-")) {
        fail(`properties.${key}`, "날짜의 연도는 0001~9999입니다");
      }
      if (
        typeof value === "string" &&
        (value.includes("\u0000") ||
          /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(value))
      ) {
        fail(`properties.${key}`, "텍스트에는 NUL 또는 잘못된 Unicode 문자를 저장할 수 없습니다");
      }
      if (typeof value === "string" && Array.from(value).length > limits.string_length) {
        fail(`properties.${key}`, "텍스트는 4096자 이하입니다");
      }
    }
    return result;
  };
}
export function validateEntityProperties(raw: unknown, values: Record<string, unknown>, creation = false) {
  return compileEntityProperties(raw)(values, creation);
}
/** Compile a supported field for explicit migration literals, without creation defaults. */
export function compileEntityFieldValue(field: EntityField) {
  const check = validator().compile({ $schema: ENTITY_SCHEMA_DIALECT, ...field });
  return (value: unknown) => {
    if (!check(value)) throw invalidInput("보완값이 대상 속성 제약을 만족하지 않습니다");
    identifier(field, value, "value");
    numeric(field, value, "value");
    if (typeof value === "string" && (!sqlSafeText(value) || (field.format === "date" && value.startsWith("0000-")))) {
      throw invalidInput("저장할 수 없는 보완값입니다");
    }
  };
}
