import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyFields, propertyValues } from "./property-fields.tsx";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
describe("schema form public presentation", () => {
  it("renders labels and three boolean states while preserving zero", () => {
    const definition = initialEntityDefinition("품명");
    definition.schema.properties.prop_2 = { type: ["boolean", "null"], title: "검사" };
    definition.schema.properties.prop_3 = { type: "number", title: "무게" };
    definition.display.order.push("prop_2", "prop_3");
    const html = renderToStaticMarkup(
      <PropertyFields
        definition={definition}
        values={{ prop_1: "제품", prop_3: "0" }}
        onChange={() => {}}
        errors={{}}
      />,
    );
    expect(html).toContain("품명");
    expect(html).toContain("미입력");
    expect(html).toContain("참");
    expect(html).toContain("거짓");
    expect(html).toContain('value="0"');
  });
});
it("nullable single-select has one empty option, even for a stored null", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { type: ["string", "null"], enum: ["a", null],
  };
  definition.display.order.push("prop_2");
  const html = renderToStaticMarkup(
    <PropertyFields definition={definition} values={{ prop_1: "이름", prop_2: null }} onChange={() => {}} errors={{}} />,
  );
  expect(html).not.toContain('value="null"');
  expect(html).toContain('value="unset" selected=""');
  expect(html).not.toContain("미입력으로 변경");
});
it("archived arbitrary stored text cannot resolve inherited option labels", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { type: "string", title: "보관 메모" };
  definition.display.order.push("prop_2");
  definition.display.archived.push("prop_2");
  for (const value of ["__proto__", "constructor", "toString"]) {
    const html = renderToStaticMarkup(
      <PropertyFields
        definition={definition}
        values={{ prop_1: "이름", prop_2: value }}
        onChange={() => {}}
        errors={{}}
      />,
    );
    expect(html).toContain(value);
  }
});

it("property drafts reject a rounded numeric value while preserving the draft", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { type: "number", title: "수량" };
  const values = { prop_1: "이름", prop_2: "1.0000000000000001" };
  expect(() => propertyValues(definition, values)).toThrow();
  expect(values.prop_2).toBe("1.0000000000000001");
});

it("numeric draft failure reports the original field key for accessible form feedback", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { type: "number", title: "수량" };
  try { propertyValues(definition, { prop_1: "자료", prop_2: "1.0000000000000001" }); throw new Error("must reject"); }
  catch (error) { expect((error as { fields: Record<string, string> }).fields["properties.prop_2"]).toContain("정밀도"); }
});

it("required empty inputs fail while optional null, zero and false remain distinct", () => {
  const definition = initialEntityDefinition("이름");
  Object.assign(definition.schema.properties, {
    prop_2: { type: ["number", "null"] },
    prop_3: { type: ["boolean", "null"] },
  });
  expect(
    propertyValues(definition, { prop_1: "이름", prop_2: "0", prop_3: false }),
  )
    .toEqual({ prop_1: "이름", prop_2: 0, prop_3: false });
  expect(propertyValues(definition, { prop_1: "이름", prop_2: null })).toEqual({
    prop_1: "이름",
    prop_2: null,
  });
  for (const value of [null, "", "  "]) {
    expect(() => propertyValues(definition, { prop_1: value })).toThrow(
      "필수 항목",
    );
  }
});
