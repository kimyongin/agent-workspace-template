import { assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { getEntitySchema } from "../../functions/_shared/core/entity-types/application.ts";

dbTest("direct SQL cannot publish a read-only selected identifier even for an empty type", async () => {
  const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 2, prepare: false });
  const fixture = await businessWorkspaceFixture(admin, sql);
  try {
    const type = await fixture.createKind("읽기 전용 식별자 거절");
    await fixture.grantKind(fixture.manager, type.id, "write");
    const current = await getEntitySchema({ uow: new SqlEntityTypeUnitOfWork(sql) }, fixture.manager, {
      type_id: type.id,
    });
    const document = structuredClone(current.schema);
    document["x-version"] = 2;
    document.properties.prop_2.readOnly = true;
    await assertRejects(() =>
      admin.begin(async (tx) => {
        await tx`select set_config('request.workspace_id',${fixture.workspaceId},true)`;
        await tx`insert into app.entity_schema_versions(workspace_id,schema) values(${fixture.workspaceId},${
          tx.json(document)
        })`;
      })
    );
    assertEquals(
      (await getEntitySchema({ uow: new SqlEntityTypeUnitOfWork(sql) }, businessRequest(fixture.manager), {
        type_id: type.id,
      })).schema_version,
      1,
    );
  } finally {
    await fixture.cleanup();
    await sql.end();
    await admin.end();
  }
});

import * as registry from "../../functions/_shared/core/entity-issuers/application.ts";
import { SqlEntityIssuerUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import * as changes from "../../functions/_shared/core/entity-types/schema-changes.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
const appKind = "00000000-0000-4000-8000-000000000001";

dbTest("a target-only identifier kind changing after empty analysis invalidates publication", async () => {
  const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 2, prepare: false });
  const fixture = await businessWorkspaceFixture(admin, sql);
  const deps = { uow: new SqlEntityTypeUnitOfWork(sql) }, issuers = { uow: new SqlEntityIssuerUnitOfWork(sql) };
  try {
    const type = await fixture.createKind("종류 경쟁 분석");
    await fixture.grantKind(fixture.manager, type.id, "write");
    const actor = () => businessRequest(fixture.manager);
    await registry.createEntityIssuer(issuers, actor(), { code: "external", label: "외부" });
    const kind = await registry.createIdentifierRule(issuers, actor(), "external", { label: "번호", meaning: "번호" });
    const change = await changes.createEntitySchemaChange(deps, actor(), type.id, {
      expected_schema_version: 1,
      edits: [{
        op: "add_property",
        client_ref: "number",
        field: {
          type: ["string", "null"],
          title: "외부 번호",
          "x-order": 30,
          "x-identifier": { allowed_kind_ids: [appKind, kind.id], default_kind_id: appKind },
        },
      }],
    });
    const accepted = await changes.analyzeEntitySchemaChange(deps, actor(), type.id, change.id, {
      expected_change_version: change.version,
    });
    await registry.updateIdentifierRule(issuers, actor(), kind.id, {
      label: "새 번호",
      expected_version: kind.version,
    });
    const error = await assertRejects(
      () =>
        changes.applyEntitySchemaChange(deps, actor(), type.id, change.id, {
          expected_change_version: change.version,
          analysis_id: accepted.analysis_id,
        }),
      AppError,
    );
    assertEquals(error.code, "schema_plan_stale");
    assertEquals((await getEntitySchema(deps, fixture.manager, { type_id: type.id })).schema_version, 1);
  } finally {
    await fixture.cleanup();
    await sql.end();
    await admin.end();
  }
});

import type postgres from "postgres";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as migrations from "../../functions/_shared/core/entity-types/schema-migrations.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { prepareMigrationBatch } from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";

