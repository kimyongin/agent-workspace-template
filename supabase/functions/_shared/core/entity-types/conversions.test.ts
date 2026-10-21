import { migrationPlan, schemaAnalysisRows } from "../../contracts/entity-schema-change.ts";
import { assertEquals } from "@std/assert";
import { initialEntityDefinition } from "../../contracts/entity-type.ts";
import { compileMigration } from "./conversions.ts";
Deno.test("migration rejects identifier loss and coercion, retains literal zero and missing", () => {
  const d = initialEntityDefinition("Name");
  d.schema.properties.prop_3 = { "x-order": 30, type: "integer" };

  const convert = compileMigration(d, { rules: [{ op: "convert", key: "prop_3", to: "integer" }], overrides: [] });
  for (const value of ["01", " 1", "1e2", "1.0", "", "１２"]) {
    assertEquals(
      convert("a", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_3: value }).errors.length >
        0,
      true,
    );
  }
  assertEquals(convert("a", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_3: "0" }).after, {
    prop_2: "00000000-0000-4000-8000-000000000001:001",
    prop_1: "A",
    prop_3: 0,
  });
  assertEquals(convert("a", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A" }).after, {
    prop_2: "00000000-0000-4000-8000-000000000001:001",
    prop_1: "A",
  });
});
Deno.test("migration preserves null/false and applies only explicit fill, removal, override and enum maps", () => {
  const d = initialEntityDefinition("Name");
  d.schema.properties.prop_3 = { "x-order": 30, type: ["boolean", "null"] };
  d.schema.required.push("prop_3");

  const fill = compileMigration(d, {
    rules: [{ op: "fill", key: "prop_3", value: false, include_null: false }, { op: "remove", key: "prop_4" }],
    overrides: [],
  });
  assertEquals(fill("a", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_4: 0 }).after, {
    prop_2: "00000000-0000-4000-8000-000000000001:001",
    prop_1: "A",
    prop_3: false,
  });
  assertEquals(fill("a", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_3: null }).after, {
    prop_2: "00000000-0000-4000-8000-000000000001:001",
    prop_1: "A",
    prop_3: null,
  });
  assertEquals(fill("a", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_4: 0 }).removed, 1);
  d.schema.properties.prop_3 = { "x-order": 30, type: "string", oneOf: ["b"].map((value) => ({ const: value })) };
  const map = compileMigration(d, {
    rules: [{ op: "map", key: "prop_3", mapping: { a: "b" }, identity: false }],
    overrides: [{ entity_id: "fixed", key: "prop_3", value: "b" }],
  });
  assertEquals(map("a", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_3: "a" }).errors, []);
  assertEquals(
    map("a", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_3: "b" }).errors.length > 0,
    true,
  );
  assertEquals(
    map("fixed", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_3: "unknown" }).errors,
    [],
  );
});
Deno.test("migration validates real calendar, decimal limits and explicit replacements without mutating sources", () => {
  const d = initialEntityDefinition("Name");
  d.schema.properties.prop_3 = { "x-order": 30, type: "string", format: "date" };

  const date = compileMigration(d, { rules: [{ op: "convert", key: "prop_3", to: "date" }], overrides: [] });
  assertEquals(
    date("a", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_3: "2024-02-29" }).errors,
    [],
  );
  for (const v of ["2023-02-29", "0000-01-01", "2024-2-29", "2024-02-29T00:00:00Z"]) {
    assertEquals(
      date("a", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_3: v }).errors.length > 0,
      true,
    );
  }
  d.schema.properties.prop_3 = { "x-order": 30, type: "number" };
  const numeric = compileMigration(d, { rules: [{ op: "convert", key: "prop_3", to: "number" }], overrides: [] });
  assertEquals(
    numeric("a", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_3: "0.123456" }).after?.prop_3,
    0.123456,
  );
  for (const v of ["0.1234567", "1000000001", "NaN", "Infinity", "0x10"]) {
    assertEquals(
      numeric("a", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_3: v }).errors.length > 0,
      true,
    );
  }
  const source = { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_3: "bad" };
  const replaced = compileMigration(d, {
    rules: [{ op: "convert", key: "prop_3", to: "number" }, { op: "replace_failure", key: "prop_3", value: 0 }],
    overrides: [],
  })("a", source);
  assertEquals(replaced.after?.prop_3, 0);
  assertEquals(replaced.errors, []);
  assertEquals(source.prop_3, "bad");
});
Deno.test("explicit missing fill composes with numeric conversion without replacing malformed present strings", () => {
  const d = initialEntityDefinition("Name");
  d.schema.properties.prop_3 = { "x-order": 30, type: "number" };
  d.schema.required.push("prop_3");

  const convert = compileMigration(d, {
    rules: [{ op: "fill", key: "prop_3", value: 0, include_null: false }, {
      op: "convert",
      key: "prop_3",
      to: "number",
    }],
    overrides: [],
  });
  assertEquals(convert("missing", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A" }).after, {
    prop_2: "00000000-0000-4000-8000-000000000001:001",
    prop_1: "A",
    prop_3: 0,
  });
  assertEquals(
    convert("valid", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_3: "1.5" }).after,
    { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_3: 1.5 },
  );
  assertEquals(
    convert("invalid", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_3: "bad" }).errors
      .length > 0,
    true,
  );
});
Deno.test("migration public plan retains prototype-like mapping codes and Unicode entity references", () => {
  const d = initialEntityDefinition("Name");
  d.schema.properties.prop_3 = { "x-order": 30, type: "string", oneOf: ["mapped"].map((value) => ({ const: value })) };

  const raw = {
    rules: [{
      op: "map",
      key: "prop_3",
      mapping: JSON.parse('{"__proto__":"mapped","constructor":"mapped","toString":"mapped"}'),
    }],
    overrides: [{
      entity_id: "00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000001:" + "😀".repeat(200),
      key: "prop_3",
      value: "mapped",
    }],
  };
  const parsed = migrationPlan.parse(raw);
  assertEquals(Object.keys((parsed.rules[0] as { mapping: Record<string, string> }).mapping), [
    "__proto__",
    "constructor",
    "toString",
  ]);
  for (const code of ["__proto__", "constructor", "toString"]) {
    assertEquals(
      compileMigration(d, parsed)("00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000001:a", {
        prop_2: "00000000-0000-4000-8000-000000000001:001",
        prop_1: "A",
        prop_3: code,
      }).after
        ?.prop_3,
      "mapped",
    );
  }
  assertEquals(
    schemaAnalysisRows.parse({
      analysis_id: "00000000-0000-4000-8000-000000000001",
      after: "00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000001:" + "😀".repeat(200),
    })
      .after,
    "00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000001:" + "😀".repeat(200),
  );
});

