import { SqlBusinessSettingsUnitOfWork } from "../../functions/_shared/adapters/supabase/business-settings-store.ts";
import { updateBusinessSettings } from "../../functions/_shared/core/settings/application.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import {
  createTag,
  deleteTag,
  renameTag,
  setTagConnections,
} from "../../functions/_shared/core/tags/application.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import type postgres from "postgres";
import { connect, dbTest, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import {
  changeConfiguredRelation,
  configuredRelationFixture,
  listConfiguredLinks,
} from "./_configured-relations.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import {
  createEntityType as createPublicEntityType,
  getEntitySchema,
  updateEntityType,
} from "../../functions/_shared/core/entity-types/application.ts";
import {
  createEntity,
  deleteEntity,
  getEntity,
  listEntities,
  updateEntity,
} from "../../functions/_shared/core/entity/application.ts";
import {
  completeTask,
  createTask,
  updateRecord,
  updateTask,
} from "../../functions/_shared/core/activity/application.ts";
import {
  analyzeEntitySchemaChange,
  createEntitySchemaChange,
  getEntitySchemaChange,
} from "../../functions/_shared/core/entity-types/schema-changes.ts";
import {
  cancelEntitySchemaMigration,
  getEntitySchemaMigration,
  listEntitySchemaMigrations,
  retryEntitySchemaMigration,
  startEntitySchemaMigration,
} from "../../functions/_shared/core/entity-types/schema-migrations.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import {
  type MigrationWorkerBatch,
  prepareMigrationBatch,
} from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type { EntityTypeDeps } from "../../functions/_shared/core/entity-types/application.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
async function fixture(admin: postgres.Sql, sql: postgres.Sql) {
  const f = await businessWorkspaceFixture(admin, sql);
  await f.grant(f.manager, [{
    target_kind: "settings",
    target_id: "*",
    access: "write",
  }, { target_kind: "tasks", target_id: "*", access: "write" }]);
  return { ...f, actor: f.manager };
}
async function createWritableType(
  f: Awaited<ReturnType<typeof fixture>>,
  d: EntityTypeDeps,
  input: Parameters<typeof createPublicEntityType>[2],
) {
  const type = await createPublicEntityType(d, requestActor(f.actor), input);
  await f.grantKind(f.actor, type.id, "write");
  return type;
}
function workerConnection() {
  const url = new URL(urls.admin);
  url.username = "app_worker";
  url.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
  return connect(url.href, {
    max: 1,
    prepare: false,
    connection: { statement_timeout: 15000, lock_timeout: 5000 },
  });
}
async function analyze(
  d: EntityTypeDeps,
  a: Actor,
  typeId: string,
  worker: postgres.Sql,
) {
  const change = await createEntitySchemaChange(d, requestActor(a), typeId, {
    expected_schema_version: 1,
    edits: [{
      op: "add_property",
      client_ref: "count",
      field: {
        "x-order": 20,
        "x-show-in-list": true,
        type: "integer",
        title: "수량",
      },
      required: true,
    }],
    migration: {
      rules: [{ op: "fill", key: "prop_2", value: 7 }],
      overrides: [],
    },
  });
  await analyzeEntitySchemaChange(d, requestActor(a), typeId, change.id, {
    expected_change_version: change.version,
  });
  for (let i = 0; i < 60; i++) {
    const [r] =
      await worker`select app.claim_entity_schema_analysis() as batch`;
    if (!r.batch) break;
    const b = r.batch, convert = compileMigration(b.target, b.migration);
    await worker`select app.complete_entity_schema_analysis_batch(${b.id},${b.fence},${
      worker.json(
        b.rows.map((
          r: { entity_id: string; properties: Record<string, unknown> },
        ) => convert(r.entity_id, r.properties)),
      )
    })`;
  }
  const ready = await getEntitySchemaChange(d, a, typeId, change.id);
  assert(ready.executable);
  return {
    change: ready,
    input: {
      expected_schema_version: 1,
      expected_change_version: ready.version,
      analysis_id: ready.analysis!.id,
      fingerprint: ready.fingerprint,
    },
  };
}
async function claim(worker: postgres.Sql): Promise<MigrationWorkerBatch> {
  const [r] = await worker`select app.claim_entity_schema_migration() as batch`;
  assert(r.batch);
  return r.batch;
}
async function stage(worker: postgres.Sql, b: MigrationWorkerBatch) {
  const prepared = await prepareMigrationBatch(
    b,
    new Date("2026-10-12T00:00:00Z"),
  );
  assert(!prepared.stale);
  const [r] =
    await worker`select app.stage_entity_schema_migration(${b.id},${b.fence},${
      worker.json(prepared.results)
    }) as accepted`;
  return r.accepted;
}
async function commit(worker: postgres.Sql, b: MigrationWorkerBatch) {
  const [r] =
    await worker`select app.commit_entity_schema_migration(${b.id},${b.fence},${b.source_template_fingerprint},${SEARCH_PIPELINE}) as committed`;
  return r.committed;
}
async function finish(worker: postgres.Sql, id: string) {
  for (let i = 0; i < 60; i++) {
    const b = await claim(worker);
    assertEquals(b.id, id);
    if (b.status === "committing") {
      assert(await commit(worker, b));
      return;
    }
    assert(await stage(worker, b));
  }
  throw Error("job batch budget exceeded");
}
const code = async (fn: () => Promise<unknown>, expected: string) =>
  assertEquals((await assertRejects(fn, AppError)).code, expected);

