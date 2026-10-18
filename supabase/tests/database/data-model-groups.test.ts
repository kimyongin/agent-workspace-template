import { assertEquals } from "@std/assert";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { requestActor } from "../_request.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import { SqlDataModelGroupStore } from "../../functions/_shared/adapters/supabase/data-model-group-store.ts";
import {
  exportDataModel,
  prepareDataModel,
  previewDataModel,
} from "../../functions/_shared/core/data-model/application.ts";
import { analyzeDataModel } from "../../functions/_shared/core/data-model/groups.ts";
import type { DataModelDocument } from "../../functions/_shared/contracts/data-model.ts";
const admin = connect(urls.admin), sql = connect(urls.direct);
const deps = { uow: new SqlDataModelUnitOfWork(sql, SqlDataModelGroupStore) };
dbTest("whole model analysis without conversion needs remains a private ready review", async () => {
  const fixture = await businessWorkspaceFixture(admin, sql);
  try {
    const document = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
    const input = { mode: "copy", document: JSON.stringify(document) };
    const review = await previewDataModel(deps, fixture.manager, input);
    const change = await prepareDataModel(deps, requestActor(fixture.manager), {
      ...input,
      preview_fingerprint: review.fingerprint,
    });
    assertEquals(change.status, "ready");
    assertEquals((await exportDataModel(deps, fixture.manager)).entity_types.length, 0);
    const analyzed = await analyzeDataModel(deps, requestActor(fixture.manager), change.id, {
      expected_version: change.version,
    });
    assertEquals(analyzed.status, "ready");
    assertEquals(analyzed.group?.children.length, 0);
  } finally {
    await fixture.cleanup();
  }
});

