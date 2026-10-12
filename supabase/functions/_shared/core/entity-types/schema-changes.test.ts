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
  field: { type: "string", title: "수량" },
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
        source_type_version: 1,
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
  const input = { expected_type_version: 1, expected_schema_version: 1, edits: [addition] };
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
  assertEquals(created.target.schema.properties.prop_2, { type: "string", title: "수량" });
  assertEquals(created.change_kind, "compatible");
  const unchanged = await updateEntitySchemaChange(f.deps, actor, typeId, changeId, {
    ...f.input,
    expected_change_version: 1,
  });
  assertEquals(unchanged, created);
  const updated = await updateEntitySchemaChange(f.deps, actor, typeId, changeId, {
    ...f.input,
    expected_change_version: 1,
    edits: [{ ...addition, field: { type: "string", title: "갯수" } }],
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
  f.context.type.version = 2;
  const stale = await assertRejects(() =>
    updateEntitySchemaChange(f.deps, actor, typeId, changeId, { ...f.input, expected_change_version: 1 })
  );
  assertEquals((stale as { code: string }).code, "schema_changed");
  f.context.type.version = 1;
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