async function evolutionHarness() {
  const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 3, prepare: false });
  const workerUrl = new URL(urls.admin);
  workerUrl.username = "app_worker";
  workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
  const worker = connect(workerUrl.href, { max: 1, prepare: false });
  const f = await businessWorkspaceFixture(admin, sql),
    d = { uow: new SqlEntityTypeUnitOfWork(sql) },
    e = { uow: new SqlEntityUnitOfWork(sql) },
    r = { uow: new SqlEntityIssuerUnitOfWork(sql) };
  const actor = () => businessRequest(f.manager);
  const type = await f.createKind("식별자 변경 경계");
  await f.grantKind(f.manager, type.id, "write");
  async function analyze(change: Awaited<ReturnType<typeof changes.createEntitySchemaChange>>) {
    const accepted = await changes.analyzeEntitySchemaChange(d, actor(), type.id, change.id, {
      expected_change_version: change.version,
    });
    for (let i = 0; i < 20; i++) {
      const [row] = await worker`select app.claim_entity_schema_analysis() as batch`;
      const batch = row.batch;
      if (!batch) break;
      const convert = compileMigration(batch.target, batch.migration, batch.recovery_keys);
      await worker`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${
        worker.json(
          batch.rows.map((
            row: {
              entity_id: string;
              properties: Record<string, unknown>;
              recovery_properties?: Record<string, unknown>;
            },
          ) => convert(row.entity_id, row.properties, row.recovery_properties)),
        )
      })`;
    }
    return { accepted, change: await changes.getEntitySchemaChange(d, f.manager, type.id, change.id) };
  }
  async function apply(change: Awaited<ReturnType<typeof changes.createEntitySchemaChange>>) {
    const ready = await analyze(change);
    return changes.applyEntitySchemaChange(d, actor(), type.id, change.id, {
      expected_change_version: ready.change.version,
      analysis_id: ready.accepted.analysis_id,
    });
  }
  async function start(change: Awaited<ReturnType<typeof changes.createEntitySchemaChange>>) {
    const ready = await analyze(change);
    return migrations.startEntitySchemaMigration(d, actor(), type.id, change.id, {
      expected_schema_version: ready.change.source_schema_version,
      expected_change_version: ready.change.version,
      analysis_id: ready.accepted.analysis_id,
      fingerprint: ready.change.fingerprint,
    });
  }
  async function stageToCommit(id: string) {
    for (let i = 0; i < 20; i++) {
      const [row] = await worker`select app.claim_entity_schema_migration() as batch`;
      const batch = row.batch;
      assertEquals(batch.id, id);
      if (batch.status === "committing") return batch;
      const prepared = await prepareMigrationBatch(batch, new Date());
      assertEquals(prepared.stale, false);
      await worker`select app.stage_entity_schema_migration(${batch.id},${batch.fence},${
        worker.json(prepared.results)
      })`;
    }
    throw Error("worker batch budget exceeded");
  }
  const commit = (batch: { id: string; fence: number; source_template_fingerprint: string }) =>
    worker`select app.commit_entity_schema_migration(${batch.id},${batch.fence},${batch.source_template_fingerprint},${SEARCH_PIPELINE}) as committed`;
  return {
    admin,
    sql,
    worker,
    f,
    d,
    e,
    r,
    actor,
    type,
    analyze,
    apply,
    start,
    stageToCommit,
    commit,
    close: async () => {
      await f.cleanup();
      await worker.end();
      await sql.end();
      await admin.end();
    },
  };
}

dbTest("registry competition after worker staging rolls back every row and schema publication", async () => {
  const h = await evolutionHarness();
  try {
    await registry.createEntityIssuer(h.r, h.actor(), { code: "external", label: "외부" });
    const kind = await registry.createIdentifierRule(h.r, h.actor(), "external", {
      label: "번호",
      meaning: "원본 번호",
    });
    await h.apply(
      await changes.createEntitySchemaChange(h.d, h.actor(), h.type.id, {
        expected_schema_version: 1,
        edits: [{
          op: "add_property",
          client_ref: "external",
          field: {
            type: "string",
            "x-order": 30,
            "x-identifier": { allowed_kind_ids: [kind.id], default_kind_id: kind.id },
          },
        }],
      }),
    );
    const rows = [];
    for (const title of ["one", "two"]) {
      rows.push(
        await entities.createEntity(h.e, h.actor(), {
          entity_type_id: h.type.id,
          schema_version: 2,
          properties: { prop_1: title, prop_3: `${kind.id}:001` },
        }),
      );
    }
    const change = await changes.createEntitySchemaChange(h.d, h.actor(), h.type.id, {
      expected_schema_version: 2,
      edits: [{ op: "set_metadata", description: "번호 변환" }],
      migration: { rules: [{ op: "map", key: "prop_3", mapping: { [`${kind.id}:001`]: `${kind.id}:002` } }] },
    });
    const job = await h.start(change), batch = await h.stageToCommit(job.job_id);
    await registry.updateIdentifierRule(h.r, h.actor(), kind.id, {
      label: "다른 이름",
      expected_version: kind.version,
    });
    assertEquals((await h.commit(batch))[0].committed, false);
    for (const row of rows) {
      assertEquals((await entities.getEntity(h.e, h.f.manager, row.id)).properties, row.properties);
    }
    assertEquals((await getEntitySchema(h.d, h.f.manager, { type_id: h.type.id })).schema_version, 2);
    assertEquals((await migrations.getEntitySchemaMigration(h.d, h.f.manager, job.job_id)).status, "failed");
  } finally {
    await h.close();
  }
});