dbTest(
  "migration job: acceptance replay, owner/type write gates, deleted targets, exact atomic effects and preserved history",
  async () => {
    const admin = connect(urls.admin),
      sql = connect(urls.direct, { max: 6 }),
      worker = workerConnection(),
      a = await fixture(admin, sql),
      b = await fixture(admin, sql);
    const d = { uow: new SqlEntityTypeUnitOfWork(sql) },
      e = { uow: new SqlEntityUnitOfWork(sql) },
      p = configuredRelationFixture(sql),
      activity = {
        uow: new SqlUnitOfWork(sql),
        clock: { now: () => new Date("2026-10-12T00:00:00Z") },
      };
    try {
      const type = await createWritableType(a, d, {
          label: "재료",
          icon_id: "leaf",
        }),
        other = await createWritableType(a, d, { label: "상품" });
      const make = (typeId: string, title: string) =>
        createEntity(e, requestActor(a.actor), {
          entity_type_id: typeId,
          schema_version: 1,
          source: "app",
          external_id: crypto.randomUUID(),
          properties: { prop_1: title },
        });
      const x = await make(type.id, "원본"),
        deleted = await make(type.id, "삭제 원본"),
        y = await make(other.id, "다른 종류"),
        z = await make(other.id, "다른 연결");
      await deleteEntity(e, requestActor(a.actor), deleted.id, 1);
      await changeConfiguredRelation(p, requestActor(a.actor), x.id, {
        other_id: y.id,
        expected_version: 1,
        expected_other_version: 1,
      }, true);
      const xBefore = await getEntity(e, a.actor, x.id),
        delBefore = await getEntity(e, a.actor, deleted.id);
      const tags = { uow: new SqlTagUnitOfWork(sql) };
      const attachedTag = await createTag(tags, requestActor(a.actor), {
        scope: "entity",
        name: "attached",
      });
      await setTagConnections(tags, requestActor(a.actor), {
        target_kind: "entity",
        target_id: x.id,
        expected_version: xBefore.version,
        tag_ids: [attachedTag.id],
      });
      const currentX = await getEntity(e, a.actor, x.id);
      const task = await createTask(activity, requestActor(a.actor), {
        kind: "once",
        title: "연결",
        body: "원래 메모",
        entity_ids: [x.id],
      });
      const freeTask = await createTask(activity, requestActor(a.actor), {
        kind: "once",
        title: "무관",
        body: "무관 메모",
        entity_ids: [],
      });
      const resultRoot = await createTask(activity, requestActor(a.actor), {
        kind: "once",
        title: "과거 수행 원본",
        body: "",
      });
      const record =
        (await completeTask(activity, requestActor(a.actor), resultRoot.id, {
          expected_version: resultRoot.version,
          body: "선택 원문",
        })).record;
      const history = await runInWorkspace(
        sql,
        a.actor,
        { mode: "business", requirements: [] },
        (tx) =>
          tx`select id,body,entity_context from app.records where workspace_id=${a.workspaceId} order by id`,
      );
      const plan = await analyze(d, a.actor, type.id, worker),
        acceptActor = requestActor(a.actor);
      const accepted = await startEntitySchemaMigration(
        d,
        acceptActor,
        type.id,
        plan.change.id,
        plan.input,
      );
      assertEquals(
        await startEntitySchemaMigration(
          d,
          acceptActor,
          type.id,
          plan.change.id,
          plan.input,
        ),
        accepted,
      );
      assertEquals(
        (await getEntitySchemaChange(d, a.actor, type.id, plan.change.id))
          .status,
        "ready",
      );
      assertEquals(
        (await getEntity(e, a.actor, x.id)).properties,
        xBefore.properties,
      );
      await code(
        () => getEntitySchemaMigration(d, b.actor, accepted.job_id),
        "not_found",
      );
      assertEquals(
        (await listEntitySchemaMigrations(d, b.actor, {})).items,
        [],
      );
      await code(
        () =>
          startEntitySchemaMigration(
            d,
            requestActor(a.actor),
            type.id,
            plan.change.id,
            plan.input,
          ),
        "schema_migration_in_progress",
      );
      await code(
        () =>
          updateEntity(e, requestActor(a.actor), x.id, {
            schema_version: 1,
            expected_version: currentX.version,
            properties: { prop_1: "変更" },
          }),
        "schema_migration_in_progress",
      );
      await code(
        () => deleteEntity(e, requestActor(a.actor), x.id, currentX.version),
        "schema_migration_in_progress",
      );
      await code(
        () =>
          createEntity(e, requestActor(a.actor), {
            entity_type_id: type.id,
            schema_version: 1,
            properties: { prop_1: "新規" },
          }),
        "schema_migration_in_progress",
      );
      await code(
        () =>
          updateEntityType(d, requestActor(a.actor), type.id, {
            expected_schema_version: 1,
            archived: true,
          }),
        "schema_migration_in_progress",
      );
      for (const [left, right] of [[x.id, y.id], [y.id, x.id]]) {
        await code(
          () =>
            changeConfiguredRelation(p, requestActor(a.actor), left, {
              other_id: right,
              expected_version: 3,
              expected_other_version: 2,
            }, false),
          "schema_migration_in_progress",
        );
      }
      await code(
        () =>
          updateTask(activity, requestActor(a.actor), task.id, {
            expected_version: task.version,
            entity_ids: [],
          }),
        "schema_migration_in_progress",
      );
      await code(
        () =>
          updateTask(activity, requestActor(a.actor), freeTask.id, {
            expected_version: freeTask.version,
            entity_ids: [x.id],
          }),
        "schema_migration_in_progress",
      );
      // Results have immutable parents; memo correction never inherits entity selections.
      await code(
        () =>
          deleteTag(
            tags,
            requestActor(a.actor),
            attachedTag.id,
            attachedTag.version,
          ),
        "schema_migration_in_progress",
      );
      await renameTag(tags, requestActor(a.actor), attachedTag.id, {
        expected_version: attachedTag.version,
        name: "renamed",
      });
      const unrelatedTag = await createTag(tags, requestActor(a.actor), {
        scope: "record",
        name: "unrelated",
      });
      await deleteTag(
        tags,
        requestActor(a.actor),
        unrelatedTag.id,
        unrelatedTag.version,
      );
      await updateTask(activity, requestActor(a.actor), task.id, {
        expected_version: task.version,
        body: "permitted note",
      });
      await updateRecord(activity, requestActor(a.actor), record.id, {
        expected_version: record.version,
        body: "permitted body",
      });
      await updateTask(activity, requestActor(a.actor), freeTask.id, {
        expected_version: freeTask.version,
        body: "無関係ノート",
      });
      await changeConfiguredRelation(p, requestActor(a.actor), y.id, {
        other_id: z.id,
        expected_version: 2,
        expected_other_version: 1,
      }, true);
      const currentY = await getEntity(e, a.actor, y.id);
      await updateEntity(e, requestActor(a.actor), y.id, {
        schema_version: 1,
        expected_version: currentY.version,
        properties: { prop_1: "別修正" },
      });
      const yBefore = await getEntity(e, a.actor, y.id);
      await updateBusinessSettings(
        { uow: new SqlBusinessSettingsUnitOfWork(sql), clock: activity.clock },
        requestActor(a.actor),
        {
          id: "record_templates",
          expected_version: 0,
          value: {
            task: { update: { memo: "task only", tag_ids: [] } },
            entity_types: {
              [other.id]: { update: { memo: "other only", tag_ids: [] } },
            },
          },
        },
      );
      await finish(worker, accepted.job_id);
      const done = await getEntitySchemaMigration(d, a.actor, accepted.job_id);
      assertEquals(done.status, "succeeded");
      assertEquals(done.result?.total, 2);
      assert(done.source_expires_at);
      assertEquals(
        await startEntitySchemaMigration(
          d,
          acceptActor,
          type.id,
          plan.change.id,
          plan.input,
        ),
        accepted,
      );
      assertEquals(
        (await getEntitySchema(d, a.actor, { type_id: type.id }))
          .schema_version,
        2,
      );
      const after = await getEntity(e, a.actor, x.id),
        delAfter = await getEntity(e, a.actor, deleted.id);
      assertEquals(after.properties, { prop_1: "원본", prop_2: 7 });
      assertEquals(after.version, currentX.version + 1);
      assertEquals(after.entity_type_id, type.id);
      assertEquals(after.schema_version, 2);
      assertEquals(delAfter.properties, { prop_1: "삭제 원본", prop_2: 7 });
      assertEquals(delAfter.deleted_at, delBefore.deleted_at);
      assertEquals(delAfter.version, delBefore.version + 1);
      assertEquals(await getEntity(e, a.actor, y.id), yBefore);
      assertEquals(
        (await listConfiguredLinks(p, a.actor, x.id, { limit: 20 })).items.map((
          v,
        ) => v.id),
        [y.id],
      );
      const old = await runInWorkspace(
        sql,
        a.actor,
        { mode: "business", requirements: [] },
        (tx) =>
          tx`select id,body,entity_context from app.records where workspace_id=${a.workspaceId} and id=any(${
            history.map((r) => r.id)
          }::text[]) order by id`,
      );
      assertEquals(
        Array.from(old),
        history.map((r) =>
          r.id === record.id ? { ...r, body: "permitted body" } : r
        ),
      );
      const [effects] =
        await admin`select count(*)::int as records,count(s.id)::int as indexes from app.records r left join app.search_index_state s on s.workspace_id=r.workspace_id and s.id=r.id where r.workspace_id=${a.workspaceId} and r.change_metadata->>'schema_migration_id'=${accepted.job_id}`;
      assertEquals(effects, { records: 2, indexes: 2 });
      assertEquals(
        (await cancelEntitySchemaMigration(
          d,
          requestActor(a.actor),
          accepted.job_id,
          { expected_job_version: 1 },
        ))
          .status,
        "succeeded",
      );
    } finally {
      await a.cleanup();
      await b.cleanup();
      await worker.end();
      await sql.end();
      await admin.end();
    }
  },
);

