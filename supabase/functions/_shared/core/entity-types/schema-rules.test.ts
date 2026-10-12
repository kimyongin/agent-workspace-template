import { assertEquals, assertThrows } from "@std/assert";
import { validateEntityDefinition, validateEntityProperties } from "./schema-rules.ts";
import { initialEntityDefinition } from "../../contracts/entity-type.ts";
Deno.test("public definition validation rejects nested features and invalid representative references", () => {
  const definition = initialEntityDefinition("이름");
  assertEquals(validateEntityDefinition(definition).schema.required, ["prop_1"]);
  assertThrows(() => validateEntityDefinition({ ...definition, schema: { ...definition.schema, allOf: [] } }));
  assertThrows(() =>
    validateEntityDefinition({ ...definition, display: { ...definition.display, representative: "prop_2" } })
  );
});
Deno.test("properties validate calendar dates, safe precision, missing/null and creation defaults", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { type: ["string", "null"], format: "date", default: "2024-02-29" };
  definition.display.order.push("prop_2");
  assertEquals(validateEntityProperties(definition, { prop_1: "자료" }, true), {
    prop_1: "자료",
    prop_2: "2024-02-29",
  });
  assertEquals(validateEntityProperties(definition, { prop_1: "자료" }), { prop_1: "자료" });
  assertThrows(() => validateEntityProperties(definition, { prop_1: "자료", prop_2: "2023-02-29" }));
  definition.schema.properties.prop_3 = { type: "number" };
  definition.display.order.push("prop_3");
  assertThrows(() => validateEntityProperties(definition, { prop_1: "자료", prop_3: 0.0000001 }));
});