dbTest("a registry change during analysis makes completion stale without publishing any definition", async () => {
  const h = await evolutionHarness();
  try {
    await registry.createEntityIssuer(h.r, h.actor(), { code: "external", label: "외부" });
    const kind = await registry.createIdentifierRule(h.r, h.actor(), "external", {
      label: "번호",
      meaning: "원본 번호",
    });
    const row = await entities.createEntity(h.e, h.actor(), {
      entity_type_id: h.type.id,
      schema_version: 1,
      properties: { prop_1: "source" },
    });
    const change = await changes.createEntitySchemaChange(h.d, h.actor(), h.type.id, {
      expected_schema_version: 1,
      edits: [{
        op: "add_property",
        client_ref: "external",
        field: {
          type: "string",
          "x-order": 30,
          "x-identifier": { allowed_kind_ids: [kind.id], default_kind_id: kind.id },
        },
      }],
    });
    await changes.analyzeEntitySchemaChange(h.d, h.actor(), h.type.id, change.id, {
      expected_change_version: change.version,
    });
    const [{ batch }] = await h.worker`select app.claim_entity_schema_analysis() as batch`;
    const convert = compileMigration(batch.target, batch.migration),
      results = batch.rows.map((row: { entity_id: string; properties: Record<string, unknown> }) =>
        convert(row.entity_id, row.properties)
      );
    await registry.updateIdentifierRule(h.r, h.actor(), kind.id, {
      label: "다른 이름",
      expected_version: kind.version,
    });
    assertEquals(
      (await h.worker`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${
        h.worker.json(results)
      }) as completed`)[0].completed,
      true,
    );
    const stale = await changes.getEntitySchemaChange(h.d, h.f.manager, h.type.id, change.id);
    assertEquals(stale.status, "stale");
    assertEquals(stale.executable, false);
    assertEquals((await entities.getEntity(h.e, h.f.manager, row.id)).properties, row.properties);
    assertEquals((await getEntitySchema(h.d, h.f.manager, { type_id: h.type.id })).schema_version, 1);
  } finally {
    await h.close();
  }
});

dbTest(
  "empty type may select another required identifier but a tombstone locks that field across publication and restore",
  async () => {
    const h = await evolutionHarness();
    try {
      const initial = await getEntitySchema(h.d, h.f.manager, { type_id: h.type.id });
      assertEquals(initial.identity_change_allowed, true);
      const change = await changes.createEntitySchemaChange(h.d, h.actor(), h.type.id, {
        expected_schema_version: 1,
        edits: [
          {
            op: "add_property",
            client_ref: "sku",
            required: true,
            field: {
              type: "string",
              title: "商品番号",
              "x-order": 30,
              "x-identifier": { allowed_kind_ids: [appKind], default_kind_id: appKind },
            },
          },
          { op: "update_property", key: "prop_2", field: initial.schema.properties.prop_2, required: false },
          { op: "set_metadata", "x-identity-property": "new_sku" },
        ],
      });
      await h.apply(change);
      const row = await entities.createEntity(h.e, h.actor(), {
        entity_type_id: h.type.id,
        schema_version: 2,
        properties: { prop_1: "保管", prop_3: `${appKind}:000A:한글/😀` },
      });
      await entities.deleteEntity(h.e, h.actor(), row.id, row.version);
      assertEquals((await getEntitySchema(h.d, h.f.manager, { type_id: h.type.id })).identity_change_allowed, false);
      const error = await assertRejects(
        () =>
          changes.createEntitySchemaChange(h.d, h.actor(), h.type.id, {
            expected_schema_version: 2,
            edits: [
              { op: "update_property", key: "prop_2", field: initial.schema.properties.prop_2, required: true },
              { op: "set_metadata", "x-identity-property": "prop_2" },
            ],
          }),
        AppError,
      );
      assertEquals(error.code, "invalid_input");
      await assertRejects(() =>
        h.admin.begin(async (tx) => {
          await tx`select set_config('request.workspace_id',${h.f.workspaceId},true)`;
          await tx`update app.entity_types set schema_version=1 where workspace_id=${h.f.workspaceId} and id=${h.type.id}`;
        })
      );
      await assertRejects(() =>
        h.admin`update app.entities set properties=jsonb_set(properties,'{prop_3}',${
          h.admin.json(`${appKind}:different`)
        }) where workspace_id=${h.f.workspaceId} and id=${row.id}`
      );
      const deleted = await entities.getEntity(h.e, h.f.manager, row.id);
      const restored = await entities.restoreEntity(h.e, h.actor(), row.id, {
        schema_version: 2,
        expected_version: deleted.version,
      });
      assertEquals(restored.id, row.id);
      assertEquals(restored.properties.prop_3, `${appKind}:000A:한글/😀`);
      assertEquals(restored.properties.prop_2, undefined);
    } finally {
      await h.close();
    }
  },
);

