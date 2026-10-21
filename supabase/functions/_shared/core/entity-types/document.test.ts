import { assertEquals, assertThrows } from "@std/assert";
import { validateEntityDefinition, validateEntityProperties } from "./schema-rules.ts";
Deno.test("single document preserves metadata and nullable choice annotations", () => {
  const definition = {
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      "x-type-id": "11111111-1111-4111-8111-111111111111",
      "x-version": 1,
      "x-title-template": "$prop_1$",
      "x-identity-property": "prop_3",
      title: "자료",
      "x-icon": "box",
      deprecated: false,
      type: "object",
      additionalProperties: false,
      properties: {
        prop_3: {
          type: "string",
          "x-order": 30,
          "x-identifier": {
            allowed_kind_ids: ["00000000-0000-4000-8000-000000000001"],
            default_kind_id: "00000000-0000-4000-8000-000000000001",
          },
        },
        prop_1: { type: "string", minLength: 1, "x-order": 10 },
        prop_2: {
          type: ["string", "null"],
          "x-order": 20,
          oneOf: [{ const: "a", title: "첫째" }, { const: null, title: "없음" }],
        },
      },
      required: ["prop_1", "prop_3"],
    },
  };
  assertEquals<unknown>(validateEntityDefinition(definition), definition);
  assertEquals(
    validateEntityProperties(definition, {
      prop_1: "이름",
      prop_2: null,
      prop_3: "00000000-0000-4000-8000-000000000001:001",
    }).prop_2,
    null,
  );
  assertThrows(() => validateEntityDefinition({ ...definition, display: {} }));
});

import { initialEntityDefinition } from "../../contracts/entity-type.ts";
import { schemaDefinitionDiff } from "./evolution.ts";
import { renderEntityTitle } from "../../contracts/entity-title-template.ts";
Deno.test("published identifier fields retain allowed kinds and one required identity in the same document", () => {
  const definition = initialEntityDefinition("이름");
  const kind = "22222222-2222-4222-8222-222222222222";
  const other = "33333333-3333-4333-8333-333333333333";
  const schema = {
    ...definition.schema,
    "x-identity-property": "prop_2",
    properties: {
      ...definition.schema.properties,
      prop_2: {
        type: "string",
        "x-order": 20,
        "x-identifier": { allowed_kind_ids: [kind, other], default_kind_id: kind },
      },
      prop_3: {
        type: ["string", "null"],
        "x-order": 30,
        "x-identifier": { allowed_kind_ids: [kind], default_kind_id: kind },
      },
    },
    required: ["prop_1", "prop_2"],
  };
  assertEquals<unknown>(validateEntityDefinition({ schema }).schema, schema);
});

Deno.test("published identifier definitions reject a missing or optional selected identity", () => {
  const definition = initialEntityDefinition("이름");
  const withoutIdentifiers = structuredClone(definition);
  delete withoutIdentifiers.schema["x-identity-property"];
  delete withoutIdentifiers.schema.properties.prop_2["x-identifier"];
  assertThrows(() => validateEntityDefinition(withoutIdentifiers));
  delete definition.schema["x-identity-property"];
  definition.schema.required = ["prop_1"];
  definition.schema.properties.prop_2 = {
    type: "string",
    "x-order": 20,
    "x-identifier": {
      allowed_kind_ids: ["22222222-2222-4222-8222-222222222222"],
      default_kind_id: "22222222-2222-4222-8222-222222222222",
    },
  };
  assertThrows(() => validateEntityDefinition(definition));
  definition.schema["x-identity-property"] = "prop_2";
  assertThrows(() => validateEntityDefinition(definition));
  definition.schema.required.push("prop_2");
  assertEquals(validateEntityDefinition(definition).schema["x-identity-property"], "prop_2");
  for (
    const field of [
      { ...definition.schema.properties.prop_2, type: ["string", "null"] },
      { ...definition.schema.properties.prop_2, default: "22222222-2222-4222-8222-222222222222:fixed" },
      { ...definition.schema.properties.prop_2, "x-identifier": undefined },
      { ...definition.schema.properties.prop_2, minLength: 2 },
      { ...definition.schema.properties.prop_2, maxLength: 100 },
    ]
  ) {
    assertThrows(() =>
      validateEntityDefinition({
        schema: { ...definition.schema, properties: { ...definition.schema.properties, prop_2: field } },
      })
    );
  }
});

Deno.test("title variables display an identifier original string without its stored kind prefix", () => {
  const definition = initialEntityDefinition("상품 식별자");
  definition.schema.properties.prop_1["x-identifier"] = {
    allowed_kind_ids: ["22222222-2222-4222-8222-222222222222"],
    default_kind_id: "22222222-2222-4222-8222-222222222222",
  };
  definition.schema["x-title-template"] = "상품 $prop_1$";
  assertEquals(
    renderEntityTitle(definition.schema, { prop_1: "22222222-2222-4222-8222-222222222222:00123" }, "대기"),
    "상품 00123",
  );
});

Deno.test("metadata changes publish while equivalent boolean annotations and required order do not", () => {
  const source = initialEntityDefinition("이름");
  source.schema.properties.prop_2 = { type: "string", "x-order": 20 };
  source.schema.required.push("prop_2");
  const target = structuredClone(source);
  target.schema["x-version"] = 99;
  delete target.schema.deprecated;
  target.schema.properties.prop_2.readOnly = false;
  target.schema.required.reverse();
  assertEquals(schemaDefinitionDiff(source, target), []);
  target.schema.title = "새 이름";
  assertEquals(schemaDefinitionDiff(source, target).map((d) => d.path), ["title"]);
});

import { checkedProperties, type EntityDefinition } from "../entity/values.ts";
Deno.test("readOnly creation defaults and immutable values remain independent of deprecated fields", () => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_3 = {
    type: "number",
    "x-order": 30,
    readOnly: true,
    default: 0.3,
    multipleOf: 0.1,
  };
  definition.schema.required.push("prop_3");
  const saved = {
    ...definition,
    type_id: definition.schema["x-type-id"],
    schema_version: 1,
    type_version: 1,
    type: { id: definition.schema["x-type-id"], label: "이름", icon_id: "box", archived: false },
  } as EntityDefinition;
  assertEquals(
    checkedProperties(saved, { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "이름" }, {
      prop_2: "00000000-0000-4000-8000-000000000001:001",
      prop_1: "이름",
    }, true),
    { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "이름", prop_3: 0.3 },
  );
  assertThrows(() =>
    checkedProperties(saved, { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "이름", prop_3: 0.3 }, {
      prop_3: 0.3,
    }, true)
  );
  assertEquals(
    checkedProperties(
      saved,
      { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "이름", prop_3: 0.3 },
      { prop_3: 0.3 },
      false,
      { prop_3: 0.3 },
    ).prop_3,
    0.3,
  );
  assertThrows(() =>
    checkedProperties(
      saved,
      { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "이름", prop_3: 0.4 },
      { prop_3: 0.4 },
      false,
      { prop_3: 0.3 },
    )
  );
  delete definition.schema.properties.prop_3.default;
  assertThrows(() => validateEntityDefinition(definition));
});

Deno.test("numeric defaults outside supported bounds fail as invalid input before decimal conversion", () => {
  for (const value of [1e-101, 1e21]) {
    const definition = initialEntityDefinition("이름");
    definition.schema.properties.prop_2 = { type: "number", "x-order": 20, multipleOf: 0.1, default: value };
    const error = assertThrows(() => validateEntityDefinition(definition));
    assertEquals((error as { code: string }).code, "invalid_input");
  }
});