dbTest(
  "migration worker crash: fences, retryable failure, final rollback, cancel/commit winner and replacement resume",
  async () => {
    const admin = connect(urls.admin),
      sql = connect(urls.direct, { max: 4 }),
      worker = workerConnection(),
      a = await fixture(admin, sql),
      d = { uow: new SqlEntityTypeUnitOfWork(sql) },
      e = { uow: new SqlEntityUnitOfWork(sql) };
    try {
      const type = await createWritableType(a, d, { label: "Crash" });
      const entity = await createEntity(e, requestActor(a.actor), {
        entity_type_id: type.id,
        schema_version: 1,
        properties: { prop_1: "old" },
      });
      const plan = await analyze(d, a.actor, type.id, worker),
        accepted = await startEntitySchemaMigration(
          d,
          requestActor(a.actor),
          type.id,
          plan.change.id,
          plan.input,
        ),
        first = await claim(worker);
      await admin`update app.entity_schema_migrations set lease_until=now()-interval '1 second' where id=${accepted.job_id}`;
      assertEquals(
        (await getEntitySchemaMigration(d, a.actor, accepted.job_id)).status,
        "preparing",
      );
      const replacement = await claim(worker);
      assert(replacement.fence > first.fence);
      assertEquals(await stage(worker, first), false);
      const [failed] =
        await worker`select app.fail_entity_schema_migration(${replacement.id},${replacement.fence},'migration_worker_failed',true) as failed`;
      assert(failed.failed);
      const failure = await getEntitySchemaMigration(
        d,
        a.actor,
        accepted.job_id,
      );
      assert(failure.retryable);
      const retryKey = requestActor(a.actor),
        retry = await retryEntitySchemaMigration(d, retryKey, accepted.job_id, {
          expected_job_version: failure.version,
        });
      assertEquals(retry.job_id, accepted.job_id);
      assertEquals(
        await retryEntitySchemaMigration(d, retryKey, accepted.job_id, {
          expected_job_version: failure.version,
        }),
        retry,
      );
      await stage(worker, await claim(worker));
      const committing = await claim(worker);
      assertEquals(committing.status, "committing");
      assertEquals(
        (await cancelEntitySchemaMigration(
          d,
          requestActor(a.actor),
          accepted.job_id,
          { expected_job_version: 1 },
        ))
          .status,
        "committing",
      );
      // A deliberate transaction abort after the real commit function tests rollback of the complete transition.
      await assertRejects(() =>
        worker.begin(async (tx) => {
          await tx`select app.commit_entity_schema_migration(${committing.id},${committing.fence},${committing.source_template_fingerprint},${SEARCH_PIPELINE})`;
          await tx`select 1/0`;
        })
      );
      assertEquals((await getEntity(e, a.actor, entity.id)).properties, {
        prop_1: "old",
      });
      assertEquals(
        (await getEntitySchema(d, a.actor, { type_id: type.id }))
          .schema_version,
        1,
      );
      assertEquals(
        (await getEntitySchemaMigration(d, a.actor, accepted.job_id)).status,
        "committing",
      );
      await admin`update app.entity_schema_migrations set lease_until=now()-interval '1 second' where id=${accepted.job_id}`;
      const successor = await claim(worker);
      assertEquals(await commit(worker, committing), false);
      assert(await commit(worker, successor));
      assertEquals(await commit(worker, successor), false);
      assertEquals(
        (await getEntitySchemaMigration(d, a.actor, accepted.job_id)).status,
        "succeeded",
      );
      const empty = await createWritableType(a, d, { label: "Empty success" });
      const emptyPlan = await analyze(d, a.actor, empty.id, worker),
        emptyJob = await startEntitySchemaMigration(
          d,
          requestActor(a.actor),
          empty.id,
          emptyPlan.change.id,
          emptyPlan.input,
        );
      await finish(worker, emptyJob.job_id);
      const zero = await getEntitySchemaMigration(d, a.actor, emptyJob.job_id);
      assertEquals(zero.status, "succeeded");
      assertEquals(zero.result?.total, 0);
      assertEquals(zero.result?.changed, 0);
      const second = await createWritableType(a, d, { label: "Cancel" }),
        cancelPlan = await analyze(d, a.actor, second.id, worker),
        cancelJob = await startEntitySchemaMigration(
          d,
          requestActor(a.actor),
          second.id,
          cancelPlan.change.id,
          cancelPlan.input,
        ),
        cancelClaim = await claim(worker),
        cancelState = await getEntitySchemaMigration(
          d,
          a.actor,
          cancelJob.job_id,
        );
      const cancelled = await cancelEntitySchemaMigration(
        d,
        requestActor(a.actor),
        cancelJob.job_id,
        {
          expected_job_version: cancelState.version,
        },
      );
      assertEquals(cancelled.status, "cancelled");
      assertEquals(await stage(worker, cancelClaim), false);
      await code(
        () =>
          retryEntitySchemaMigration(
            d,
            requestActor(a.actor),
            cancelJob.job_id,
            {
              expected_job_version: cancelled.version,
            },
          ),
        "conflict",
      );
      assertEquals(
        (await getEntitySchema(d, a.actor, { type_id: second.id }))
          .schema_version,
        1,
      );
    } finally {
      await a.cleanup();
      await worker.end();
      await sql.end();
      await admin.end();
    }
  },
);

