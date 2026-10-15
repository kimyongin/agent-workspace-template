import { assertEquals, assertRejects } from "@std/assert";
import type { EntityTypeDeps } from "./application.ts";
import { previewEntitySchemaImport } from "./schema-import.ts";
Deno.test("raw schema preview rejects duplicate JSON keys before any storage access", async () => {
  const deps: EntityTypeDeps = {
    uow: {
      run: () => {
        throw new Error("malformed input must never read storage");
      },
    },
  };
  const error = await assertRejects(() =>
    previewEntitySchemaImport(deps, { userId: "owner" }, { mode: "copy", document: '{"title":"one","title":"two"}' })
  );
  assertEquals((error as { code: string }).code, "invalid_input");
  assertEquals((error as { fields: Array<{ path: string }> }).fields[0].path, "document.title");
});

import { type EntityType, initialEntityDefinition } from "../../contracts/entity-type.ts";
import type { EntityTypeStore } from "./application.ts";
const typeId = "11111111-1111-4111-8111-111111111111";
function fixture() {
  const definition = initialEntityDefinition("이름", { id: typeId, title: "현재 종류" });
  definition.schema["x-version"] = 3;
  const type: EntityType = {
    id: typeId,
    label: "현재 종류",
    icon_id: "box",
    archived: false,
    schema_version: 3,
    next_property_number: 3,
    created_at: "2026-10-16T00:00:00Z",
    updated_at: "2026-10-16T00:00:00Z",
  };
  let writes = 0;
  const store = {
    get: () => Promise.resolve(type),
    loadSchemaChangeDraft: () =>
      Promise.resolve({ type: { ...type, version: 3, schema_write_locked: false }, definition, previous: null }),
    reserveSchemaChangeProperties: () => {
      writes++;
      throw new Error("preview must never reserve");
    },
  } as unknown as EntityTypeStore;
  const deps: EntityTypeDeps = { uow: { run: (_a, fn) => fn(store) } };
  return { deps, definition, type, writes: () => writes };
}
Deno.test("existing import preview reports stale source provenance and semantic no-op without reservations", async () => {
  const f = fixture(), source = structuredClone(f.definition.schema);
  source["x-version"] = 1;
  const review = await previewEntitySchemaImport(f.deps, { userId: "owner" }, {
    mode: "update",
    type_id: typeId,
    expected_schema_version: 3,
    document: JSON.stringify(source, null, 2),
  });
  assertEquals(review.changed, false);
  assertEquals(review.source_schema_version, 1);
  assertEquals(review.current_schema_version, 3);
  assertEquals(review.source_is_stale, true);
  assertEquals(review.key_mapping, { prop_1: "prop_1" });
  assertEquals(f.writes(), 0);
});

import { prepareEntitySchemaImport } from "./schema-import.ts";
Deno.test("explicit copy reviews key gaps and atomically issues a new type and mapped required property", async () => {
  const source = initialEntityDefinition("코드", { id: typeId, title: "복사 종류" }).schema;
  source.properties = { prop_9: source.properties.prop_1 };
  source.required = ["prop_9"];
  let stored: unknown, writes = 0;
  const store = {
    executeRequest: <T>(_r: unknown, run: () => Promise<T>) => run(),
    createImportedType: (schema: typeof source) => {
      writes++;
      stored = schema;
      return Promise.resolve({
        id: "22222222-2222-4222-8222-222222222222",
        label: "복사 종류",
        icon_id: "box",
        archived: false,
        schema_version: 1,
        next_property_number: 2,
      });
    },
  } as unknown as EntityTypeStore;
  const deps: EntityTypeDeps = { uow: { run: (_a, fn) => fn(store) } },
    actor = { userId: "owner", request: { key: crypto.randomUUID() } };
  const input = { mode: "copy", document: JSON.stringify(source) };
  const review = await previewEntitySchemaImport(deps, actor, input);
  assertEquals(writes, 0);
  assertEquals(review.key_mapping, { prop_9: "prop_1" });
  const result = await prepareEntitySchemaImport(deps, actor, {
    ...input,
    preview_fingerprint: review.preview_fingerprint,
  });
  assertEquals(writes, 1);
  assertEquals((stored as typeof source).required, ["prop_1"]);
  assertEquals(result.type?.id, "22222222-2222-4222-8222-222222222222");
  assertEquals(result.schema?.["x-type-id"], result.type?.id);
  assertEquals(result.schema?.["x-version"], 1);
});

