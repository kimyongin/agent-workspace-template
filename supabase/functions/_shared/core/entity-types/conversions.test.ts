import { migrationPlan, schemaAnalysisRows } from "../../contracts/entity-schema-change.ts";
import { assertEquals } from "@std/assert";
import { initialEntityDefinition } from "../../contracts/entity-type.ts";
import { compileMigration } from "./conversions.ts";
Deno.test("migration rejects identifier loss and coercion, retains literal zero and missing", () => {
  const d = initialEntityDefinition("Name");
  d.schema.properties.prop_2 = { type: "integer" };
  d.display.order.push("prop_2");
  const convert = compileMigration(d, { rules: [{ op: "convert", key: "prop_2", to: "integer" }], overrides: [] });
  for (const value of ["01", " 1", "1e2", "1.0", "", "１２"]) {
    assertEquals(convert("a", { prop_1: "A", prop_2: value }).errors.length > 0, true);
  }
  assertEquals(convert("a", { prop_1: "A", prop_2: "0" }).after, { prop_1: "A", prop_2: 0 });
  assertEquals(convert("a", { prop_1: "A" }).after, { prop_1: "A" });
});
Deno.test("migration preserves null/false and applies only explicit fill, removal, override and enum maps", () => {
  const d = initialEntityDefinition("Name");
  d.schema.properties.prop_2 = { type: ["boolean", "null"] };
  d.schema.required.push("prop_2");
  d.display.order.push("prop_2");
  const fill = compileMigration(d, {
    rules: [{ op: "fill", key: "prop_2", value: false, include_null: false }, { op: "remove", key: "prop_3" }],
    overrides: [],
  });
  assertEquals(fill("a", { prop_1: "A", prop_3: 0 }).after, { prop_1: "A", prop_2: false });
  assertEquals(fill("a", { prop_1: "A", prop_2: null }).after, { prop_1: "A", prop_2: null });
  assertEquals(fill("a", { prop_1: "A", prop_3: 0 }).removed, 1);
  d.schema.properties.prop_2 = { type: "string", enum: ["b"] };
  const map = compileMigration(d, {
    rules: [{ op: "map", key: "prop_2", mapping: { a: "b" }, identity: false }],
    overrides: [{ entity_id: "fixed", key: "prop_2", value: "b" }],
  });
  assertEquals(map("a", { prop_1: "A", prop_2: "a" }).errors, []);
  assertEquals(map("a", { prop_1: "A", prop_2: "b" }).errors.length > 0, true);
  assertEquals(map("fixed", { prop_1: "A", prop_2: "unknown" }).errors, []);
});
Deno.test("migration validates real calendar, decimal limits and explicit replacements without mutating sources", () => {
  const d = initialEntityDefinition("Name");
  d.schema.properties.prop_2 = { type: "string", format: "date" };
  d.display.order.push("prop_2");
  const date = compileMigration(d, { rules: [{ op: "convert", key: "prop_2", to: "date" }], overrides: [] });
  assertEquals(date("a", { prop_1: "A", prop_2: "2024-02-29" }).errors, []);
  for (const v of ["2023-02-29", "0000-01-01", "2024-2-29", "2024-02-29T00:00:00Z"]) {
    assertEquals(date("a", { prop_1: "A", prop_2: v }).errors.length > 0, true);
  }
  d.schema.properties.prop_2 = { type: "number" };
  const numeric = compileMigration(d, { rules: [{ op: "convert", key: "prop_2", to: "number" }], overrides: [] });
  assertEquals(numeric("a", { prop_1: "A", prop_2: "0.123456" }).after?.prop_2, 0.123456);
  for (const v of ["0.1234567", "1000000001", "NaN", "Infinity", "0x10"]) {
    assertEquals(numeric("a", { prop_1: "A", prop_2: v }).errors.length > 0, true);
  }
  const source = { prop_1: "A", prop_2: "bad" };
  const replaced = compileMigration(d, {
    rules: [{ op: "convert", key: "prop_2", to: "number" }, { op: "replace_failure", key: "prop_2", value: 0 }],
    overrides: [],
  })("a", source);
  assertEquals(replaced.after?.prop_2, 0);
  assertEquals(replaced.errors, []);
  assertEquals(source.prop_2, "bad");
});
Deno.test("explicit missing fill composes with numeric conversion without replacing malformed present strings", () => {
  const d = initialEntityDefinition("Name");
  d.schema.properties.prop_2 = { type: "number" };
  d.schema.required.push("prop_2");
  d.display.order.push("prop_2");
  const convert = compileMigration(d, {
    rules: [{ op: "fill", key: "prop_2", value: 0, include_null: false }, {
      op: "convert",
      key: "prop_2",
      to: "number",
    }],
    overrides: [],
  });
  assertEquals(convert("missing", { prop_1: "A" }).after, { prop_1: "A", prop_2: 0 });
  assertEquals(convert("valid", { prop_1: "A", prop_2: "1.5" }).after, { prop_1: "A", prop_2: 1.5 });
  assertEquals(convert("invalid", { prop_1: "A", prop_2: "bad" }).errors.length > 0, true);
});
Deno.test("migration public plan retains prototype-like mapping codes and Unicode entity references", () => {
  const d = initialEntityDefinition("Name");
  d.schema.properties.prop_2 = { type: "string", enum: ["mapped"] };
  d.display.order.push("prop_2");
  const raw = {
    rules: [{
      op: "map",
      key: "prop_2",
      mapping: JSON.parse('{"__proto__":"mapped","constructor":"mapped","toString":"mapped"}'),
    }],
    overrides: [{ entity_id: "app:" + "😀".repeat(200), key: "prop_2", value: "mapped" }],
  };
  const parsed = migrationPlan.parse(raw);
  assertEquals(Object.keys((parsed.rules[0] as { mapping: Record<string, string> }).mapping), [
    "__proto__",
    "constructor",
    "toString",
  ]);
  for (const code of ["__proto__", "constructor", "toString"]) {
    assertEquals(compileMigration(d, parsed)("app:a", { prop_1: "A", prop_2: code }).after?.prop_2, "mapped");
  }
  assertEquals(
    schemaAnalysisRows.parse({ analysis_id: "00000000-0000-4000-8000-000000000001", after: "app:" + "😀".repeat(200) })
      .after,
    "app:" + "😀".repeat(200),
  );
});

Deno.test("trusted recovery restores removed same-meaning keys and distinguishes null/zero/false/empty/missing", () => {
  const target = initialEntityDefinition("Name");
  Object.assign(target.schema.properties, {
    prop_2: { type: ["string", "null"] },
    prop_3: { type: "integer" },
    prop_4: { type: "boolean" },
    prop_5: { type: "string" },
    prop_6: { type: "string" },
  });
  target.display.order.push("prop_2", "prop_3", "prop_4", "prop_5", "prop_6");
  const transform = compileMigration(target, { rules: [], overrides: [] }, [
    "prop_1",
    "prop_2",
    "prop_3",
    "prop_4",
    "prop_5",
    "prop_6",
    "prop_7",
  ]);
  const result = transform("a", { prop_1: "A", prop_7: "added" }, {
    prop_1: "A",
    prop_2: null,
    prop_3: 0,
    prop_4: false,
    prop_5: "",
  });
  assertEquals(result.after, { prop_1: "A", prop_2: null, prop_3: 0, prop_4: false, prop_5: "" });
  assertEquals(result.errors, []);
  assertEquals(result.changed, true);
});
