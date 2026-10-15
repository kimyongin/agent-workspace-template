import { assertEquals, assertRejects } from "@std/assert";
import { initialEntityDefinition } from "../../contracts/entity-type.ts";
import type { EntityTypeDeps, EntityTypeStore } from "./application.ts";
import { applyEntitySchemaChange } from "./schema-changes.ts";
import { startEntitySchemaMigration } from "./schema-migrations.ts";
import type { SchemaApplicationContext } from "./schema-application.ts";
import { effectiveEntityTemplateFingerprint } from "./template-references.ts";
const typeId = "00000000-0000-4000-8000-000000000001",
  changeId = "00000000-0000-4000-8000-000000000002",
  analysisId = "00000000-0000-4000-8000-000000000003";
async function fixture(kind: "compatible" | "migration_required") {
  const fingerprint = await effectiveEntityTemplateFingerprint({}, typeId);
  const context: SchemaApplicationContext = {
    type: {
      id: typeId,
      label: "자료",
      icon_id: "box",
      version: 1,
      schema_version: 1,
      archived: false,
      schema_write_locked: false,
    },
    change: {
      id: changeId,
      version: 1,
      status: "ready",
      kind,
      source_type_version: 1,
      source_schema_version: 1,
      analysis_id: analysisId,
      fingerprint: "a".repeat(64),
      source_template_fingerprint: fingerprint,
      target: initialEntityDefinition("이름"),
      diff: [],
      migration: { rules: [], overrides: [] },
      recovery_source_job_id: null,
      recovery_keys: null,
    },
    analysis: {
      id: analysisId,
      status: "succeeded",
      failed: 0,
      change_version: 1,
      fingerprint: "a".repeat(64),
      membership: "snapshot",
      total: 1,
    },
    membership: "snapshot",
  };
  const saved: Array<{ path: string; version?: number }> = [];
  const store = {
    executeRequest: <T>(_r: unknown, run: () => Promise<T>) => run(),
    loadSchemaApplication: () => Promise.resolve(context),
    lockSchemaApplicationBindings: () => Promise.resolve({ templates: {}, recovery: null }),
    saveSchemaPublication: (_c: SchemaApplicationContext, version: number) => {
      saved.push({ path: "publish", version });
      return Promise.resolve({ id: changeId, status: "applied" });
    },
    saveSchemaMigration: () => {
      saved.push({ path: "migration" });
      return Promise.resolve({ job_id: changeId, status: "queued" });
    },
  } as unknown as EntityTypeStore;
  const deps: EntityTypeDeps = { uow: { run: (_a, fn) => fn(store) } },
    actor = { userId: "owner", source: "http" as const, request: { key: crypto.randomUUID() } };
  return {
    context,
    saved,
    run: () =>
      kind === "compatible"
        ? applyEntitySchemaChange(deps, actor, typeId, changeId, {
          expected_change_version: 1,
          analysis_id: analysisId,
        })
        : startEntitySchemaMigration(deps, actor, typeId, changeId, {
          expected_change_version: 1,
          expected_type_version: 1,
          expected_schema_version: 1,
          analysis_id: analysisId,
          fingerprint: "a".repeat(64),
        }),
  };
}
Deno.test("publication and migration start accept the same exact successful analysis through their public usecases", async () => {
  const publication = await fixture("compatible");
  await publication.run();
  assertEquals(publication.saved, [{ path: "publish", version: 2 }]);
  const migration = await fixture("migration_required");
  await migration.run();
  assertEquals(migration.saved, [{ path: "migration" }]);
});
Deno.test("publication and migration start refuse stale or failed analyses without persisting either path", async () => {
  for (const kind of ["compatible", "migration_required"] as const) {
    for (
      const alter of [
        (c: SchemaApplicationContext) => {
          c.change.status = "draft";
        },
        (c: SchemaApplicationContext) => {
          c.change.analysis_id = changeId;
        },
        (c: SchemaApplicationContext) => {
          c.analysis = null;
        },
        (c: SchemaApplicationContext) => {
          c.analysis!.status = "running";
        },
        (c: SchemaApplicationContext) => {
          c.analysis!.failed = 1;
        },
        (c: SchemaApplicationContext) => {
          c.analysis!.change_version = 2;
        },
        (c: SchemaApplicationContext) => {
          c.analysis!.fingerprint = "other definition";
        },
        (c: SchemaApplicationContext) => {
          c.membership = "changed source";
        },
      ]
    ) {
      const f = await fixture(kind);
      alter(f.context);
      const error = await assertRejects(f.run);
      assertEquals((error as { code: string }).code, "schema_plan_stale");
      assertEquals(f.saved, []);
    }
  }
});
Deno.test("schema path compatibility, source version and active gate remain core usecase decisions", async () => {
  for (
    const [kind, changedKind, code] of [["compatible", "migration_required", "schema_migration_required"], [
      "migration_required",
      "compatible",
      "invalid_input",
    ]] as const
  ) {
    const f = await fixture(kind);
    f.context.change.kind = changedKind;
    const error = await assertRejects(f.run);
    assertEquals((error as { code: string }).code, code);
    assertEquals(f.saved, []);
  }
  const stale = await fixture("compatible");
  stale.context.type.schema_version = 2;
  assertEquals((await assertRejects(stale.run) as { code: string }).code, "schema_changed");
  assertEquals(stale.saved, []);
  const active = await fixture("migration_required");
  active.context.type.schema_write_locked = true;
  assertEquals((await assertRejects(active.run) as { code: string }).code, "schema_migration_in_progress");
  assertEquals(active.saved, []);
});

Deno.test("an exact successful empty-material analysis can publish a structural change without a conversion job", async () => {
  const f = await fixture("migration_required");
  f.context.analysis!.total = 0;
  const deps: EntityTypeDeps = {
    uow: {
      run: (_a, fn) =>
        fn({
          executeRequest: <T>(_r: unknown, run: () => Promise<T>) => run(),
          loadSchemaApplication: () => Promise.resolve(f.context),
          lockSchemaApplicationBindings: () => Promise.resolve({ templates: {}, recovery: null }),
          saveSchemaPublication: (_c: SchemaApplicationContext, version: number) => Promise.resolve({ version }),
        } as unknown as EntityTypeStore),
    },
  };
  const actor = { userId: "owner", source: "http" as const, request: { key: crypto.randomUUID() } };
  const publish = () =>
    applyEntitySchemaChange(deps, actor, typeId, changeId, { expected_change_version: 1, analysis_id: analysisId });
  assertEquals((await publish()).version, 2);
  for (
    const patch of [
      { membership: "new-entity-inserted" },
      { analysis: { ...f.context.analysis!, total: 1 } },
      { change: { ...f.context.change, recovery_source_job_id: changeId } },
    ]
  ) {
    const before = structuredClone(f.context);
    Object.assign(f.context, patch);
    await assertRejects(publish);
    Object.assign(f.context, before);
  }
});