import type { PreparedSchemaChange, SchemaChangeDraftContext } from "./schema-changes.ts";
Deno.test("import reserves reviewed new keys only when preparing a normal schema change", async () => {
  const f = fixture(), source = structuredClone(f.definition.schema);
  source.properties.prop_27 = { type: "integer", "x-order": 20 };
  source.required.push("prop_27");
  let writes = 0, saved: PreparedSchemaChange | undefined;
  const context: SchemaChangeDraftContext = {
    type: { ...f.type, version: 3, schema_write_locked: false },
    definition: f.definition,
    previous: null,
  };
  const store = {
    get: () => Promise.resolve(f.type),
    loadSchemaChangeDraft: () => Promise.resolve(context),
    executeRequest: <T>(_r: unknown, run: () => Promise<T>) => run(),
    reserveSchemaChangeProperties: () => {
      writes++;
      return Promise.resolve({ import_prop_27: `prop_${f.type.next_property_number++}` });
    },
    lockSchemaChangeBindings: () => Promise.resolve({}),
    saveSchemaChangeDraft: (_c: unknown, p: PreparedSchemaChange) => {
      saved = p;
      return Promise.resolve({
        ...p,
        id: typeId,
        type_id: typeId,
        version: 1,
        status: "draft",
        source_schema_version: 3,
        change_kind: p.kind,
        analysis: null,
        executable: false,
        created_at: "now",
        updated_at: "now",
      });
    },
  } as unknown as EntityTypeStore;
  const deps: EntityTypeDeps = { uow: { run: (_a, fn) => fn(store) } },
    actor = { userId: "owner", request: { key: crypto.randomUUID() } };
  const input = { mode: "update", type_id: typeId, expected_schema_version: 3, document: JSON.stringify(source) };
  const review = await previewEntitySchemaImport(deps, actor, input);
  assertEquals(writes, 0);
  assertEquals(review.key_mapping.prop_27, "prop_3");
  const result = await prepareEntitySchemaImport(deps, actor, {
    ...input,
    preview_fingerprint: review.preview_fingerprint,
  });
  assertEquals(writes, 1);
  assertEquals(saved?.target.schema.required, ["prop_1", "prop_3"]);
  assertEquals(saved?.kind, "migration_required");
  assertEquals(result.source_schema_version, 3);
});
Deno.test("a new reservation after preview invalidates preparation before any write", async () => {
  const f = fixture(), source = structuredClone(f.definition.schema);
  source.properties.prop_27 = { type: "integer", "x-order": 20 };
  const input = { mode: "update", type_id: typeId, expected_schema_version: 3, document: JSON.stringify(source) };
  const actor = { userId: "owner", request: { key: crypto.randomUUID() } };
  const review = await previewEntitySchemaImport(f.deps, actor, input);
  f.type.next_property_number++;
  const store = f.deps.uow;
  const deps: EntityTypeDeps = {
    uow: {
      run: (a, fn) =>
        store.run(a, (s) =>
          fn({
            ...s,
            executeRequest: <T>(_r: unknown, run: () => Promise<T>) => run(),
          } as EntityTypeStore)),
    },
  };
  const error = await assertRejects(() =>
    prepareEntitySchemaImport(deps, actor, { ...input, preview_fingerprint: review.preview_fingerprint })
  );
  assertEquals((error as { code: string }).code, "schema_plan_stale");
  assertEquals(f.writes(), 0);
});
Deno.test("tombstoned input keys require reviewed explicit remapping and never revive their identity", async () => {
  const f = fixture(), source = structuredClone(f.definition.schema);
  source.properties.prop_2 = { type: "string", "x-order": 20 };
  const input = { mode: "update", type_id: typeId, expected_schema_version: 3, document: JSON.stringify(source) };
  const error = await assertRejects(() => previewEntitySchemaImport(f.deps, { userId: "owner" }, input));
  assertEquals((error as { code: string }).code, "invalid_input");
  const review = await previewEntitySchemaImport(f.deps, { userId: "owner" }, { ...input, new_keys: ["prop_2"] });
  assertEquals(review.key_mapping.prop_2, "prop_3");
});

