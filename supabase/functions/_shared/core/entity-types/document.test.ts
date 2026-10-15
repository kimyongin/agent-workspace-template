import { assertEquals, assertThrows } from "@std/assert";
import { validateEntityDefinition, validateEntityProperties } from "./schema-rules.ts";
Deno.test("single document preserves metadata and nullable choice annotations", () => {
  const definition = {
    schema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      "x-type-id": "11111111-1111-4111-8111-111111111111",
      "x-version": 1,
      title: "자료",
      "x-icon": "box",
      deprecated: false,
      type: "object",
      additionalProperties: false,
      properties: {
        prop_1: { type: "string", minLength: 1, "x-order": 10, "x-representative": true, "x-show-in-list": true },
        prop_2: {
          type: ["string", "null"],
          "x-order": 20,
          oneOf: [{ const: "a", title: "첫째" }, { const: null, title: "없음" }],
        },
      },
      required: ["prop_1"],
    },
  };
  assertEquals<unknown>(validateEntityDefinition(definition), definition);
  assertEquals(validateEntityProperties(definition, { prop_1: "이름", prop_2: null }).prop_2, null);
  assertThrows(() => validateEntityDefinition({ ...definition, display: {} }));
});

import { initialEntityDefinition } from "../../contracts/entity-type.ts";
import { schemaDefinitionDiff } from "./evolution.ts";
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
  definition.schema.properties.prop_2 = {
    type: "number",
    "x-order": 20,
    readOnly: true,
    default: 0.3,
    multipleOf: 0.1,
  };
  definition.schema.required.push("prop_2");
  const saved = {
    ...definition,
    type_id: definition.schema["x-type-id"],
    schema_version: 1,
    type_version: 1,
    type: { id: definition.schema["x-type-id"], label: "이름", icon_id: "box", archived: false },
  } as EntityDefinition;
  assertEquals(checkedProperties(saved, { prop_1: "이름" }, { prop_1: "이름" }, true), { prop_1: "이름", prop_2: 0.3 });
  assertThrows(() => checkedProperties(saved, { prop_1: "이름", prop_2: 0.3 }, { prop_2: 0.3 }, true));
  assertEquals(
    checkedProperties(saved, { prop_1: "이름", prop_2: 0.3 }, { prop_2: 0.3 }, false, { prop_2: 0.3 }).prop_2,
    0.3,
  );
  assertThrows(() =>
    checkedProperties(saved, { prop_1: "이름", prop_2: 0.4 }, { prop_2: 0.4 }, false, { prop_2: 0.3 })
  );
  delete definition.schema.properties.prop_2.default;
  assertThrows(() => validateEntityDefinition(definition));
});
