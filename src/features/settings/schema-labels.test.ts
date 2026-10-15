import { expect, it } from "vitest";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
import { schemaDiffValueLabel } from "./schema-labels.ts";
it("review uses input labels while preserving boolean values and schema references", () => {
  const definition = initialEntityDefinition("재료명");
  expect(schemaDiffValueLabel("schema.properties.prop_1.required", false, definition)).toBe("선택");
  expect(schemaDiffValueLabel("schema.properties.prop_1.required", true, definition)).toBe("필수");
  expect(schemaDiffValueLabel("schema.properties.prop_2.type", ["number", "null"], definition)).toBe("숫자");
  expect(schemaDiffValueLabel("display.representative", "prop_1", definition)).toBe("재료명");
  expect(schemaDiffValueLabel("schema.properties.prop_2.default", false, definition)).toBe("아니오");
  expect(schemaDiffValueLabel("schema.properties.prop_2.default", 0, definition)).toBe("0");
});

it("review translates enum codes using the definition belonging to that side of the change", () => {
  const definition = initialEntityDefinition("재료명");
  definition.schema.properties.prop_2 = { type: "string", enum: ["ready", "closed"] };
  definition.display.option_labels.prop_2 = { ready: "판매 중", closed: "판매 종료" };
  expect(schemaDiffValueLabel("properties.prop_2.enum", ["ready", "closed"], definition)).toBe("판매 중, 판매 종료");
  expect(schemaDiffValueLabel("properties.prop_2.default", "ready", definition)).toBe("판매 중");
  expect(schemaDiffValueLabel("properties.prop_2.default", "unknown", definition)).toBe("unknown");
  expect(schemaDiffValueLabel("properties.prop_2.title", "ready", definition)).toBe("ready");
});
