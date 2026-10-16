import { entitySchemaPresentation } from "../../contracts/entity-type.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { initialEntityDefinition } from "../../contracts/entity-type.ts";
import type { EntitySchemaChange, SchemaEdit } from "../../contracts/entity-schema-change.ts";
import type { EntityTypeStore } from "./application.ts";
import {
  createEntitySchemaChange,
  type PreparedSchemaChange,
  type SchemaChangeDraftContext,
  type SchemaChangeStore,
  updateEntitySchemaChange,
} from "./schema-changes.ts";
import { effectiveEntityTemplateFingerprint } from "./template-references.ts";
import { notFound } from "../shared/errors.ts";

const typeId = "11111111-1111-4111-8111-111111111111";
const changeId = "22222222-2222-4222-8222-222222222222";
const actor = { userId: "owner", source: "http" as const, request: { key: "33333333-3333-4333-8333-333333333333" } };
const addition: SchemaEdit = {
  op: "add_property",
  client_ref: "amount",
  field: { "x-order": 20, type: "string", title: "수량" },
  required: false,
};

/** A transactional storage adapter, not a mock of the domain decision helpers. */
async function fixture() {
  const context: SchemaChangeDraftContext = {
    type: { id: typeId, version: 1, schema_version: 1, archived: false, schema_write_locked: false },
    definition: initialEntityDefinition("이름"),
    previous: null,
  };
  let saved: EntitySchemaChange | null = null;
  let next = 2;
  const templateFingerprint = await effectiveEntityTemplateFingerprint({}, typeId);
  const store: Pick<
    SchemaChangeStore,
    | "loadSchemaChangeDraft"
    | "lockExistingSchemaChange"
    | "reserveSchemaChangeProperties"
    | "lockSchemaChangeBindings"
    | "saveSchemaChangeDraft"
    | "getChange"
  > = {
    loadSchemaChangeDraft: () => Promise.resolve(structuredClone({ ...context, previous: null })),
    lockExistingSchemaChange: () => {
      if (!saved) throw notFound();
      return Promise.resolve({ ...saved, recovery_source_job_id: saved.recovery?.source_job_id ?? null });
    },
    reserveSchemaChangeProperties: (_id, edits, prior) => {
      const reservations = { ...prior };
      for (const edit of edits) {
        if (edit.op === "add_property" && !Object.hasOwn(reservations, edit.client_ref)) {
          reservations[edit.client_ref] = `prop_${next++}`;
        }
      }
      return Promise.resolve(reservations);
    },
    lockSchemaChangeBindings: () => Promise.resolve({}),
    saveSchemaChangeDraft: (_context, p: PreparedSchemaChange) => {
      saved = {
        id: changeId,
        type_id: typeId,
        version: (saved?.version ?? 0) + 1,
        status: "draft",
        source_schema_version: 1,
        source_template_fingerprint: templateFingerprint,
        edits: p.edits,
        migration: p.migration,
        reservations: p.reservations,
        target: p.target,
        diff: p.diff,
        change_kind: p.kind,
        fingerprint: p.fingerprint,
        analysis: null,
        executable: false,
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      };
      return Promise.resolve(saved);
    },
    getChange: () => {
      if (!saved) throw notFound();
      return Promise.resolve(saved);
    },
  };
  const deps = {
    uow: {
      run: async <T>(_actor: unknown, fn: (s: EntityTypeStore) => Promise<T>) => {
        const snapshot = structuredClone(saved), previousNext = next;
        try {
          return await fn({
            ...store,
            executeRequest: (_r: unknown, execute: () => Promise<unknown>) => execute(),
          } as unknown as EntityTypeStore);
        } catch (e) {
          saved = snapshot;
          next = previousNext;
          throw e;
        }
      },
    },
  };
  const input = { expected_schema_version: 1, edits: [addition] };
  return {
    deps,
    context,
    input,
    setSaved: (value: EntitySchemaChange) => {
      saved = value;
    },
  };
}

Deno.test("public schema change create/update preserve reserved additions and unchanged versions", async () => {
  const f = await fixture();
  const created = await createEntitySchemaChange(f.deps, actor, typeId, f.input);
  assertEquals(created.reservations, { amount: "prop_2" });
  assertEquals(created.target.schema.properties.prop_2, { type: "string", title: "수량", "x-order": 20 });
  assertEquals(created.change_kind, "compatible");
  const unchanged = await updateEntitySchemaChange(f.deps, actor, typeId, changeId, {
    ...f.input,
    expected_change_version: 1,
  });
  assertEquals(unchanged, created);
  const updated = await updateEntitySchemaChange(f.deps, actor, typeId, changeId, {
    ...f.input,
    expected_change_version: 1,
    edits: [{ ...addition, field: { "x-order": 20, type: "string", title: "갯수" } }],
  });
  assertEquals(updated.version, 2);
  assertEquals(updated.reservations, { amount: "prop_2" });
  assertEquals(updated.target.schema.properties.prop_2.title, "갯수");
});

Deno.test("public schema change create/update classify explicit value conversions consistently", async () => {
  const f = await fixture();
  const input = { ...f.input, migration: { rules: [{ op: "fill", key: "prop_2", value: "0" }], overrides: [] } };
  const created = await createEntitySchemaChange(f.deps, actor, typeId, input);
  assertEquals(created.change_kind, "migration_required");
  const updated = await updateEntitySchemaChange(f.deps, actor, typeId, changeId, {
    ...input,
    expected_change_version: 1,
    migration: { rules: [{ op: "fill", key: "prop_2", value: "1" }] },
  });
  assertEquals(updated.change_kind, "migration_required");
  assertEquals(updated.version, 2);
});