import { entitySchemaLimits } from "../../contracts/entity-type.ts";
import { jsonbText, validateEntityDefinition } from "./schema-rules.ts";
import { REQUEST_RESULT_MAX_BYTES } from "../../contracts/request.ts";
Deno.test("maximum export wholesale import prepares a complete draft while the receipt stays within 1 MiB", async () => {
  const f = fixture();
  for (let n = 2; n <= 64; n++) {
    f.definition.schema.properties[`prop_${n}`] = {
      type: "string",
      "x-order": n * 10,
      oneOf: Array.from(
        { length: 4 },
        (_, i) => ({ const: String(i).padStart(3, "0") + "a".repeat(900), title: "옵션" }),
      ),
    };
  }
  const size = () => new TextEncoder().encode(jsonbText(f.definition.schema)).length;
  for (const option of Object.values(f.definition.schema.properties).flatMap((field) => field.oneOf ?? [])) {
    option.const += "a".repeat(Math.min(4096 - option.const!.length, entitySchemaLimits.definition_bytes - size()));
    if (size() === entitySchemaLimits.definition_bytes) break;
  }
  assertEquals(size(), 262144);
  validateEntityDefinition(f.definition);
  f.type.next_property_number = 65;
  const imported = structuredClone(f.definition.schema);
  for (const field of Object.values(imported.properties)) {
    for (const option of field.oneOf ?? []) option.const = option.const!.replaceAll("a", "b");
  }
  let draftBytes = 0, receiptBytes = 0;
  const store = {
    get: () => Promise.resolve(f.type),
    loadSchemaChangeDraft: () =>
      Promise.resolve({
        type: { ...f.type, version: 3, schema_write_locked: false },
        definition: f.definition,
        previous: null,
      }),
    reserveSchemaChangeProperties: () => Promise.resolve({}),
    lockSchemaChangeBindings: () => Promise.resolve({}),
    executeRequest: async <T>(_r: unknown, run: () => Promise<T>) => {
      const value = await run();
      receiptBytes = new TextEncoder().encode(JSON.stringify(value)).length;
      assertEquals(receiptBytes <= REQUEST_RESULT_MAX_BYTES, true);
      return value;
    },
    saveSchemaChangeDraft: (_context: unknown, p: PreparedSchemaChange) => {
      const change = {
        ...p,
        id: typeId,
        type_id: typeId,
        source_schema_version: 3,
        version: 1,
        status: "draft",
        change_kind: p.kind,
        recovery: null,
        analysis: null,
        executable: false,
        created_at: "2026-10-16T00:00:00Z",
        updated_at: "2026-10-16T00:00:00Z",
      };
      draftBytes = new TextEncoder().encode(JSON.stringify(change)).length;
      return Promise.resolve(change);
    },
  } as unknown as EntityTypeStore;
  const deps: EntityTypeDeps = { uow: { run: (_a, fn) => fn(store) } },
    actor = { userId: "owner", request: { key: crypto.randomUUID() } };
  const input = {
    mode: "update",
    type_id: typeId,
    expected_schema_version: 3,
    document: JSON.stringify(imported, null, 2),
  };
  const review = await previewEntitySchemaImport(deps, actor, input);
  const result = await prepareEntitySchemaImport(deps, actor, {
    ...input,
    preview_fingerprint: review.preview_fingerprint,
  });
  assertEquals(result.change?.status, "draft");
  assertEquals(draftBytes > REQUEST_RESULT_MAX_BYTES, true);
  assertEquals(receiptBytes < 16384, true);
});