dbTest(
  "migration joined GET and shared-definition list race return whole source or whole committed epoch",
  async () => {
    const admin = connect(urls.admin),
      sql = connect(urls.direct, { max: 6 }),
      worker = workerConnection(),
      a = await fixture(admin, sql),
      d = { uow: new SqlEntityTypeUnitOfWork(sql) },
      e = { uow: new SqlEntityUnitOfWork(sql) };
    let stopReader = false;
    let reader: Promise<void> | undefined;
    let readerFailure: unknown;
    try {
      const type = await createWritableType(a, d, { label: "Read race" }),
        entity = await createEntity(e, requestActor(a.actor), {
          entity_type_id: type.id,
          schema_version: 1,
          properties: { prop_1: "old" },
        }),
        plan = await analyze(d, a.actor, type.id, worker),
        job = await startEntitySchemaMigration(
          d,
          requestActor(a.actor),
          type.id,
          plan.change.id,
          plan.input,
        );
      await stage(worker, await claim(worker));
      const final = await claim(worker);
      const old = await getEntity(e, a.actor, entity.id);
      const observations: Array<{ schema: number; value: unknown }> = [{
        schema: old.current_schema_version,
        value: old.properties.prop_2,
      }];
      reader = (async () => {
        for (let i = 0; i < 40 && !stopReader; i++) {
          const row = await getEntity(e, a.actor, entity.id);
          observations.push({
            schema: row.current_schema_version,
            value: row.properties.prop_2,
          });
          if (stopReader) break;
          const list = await listEntities(e, a.actor, {
            entity_type_id: type.id,
            limit: 20,
            sort: "updated_at",
          });
          for (const r of list.items) {
            observations.push({
              schema: r.current_schema_version,
              value: r.display_properties.prop_2,
            });
          }
        }
      })().catch((error) => {
        readerFailure = error;
      });
      assert(await commit(worker, final));
      await reader;
      if (readerFailure) throw readerFailure;
      for (const o of observations) {
        assert(
          o.schema === 1
            ? o.value === undefined
            : o.schema === 2 && o.value === 7,
        );
      }
      const after = await getEntity(e, a.actor, entity.id);
      assertEquals({
        schema: after.current_schema_version,
        value: after.properties.prop_2,
      }, { schema: 2, value: 7 });
      assertEquals(
        (await getEntitySchemaMigration(d, a.actor, job.job_id)).status,
        "succeeded",
      );
    } finally {
      stopReader = true;
      await reader;
      await a.cleanup();
      await worker.end();
      await sql.end();
      await admin.end();
    }
  },
);

