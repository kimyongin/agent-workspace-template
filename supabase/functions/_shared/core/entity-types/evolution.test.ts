import { entitySchemaPresentation } from "../../contracts/entity-type.ts";
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
      [{ op: "update_property", key: "prop_99", field: { "x-order": 20, type: "string" }, required: false }],
      {},
    )
  );
});
Deno.test("archive retains definitions and requires explicit requiredness edit while representative stays active", () => {
  const source = initialEntityDefinition("이름");
  source.schema.properties.prop_2 = { "x-order": 20, type: "string", title: "설명" };
  source.schema.required.push("prop_2");
  source.schema.properties.prop_2["x-show-in-list"] = true;
  assertThrows(() => resolveSchemaEdits(source, [{ op: "archive_property", key: "prop_2" }], {}));
  const result = resolveSchemaEdits(source, [{ op: "archive_property", key: "prop_2" }, {
    op: "update_property",
    key: "prop_2",
    field: source.schema.properties.prop_2,
    required: false,
  }], {});
  assertEquals(result.kind, "compatible");
  assertEquals(result.target.schema.properties.prop_2.title, "설명");
  assertEquals(entitySchemaPresentation(result.target.schema).archived, ["prop_2"]);
  assertEquals(entitySchemaPresentation(result.target.schema).list_columns, ["prop_1"]);
  assertThrows(() => resolveSchemaEdits(source, [{ op: "archive_property", key: "prop_1" }], {}));
});
Deno.test("integer widening accounts for effective product number limits", () => {
  const source = initialEntityDefinition("이름");
  source.schema.properties.prop_2 = { "x-order": 20, type: "integer" };

  assertEquals(
    resolveSchemaEdits(
      source,
      [{ op: "update_property", key: "prop_2", field: { "x-order": 20, type: "number" }, required: false }],
      {},
    ).kind,
    "migration_required",
  );
  source.schema.properties.prop_2 = { "x-order": 20, type: "integer", minimum: -1e9, maximum: 1e9 };
  assertEquals(
    resolveSchemaEdits(
      source,
      [{ op: "update_property", key: "prop_2", field: { "x-order": 20, type: "number" }, required: false }],
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

Deno.test("decimal multipleOf expansion follows exact decimal divisibility", () => {
  const source = initialEntityDefinition("이름");
  source.schema.properties.prop_2 = { type: "number", "x-order": 20, multipleOf: 0.3 };
  const expanded = resolveSchemaEdits(source, [{
    op: "update_property",
    key: "prop_2",
    field: { type: "number", "x-order": 20, multipleOf: 0.1 },
    required: false,
  }], {});
  assertEquals(expanded.kind, "compatible");
});

Deno.test("archiving selected text clears selection and restore does not silently reselect", () => {
  const source = initialEntityDefinition("이름");
  source.schema.properties.prop_2 = { type: "string", "x-order": 20, "x-search-text": true };
  const archived = resolveSchemaEdits(source, [{ op: "archive_property", key: "prop_2" }], {});
  assertEquals(archived.target.schema.properties.prop_2["x-search-text"], false);
  const restored = resolveSchemaEdits(archived.target, [{ op: "restore_property", key: "prop_2" }], {});
  assertEquals(restored.target.schema.properties.prop_2["x-search-text"], false);
});

Deno.test("explicit false search selection is compatible and equal to an omitted annotation", () => {
  const source = initialEntityDefinition("이름");
  const change = resolveSchemaEdits(source, [{
    op: "update_property",
    key: "prop_1",
    required: true,
    field: { ...source.schema.properties.prop_1, "x-search-text": false },
  }], {});
  assertEquals(change.diff, []);
  assertEquals(change.kind, "compatible");
});

Deno.test("title template can be reviewed and published as a compatible definition change", async () => {
  const { entitySchemaEdit } = await import("../../contracts/entity-schema-change.ts");
  const source = initialEntityDefinition("고객명");
  source.schema.properties.prop_2 = { type: "string", title: "지역", "x-order": 20 };
  const edit = entitySchemaEdit.parse({ op: "set_metadata", "x-title-template": "$prop_1$ - $prop_2$" });
  const result = resolveSchemaEdits(source, [edit], {});
  assertEquals(result.kind, "compatible");
  assertEquals((result.target.schema as unknown as Record<string, unknown>)["x-title-template"], "$prop_1$ - $prop_2$");
  assertEquals(result.diff.find((item) => item.path === "x-title-template")?.after, "$prop_1$ - $prop_2$");
});

Deno.test("title template resolves same-change added properties and rejects dangling or archived references", async () => {
  const { entitySchemaEdit } = await import("../../contracts/entity-schema-change.ts");
  const source = initialEntityDefinition("고객명");
  const added = resolveSchemaEdits(source, [
    entitySchemaEdit.parse({
      op: "set_metadata",
      "x-title-template": "$prop_1$ - $new_region$",
    }),
    {
      op: "add_property",
      client_ref: "region",
      field: { type: "string", title: "지역", "x-order": 20 },
      required: false,
    },
  ], { region: "prop_2" });
  assertEquals(added.target.schema["x-title-template"], "$prop_1$ - $prop_2$");
  assertThrows(() => resolveSchemaEdits(added.target, [{ op: "archive_property", key: "prop_2" }], {}));
  assertThrows(() => resolveSchemaEdits(added.target, [{ op: "remove_property", key: "prop_2" }], {}));
  assertThrows(() =>
    resolveSchemaEdits(source, [entitySchemaEdit.parse({ op: "set_metadata", "x-title-template": "$prop_999$" })], {})
  );
  assertThrows(() =>
    resolveSchemaEdits(
      source,
      [entitySchemaEdit.parse({ op: "set_metadata", "x-title-template": "$new_missing$" })],
      {},
    )
  );
  const valid = resolveSchemaEdits(added.target, [
    entitySchemaEdit.parse({ op: "set_metadata", "x-title-template": "$prop_1$" }),
    { op: "archive_property", key: "prop_2" },
  ], {});
  assertEquals(valid.kind, "compatible");
});
