import { expect, it } from "vitest";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
import { schemaDiffValueLabel } from "./schema-labels.ts";
it("review uses input labels while preserving boolean values and schema references", () => {
  const definition = initialEntityDefinition("재료명");
  expect(schemaDiffValueLabel("schema.properties.prop_1.required", false, definition)).toBe("선택");
  expect(schemaDiffValueLabel("schema.properties.prop_1.required", true, definition)).toBe("필수");
  expect(schemaDiffValueLabel("schema.properties.prop_2.type", ["number", "null"], definition)).toBe("숫자");
  expect(schemaDiffValueLabel("schema.required", "prop_1", definition)).toBe("재료명");
  expect(schemaDiffValueLabel("schema.properties.prop_2.default", false, definition)).toBe("아니오");
  expect(schemaDiffValueLabel("schema.properties.prop_2.default", 0, definition)).toBe("0");
});

it("review translates enum codes using the definition belonging to that side of the change", () => {
  const definition = initialEntityDefinition("재료명");
  definition.schema.properties.prop_2 = {
    "x-order": 20,
    type: "string",
    oneOf: [{ const: "ready" }, { const: "closed" }],
  };
  definition.schema.properties.prop_2 = {
    ...definition.schema.properties.prop_2,
    oneOf: Object.entries({ ready: "판매 중", closed: "판매 종료" }).map(([value, title]) => ({ const: value, title })),
  };
  expect(schemaDiffValueLabel("properties.prop_2.oneOf", ["ready", "closed"], definition)).toBe("판매 중, 판매 종료");
  expect(schemaDiffValueLabel("properties.prop_2.default", "ready", definition)).toBe("판매 중");
  expect(schemaDiffValueLabel("properties.prop_2.default", "unknown", definition)).toBe("unknown");
  expect(schemaDiffValueLabel("properties.prop_2.title", "ready", definition)).toBe("ready");
});

it("review names choices from the oneOf branch titles", () => {
  const definition = initialEntityDefinition("재료명");
  expect(
    schemaDiffValueLabel(
      "properties.prop_2.oneOf",
      [{ const: "kg", title: "킬로그램" }, { const: "g", title: "그램" }],
      definition,
    ),
  ).toBe("킬로그램, 그램");
});

it("default diff resolves null through its field branch without colliding with string null", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = {
    type: ["string", "null"],
    "x-order": 20,
    oneOf: [{ const: null, title: "미정" }, { const: "null", title: "문자 코드" }],
  };
  expect(schemaDiffValueLabel("properties.prop_2.default", null, definition)).toBe("미정");
  expect(schemaDiffValueLabel("properties.prop_2.default", "null", definition)).toBe("문자 코드");
  expect(schemaDiffValueLabel("properties.prop_2.oneOf", [null, "null"], definition)).toBe("미정, 문자 코드");
});
