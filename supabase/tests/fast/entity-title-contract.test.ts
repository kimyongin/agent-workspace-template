import { assertEquals, assertThrows } from "@std/assert";
import { initialEntityDefinition } from "../../functions/_shared/contracts/entity-type.ts";
import { validateEntityDefinition } from "../../functions/_shared/core/entity-types/schema-rules.ts";

Deno.test("current title definitions require a template and reject retired property display flags", () => {
  const definition = initialEntityDefinition("이름");
  const without = structuredClone(definition) as { schema: Record<string, unknown> };
  delete without.schema["x-title-template"];
  assertThrows(() => validateEntityDefinition(without));
  for (const flag of ["x-representative", "x-show-in-list", "x-list-order"]) {
    const old = structuredClone(definition);
    Object.assign(old.schema.properties.prop_1, { [flag]: flag === "x-list-order" ? 10 : true });
    assertThrows(() => validateEntityDefinition(old));
  }
  const numeric = {
    ...definition.schema,
    required: [],
    "x-title-template": "$prop_2$",
    properties: {
      prop_2: { type: "integer" as const, "x-order": 20 },
    },
  };
  assertEquals(validateEntityDefinition({ schema: numeric }).schema["x-title-template"], "$prop_2$");
});
