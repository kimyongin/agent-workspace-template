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
