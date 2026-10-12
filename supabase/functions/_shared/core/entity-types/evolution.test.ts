import { assertEquals, assertThrows } from "@std/assert";
import { initialEntityDefinition } from "../../contracts/entity-type.ts";
import { resolveSchemaEdits } from "./evolution.ts";
Deno.test("schema edit policy preserves key meaning and labels but classifies narrowing independently of data", () => {
  const source = initialEntityDefinition("이름");
  const change = resolveSchemaEdits(source, [{
    op: "update_property",
    key: "prop_1",
    field: { ...source.schema.properties.prop_1, title: "상품명" },
    required: true,
  }], {});
  assertEquals(change.kind, "compatible");
  assertEquals(change.target.schema.properties.prop_1.title, "상품명");
  const narrowed = resolveSchemaEdits(source, [{
    op: "update_property",
    key: "prop_1",
    field: { ...source.schema.properties.prop_1, maxLength: 20 },
    required: true,
  }], {});
  assertEquals(narrowed.kind, "migration_required");
  assertEquals(narrowed.diff.find((d) => d.path === "properties.prop_1.maxLength")?.kind, "migration_required");
  assertThrows(() =>
    resolveSchemaEdits(
      source,
      [{ op: "update_property", key: "prop_99", field: { type: "string" }, required: false }],
      {},
    )
  );
});
Deno.test("archive retains definitions and requires explicit requiredness edit while representative stays active", () => {
  const source = initialEntityDefinition("이름");
  source.schema.properties.prop_2 = { type: "string", title: "설명" };
  source.schema.required.push("prop_2");
  source.display.order.push("prop_2");
  source.display.list_columns.push("prop_2");
  assertThrows(() => resolveSchemaEdits(source, [{ op: "archive_property", key: "prop_2" }], {}));
  const result = resolveSchemaEdits(source, [{ op: "archive_property", key: "prop_2" }, {
    op: "update_property",
    key: "prop_2",
    field: source.schema.properties.prop_2,
    required: false,
  }], {});
  assertEquals(result.kind, "compatible");
  assertEquals(result.target.schema.properties.prop_2.title, "설명");
  assertEquals(result.target.display.archived, ["prop_2"]);
  assertEquals(result.target.display.list_columns, ["prop_1"]);
  assertThrows(() => resolveSchemaEdits(source, [{ op: "archive_property", key: "prop_1" }], {}));
});
Deno.test("integer widening accounts for effective product number limits", () => {
  const source = initialEntityDefinition("이름");
  source.schema.properties.prop_2 = { type: "integer" };
  source.display.order.push("prop_2");
  assertEquals(
    resolveSchemaEdits(
      source,
      [{ op: "update_property", key: "prop_2", field: { type: "number" }, required: false }],
      {},
    ).kind,
    "migration_required",
  );
  source.schema.properties.prop_2 = { type: "integer", minimum: -1e9, maximum: 1e9 };
  assertEquals(
    resolveSchemaEdits(
      source,
      [{ op: "update_property", key: "prop_2", field: { type: "number" }, required: false }],
      {},
    ).kind,
    "compatible",
  );
  assertEquals(
    resolveSchemaEdits(source, [{
      op: "update_property",
      key: "prop_1",
      field: { ...source.schema.properties.prop_1, maxLength: 4096 },
      required: true,
    }], {}).kind,
    "compatible",
  );
});