dbTest(
  "migration 2000-target boundary commits complete bulk effects under existing 15s timeout; 2001 and byte limits reject",
  async () => {
    const admin = connect(urls.admin),
      sql = connect(urls.direct, { max: 4 }),
      worker = workerConnection(),
      a = await fixture(admin, sql),
      d = { uow: new SqlEntityTypeUnitOfWork(sql) },
      e = { uow: new SqlEntityUnitOfWork(sql) };
    try {
      const type = await createWritableType(a, d, { label: "Boundary" });
      await runInWorkspace(
        sql,
        a.actor,
        { mode: "business", requirements: [] },
        (tx) =>
          tx`insert into app.entities(workspace_id,id,source,external_id,entity_type_id,schema_version,properties) select ${a.workspaceId},'app:'||${type.id}::text||':'||n,'app',n::text,${type.id},1,jsonb_build_object('prop_1','item '||n) from generate_series(1,2000) n`,
      );
      const plan = await analyze(d, a.actor, type.id, worker),
        job = await startEntitySchemaMigration(
          d,
          requestActor(a.actor),
          type.id,
          plan.change.id,
          plan.input,
        );
      for (let i = 0; i < 60; i++) {
        const b = await claim(worker);
        if (b.status === "committing") {
          const started = performance.now();
          assert(await commit(worker, b));
          console.log(
            JSON.stringify({
              migration_targets: 2000,
              final_commit_ms: Math.round(performance.now() - started),
              statement_timeout_ms: 15000,
              includes:
                "pointer, properties, all versions, records, index intents, recovery baseline, success result",
            }),
          );
          break;
        }
        assert(await stage(worker, b));
      }
      const done = await getEntitySchemaMigration(d, a.actor, job.job_id);
      assertEquals(done.status, "succeeded");
      assertEquals(done.processed, 2000);
      assertEquals(done.result?.changed, 2000);
      const [effects] =
        await admin`select (select count(*) from app.entities where workspace_id=${a.workspaceId} and entity_type_id=${type.id} and schema_version=2 and version=2 and properties->'prop_2'='7'::jsonb)::int as entities,(select count(*) from app.records where workspace_id=${a.workspaceId} and change_metadata->>'schema_migration_id'=${job.job_id})::int as records,(select count(*) from app.search_index_state s join app.records r on r.workspace_id=s.workspace_id and r.id=s.id where r.workspace_id=${a.workspaceId} and r.change_metadata->>'schema_migration_id'=${job.job_id})::int as indexes`;
      assertEquals(effects, { entities: 2000, records: 2000, indexes: 2000 });
      const over = await createWritableType(a, d, { label: "Over count" });
      await runInWorkspace(
        sql,
        a.actor,
        { mode: "business", requirements: [] },
        (tx) =>
          tx`insert into app.entities(workspace_id,id,source,external_id,entity_type_id,schema_version,properties) select ${a.workspaceId},'app:'||${over.id}::text||':'||n,'app',n::text,${over.id},1,jsonb_build_object('prop_1','item') from generate_series(1,2001) n`,
      );
      await code(() => analyze(d, a.actor, over.id, worker), "invalid_input");
      const large = await createWritableType(a, d, { label: "Over bytes" });
      await runInWorkspace(
        sql,
        a.actor,
        { mode: "business", requirements: [] },
        (tx) =>
          tx`insert into app.entities(workspace_id,id,source,external_id,entity_type_id,schema_version,properties) select ${a.workspaceId},'app:'||${large.id}::text||':'||n,'app',n::text,${large.id},1,jsonb_build_object('prop_1',repeat('한',4096)) from generate_series(1,700) n`,
      );
      await code(() => analyze(d, a.actor, large.id, worker), "invalid_input");
      assertEquals(
        (await getEntitySchema(d, a.actor, { type_id: over.id }))
          .schema_version,
        1,
      );
      assertEquals(
        (await getEntitySchema(d, a.actor, { type_id: large.id }))
          .schema_version,
        1,
      );
      // A source change invalidates retry; neither the old snapshot nor its stage is reused.
      const stale = await createWritableType(a, d, { label: "Stale retry" }),
        row = await createEntity(e, requestActor(a.actor), {
          entity_type_id: stale.id,
          schema_version: 1,
          properties: { prop_1: "source" },
        }),
        stalePlan = await analyze(d, a.actor, stale.id, worker),
        staleJob = await startEntitySchemaMigration(
          d,
          requestActor(a.actor),
          stale.id,
          stalePlan.change.id,
          stalePlan.input,
        ),
        claimed = await claim(worker);
      await worker`select app.fail_entity_schema_migration(${claimed.id},${claimed.fence},'migration_worker_failed',true)`;
      await updateEntity(e, requestActor(a.actor), row.id, {
        schema_version: 1,
        expected_version: row.version,
        properties: { prop_1: "newer" },
      });
      const failed = await getEntitySchemaMigration(
        d,
        a.actor,
        staleJob.job_id,
      );
      await code(
        () =>
          retryEntitySchemaMigration(
            d,
            requestActor(a.actor),
            staleJob.job_id,
            {
              expected_job_version: failed.version,
            },
          ),
        "schema_plan_stale",
      );
    } finally {
      await a.cleanup();
      await worker.end();
      await sql.end();
      await admin.end();
    }
  },
);