Deno.test("public schema change rejects unmatched removal rules without keeping failed key reservations", async () => {
  const f = await fixture();
  const error = await assertRejects(() =>
    createEntitySchemaChange(f.deps, actor, typeId, {
      ...f.input,
      migration: { rules: [{ op: "remove", key: "prop_1" }] },
    })
  );
  assertEquals((error as { code: string }).code, "invalid_input");
  const created = await createEntitySchemaChange(f.deps, actor, typeId, f.input);
  assertEquals(created.reservations, { amount: "prop_2" });
  const updatedError = await assertRejects(() =>
    updateEntitySchemaChange(f.deps, actor, typeId, changeId, {
      ...f.input,
      expected_change_version: 1,
      migration: { rules: [{ op: "remove", key: "prop_1" }] },
    })
  );
  assertEquals((updatedError as { code: string }).code, "invalid_input");
});

Deno.test("public schema change checks source before missing draft and preserves immutable recovery/version restrictions", async () => {
  const f = await fixture();
  f.context.type.schema_version = 2;
  const stale = await assertRejects(() =>
    updateEntitySchemaChange(f.deps, actor, typeId, changeId, { ...f.input, expected_change_version: 1 })
  );
  assertEquals((stale as { code: string }).code, "schema_changed");
  f.context.type.schema_version = 1;
  const created = await createEntitySchemaChange(f.deps, actor, typeId, f.input);
  for (
    const patch of [{ version: 2 }, { status: "applied" as const }, {
      recovery: { source_job_id: changeId, source_expires_at: "2026-02-01T00:00:00Z" },
    }]
  ) {
    f.setSaved({ ...created, ...patch });
    const error = await assertRejects(() =>
      updateEntitySchemaChange(f.deps, actor, typeId, changeId, { ...f.input, expected_change_version: 1 })
    );
    assertEquals((error as { code: string }).code, "conflict");
  }
});

Deno.test("public change reserves new fields while presentation travels with each field", async () => {
  const f = await fixture();
  const input = {
    ...f.input,
    edits: [
      {
        ...addition,
        field: {
          type: "string",
          "x-order": 20,
          "x-show-in-list": true,
          "x-list-order": 10,
          title: "상태",
          oneOf: [{ const: "available", title: "판매 중" }],
        },
      },
      {
        ...addition,
        client_ref: "sku",
        field: {
          type: "string",
          "x-order": 5,
          "x-representative": true,
          "x-show-in-list": true,
          "x-list-order": 20,
          title: "상품명",
          minLength: 1,
        },
        required: true,
      },
      {
        op: "update_property",
        key: "prop_1",
        field: {
          ...initialEntityDefinition("이름").schema.properties.prop_1,
          "x-representative": false,
          "x-show-in-list": false,
        },
        required: true,
      },
    ],
    migration: { rules: [{ op: "fill", key: "new_sku", value: "기본 상품명" }] },
  };
  const created = await createEntitySchemaChange(f.deps, actor, typeId, input);
  assertEquals(entitySchemaPresentation(created.target.schema), {
    representative: "prop_3",
    order: ["prop_3", "prop_1", "prop_2"],
    list_columns: ["prop_2", "prop_3"],
    archived: [],
    option_labels: { prop_2: { available: "판매 중" } },
  });
  assertEquals(created.migration.rules, [{ op: "fill", key: "prop_3", value: "기본 상품명", include_null: false }]);
  const updated = await updateEntitySchemaChange(f.deps, actor, typeId, changeId, {
    ...input,
    expected_change_version: created.version,
  });
  assertEquals(updated, created);
  const error = await assertRejects(() =>
    createEntitySchemaChange(f.deps, actor, typeId, {
      ...input,
      migration: { rules: [{ op: "fill", key: "new_missing", value: "bad" }] },
    })
  );
  assertEquals((error as { code: string }).code, "invalid_input");
});

Deno.test("archived type publishes metadata or an explicit unarchive with property edits", async () => {
  const f = await fixture();
  f.context.type.archived = true;
  f.context.definition.schema.deprecated = true;
  const metadata = await createEntitySchemaChange(f.deps, actor, typeId, {
    ...f.input,
    edits: [{ op: "set_metadata", title: "보관 이름" }],
  });
  assertEquals(metadata.target.schema.deprecated, true);
  const error = await assertRejects(() => createEntitySchemaChange(f.deps, actor, typeId, f.input));
  assertEquals((error as { code: string }).code, "entity_type_archived");
  const restored = await createEntitySchemaChange(f.deps, actor, typeId, {
    ...f.input,
    edits: [...f.input.edits, { op: "set_metadata", deprecated: false }],
  });
  assertEquals(restored.target.schema.deprecated, false);
  assertEquals(restored.target.schema.properties[restored.reservations.amount]["x-order"], 20);
  assertEquals(f.context.type.archived, true);
});
Deno.test("semantically unchanged schema change never saves a new draft", async () => {
  const f = await fixture();
  const error = await assertRejects(() =>
    createEntitySchemaChange(f.deps, actor, typeId, {
      ...f.input,
      edits: [{ op: "set_metadata", title: f.context.definition.schema.title, deprecated: false }],
    })
  );
  assertEquals((error as { code: string }).code, "invalid_input");
});
