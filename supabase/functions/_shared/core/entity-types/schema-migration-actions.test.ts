import { assertEquals, assertRejects } from "@std/assert";
import { initialEntityDefinition } from "../../contracts/entity-type.ts";
import type { EntitySchemaMigration } from "../../contracts/entity-schema-migration.ts";
import type { Actor } from "../shared/actor.ts";
import type { SchemaApplicationBindings, SchemaApplicationContext } from "./schema-application.ts";
import { effectiveEntityTemplateFingerprint } from "./template-references.ts";
import {
  cancelEntitySchemaMigration,
  retryEntitySchemaMigration,
  type SchemaMigrationActionStore,
} from "./schema-migrations.ts";

const id = "11111111-1111-4111-8111-111111111111";
const actor: Actor = { userId: "owner", request: { key: "22222222-2222-4222-8222-222222222222" } };
async function fixture() {
  let job: EntitySchemaMigration = {
    id,
    type_id: id,
    type: { id, label: "자료", icon_id: "box", archived: false },
    change_id: id,
    change_version: 2,
    analysis_id: id,
    fingerprint: "a".repeat(64),
    source_schema_version: 1,
    version: 3,
    status: "preparing",
    total: 0,
    processed: 0,
    retryable: false,
    failure_reason: null,
    result: null,
    source_expires_at: null,
    created_at: "2026-10-13T00:00:00Z",
    updated_at: "2026-10-13T00:00:00Z",
  };
  const context: SchemaApplicationContext = {
    type: { ...job.type, version: 1, schema_version: 1, schema_write_locked: false },
    change: {
      id,
      version: 2,
      status: "ready",
      kind: "migration_required",
      source_type_version: 1,
      source_schema_version: 1,
      analysis_id: id,
      fingerprint: job.fingerprint,
      source_template_fingerprint: await effectiveEntityTemplateFingerprint({}, id),
      target: initialEntityDefinition("이름"),
      diff: [],
      migration: { rules: [], overrides: [] },
      recovery_source_job_id: null,
      recovery_keys: null,
    },
    analysis: {
      id,
      status: "succeeded",
      failed: 0,
      change_version: 2,
      fingerprint: job.fingerprint,
      membership: "members",
      total: 0,
    },
    membership: "members",
  };
  const observation = { at: "2026-10-13T00:00:00Z", locked: false, references: true };
  const bindings: SchemaApplicationBindings = { templates: {}, recovery: null };
  const store: SchemaMigrationActionStore = {
    executeRequest: (_request, execute) => execute(),
    loadMigrationAction: () =>
      Promise.resolve({
        job: structuredClone(job),
        observed_at: observation.at,
        schema_write_locked: observation.locked,
      }),
    getMigration: () => Promise.resolve(structuredClone(job)),
    saveMigrationCancellation: () => {
      job = { ...job, status: "cancelled", version: job.version + 1, retryable: false };
      return Promise.resolve(structuredClone(job));
    },
    saveMigrationRetry: () => {
      job = { ...job, status: "queued", version: job.version + 1, retryable: false, failure_reason: null };
      return Promise.resolve({
        job_id: id,
        type_id: id,
        change_id: id,
        analysis_id: id,
        job_version: job.version,
        status: "queued",
      });
    },
    loadSchemaApplication: () => Promise.resolve(structuredClone(context)),
    lockSchemaApplicationBindings: () => Promise.resolve(bindings),
    migrationReferencesFresh: () => Promise.resolve(observation.references),
  };
  const deps = { uow: { run: <T>(_actor: Actor, fn: (s: SchemaMigrationActionStore) => Promise<T>) => fn(store) } };
  return {
    context,
    observation,
    bindings,
    job: () => job,
    set: (values: Partial<EntitySchemaMigration>) => {
      job = { ...job, ...values };
    },
    cancel: (version = 3) => cancelEntitySchemaMigration(deps, actor, id, { expected_job_version: version }),
    retry: (version = 3) => retryEntitySchemaMigration(deps, actor, id, { expected_job_version: version }),
  };
}
Deno.test("public cancellation returns committed terminal status even for an outdated caller", async () => {
  const f = await fixture();
  f.set({ status: "succeeded", version: 4 });
  assertEquals((await f.cancel()).status, "succeeded");
  assertEquals(f.job().version, 4);
});
Deno.test("public retry durably resumes a valid failed job with a new version", async () => {
  const f = await fixture();
  f.set({ status: "failed", retryable: true, failure_reason: "temporary" });
  assertEquals(await f.retry(), {
    job_id: id,
    type_id: id,
    change_id: id,
    analysis_id: id,
    job_version: 4,
    status: "queued",
  });
  assertEquals(f.job().failure_reason, null);
});
Deno.test("public cancellation preserves every terminal winner and rejects stale active work", async () => {
  for (const status of ["committing", "succeeded", "failed", "cancelled"] as const) {
    const f = await fixture();
    f.set({ status, version: 4 });
    assertEquals((await f.cancel()).status, status);
    assertEquals(f.job().version, 4);
  }
  const f = await fixture();
  const error = await assertRejects(() => f.cancel(2));
  assertEquals((error as { code: string }).code, "conflict");
  assertEquals(f.job().status, "preparing");
  assertEquals((await f.cancel()).status, "cancelled");
  assertEquals(f.job().version, 4);
});
Deno.test("public retry preserves the active gate then version then source expiry priority", async () => {
  const f = await fixture();
  f.set({ source_expires_at: f.observation.at });
  f.observation.locked = true;
  let error = await assertRejects(() => f.retry(2));
  assertEquals((error as { code: string }).code, "schema_migration_in_progress");
  f.observation.locked = false;
  error = await assertRejects(() => f.retry(2));
  assertEquals((error as { code: string }).code, "conflict");
  error = await assertRejects(() => f.retry());
  assertEquals((error as { code: string }).code, "migration_source_expired");
  assertEquals(f.job().status, "preparing");
});
Deno.test("public retry uses the database observation with an inclusive UTC expiry boundary", async () => {
  const f = await fixture();
  f.set({ status: "failed", retryable: true, source_expires_at: "2026-10-13T09:00:00.001+09:00" });
  assertEquals((await f.retry()).status, "queued");
  const expired = await fixture();
  expired.set({ status: "failed", retryable: true, source_expires_at: "2026-10-13T09:00:00+09:00" });
  const error = await assertRejects(() => expired.retry());
  assertEquals((error as { code: string }).code, "migration_source_expired");
  assertEquals(expired.job().status, "failed");
});
Deno.test("public retry accepts only retryable failed jobs before examining a stale plan", async () => {
  for (const values of [{ status: "failed", retryable: false }, { status: "cancelled", retryable: true }] as const) {
    const f = await fixture();
    f.set(values);
    f.context.change.version = 99;
    const error = await assertRejects(() => f.retry());
    assertEquals((error as { code: string }).code, "conflict");
    assertEquals((error as Error).message, "재시도 가능한 실패 작업만 재개할 수 있습니다. 새 분석을 준비하세요");
  }
});
Deno.test("public retry rejects stale change identity before changed source versions", async () => {
  for (const change of [{ version: 99 }, { fingerprint: "b".repeat(64) }, { analysis_id: null }]) {
    const f = await fixture();
    f.set({ status: "failed", retryable: true });
    Object.assign(f.context.change, change);
    f.context.type.schema_version = 99;
    const error = await assertRejects(() => f.retry());
    assertEquals((error as { code: string }).code, "schema_plan_stale");
    assertEquals((error as Error).message, "새 분석을 준비하세요");
    assertEquals(f.job().status, "failed");
  }
});
Deno.test("public retry checks source and archived type before analysis readiness", async () => {
  const f = await fixture();
  f.set({ status: "failed", retryable: true });
  f.context.type.schema_version = 99;
  f.context.analysis = null;
  let error = await assertRejects(() => f.retry());
  assertEquals((error as { code: string }).code, "schema_changed");
  f.context.type.schema_version = 1;
  f.context.type.archived = true;
  f.context.change.diff = [{ path: "properties.prop_2.type" } as typeof f.context.change.diff[number]];
  f.context.change.target.schema.deprecated = true;
  error = await assertRejects(() => f.retry());
  assertEquals((error as { code: string }).code, "entity_type_archived");
  f.context.type.archived = false;
  error = await assertRejects(() => f.retry());
  assertEquals((error as { code: string }).code, "schema_plan_stale");
});
Deno.test("public retry rejects stale analysis membership, completion, fingerprint and version", async () => {
  for (
    const analysis of [{ membership: "changed" }, { status: "failed" }, { failed: 1 }, { fingerprint: "changed" }, {
      change_version: 99,
    }]
  ) {
    const f = await fixture();
    f.set({ status: "failed", retryable: true });
    Object.assign(f.context.analysis!, analysis);
    const error = await assertRejects(() => f.retry());
    assertEquals((error as { code: string }).code, "schema_plan_stale");
    assertEquals(f.job().status, "failed");
  }
});
Deno.test("public retry checks template bindings before the current reference baseline", async () => {
  const f = await fixture();
  f.set({ status: "failed", retryable: true });
  f.context.change.source_template_fingerprint = "outdated";
  f.observation.references = false;
  let error = await assertRejects(() => f.retry());
  assertEquals((error as { code: string }).code, "schema_plan_stale");
  assertEquals((error as Error).message, "기록 템플릿이 변경되었습니다. 새 변경과 분석을 준비하세요");
  f.context.change.source_template_fingerprint = await effectiveEntityTemplateFingerprint({}, id);
  error = await assertRejects(() => f.retry());
  assertEquals((error as Error).message, "연결이 변경되었습니다. 새 분석을 준비하세요");
  assertEquals(f.job().status, "failed");
});
Deno.test("public retry validates template property references even when its fingerprint matches", async () => {
  const f = await fixture();
  f.set({ status: "failed", retryable: true });
  f.bindings.templates = { entity_types: { [id]: { update: { memo: "$엔터티.이후.prop_9$", tag_ids: [] } } } };
  f.context.change.source_template_fingerprint = await effectiveEntityTemplateFingerprint(f.bindings.templates, id);
  const error = await assertRejects(() => f.retry());
  assertEquals((error as { code: string }).code, "invalid_input");
  assertEquals((error as Error).message, "기록 템플릿의 속성 참조를 확인하세요");
  assertEquals(f.job().status, "failed");
});
Deno.test("public retry preserves recovery freshness before changed templates and references", async () => {
  const f = await fixture();
  f.set({ status: "failed", retryable: true });
  f.bindings.recovery = {
    observed_at: f.observation.at,
    evidence: {
      status: "succeeded",
      expires_at: f.observation.at,
      material_present: true,
      retained: 0,
      total: 0,
      values_match: true,
      references_match: true,
      conflicts: [],
      type: f.context.type,
    },
  };
  f.context.change.source_template_fingerprint = "stale";
  f.observation.references = false;
  const error = await assertRejects(() => f.retry());
  assertEquals((error as { code: string }).code, "migration_source_expired");
  assertEquals(f.job().status, "failed");
});