import { assertRejects } from "@std/assert";
import { applyDataModel, getDataModelChange } from "../../functions/_shared/core/data-model/application.ts";
import { createEntity, getEntity } from "../../functions/_shared/core/entity/application.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { startEntitySchemaMigration } from "../../functions/_shared/core/entity-types/schema-migrations.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { prepareMigrationBatch } from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
const workerUrl = new URL(urls.admin);
workerUrl.username = "app_worker";
workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
const worker = connect(workerUrl.toString());
dbTest(
  "two-kind durable model conversion prepares privately and publishes values, compatible settings and relationship once",
  async () => {
    const fixture = await fixtureOwner(admin), foreign = await fixtureOwner(admin);
    try {
      const sample = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
      for (const kind of sample.entity_types.slice(0, 2)) {
        kind.schema.properties.prop_2 = { type: "string", "x-order": 20 };
      }
      const input = { mode: "copy", document: JSON.stringify(sample) },
        preview = await previewDataModel(deps, fixture.actor, input);
      const initial = await prepareDataModel(deps, requestActor(fixture.actor), {
        ...input,
        preview_fingerprint: preview.fingerprint,
      });
      assertEquals(
        (await applyDataModel(deps, requestActor(fixture.actor), initial.id, { expected_version: initial.version }))
          .status,
        "applied",
      );
      const entityDeps = { uow: new SqlEntityUnitOfWork(sql) };
      const ids = sample.entity_types.slice(0, 2).map((t) => preview.mapping.types[t.ref]);
      const entities = [];
      for (const [index, id] of ids.entries()) {
        entities.push(
          await createEntity(entityDeps, requestActor(fixture.actor), {
            entity_type_id: id,
            schema_version: 1,
            properties: { prop_1: `자료${index}`, prop_2: String(12 + index) },
          }),
        );
      }
      const before = await exportDataModel(deps, fixture.actor), target = structuredClone(before);
      for (const kind of target.entity_types) {
        if (ids.includes(kind.schema["x-type-id"])) {
          kind.schema.properties.prop_2 = { type: "integer", "x-order": 20 };
        } else kind.schema.description = "함께 게시하는 호환 설정";
      }
      target.relations[0].ends[0].label = "함께 바꾼 관계";
      const source = { mode: "update", document: JSON.stringify(target) },
        review = await previewDataModel(deps, fixture.actor, source);
      const saved = await prepareDataModel(deps, requestActor(fixture.actor), {
        ...source,
        preview_fingerprint: review.fingerprint,
      });
      assertEquals(saved.status, "needs_conversion");
      const conversions = target.entity_types.filter((t) => ids.includes(t.schema["x-type-id"])).map((t) => ({
        type_ref: t.ref,
        migration: { rules: [{ op: "convert", key: "prop_2", to: "integer" }], overrides: [] },
      }));
      const analyzed = await analyzeDataModel(deps, requestActor(fixture.actor), saved.id, {
        expected_version: saved.version,
        conversions,
      });
      assertEquals(analyzed.status, "analyzing");
      const read = await getDataModelChange(deps, fixture.actor, saved.id);
      assertEquals(read.group?.children.length, 2);
      await assertRejects(() => getDataModelChange(deps, foreign.actor, saved.id));
      const child = read.group!.children[0];
      await assertRejects(
        async () =>
          await startEntitySchemaMigration(
            { uow: new SqlEntityTypeUnitOfWork(sql) },
            requestActor(fixture.actor),
            child.change.type_id,
            child.change.id,
            {
              expected_change_version: child.change.version,
              expected_schema_version: child.change.source_schema_version,
              analysis_id: child.change.analysis!.id,
              fingerprint: child.change.fingerprint,
            },
          ),
        Error,
        "전체 모델",
      );
      for (let step = 0; step < 10; step++) {
        const [claimed] = await worker`select app.claim_entity_schema_analysis() as batch`;
        if (!claimed.batch) break;
        const batch = claimed.batch, convert = compileMigration(batch.target, batch.migration, batch.recovery_keys);
        const result = batch.rows.map((
          r: { entity_id: string; properties: Record<string, unknown>; recovery_properties?: Record<string, unknown> },
        ) => convert(r.entity_id, r.properties, r.recovery_properties));
        const [completed] = await worker`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${
          worker.json(result)
        }) as accepted`;
        assertEquals(completed.accepted, true);
      }
      const ready = await getDataModelChange(deps, fixture.actor, saved.id);
      assertEquals(ready.status, "ready");
      const actor = requestActor(fixture.actor), action = { expected_version: ready.version };
      const accepted = await applyDataModel(deps, actor, saved.id, action);
      assertEquals(accepted.status, "queued");
      assertEquals(await applyDataModel(deps, actor, saved.id, action), accepted);
      const queued = await getDataModelChange(deps, fixture.actor, saved.id);
      const isolated = queued.group!.children[0].job!;
      const [standalone] = await worker`select app.claim_entity_schema_migration() as batch`;
      assertEquals(standalone.batch, null);
      const [denied] =
        await worker`select app.commit_entity_schema_migration(${isolated.id},0,'irrelevant',${SEARCH_PIPELINE}) as committed`;
      assertEquals(denied.committed, false);
      await assertRejects(() => worker`select id from app.data_model_changes limit 1`);
      assertEquals(await exportDataModel(deps, fixture.actor), before);
      for (const entity of entities) {
        assertEquals((await getEntity(entityDeps, fixture.actor, entity.id)).properties, entity.properties);
      }
      for (let step = 0; step < 20; step++) {
        const [claimed] = await worker`select app.claim_data_model_conversion() as batch`;
        if (!claimed.batch) break;
        const parent = claimed.batch;
        if (parent.status === "committing") {
          const [result] =
            await worker`select app.commit_data_model_conversion(${parent.id},${parent.fence},${SEARCH_PIPELINE}) as committed`;
          assertEquals(result.committed, true);
        } else {
          const prepared = await prepareMigrationBatch(parent.child, new Date());
          assertEquals(prepared.stale, false);
          const [stale] = await worker`select app.stage_data_model_conversion(${parent.id},${
            Number(parent.fence) + 1
          },${parent.child.id},${parent.child.fence},${worker.json(prepared.results)}) as accepted`;
          assertEquals(stale.accepted, false);
          const [result] =
            await worker`select app.stage_data_model_conversion(${parent.id},${parent.fence},${parent.child.id},${parent.child.fence},${
              worker.json(prepared.results)
            }) as accepted`;
          assertEquals(result.accepted, true);
          assertEquals(await exportDataModel(deps, fixture.actor), before);
        }
      }
      const done = await getDataModelChange(deps, fixture.actor, saved.id);
      assertEquals(done.status, "applied");
      assertEquals(done.result?.counts?.types.updated, 3);
      for (const [index, entity] of entities.entries()) {
        assertEquals((await getEntity(entityDeps, fixture.actor, entity.id)).properties.prop_2, 12 + index);
      }
      const after = await exportDataModel(deps, fixture.actor);
      assertEquals(after.relations[0].ends[0].label, "함께 바꾼 관계");
      for (const child of done.group!.children) {
        assertEquals(child.job?.status, "succeeded");
        assertEquals(child.job?.recovery?.status, "available");
      }
    } finally {
      await fixture.cleanup();
      await foreign.cleanup();
    }
  },
);

