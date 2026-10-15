import { expect, test } from "vitest";
import { initialEntityDefinition } from "@contracts/entity-type.ts";
import { migrationNumericValues, schemaNumericValues } from "./numeric-drafts.ts";
const definition = () => {
  const schema = initialEntityDefinition("이름");
  schema.schema.properties.prop_2 = { "x-order": 20, type: "number", title: "무게", default: 0 };
  return schema;
};
test("numeric schema bounds/defaults reject rounded drafts and keep current definition untouched", () => {
  const source = definition();
  for (const name of ["minimum", "maximum", "default"]) {
    expect(() => schemaNumericValues(source, { [`prop_2:${name}`]: "1.0000000000000001" })).toThrow();
  }
  expect(source.schema.properties.prop_2).toEqual({ "x-order": 20, type: "number", title: "무게", default: 0 });
  expect(
    schemaNumericValues(source, { "prop_2:minimum": "0.123456", "prop_2:maximum": "", "prop_2:default": "1.230000" })
      .schema.properties.prop_2,
  ).toEqual({ "x-order": 20, type: "number", title: "무게", default: 1.23, minimum: 0.123456, maximum: undefined });
});
test("numeric fill, failure replacement and row override decode only at submission", () => {
  const source = definition();
  for (const op of ["fill", "replace_failure"] as const) {
    const migration = {
      rules: [{ op, key: "prop_2", value: "1.0000000000000001", include_null: false }],
      overrides: [],
    };
    expect(() => migrationNumericValues(source, migration)).toThrow();
    expect(migration.rules[0].value).toBe("1.0000000000000001");
  }
  const migration = { rules: [], overrides: [{ entity_id: "app:row", key: "prop_2", value: "0.123456" }] };
  expect(migrationNumericValues(source, migration).overrides[0].value).toBe(0.123456);
  expect(migration.overrides[0].value).toBe("0.123456");
});
