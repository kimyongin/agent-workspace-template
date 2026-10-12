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
it("nullable single-select exposes null only when its enum admits null", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { type: ["string", "null"], enum: ["a"] };
  definition.display.order.push("prop_2");
  const html = renderToStaticMarkup(
    <PropertyFields definition={definition} values={{ prop_1: "이름" }} onChange={() => {}} errors={{}} />,
  );
  expect(html).not.toContain('value="null"');
  definition.schema.properties.prop_2.enum = ["a", null];
  expect(
    renderToStaticMarkup(
      <PropertyFields definition={definition} values={{ prop_1: "이름" }} onChange={() => {}} errors={{}} />,
    ),
  ).toContain('value="null"');
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