Deno.test("only an exact known incomplete historical document preserves current root metadata", async () => {
  const f = fixture(), historical = structuredClone(f.definition.schema);
  historical["x-version"] = 1;
  delete historical.title;
  delete historical["x-icon"];
  delete historical.deprecated;
  f.definition.schema.title = "현재 이름";
  f.definition.schema["x-icon"] = "leaf";
  f.definition.schema.description = "현재 설명";
  f.definition.schema.deprecated = true;
  const deps: EntityTypeDeps = {
    uow: {
      run: (a, fn) =>
        f.deps.uow.run(a, (store) =>
          fn({
            ...store,
            schema: () =>
              Promise.resolve({
                type_id: typeId,
                schema_version: 1,
                schema: historical,
                metadata_missing: true,
                type: f.type,
                created_at: "2026-01-01T00:00:00Z",
              }),
          } as EntityTypeStore)),
    },
  };
  const input = { mode: "update", type_id: typeId, expected_schema_version: 3, document: JSON.stringify(historical) };
  const review = await previewEntitySchemaImport(deps, { userId: "owner" }, input);
  assertEquals(review.metadata_preserved, true);
  assertEquals(review.schema.title, "현재 이름");
  assertEquals(review.schema["x-icon"], "leaf");
  assertEquals(review.schema.description, "현재 설명");
  assertEquals(review.schema.deprecated, true);
  assertEquals(review.changed, false);
  const unknown = structuredClone(historical);
  unknown.properties.prop_1.title = "확인되지 않은 수정";
  const error = await assertRejects(() =>
    previewEntitySchemaImport(deps, { userId: "owner" }, { ...input, document: JSON.stringify(unknown) })
  );
  assertEquals((error as { code: string }).code, "invalid_input");
  const copyError = await assertRejects(() =>
    previewEntitySchemaImport(deps, { userId: "owner" }, { mode: "copy", document: input.document })
  );
  assertEquals((copyError as { code: string }).code, "invalid_input");
});
Deno.test("metadata description removal stays compatible and becomes an explicit null edit", async () => {
  const f = fixture();
  f.definition.schema.description = "기존 설명";
  const source = structuredClone(f.definition.schema);
  delete source.description;
  let saved: PreparedSchemaChange | undefined;
  const deps: EntityTypeDeps = {
    uow: {
      run: (a, fn) =>
        f.deps.uow.run(a, (store) =>
          fn({
            ...store,
            executeRequest: <T>(_r: unknown, run: () => Promise<T>) => run(),
            reserveSchemaChangeProperties: () => Promise.resolve({}),
            lockSchemaChangeBindings: () => Promise.resolve({}),
            saveSchemaChangeDraft: (_c: unknown, p: PreparedSchemaChange) => {
              saved = p;
              return Promise.resolve({
                ...p,
                id: typeId,
                type_id: typeId,
                version: 1,
                status: "draft",
                source_schema_version: 3,
                change_kind: p.kind,
                analysis: null,
                executable: false,
                created_at: "now",
                updated_at: "now",
              });
            },
          } as EntityTypeStore)),
    },
  };
  const actor = { userId: "owner", request: { key: crypto.randomUUID() } },
    input = { mode: "update", type_id: typeId, expected_schema_version: 3, document: JSON.stringify(source) };
  const review = await previewEntitySchemaImport(deps, actor, input);
  assertEquals(review.diff.map((d) => [d.path, d.kind]), [["description", "compatible"]]);
  await prepareEntitySchemaImport(deps, actor, { ...input, preview_fingerprint: review.preview_fingerprint });
  assertEquals(saved?.target.schema.description, undefined);
  assertEquals(saved?.edits[0], {
    op: "set_metadata",
    title: f.definition.schema.title,
    description: null,
    "x-icon": "box",
    deprecated: false,
  });
});