Deno.test("trusted recovery restores removed same-meaning keys and distinguishes null/zero/false/empty/missing", () => {
  const target = initialEntityDefinition("Name");
  Object.assign(target.schema.properties, {
    prop_3: { "x-order": 30, type: ["string", "null"] },
    prop_4: { "x-order": 40, type: "integer" },
    prop_5: { "x-order": 50, type: "boolean" },
    prop_6: { "x-order": 60, type: "string" },
    prop_7: { "x-order": 70, type: "string" },
  });

  const transform = compileMigration(target, { rules: [], overrides: [] }, [
    "prop_1",
    "prop_3",
    "prop_4",
    "prop_5",
    "prop_6",
    "prop_7",
    "prop_8",
  ]);
  const result = transform("a", { prop_2: "00000000-0000-4000-8000-000000000001:001", prop_1: "A", prop_8: "added" }, {
    prop_2: "00000000-0000-4000-8000-000000000001:001",
    prop_1: "A",
    prop_3: null,
    prop_4: 0,
    prop_5: false,
    prop_6: "",
  });
  assertEquals(result.after, {
    prop_2: "00000000-0000-4000-8000-000000000001:001",
    prop_1: "A",
    prop_3: null,
    prop_4: 0,
    prop_5: false,
    prop_6: "",
  });
  assertEquals(result.errors, []);
  assertEquals(result.changed, true);
});