dbTest(
  "ordinary identifier fill map override and retained recovery preserve selected pairs across live and deleted rows",
  async () => {
    const h = await evolutionHarness();
    try {
      const rows = [];
      for (const name of ["live", "deleted"]) {
        rows.push(
          await entities.createEntity(h.e, h.actor(), {
            entity_type_id: h.type.id,
            schema_version: 1,
            properties: { prop_1: name },
          }),
        );
      }
      await entities.deleteEntity(h.e, h.actor(), rows[1].id, rows[1].version);
      const add = await changes.createEntitySchemaChange(h.d, h.actor(), h.type.id, {
        expected_schema_version: 1,
        edits: [{
          op: "add_property",
          client_ref: "ordinary",
          required: true,
          field: {
            type: "string",
            "x-order": 30,
            "x-identifier": { allowed_kind_ids: [appKind], default_kind_id: appKind },
          },
        }],
        migration: { rules: [{ op: "fill", key: "new_ordinary", value: `${appKind}:000A:한글/😀` }] },
      });
      const fill = await h.start(add);
      assertEquals((await h.commit(await h.stageToCommit(fill.job_id)))[0].committed, true);
      for (const row of rows) {
        const current = await entities.getEntity(h.e, h.f.manager, row.id);
        assertEquals(current.properties.prop_2, row.properties.prop_2);
        assertEquals(current.properties.prop_3, `${appKind}:000A:한글/😀`);
      }
      const map = await changes.createEntitySchemaChange(h.d, h.actor(), h.type.id, {
        expected_schema_version: 2,
        edits: [{ op: "set_metadata", description: "명시적 쌍 변환" }],
        migration: {
          rules: [{ op: "map", key: "prop_3", mapping: { [`${appKind}:000A:한글/😀`]: `${appKind}:mapped` } }],
          overrides: [{ entity_id: rows[1].id, key: "prop_3", value: `${appKind}:override` }],
        },
      });
      const ready = await h.analyze(map),
        request = h.actor(),
        input = {
          expected_schema_version: 2,
          expected_change_version: ready.change.version,
          analysis_id: ready.accepted.analysis_id,
          fingerprint: ready.change.fingerprint,
        };
      const accepted = await migrations.startEntitySchemaMigration(h.d, request, h.type.id, map.id, input);
      assertEquals((await h.commit(await h.stageToCommit(accepted.job_id)))[0].committed, true);
      assertEquals((await entities.getEntity(h.e, h.f.manager, rows[0].id)).properties.prop_3, `${appKind}:mapped`);
      assertEquals((await entities.getEntity(h.e, h.f.manager, rows[1].id)).properties.prop_3, `${appKind}:override`);
      const done = await migrations.getEntitySchemaMigration(h.d, h.f.manager, accepted.job_id);
      const recovery = await migrations.createEntitySchemaRecovery(h.d, h.actor(), done.id, {
        expected_job_version: done.version,
        expected_schema_version: 3,
      });
      const restored = await h.start(recovery);
      assertEquals((await h.commit(await h.stageToCommit(restored.job_id)))[0].committed, true);
      for (const row of rows) {
        const current = await entities.getEntity(h.e, h.f.manager, row.id);
        assertEquals(current.properties.prop_2, row.properties.prop_2);
        assertEquals(current.properties.prop_3, `${appKind}:000A:한글/😀`);
      }
      assertEquals(await migrations.startEntitySchemaMigration(h.d, request, h.type.id, map.id, input), accepted);
      await h
        .admin`update app.entity_schema_migrations set source_expires_at=now()-interval '1 second' where workspace_id=${h.f.workspaceId} and id=${done.id}`;
      const expired = await assertRejects(
        () =>
          migrations.createEntitySchemaRecovery(h.d, h.actor(), done.id, {
            expected_job_version: done.version,
            expected_schema_version: 4,
          }),
        AppError,
      );
      assertEquals(expired.code, "migration_source_expired");
      assertEquals(
        (await getEntitySchema(h.d, h.f.manager, { type_id: h.type.id, schema_version: 2 }))
          .schema["x-identity-property"],
        "prop_2",
      );
    } finally {
      await h.close();
    }
  },
);
