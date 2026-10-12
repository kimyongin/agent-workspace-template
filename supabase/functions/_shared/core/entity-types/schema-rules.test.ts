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
  for (const field of [{ format: "date" as const }, { enum: ["a", "b"] }]) {
    assertThrows(() =>
      validateEntityDefinition({
        ...definition,
        schema: { ...definition.schema, properties: { prop_1: { ...definition.schema.properties.prop_1, ...field } } },
      })
    );
  }
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
Deno.test("representative is not whitespace and public field errors use dot paths", () => {
  const definition = initialEntityDefinition("이름");
  const blank = assertThrows(() => validateEntityProperties(definition, { prop_1: "   " }));
  assertEquals((blank as { fields?: { path: string }[] }).fields?.[0].path, "properties.prop_1");
  const wrong = assertThrows(() => validateEntityProperties(definition, { prop_1: 12 }));
  assertEquals((wrong as { fields?: { path: string }[] }).fields?.[0].path, "properties.prop_1");
});
Deno.test("definitions reject SQL-unsafe labels and Gregorian year zero", () => {
  const d = initialEntityDefinition("이름");
  d.schema.properties.prop_1.title = "bad\u0000";
  assertThrows(() => validateEntityDefinition(d));
  d.schema.properties.prop_1.title = "한국어😀";
  d.schema.properties.prop_2 = { type: "string", format: "date" };
  d.display.order.push("prop_2");
  assertThrows(() => validateEntityProperties(d, { prop_1: "name", prop_2: "0000-02-29" }));
});

Deno.test("validated definitions retain prototype-like single-select labels", () => {
  const d = initialEntityDefinition("이름");
  d.schema.properties.prop_2 = { type: "string", enum: ["__proto__", "constructor", "toString"] };
  d.display.order.push("prop_2");
  d.display.option_labels.prop_2 = JSON.parse(
    '{"__proto__":"특수 코드","constructor":"생성 코드","toString":"문자 코드"}',
  );
  const validated = validateEntityDefinition(d);
  assertEquals(Object.keys(validated.display.option_labels.prop_2), ["__proto__", "constructor", "toString"]);
  assertEquals(validateEntityProperties(d, { prop_1: "이름", prop_2: "__proto__" }).prop_2, "__proto__");
});
