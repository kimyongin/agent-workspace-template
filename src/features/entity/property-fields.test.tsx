import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PropertyFields } from "./property-fields.tsx";
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
