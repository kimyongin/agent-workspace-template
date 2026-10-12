import { assertEquals } from "@std/assert";
import { entityCreate, entityUpdate } from "./entity.ts";
Deno.test("Typed entity input preserves scalar values and rejects old and mutable type fields", () => {
  const entity_type_id = crypto.randomUUID();
  const properties = { prop_1: "  예제  ", prop_2: 0, prop_3: false, prop_4: null };
  assertEquals(entityCreate.parse({ entity_type_id, schema_version: 1, properties }).properties, properties);
  assertEquals(entityCreate.safeParse({ entity_type_id, schema_version: 1, properties, prop1: "old" }).success, false);
  assertEquals(
    entityUpdate.safeParse({ entity_type_id, schema_version: 1, expected_version: 1, properties }).success,
    false,
  );
  assertEquals(
    entityUpdate.parse({ schema_version: 1, expected_version: 1, properties: { prop_4: null } }).properties,
    { prop_4: null },
  );
});
