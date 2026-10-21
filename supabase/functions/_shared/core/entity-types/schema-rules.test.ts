import { entitySchemaPresentation } from "../../contracts/entity-type.ts";
import { assertEquals, assertThrows } from "@std/assert";
import { validateEntityDefinition, validateEntityProperties } from "./schema-rules.ts";
import { initialEntityDefinition } from "../../contracts/entity-type.ts";
Deno.test("public definition validation rejects nested features and invalid title references", () => {
  const definition = initialEntityDefinition("이름");
  assertEquals(validateEntityDefinition(definition).schema.required, ["prop_1"]);
  assertThrows(() => validateEntityDefinition({ ...definition, schema: { ...definition.schema, allOf: [] } }));
  assertThrows(() => validateEntityDefinition({ ...definition, display: { representative: "prop_2" } }));
  assertThrows(() => validateEntityDefinition({ schema: { ...definition.schema, "x-title-template": "$prop_2$" } }));
  for (const field of [{ format: "date" as const }, { oneOf: ["a", "b"].map((value) => ({ const: value })) }]) {
    assertEquals(
      validateEntityDefinition({
        schema: { ...definition.schema, properties: { prop_1: { ...definition.schema.properties.prop_1, ...field } } },
      }).schema["x-title-template"],
      "$prop_1$",
    );
  }
});
Deno.test("properties validate calendar dates, safe precision, missing/null and creation defaults", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = {
    "x-order": 20,
    type: ["string", "null"],
    format: "date",
    default: "2024-02-29",
  };

  assertEquals(validateEntityProperties(definition, { prop_1: "자료" }, true), {
    prop_1: "자료",
    prop_2: "2024-02-29",
  });
  assertEquals(validateEntityProperties(definition, { prop_1: "자료" }), { prop_1: "자료" });
  assertThrows(() => validateEntityProperties(definition, { prop_1: "자료", prop_2: "2023-02-29" }));
  definition.schema.properties.prop_3 = { "x-order": 30, type: "number" };

  assertThrows(() => validateEntityProperties(definition, { prop_1: "자료", prop_3: 0.0000001 }));
});
Deno.test("ordinary minLength and type errors use public dot paths", () => {
  const definition = initialEntityDefinition("이름");
  const blank = assertThrows(() => validateEntityProperties(definition, { prop_1: "" }));
  assertEquals(validateEntityProperties(definition, { prop_1: "   " }).prop_1, "   ");
  assertEquals((blank as { fields?: { path: string }[] }).fields?.[0].path, "properties.prop_1");
  const wrong = assertThrows(() => validateEntityProperties(definition, { prop_1: 12 }));
  assertEquals((wrong as { fields?: { path: string }[] }).fields?.[0].path, "properties.prop_1");
});
Deno.test("definitions reject SQL-unsafe labels and Gregorian year zero", () => {
  const d = initialEntityDefinition("이름");
  d.schema.properties.prop_1.title = "bad\u0000";
  assertThrows(() => validateEntityDefinition(d));
  d.schema.properties.prop_1.title = "한국어😀";
  d.schema.properties.prop_2 = { "x-order": 20, type: "string", format: "date" };

  assertThrows(() => validateEntityProperties(d, { prop_1: "name", prop_2: "0000-02-29" }));
});

Deno.test("validated definitions retain prototype-like single-select labels", () => {
  const d = initialEntityDefinition("이름");
  d.schema.properties.prop_2 = {
    "x-order": 20,
    type: "string",
    oneOf: ["__proto__", "constructor", "toString"].map((value) => ({ const: value })),
  };

  d.schema.properties.prop_2.oneOf = [{ const: "__proto__", title: "특수 코드" }, {
    const: "constructor",
    title: "생성 코드",
  }, { const: "toString", title: "문자 코드" }];
  const validated = validateEntityDefinition(d);
  assertEquals(Object.keys(entitySchemaPresentation(validated.schema).option_labels.prop_2), [
    "__proto__",
    "constructor",
    "toString",
  ]);
  assertEquals(validateEntityProperties(d, { prop_1: "이름", prop_2: "__proto__" }).prop_2, "__proto__");
});

Deno.test("property limits return localized field errors to every caller", () => {
  const d = initialEntityDefinition("이름");
  d.schema.properties.prop_2 = { "x-order": 20, type: "integer", maximum: 100 };

  const error = assertThrows(() => validateEntityProperties(d, { prop_1: "자료", prop_2: 101 }));
  assertEquals((error as { fields?: { path: string; message: string }[] }).fields, [{
    path: "properties.prop_2",
    message: "100 이하여야 합니다",
  }]);
});

Deno.test("published definitions retain explicit selected text through label renames and reject unsupported selections", () => {
  const d = initialEntityDefinition("이름");
  Object.assign(d.schema.properties.prop_1, { "x-search-text": true });
  d.schema.properties.prop_2 = { type: ["string", "null"], "x-order": 20, title: "설명" };
  Object.assign(d.schema.properties.prop_2, { "x-search-text": true });
  const published = validateEntityDefinition(JSON.parse(JSON.stringify(d)));
  assertEquals(published.schema.properties.prop_1, { ...d.schema.properties.prop_1 });
  published.schema.properties.prop_1.title = "바뀐 이름";
  assertEquals(validateEntityDefinition(published).schema.properties.prop_1, {
    ...d.schema.properties.prop_1,
    title: "바뀐 이름",
  });
  for (
    const field of [
      { type: "number" },
      { type: "boolean" },
      { format: "date" },
      { oneOf: [{ const: "a", title: "선택" }] },
      { deprecated: true },
    ]
  ) {
    assertThrows(() =>
      validateEntityDefinition({
        schema: {
          ...d.schema,
          properties: {
            ...d.schema.properties,
            prop_2: { type: "string", "x-order": 20, "x-search-text": true, ...field },
          },
        },
      })
    );
  }
});
