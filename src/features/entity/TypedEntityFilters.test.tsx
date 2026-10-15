import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  entitySchemaLimits,
  entitySchemaPolicy,
  type EntitySchemaResult,
  initialEntityDefinition,
} from "@contracts/entity-type.ts";
import { TypedEntityFilters, validatePropertyFilters } from "./TypedEntityFilters.tsx";

function definition(): EntitySchemaResult {
  return {
    ...initialEntityDefinition("이름"),
    type_id: "00000000-0000-4000-8000-000000000001",
    schema_version: 1,
    created_at: "2026-10-16T00:00:00Z",
    type: { id: "00000000-0000-4000-8000-000000000001", label: "자료", icon_id: "box", archived: false },
    constraints: entitySchemaLimits,
    policy: entitySchemaPolicy,
  };
}
it("validates choice codes from oneOf while keeping labels and order in the filter draft", () => {
  const schema = definition();
  schema.schema.properties.prop_2 = {
    type: ["string", "null"],
    "x-order": 20,
    oneOf: [{ const: "b", title: "두 번째" }, { const: null, title: "비어 있음" }, { const: "a", title: "첫 번째" }],
  };
  const raw = JSON.stringify([{ key: "prop_2", operator: "eq", value: "b" }]);
  expect(validatePropertyFilters(raw, schema)).toBe(raw);
  expect(() => validatePropertyFilters(raw.replace('"b"', '"missing"'), schema)).toThrow();
  expect(() => validatePropertyFilters(raw.replace('"eq"', '"contains"'), schema)).toThrow();
  const html = renderToStaticMarkup(
    <TypedEntityFilters schema={schema} raw={raw} sort="updated_at" onChange={() => {}} />,
  );
  expect(html.indexOf("두 번째")).toBeLessThan(html.indexOf("첫 번째"));
  expect(html).not.toContain("속성 조건 적용");
});
it("rejects deprecated properties from restored filter URLs", () => {
  const schema = definition();
  schema.schema.properties.prop_2 = { type: "string", "x-order": 20, deprecated: true };
  expect(() => validatePropertyFilters(JSON.stringify([{ key: "prop_2", operator: "unset" }]), schema)).toThrow();
});
it("normalizes numeric drafts only at application and rejects blank or imprecise input", () => {
  const schema = definition();
  schema.schema.properties.prop_2 = { type: "integer", "x-order": 20 };
  const raw = (value: string) => JSON.stringify([{ key: "prop_2", operator: "eq", value }]);
  expect(JSON.parse(validatePropertyFilters(raw("42"), schema))[0].value).toBe(42);
  for (const value of ["", "9007199254740993"]) expect(() => validatePropertyFilters(raw(value), schema)).toThrow();
});