import { changeDataModelGroup } from "../../functions/_shared/core/data-model/groups.ts";
async function queuedGroup(analyzeOnly = false) {
  const fixture = await fixtureOwner(admin);
  try {
    const sample = JSON.parse(await Deno.readTextFile("docs/examples/data-model/cooking.json")) as DataModelDocument;
    for (const t of sample.entity_types.slice(0, 2)) t.schema.properties.prop_2 = { type: "string", "x-order": 20 };
    const source = { mode: "copy", document: JSON.stringify(sample) },
      review = await previewDataModel(deps, fixture.actor, source);
    const initial = await prepareDataModel(deps, requestActor(fixture.actor), {
      ...source,
      preview_fingerprint: review.fingerprint,
    });
    await applyDataModel(deps, requestActor(fixture.actor), initial.id, { expected_version: initial.version });
    const entityDeps = { uow: new SqlEntityUnitOfWork(sql) },
      ids = sample.entity_types.slice(0, 2).map((t) => review.mapping.types[t.ref]);
    const entities = [];
    for (const [index, id] of ids.entries()) {
      entities.push(
        await createEntity(entityDeps, requestActor(fixture.actor), {
          entity_type_id: id,
          schema_version: 1,
          properties: { prop_1: `기준${index}`, prop_2: String(41 + index) },
        }),
      );
    }
    const before = await exportDataModel(deps, fixture.actor), target = structuredClone(before);
    for (const t of target.entity_types) {
      if (ids.includes(t.schema["x-type-id"])) t.schema.properties.prop_2 = { type: "integer", "x-order": 20 };
      else t.schema.description = "함께 게시";
    }
    target.relations[0].ends[0].label = "최종 관계";
    const input = { mode: "update", document: JSON.stringify(target) },
      preview = await previewDataModel(deps, fixture.actor, input);
    const saved = await prepareDataModel(deps, requestActor(fixture.actor), {
      ...input,
      preview_fingerprint: preview.fingerprint,
    });
    const conversions = target.entity_types.filter((t) => ids.includes(t.schema["x-type-id"])).map((t) => ({
      type_ref: t.ref,
      migration: { rules: [{ op: "convert", key: "prop_2", to: "integer" }], overrides: [] },
    }));
    await analyzeDataModel(deps, requestActor(fixture.actor), saved.id, {
      expected_version: saved.version,
      conversions,
    });
    if (analyzeOnly) return { fixture, id: saved.id, before, entities, entityDeps, ids, target };
    for (let step = 0; step < 10; step++) {
      const [result] = await worker`select app.claim_entity_schema_analysis() as batch`;
      if (!result.batch) break;
      const b = result.batch, convert = compileMigration(b.target, b.migration, b.recovery_keys);
      const rows = b.rows.map((
        r: { entity_id: string; properties: Record<string, unknown>; recovery_properties?: Record<string, unknown> },
      ) => convert(r.entity_id, r.properties, r.recovery_properties));
      await worker`select app.complete_entity_schema_analysis_batch(${b.id},${b.fence},${worker.json(rows)})`;
    }
    const ready = await getDataModelChange(deps, fixture.actor, saved.id);
    assertEquals(ready.status, "ready");
    await applyDataModel(deps, requestActor(fixture.actor), saved.id, { expected_version: ready.version });
    return { fixture, id: saved.id, before, entities, entityDeps, ids, target };
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
}
async function prepareUntilCommit(id: string) {
  for (let step = 0; step < 20; step++) {
    const [r] = await worker`select app.claim_data_model_conversion() as batch`;
    assertEquals(r.batch?.id, id);
    const b = r.batch;
    if (b.status === "committing") return b;
    const result = await prepareMigrationBatch(b.child, new Date());
    assertEquals(result.stale, false);
    const [stage] =
      await worker`select app.stage_data_model_conversion(${b.id},${b.fence},${b.child.id},${b.child.fence},${
        worker.json(result.results)
      }) as accepted`;
    assertEquals(stage.accepted, true);
  }
  throw Error("group did not become ready to commit");
}
dbTest(
  "a late model identity publication failure rolls back every converted value, schema, record and index intent",
  async () => {
    const f = await queuedGroup();
    try {
      const batch = await prepareUntilCommit(f.id);
      const rows =
        await admin`select r.record_id from private.entity_schema_migration_rows r join app.entity_schema_migrations j on j.owner_id=r.owner_id and j.id=r.job_id where j.owner_id=${f.fixture.actor.userId}::uuid and j.model_change_id=${f.id}::uuid and r.record_id is not null`;
      const recordIds = rows.map((r) => String(r.record_id));
      // Fault injection changes only this test-owned frozen target after acceptance.
      await admin`update app.data_model_changes set plan=jsonb_set(plan,'{target,entity_types,0,identity,label}','""'::jsonb) where owner_id=${f.fixture.actor.userId}::uuid and id=${f.id}::uuid`;
      const [result] =
        await worker`select app.commit_data_model_conversion(${batch.id},${batch.fence},${SEARCH_PIPELINE}) as committed`;
      assertEquals(result.committed, false);
      const failed = await getDataModelChange(deps, f.fixture.actor, f.id);
      assertEquals(failed.status, "failed");
      assertEquals(failed.result, null);
      assertEquals(failed.group?.retryable, false);
      assertEquals(await exportDataModel(deps, f.fixture.actor), f.before);
      for (const e of f.entities) {
        assertEquals(
          (await getEntity(f.entityDeps, f.fixture.actor, e.id)).properties,
          e.properties,
        );
      }
      const [remaining] =
        await admin`select (select count(*)::int from app.records where owner_id=${f.fixture.actor.userId}::uuid and id=any(${recordIds}::text[])) as records,(select count(*)::int from app.search_index_state where owner_id=${f.fixture.actor.userId}::uuid and id=any(${recordIds}::text[])) as indexes,(select count(*)::int from pgmq.q_search_index where message->>'owner_id'=${f.fixture.actor.userId} and message->>'id'=any(${recordIds}::text[])) as queue`;
      assertEquals(remaining, { records: 0, indexes: 0, queue: 0 });
    } finally {
      await f.fixture.cleanup();
    }
  },
);
dbTest(
  "whole model cancellation invalidates an in-flight child and removes preparation material together",
  async () => {
    const f = await queuedGroup();
    try {
      const [claimed] = await worker`select app.claim_data_model_conversion() as batch`, batch = claimed.batch;
      const prepared = await prepareMigrationBatch(batch.child, new Date());
      const current = await getDataModelChange(deps, f.fixture.actor, f.id);
      const cancelled = await changeDataModelGroup(deps, requestActor(f.fixture.actor), f.id, {
        expected_version: current.version,
      }, "cancel");
      assertEquals(cancelled.status, "cancelled");
      const [old] =
        await worker`select app.stage_data_model_conversion(${batch.id},${batch.fence},${batch.child.id},${batch.child.fence},${
          worker.json(prepared.results)
        }) as accepted`;
      assertEquals(old.accepted, false);
      assertEquals(await exportDataModel(deps, f.fixture.actor), f.before);
      const [material] =
        await admin`select count(*)::int as n from private.entity_schema_migration_rows r join app.entity_schema_migrations j on j.owner_id=r.owner_id and j.id=r.job_id where j.owner_id=${f.fixture.actor.userId}::uuid and j.model_change_id=${f.id}::uuid`;
      assertEquals(material.n, 0);
    } finally {
      await f.fixture.cleanup();
    }
  },
);
dbTest("a temporary whole model failure retries the same frozen child jobs without duplicate publication", async () => {
  const f = await queuedGroup();
  try {
    const old = (await getDataModelChange(deps, f.fixture.actor, f.id)).group!.children.map((c) => c.job!.id);
    const [claimed] = await worker`select app.claim_data_model_conversion() as batch`, batch = claimed.batch;
    const [failure] =
      await worker`select app.fail_data_model_conversion(${batch.id},${batch.fence},${batch.child.id},${batch.child.fence},'migration_worker_failed',true) as accepted`;
    assertEquals(failure.accepted, true);
    const failed = await getDataModelChange(deps, f.fixture.actor, f.id);
    assertEquals(failed.status, "failed");
    assertEquals(failed.group?.retryable, true);
    const resumed = await changeDataModelGroup(deps, requestActor(f.fixture.actor), f.id, {
      expected_version: failed.version,
    }, "retry");
    assertEquals(resumed.status, "queued");
    assertEquals((await getDataModelChange(deps, f.fixture.actor, f.id)).group!.children.map((c) => c.job!.id), old);
    const ready = await prepareUntilCommit(f.id);
    const [result] =
      await worker`select app.commit_data_model_conversion(${ready.id},${ready.fence},${SEARCH_PIPELINE}) as committed`;
    assertEquals(result.committed, true);
    const done = await getDataModelChange(deps, f.fixture.actor, f.id);
    assertEquals(done.status, "applied");
    for (const child of done.group!.children) assertEquals(child.job?.result?.schema_version, 2);
  } finally {
    await f.fixture.cleanup();
  }
});
dbTest("expired parent and child leases reject old stage/fail before a fenced reclaim can resume", async () => {
  const f = await queuedGroup();
  try {
    const [first] = await worker`select app.claim_data_model_conversion() as batch`, old = first.batch;
    const prepared = await prepareMigrationBatch(old.child, new Date());
    await admin.begin(async (tx) => {
      await tx`update app.data_model_changes set lease_until=now()-interval '1 second' where owner_id=${f.fixture.actor.userId}::uuid and id=${f.id}::uuid`;
      await tx`update app.entity_schema_migrations set lease_until=now()-interval '1 second' where owner_id=${f.fixture.actor.userId}::uuid and id=${old.child.id}::uuid`;
    });
    const [expired] =
      await worker`select app.stage_data_model_conversion(${old.id},${old.fence},${old.child.id},${old.child.fence},${
        worker.json(prepared.results)
      }) as accepted`;
    assertEquals(expired.accepted, false);
    const [failed] =
      await worker`select app.fail_data_model_conversion(${old.id},${old.fence},${old.child.id},${old.child.fence},'migration_worker_failed',true) as accepted`;
    assertEquals(failed.accepted, false);
    const [second] = await worker`select app.claim_data_model_conversion() as batch`, fresh = second.batch;
    assertEquals(Number(fresh.fence) > Number(old.fence), true);
    assertEquals(Number(fresh.child.fence) > Number(old.child.fence), true);
    const [stale] =
      await worker`select app.stage_data_model_conversion(${old.id},${old.fence},${old.child.id},${old.child.fence},${
        worker.json(prepared.results)
      }) as accepted`;
    assertEquals(stale.accepted, false);
    const next = await prepareMigrationBatch(fresh.child, new Date());
    await worker`select app.stage_data_model_conversion(${fresh.id},${fresh.fence},${fresh.child.id},${fresh.child.fence},${
      worker.json(next.results)
    })`;
    const commit = await prepareUntilCommit(f.id);
    const [result] =
      await worker`select app.commit_data_model_conversion(${commit.id},${commit.fence},${SEARCH_PIPELINE}) as committed`;
    assertEquals(result.committed, true);
  } finally {
    await f.fixture.cleanup();
  }
});
dbTest(
  "compatible target template changes stale the entire queued model even when conversion child templates stay unchanged",
  async () => {
    const f = await queuedGroup();
    try {
      const other = f.target.entity_types.find((t) => !f.ids.includes(t.schema["x-type-id"]))!;
      const batch = await prepareUntilCommit(f.id);
      const settings = {
        entity_types: { [other.schema["x-type-id"]]: { update: { memo: "바뀐 템플릿 $대상$ $액션$", tag_ids: [] } } },
      };
      await admin`insert into app.user_business_settings(owner_id,id,version,settings) values(${f.fixture.actor.userId}::uuid,'record_templates',1,${
        admin.json(settings)
      }) on conflict(owner_id,id) do update set settings=excluded.settings,version=app.user_business_settings.version+1`;
      const [result] =
        await worker`select app.commit_data_model_conversion(${batch.id},${batch.fence},${SEARCH_PIPELINE}) as committed`;
      assertEquals(result.committed, false);
      const state = await getDataModelChange(deps, f.fixture.actor, f.id);
      assertEquals(state.status, "failed");
      assertEquals(state.group?.failure_reason, "schema_plan_stale");
      assertEquals(await exportDataModel(deps, f.fixture.actor), f.before);
    } finally {
      await f.fixture.cleanup();
    }
  },
);

dbTest(
  "whole model account deletion cascades durable children without touching another owner's queued group",
  async () => {
    const removed = await queuedGroup(), retained = await queuedGroup();
    try {
      const before = await getDataModelChange(deps, retained.fixture.actor, retained.id);
      await removed.fixture.cleanup();
      const [rows] =
        await admin`select (select count(*)::int from app.data_model_children where owner_id=${removed.fixture.actor.userId}::uuid) as children,(select count(*)::int from app.entity_schema_migrations where owner_id=${removed.fixture.actor.userId}::uuid) as jobs,(select count(*)::int from app.data_model_changes where owner_id=${removed.fixture.actor.userId}::uuid) as models`;
      assertEquals(rows, { children: 0, jobs: 0, models: 0 });
      assertEquals(await getDataModelChange(deps, retained.fixture.actor, retained.id), before);
    } finally {
      await removed.fixture.cleanup();
      await retained.fixture.cleanup();
    }
  },
);

dbTest(
  "expired group analysis material returns its parent to review without expiring another owner's analysis",
  async () => {
    const expired = await queuedGroup(true), fresh = await queuedGroup(true);
    try {
      const freshBefore = await getDataModelChange(deps, fresh.fixture.actor, fresh.id);
      await admin`update app.entity_schema_analyses set created_at=now()-interval '31 days' where owner_id=${expired.fixture.actor.userId}::uuid and change_id in(select change_id from app.data_model_children where owner_id=${expired.fixture.actor.userId}::uuid and model_id=${expired.id}::uuid)`;
      await worker`select app.claim_entity_schema_migration()`;
      const current = await getDataModelChange(deps, expired.fixture.actor, expired.id);
      assertEquals(current.status, "needs_conversion");
      assertEquals(current.review.can_apply, false);
      assertEquals(current.group?.children.every((child) => child.change.analysis === null), true);
      const [rows] =
        await admin`select count(*)::int as count from private.entity_schema_analysis_rows r join app.data_model_children c on c.owner_id=r.owner_id and c.analysis_id=r.analysis_id where c.owner_id=${expired.fixture.actor.userId}::uuid and c.model_id=${expired.id}::uuid`;
      assertEquals(rows.count, 0);
      assertEquals(await getDataModelChange(deps, fresh.fixture.actor, fresh.id), freshBefore);
      assertEquals(await exportDataModel(deps, expired.fixture.actor), expired.before);
    } finally {
      await expired.fixture.cleanup();
      await fresh.fixture.cleanup();
    }
  },
);
