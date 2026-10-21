import { entitySchemaPresentation } from "../../contracts/entity-type.ts";
import { assertEquals, assertThrows } from "@std/assert";
import { validateEntityDefinition, validateEntityProperties } from "./schema-rules.ts";
import { initialEntityDefinition } from "../../contracts/entity-type.ts";
Deno.test("public definition validation rejects nested features and invalid title references", () => {
  const definition = initialEntityDefinition("이름");
  assertEquals(validateEntityDefinition(definition).schema.required, ["prop_1", "prop_2"]);
  assertThrows(() => validateEntityDefinition({ ...definition, schema: { ...definition.schema, allOf: [] } }));
  assertThrows(() => validateEntityDefinition({ ...definition, display: { representative: "prop_3" } }));
  assertThrows(() => validateEntityDefinition({ schema: { ...definition.schema, "x-title-template": "$prop_3$" } }));
  for (const field of [{ format: "date" as const }, { oneOf: ["a", "b"].map((value) => ({ const: value })) }]) {
    assertEquals(
      validateEntityDefinition({
        schema: {
          ...definition.schema,
          properties: { ...definition.schema.properties, prop_1: { ...definition.schema.properties.prop_1, ...field } },
        },
      }).schema["x-title-template"],
      "$prop_1$",
    );
  }
});
Deno.test("properties validate calendar dates, safe precision, missing/null and creation defaults", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_3 = {
    "x-order": 30,
    type: ["string", "null"],
    format: "date",
    default: "2024-02-29",
  };

  assertEquals(
    validateEntityProperties(definition, { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "자료" }, true),
    {
      prop_2: "00000000-0000-4000-8000-000000000001:001",
      prop_1: "자료",
      prop_3: "2024-02-29",
    },
  );
  assertEquals(
    validateEntityProperties(definition, { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "자료" }),
    { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "자료" },
  );
  assertThrows(() =>
    validateEntityProperties(definition, {
      prop_2: "00000000-0000-4000-8000-000000000001:001",
      prop_1: "자료",
      prop_3: "2023-02-29",
    })
  );
  definition.schema.properties.prop_4 = { "x-order": 40, type: "number" };

  assertThrows(() =>
    validateEntityProperties(definition, {
      prop_2: "00000000-0000-4000-8000-000000000001:001",
      prop_1: "자료",
      prop_4: 0.0000001,
    })
  );
});
Deno.test("ordinary minLength and type errors use public dot paths", () => {
  const definition = initialEntityDefinition("이름");
  const blank = assertThrows(() =>
    validateEntityProperties(definition, { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "" })
  );
  assertEquals(
    validateEntityProperties(definition, { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "   " }).prop_1,
    "   ",
  );
  assertEquals((blank as { fields?: { path: string }[] }).fields?.[0].path, "properties.prop_1");
  const wrong = assertThrows(() =>
    validateEntityProperties(definition, { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: 12 })
  );
  assertEquals((wrong as { fields?: { path: string }[] }).fields?.[0].path, "properties.prop_1");
});
Deno.test("definitions reject SQL-unsafe labels and Gregorian year zero", () => {
  const d = initialEntityDefinition("이름");
  d.schema.properties.prop_1.title = "bad\u0000";
  assertThrows(() => validateEntityDefinition(d));
  d.schema.properties.prop_1.title = "한국어😀";
  d.schema.properties.prop_3 = { "x-order": 30, type: "string", format: "date" };

  assertThrows(() =>
    validateEntityProperties(d, {
      prop_2: "00000000-0000-4000-8000-000000000001:001",
      prop_1: "name",
      prop_3: "0000-02-29",
    })
  );
});

Deno.test("validated definitions retain prototype-like single-select labels", () => {
  const d = initialEntityDefinition("이름");
  d.schema.properties.prop_3 = {
    "x-order": 30,
    type: "string",
    oneOf: ["__proto__", "constructor", "toString"].map((value) => ({ const: value })),
  };

  d.schema.properties.prop_3.oneOf = [{ const: "__proto__", title: "특수 코드" }, {
    const: "constructor",
    title: "생성 코드",
  }, { const: "toString", title: "문자 코드" }];
  const validated = validateEntityDefinition(d);
  assertEquals(Object.keys(entitySchemaPresentation(validated.schema).option_labels.prop_3), [
    "__proto__",
    "constructor",
    "toString",
  ]);
  assertEquals(
    validateEntityProperties(d, {
      prop_2: "00000000-0000-4000-8000-000000000001:001",
      prop_1: "이름",
      prop_3: "__proto__",
    }).prop_3,
    "__proto__",
  );
});

Deno.test("property limits return localized field errors to every caller", () => {
  const d = initialEntityDefinition("이름");
  d.schema.properties.prop_3 = { "x-order": 30, type: "integer", maximum: 100 };

  const error = assertThrows(() =>
    validateEntityProperties(d, { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "자료", prop_3: 101 })
  );
  assertEquals((error as { fields?: { path: string; message: string }[] }).fields, [{
    path: "properties.prop_3",
    message: "100 이하여야 합니다",
  }]);
});

Deno.test("published definitions retain explicit selected text through label renames and reject unsupported selections", () => {
  const d = initialEntityDefinition("이름");
  Object.assign(d.schema.properties.prop_1, { "x-search-text": true });
  d.schema.properties.prop_3 = { type: ["string", "null"], "x-order": 30, title: "설명" };
  Object.assign(d.schema.properties.prop_3, { "x-search-text": true });
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
            prop_3: { type: "string", "x-order": 30, "x-search-text": true, ...field },
          },
        },
      })
    );
  }
});
