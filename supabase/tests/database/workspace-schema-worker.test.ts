import { APP_IDENTIFIER_RULE_ID } from "../../functions/_shared/contracts/entity-issuer.ts";
import * as migrations from "../../functions/_shared/core/entity-types/schema-migrations.ts";
import { SqlBusinessSettingsUnitOfWork } from "../../functions/_shared/adapters/supabase/business-settings-store.ts";
import * as settings from "../../functions/_shared/core/settings/application.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import * as workspaces from "../../functions/_shared/core/workspaces/application.ts";
import * as types from "../../functions/_shared/core/entity-types/application.ts";
import * as changes from "../../functions/_shared/core/entity-types/schema-changes.ts";
import { SqlWorkspaceUnitOfWork } from "../../functions/_shared/adapters/supabase/workspace-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 2, prepare: false });
const workerUrl = new URL(urls.admin);
workerUrl.username = "app_worker";
workerUrl.password = Deno.env.get("APP_WORKER_PASSWORD")!;
const worker = connect(workerUrl.toString(), { max: 1 });
const workspaceDeps = { uow: new SqlWorkspaceUnitOfWork(sql) };
const typeDeps = { uow: new SqlEntityTypeUnitOfWork(sql) };
const key = (actor: Actor): Actor => ({ ...actor, request: { key: crypto.randomUUID() } });

async function searchSnapshot(workspaceId: string) {
  return {
    state: await admin`select * from app.search_index_state where workspace_id=${workspaceId} order by kind,id`,
    chunks:
      await admin`select to_jsonb(c) as row from app.search_chunks c where workspace_id=${workspaceId} order by to_jsonb(c)::text`,
    queue: await admin`select * from pgmq.q_search_index where message->>'workspace_id'=${workspaceId} order by msg_id`,
  };
}

dbTest("shared schema analysis captures the actual initiator and immutable workspace generation", async () => {
  const a = { userId: crypto.randomUUID() }, b = { userId: crypto.randomUUID() };
  let workspaceId: string | undefined;
  let otherWorkspaceId: string | undefined;
  for (const actor of [a, b]) {
    const email = `worker513-${actor.userId}@example.test`;
    await admin`insert into auth.users(id,email) values(${actor.userId},${email})`;
    await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data)
      values(${crypto.randomUUID()},${actor.userId},'google',${actor.userId},${
      admin.json({ sub: actor.userId, email, email_verified: true })
    })`;
  }
  try {
    workspaceId = (await workspaces.createWorkspace(workspaceDeps, key(a), { name: "공유 분석" })).workspace.id;
    const author = { ...a, workspaceId }, executor = { ...b, workspaceId };
    const type = await types.createEntityType(typeDeps, key(author), { label: "분석 대상" });
    const invitation = await workspaces.inviteWorkspaceMember(workspaceDeps, key(a), workspaceId, {
      email: `worker513-${b.userId}@example.test`,
      grants: [
        { target_kind: "settings", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: type.id, access: "write" },
      ],
    });
    await workspaces.acceptWorkspaceInvitation(workspaceDeps, key(b), invitation.invitation.id);
    const draft = await changes.createEntitySchemaChange(typeDeps, key(executor), type.id, {
      expected_schema_version: 1,
      edits: [{ op: "set_metadata", description: "공유 실행자의 분석" }],
      migration: { rules: [], overrides: [] },
    });
    const accepted = await changes.analyzeEntitySchemaChange(typeDeps, key(executor), type.id, draft.id, {
      expected_change_version: draft.version,
    });
    const [analysis] = await admin`select workspace_id,owner_id,initiated_by,workspace_generation
      from app.entity_schema_analyses where id=${accepted.analysis_id}`;
    const [workspace] = await admin`select lifecycle_generation from app.workspaces where id=${workspaceId}`;
    assertEquals(analysis.workspace_id, workspaceId);
    assertEquals(analysis.owner_id, null);
    assertEquals(analysis.initiated_by, b.userId);
    assertEquals(Number(analysis.workspace_generation), Number(workspace.lifecycle_generation));
    assertEquals(accepted.status, "queued");
    otherWorkspaceId =
      (await workspaces.createWorkspace(workspaceDeps, key(a), { name: "다른 분석 공간" })).workspace.id;
    const other = { ...a, workspaceId: otherWorkspaceId };
    const otherType = await types.createEntityType(typeDeps, key(other), { label: "분석 대상" });
    assertEquals(
      (await assertRejects(() => changes.getEntitySchemaChange(typeDeps, other, type.id, draft.id), AppError)).code,
      "not_found",
    );
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), otherWorkspaceId, a.userId, {
      expected_version: 1,
      grants: [
        { target_kind: "settings", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: otherType.id, access: "write" },
      ],
    });
    assertEquals(
      (await assertRejects(() =>
        changes.analyzeEntitySchemaChange(typeDeps, key(other), otherType.id, draft.id, {
          expected_change_version: draft.version,
        }), AppError)).code,
      "not_found",
    );

    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, a.userId, {
      expected_version: 1,
      grants: [
        { target_kind: "settings", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: type.id, access: "write" },
      ],
    });
    const externalId = crypto.randomUUID(), entityId = `${type.id}:${APP_IDENTIFIER_RULE_ID}:${externalId}`;
    await runInWorkspace(sql, author, {
      mode: "business",
      requirements: [{ target_kind: "entity_type", target_id: type.id, access: "write" }],
    }, (tx) =>
      tx`insert into app.entities(workspace_id,id,entity_type_id,schema_version,properties)
      values(${author.workspaceId},${entityId},${type.id},1,${
        tx.json({ prop_1: "A가 작성한 공유 원본", prop_2: `${APP_IDENTIFIER_RULE_ID}:${externalId}` })
      })`);
    const nextDraft = await changes.createEntitySchemaChange(typeDeps, key(executor), type.id, {
      expected_schema_version: 1,
      edits: [{ op: "set_metadata", description: "실제 공유 자료 분석" }],
      migration: { rules: [], overrides: [] },
    });
    const next = await changes.analyzeEntitySchemaChange(typeDeps, key(executor), type.id, nextDraft.id, {
      expected_change_version: nextDraft.version,
    });
    const [claimed] = await worker`select app.claim_entity_schema_analysis() as batch`;
    assertEquals(claimed.batch?.id, next.analysis_id);
    assertEquals(
      claimed.batch.rows.map((r: { entity_id: string; properties: unknown }) => ({
        entity_id: r.entity_id,
        properties: r.properties,
      })),
      [{
        entity_id: entityId,
        properties: { prop_1: "A가 작성한 공유 원본", prop_2: `${APP_IDENTIFIER_RULE_ID}:${externalId}` },
      }],
    );
    const convert = compileMigration(claimed.batch.target, claimed.batch.migration, claimed.batch.recovery_keys);
    const results = claimed.batch.rows.map((r: { entity_id: string; properties: Record<string, unknown> }) =>
      convert(r.entity_id, r.properties)
    );
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, b.userId, {
      expected_version: 1,
      grants: [{ target_kind: "settings", target_id: "*", access: "write" }],
    });
    const [revoked] =
      await worker`select app.complete_entity_schema_analysis_batch(${next.analysis_id},${claimed.batch.fence},${
        worker.json(results)
      }) as accepted`;
    assertEquals(revoked.accepted, false);
    const [denied] = await worker`select app.claim_entity_schema_analysis() as batch`;
    assertEquals(denied.batch, null);
    assertEquals(
      (await assertRejects(() => changes.getEntitySchemaChange(typeDeps, executor, type.id, nextDraft.id), AppError))
        .code,
      "forbidden",
    );
    // Expire the original lease to make this a real reclaim attempt after revocation.
    await admin`update app.entity_schema_analyses set lease_until=clock_timestamp()-interval '1 second' where workspace_id=${workspaceId} and id=${next.analysis_id}`;
    assertEquals((await worker`select app.claim_entity_schema_analysis() as batch`)[0].batch, null);
    // Deleting the actual executor retains shared source/history but cannot lend another actor's authority.
    await admin`delete from auth.users where id=${b.userId}`;
    assertEquals((await changes.getEntitySchemaChange(typeDeps, author, type.id, nextDraft.id)).analysis?.total, 1);
    assertEquals((await worker`select app.claim_entity_schema_analysis() as batch`)[0].batch, null);
    const oldGenerationDraft = await changes.createEntitySchemaChange(typeDeps, key(author), type.id, {
      expected_schema_version: 1,
      edits: [{ op: "set_metadata", description: "삭제 전 분석" }],
      migration: { rules: [], overrides: [] },
    });
    await changes.analyzeEntitySchemaChange(typeDeps, key(author), type.id, oldGenerationDraft.id, {
      expected_change_version: oldGenerationDraft.version,
    });
    await workspaces.deleteWorkspace(workspaceDeps, key(a), workspaceId, { expected_generation: 1 });
    await workspaces.restoreWorkspace(workspaceDeps, key(a), workspaceId, { expected_generation: 2 });
    assertEquals((await worker`select app.claim_entity_schema_analysis() as batch`)[0].batch, null);
  } finally {
    if (otherWorkspaceId) await admin`delete from app.workspaces where id=${otherWorkspaceId}`;
    if (workspaceId) await admin`delete from app.workspaces where id=${workspaceId}`;
    for (const actor of [a, b]) await admin`delete from auth.users where id=${actor.userId}`;
  }
});

import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import { SqlDataModelGroupStore } from "../../functions/_shared/adapters/supabase/data-model-group-store.ts";
import {
  applyDataModel,
  exportDataModel,
  getDataModelChange,
  prepareDataModel,
  previewDataModel,
} from "../../functions/_shared/core/data-model/application.ts";
import { analyzeDataModel, changeDataModelGroup } from "../../functions/_shared/core/data-model/groups.ts";
import { prepareMigrationBatch } from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";

const modelDeps = { uow: new SqlDataModelUnitOfWork(sql, SqlDataModelGroupStore) };
async function twoKindPublicationFixture(injectLateFailure: boolean, expireGroup = false) {
  const a = { userId: crypto.randomUUID() }, b = { userId: crypto.randomUUID() };
  let workspaceId: string | undefined;
  for (const actor of [a, b]) {
    const email = `group513-${actor.userId}@example.test`;
    await admin`insert into auth.users(id,email) values(${actor.userId},${email})`;
    await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data)
      values(${crypto.randomUUID()},${actor.userId},'google',${actor.userId},${
      admin.json({ sub: actor.userId, email, email_verified: true })
    })`;
  }
  try {
    workspaceId =
      (await workspaces.createWorkspace(workspaceDeps, key(a), { name: "공유 다중 종류 변환" })).workspace.id;
    const author = { ...a, workspaceId }, executor = { ...b, workspaceId };
    const kinds: Awaited<ReturnType<typeof types.createEntityType>>[] = [];
    for (const label of ["첫 종류", "둘째 종류"]) {
      kinds.push(
        await types.createEntityType(typeDeps, key(author), { label }),
      );
    }
    const grants = [
      { target_kind: "settings", target_id: "*", access: "write" },
      ...kinds.map((kind) => ({ target_kind: "entity_type", target_id: kind.id, access: "write" })),
    ];
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, a.userId, {
      expected_version: 1,
      grants,
    });
    const invitation = await workspaces.inviteWorkspaceMember(workspaceDeps, key(a), workspaceId, {
      email: `group513-${b.userId}@example.test`,
      grants,
    });
    await workspaces.acceptWorkspaceInvitation(workspaceDeps, key(b), invitation.invitation.id);
    const entities: string[] = [];
    for (const [index, kind] of kinds.entries()) {
      const externalId = crypto.randomUUID(), id = `${kind.id}:${APP_IDENTIFIER_RULE_ID}:${externalId}`;
      entities.push(id);
      await runInWorkspace(
        sql,
        author,
        {
          mode: "business",
          requirements: [{ target_kind: "entity_type", target_id: kind.id, access: "write" }],
        },
        (tx) =>
          tx`insert into app.entities(workspace_id,id,entity_type_id,schema_version,properties)
        values(${author.workspaceId},${id},${kind.id},1,${
            tx.json({ prop_1: String(12 + index), prop_2: `${APP_IDENTIFIER_RULE_ID}:${externalId}` })
          })`,
      );
    }
    const tagId = await admin.begin(async (tx) => {
      await tx`select set_config('request.workspace_id',${workspaceId!},true)`;
      return (await tx`insert into app.tags(workspace_id,scope,name) values(${workspaceId!},'record','변환 기록 태그') returning id`)[
        0
      ].id as string;
    });
    await settings.updateBusinessSettings(
      {
        uow: new SqlBusinessSettingsUnitOfWork(sql),
        clock: { now: () => new Date() },
      },
      key(author),
      {
        id: "record_templates",
        expected_version: 0,
        value: {
          entity_types: Object.fromEntries(
            kinds.map((kind) => [kind.id, { update: { memo: "변환 기록", tag_ids: [tagId] } }]),
          ),
        },
      },
    );
    const before = await exportDataModel(modelDeps, executor), target = structuredClone(before);
    for (const kind of target.entity_types) {
      kind.schema.properties.prop_1.maxLength = 1;
    }
    const input = { mode: "update", document: JSON.stringify(target) };
    const preview = await previewDataModel(modelDeps, author, input);
    const saved = await prepareDataModel(modelDeps, key(author), {
      ...input,
      preview_fingerprint: preview.fingerprint,
    });
    assertEquals(saved.status, "needs_conversion");
    assertEquals(
      (await admin`select initiated_by from app.data_model_changes where workspace_id=${workspaceId} and id=${saved.id}`)[
        0
      ].initiated_by,
      a.userId,
    );
    const analyzed = await analyzeDataModel(modelDeps, key(executor), saved.id, {
      expected_version: saved.version,
      conversions: target.entity_types.map((kind) => ({
        type_ref: kind.ref,
        migration: {
          rules: [],
          overrides: [{
            entity_id: entities[kinds.findIndex((k) => k.id === kind.schema["x-type-id"])],
            key: "prop_1",
            value: "X",
          }],
        },
      })),
    });
    assertEquals(analyzed.status, "analyzing");
    for (let step = 0; step < 2; step++) {
      const [claim] = await worker`select app.claim_entity_schema_analysis() as batch`;
      assertEquals(Boolean(claim.batch), true);
      const batch = claim.batch, convert = compileMigration(batch.target, batch.migration, batch.recovery_keys);
      const result = batch.rows.map((r: { entity_id: string; properties: Record<string, unknown> }) =>
        convert(r.entity_id, r.properties)
      );
      const [completed] = await worker`select app.complete_entity_schema_analysis_batch(${batch.id},${batch.fence},${
        worker.json(result)
      }) as accepted`;
      assertEquals(completed.accepted, true);
    }
    const ready = await getDataModelChange(modelDeps, executor, saved.id);
    assertEquals(ready.status, "ready");
    assertEquals(
      (await applyDataModel(modelDeps, key(executor), saved.id, { expected_version: ready.version })).status,
      "queued",
    );
    assertEquals(
      (await admin`select initiated_by from app.data_model_changes where workspace_id=${workspaceId} and id=${saved.id}`)[
        0
      ].initiated_by,
      b.userId,
    );
    // Each barrier proves the authorizer rechecks actors after that lock wait.
    // Privileged fixture substitution isolates the fence from retry API behavior.
    for (const barrier of ["account", "domain"] as const) {
      const blocker = connect(urls.admin, { max: 1 });
      const claimant = connect(urls.admin, { max: 1 });
      let release!: () => void;
      const released = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked!: () => void;
      const lockReady = new Promise<void>((resolve) => {
        locked = resolve;
      });
      let authorization: Promise<{ allowed: boolean }[]> | undefined;
      const held = blocker.begin(async (tx) => {
        if (barrier === "account") {
          await tx`select id from auth.users where id=${b.userId} for update`;
        } else {
          await tx`select pg_advisory_xact_lock(hashtextextended(${workspaceId}::text||':entity-relations',0))`;
        }
        locked();
        await released;
      });
      try {
        await lockReady;
        const [connection] = await claimant`select pg_backend_pid() as pid`;
        authorization = claimant<
          { allowed: boolean }[]
        >`select private.authorize_schema_group(${workspaceId},${saved.id}) as allowed`;
        // Start the lazy query before observing its database lock wait.
        const pending = authorization.then((rows) => rows);
        let waiting = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          const [state] = await admin`select cardinality(pg_blocking_pids(${connection.pid}))>0 as blocked`;
          if (state.blocked) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        assertEquals(waiting, true);
        await admin`update app.data_model_changes set initiated_by=${a.userId} where workspace_id=${workspaceId} and id=${saved.id}`;
        release();
        assertEquals((await pending)[0].allowed, false);
      } finally {
        release();
        await held;
        if (authorization) await authorization;
        await admin`update app.data_model_changes set initiated_by=${b.userId} where workspace_id=${workspaceId} and id=${saved.id}`;
        await Promise.all([blocker.end(), claimant.end()]);
      }
    }
    for (let step = 0; step < 4; step++) {
      const [claim] = await worker`select app.claim_data_model_conversion() as batch`;
      assertEquals(Boolean(claim.batch), true);
      const batch = claim.batch;
      if (batch.status === "committing") {
        if (injectLateFailure) {
          const [collision] = await admin`select r.record_id,r.entity_id,r.record_body from app.data_model_children c
              join private.entity_schema_migration_rows r on r.workspace_id=c.workspace_id and r.job_id=c.job_id
              where c.workspace_id=${workspaceId} and c.model_id=${saved.id} order by c.type_id desc limit 1`;
          await admin.begin(async (tx) => {
            await tx`select set_config('request.workspace_id',${executor.workspaceId},true)`;
            await tx`insert into app.records(workspace_id,owner_id,id,entity_id,created_by,body,record_kind,change_metadata)
              values(${executor.workspaceId},null,${collision.record_id},${collision.entity_id},${b.userId},${collision.record_body},'change',
                ${
              tx.json({
                event_id: collision.record_id,
                target_kind: "entity",
                target_id: collision.entity_id,
                target_title: "의도한 충돌",
                action: "update",
                source: "http",
                before: null,
                after: null,
                path: null,
              })
            })`;
          });
          const searchBefore = await searchSnapshot(workspaceId);
          assertEquals(
            new Set(searchBefore.state.map((row) => `${row.kind}:${row.id}`)),
            new Set(entities.map((id) => `entity:${id}`)),
          );
          assertEquals(searchBefore.chunks.length, 0);
          assertEquals(searchBefore.queue.length, 0);
          await admin.begin(async (tx) => {
            await tx`select private.validate_data_model_group(${executor.workspaceId},${batch.id},${batch.fence})`;
            const error = await assertRejects(() =>
              tx.savepoint(async (nested) => {
                await nested`insert into private.data_model_commit_context(workspace_id,model_id,pid,txid)
                values(${executor.workspaceId},${batch.id},pg_backend_pid(),txid_current())`;
                const jobs =
                  await nested`select j.id,j.fence,j.source_template_fingerprint from app.data_model_children c
                join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id
                where c.workspace_id=${executor.workspaceId} and c.model_id=${batch.id} order by c.type_id`;
                for (const job of jobs) {
                  assertEquals(
                    (await nested`select private.commit_entity_schema_migration(${job.id},${job.fence},${job.source_template_fingerprint},${SEARCH_PIPELINE}) as committed`)[
                      0
                    ].committed,
                    true,
                  );
                }
              })
            );
            assertEquals((error as { code?: string }).code, "23505");
          });
          assertEquals(
            (await worker`select app.commit_data_model_conversion(${batch.id},${batch.fence},${SEARCH_PIPELINE}) as committed`)[
              0
            ].committed,
            false,
          );
          const failed = await getDataModelChange(modelDeps, executor, saved.id);
          assertEquals(failed.status, "failed");
          assertEquals(failed.group!.failure_reason, "group_commit_failed");
          assertEquals(await exportDataModel(modelDeps, executor), before);
          assertEquals(
            (await admin`select properties,schema_version,version from app.entities where workspace_id=${workspaceId} order by entity_type_id`)
              .map((r) => ({
                properties: r.properties,
                schema_version: Number(r.schema_version),
                version: Number(r.version),
              }))
              .sort((l, r) => String(l.properties.prop_1).localeCompare(String(r.properties.prop_1))),
            [
              { properties: { prop_1: "12" }, schema_version: 1, version: 1 },
              { properties: { prop_1: "13" }, schema_version: 1, version: 1 },
            ],
          );
          assertEquals((await admin`select id from app.records where workspace_id=${workspaceId}`).map((r) => r.id), [
            collision.record_id,
          ]);
          assertEquals(
            Number(
              (await admin`select count(*) count from app.record_tags where workspace_id=${workspaceId}`)[0].count,
            ),
            0,
          );
          assertEquals(await searchSnapshot(workspaceId), searchBefore);
          assertEquals(
            Number(
              (await admin`select count(*) count from private.data_model_commit_context where workspace_id=${workspaceId}`)[
                0
              ].count,
            ),
            0,
          );
          assertEquals(
            Number(
              (await admin`select count(*) count from private.schema_job_commit_context where workspace_id=${workspaceId}`)[
                0
              ].count,
            ),
            0,
          );
          const sealed =
            await admin`select j.status,j.retryable,j.source_definition<>'{}'::jsonb retained,r.prepared,r.record_tags
              from app.entity_schema_migrations j join private.entity_schema_migration_rows r on r.workspace_id=j.workspace_id and r.job_id=j.id
              where j.workspace_id=${workspaceId} and j.model_change_id=${saved.id}`;
          assertEquals(sealed.length, 2);
          assertEquals(
            sealed.every((r) =>
              r.status === "failed" && !r.retryable && r.retained && r.prepared && r.record_tags.length === 1
            ),
            true,
          );
          return;
        }
        const [result] =
          await worker`select app.commit_data_model_conversion(${batch.id},${batch.fence},${SEARCH_PIPELINE}) as committed`;
        const diagnostic = result.committed ? null : await admin`select g.id,g.status,g.failure_reason,
            coalesce(jsonb_agg(jsonb_build_object('job_id',j.id,'status',j.status,'failure_reason',j.failure_reason)) filter(where j.id is not null),'[]') children
            from app.data_model_changes g left join app.data_model_children c on c.workspace_id=g.workspace_id and c.model_id=g.id
            left join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id
            where g.workspace_id=${workspaceId} and g.id=${saved.id} group by g.id,g.status,g.failure_reason`;
        assertEquals(result.committed, true, JSON.stringify(diagnostic));
        break;
      }
      const prepared = await prepareMigrationBatch(batch.child, new Date());
      assertEquals(prepared.stale, false);
      const [result] =
        await worker`select app.stage_data_model_conversion(${batch.id},${batch.fence},${batch.child.id},${batch.child.fence},${
          worker.json(prepared.results)
        }) as accepted`;
      assertEquals(result.accepted, true);
      assertEquals(await exportDataModel(modelDeps, executor), before);
    }
    assertEquals((await getDataModelChange(modelDeps, executor, saved.id)).status, "applied");
    await runInWorkspace(sql, executor, {
      mode: "business",
      requirements: kinds.map((kind) => ({ target_kind: "entity_type", target_id: kind.id, access: "read" })),
    }, async (tx) => {
      const values =
        await tx`select id,properties,schema_version from app.entities where workspace_id=${executor.workspaceId} order by id`;
      assertEquals(values.map((r) => ({ properties: r.properties, schema_version: Number(r.schema_version) })), [
        { properties: { prop_1: "X", prop_2: values[0].id.slice(37) }, schema_version: 2 },
        { properties: { prop_1: "X", prop_2: values[1].id.slice(37) }, schema_version: 2 },
      ]);
      const records =
        await tx`select id,version,workspace_id,owner_id,entity_id,entity_ids,entity_context,task_id,created_by from app.records where workspace_id=${executor.workspaceId}`;
      assertEquals(records.length, 2);
      assertEquals(
        new Set(records.map((r) => r.entity_id)),
        new Set(entities),
      );
      for (const row of records) {
        assertEquals(row.workspace_id, workspaceId);
        assertEquals(row.owner_id, null);
        assertEquals(row.task_id, null);
        assertEquals(row.created_by, b.userId);
        assertEquals(row.entity_ids, []);
        assertEquals(row.entity_context, []);
      }
    });
    assertEquals(
      (await admin`select tag_id from app.record_tags where workspace_id=${workspaceId} order by record_id`).map((r) =>
        r.tag_id
      ),
      [tagId, tagId],
    );
    const [epoch] = await admin`select lifecycle_generation from app.workspaces where id=${workspaceId}`;
    const search = await admin`select s.owner_id,s.workspace_id,s.initiated_by,s.workspace_generation,s.source_version,
        s.kind,s.id,s.input_hash,s.pipeline,record.version,q.message
        from app.search_index_state s join app.records record on record.workspace_id=s.workspace_id and record.id=s.id
        join pgmq.q_search_index q on q.msg_id=s.message_id
        where s.workspace_id=${workspaceId} and s.kind='record' order by s.id`;
    assertEquals(search.length, 2);
    for (const state of search) {
      assertEquals(state.owner_id, null);
      assertEquals(state.workspace_id, workspaceId);
      assertEquals(state.initiated_by, b.userId);
      assertEquals(Number(state.workspace_generation), Number(epoch.lifecycle_generation));
      assertEquals(Number(state.source_version), Number(state.version));
      assertEquals(state.message, {
        workspace_id: workspaceId,
        initiated_by: b.userId,
        workspace_generation: Number(epoch.lifecycle_generation),
        source_version: Number(state.version),
        kind: "record",
        id: state.id,
        input_hash: state.input_hash,
        pipeline: SEARCH_PIPELINE,
      });
    }
    if (expireGroup) {
      await workspaces.leaveWorkspace(workspaceDeps, key(b), workspaceId, { expected_version: 1 });
      await admin`update app.data_model_changes set source_expires_at=clock_timestamp()-interval '1 second' where workspace_id=${workspaceId} and id=${saved.id}`;
      await worker`select app.prune_data_model_sources()`;
      const [expired] =
        await admin`select source_templates,source_memberships from app.data_model_changes where workspace_id=${workspaceId} and id=${saved.id}`;
      assertEquals(expired, { source_templates: null, source_memberships: null });
      assertEquals(
        Number(
          (await admin`select count(*) count from private.entity_schema_migration_rows where workspace_id=${workspaceId}`)[
            0
          ].count,
        ),
        2,
      );
    }
  } finally {
    if (workspaceId) {
      await admin`delete from pgmq.q_search_index where message->>'workspace_id'=${workspaceId}`;
      await admin`delete from app.workspaces where id=${workspaceId}`;
    }
    for (const actor of [a, b]) await admin`delete from auth.users where id=${actor.userId}`;
  }
}

dbTest(
  "shared two-kind durable conversion publishes one workspace and one immutable entity parent per record",
  () => twoKindPublicationFixture(false),
);
dbTest(
  "late second-child record failure rolls back the complete durable publication",
  () => twoKindPublicationFixture(true),
);

async function retryOrRestoreFixture(
  scenario:
    | "retry"
    | "restore"
    | "restore_committing"
    | "coordinator"
    | "repair"
    | "recovery"
    | "seal_job"
    | "seal_model"
    | "seal_model_snapshots"
    | "analysis_expiry"
    | "analysis_dependency"
    | "seal_analysis",
) {
  const a = { userId: crypto.randomUUID() }, b = { userId: crypto.randomUUID() };
  let workspaceId: string | undefined;
  for (const actor of [a, b]) {
    const email = `retry513-${actor.userId}@example.test`;
    await admin`insert into auth.users(id,email) values(${actor.userId},${email})`;
    await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data)
      values(${crypto.randomUUID()},${actor.userId},'google',${actor.userId},${
      admin.json({ sub: actor.userId, email, email_verified: true })
    })`;
  }
  try {
    workspaceId = (await workspaces.createWorkspace(workspaceDeps, key(a), { name: "공유 재시도" })).workspace.id;
    const author = { ...a, workspaceId }, executor = { ...b, workspaceId };
    const kind = await types.createEntityType(typeDeps, key(author), { label: "재시도 대상" });
    const grants = [
      { target_kind: "settings", target_id: "*", access: "write" },
      { target_kind: "entity_type", target_id: kind.id, access: "write" },
    ];
    await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, a.userId, {
      expected_version: 1,
      grants,
    });
    const invitation = await workspaces.inviteWorkspaceMember(workspaceDeps, key(a), workspaceId, {
      email: `retry513-${b.userId}@example.test`,
      grants,
    });
    await workspaces.acceptWorkspaceInvitation(workspaceDeps, key(b), invitation.invitation.id);
    const externalId = crypto.randomUUID(), entityId = `${kind.id}:${APP_IDENTIFIER_RULE_ID}:${externalId}`;
    await runInWorkspace(sql, author, {
      mode: "business",
      requirements: [{ target_kind: "entity_type", target_id: kind.id, access: "write" }],
    }, (tx) =>
      tx`insert into app.entities(workspace_id,id,entity_type_id,schema_version,properties)
      values(${author.workspaceId},${entityId},${kind.id},1,${
        tx.json({ prop_1: "12", prop_2: `${APP_IDENTIFIER_RULE_ID}:${externalId}` })
      })`);
    if (scenario === "recovery") {
      type Change = Awaited<ReturnType<typeof changes.createEntitySchemaChange>>;
      const analyze = async (change: Change, actor: Actor) => {
        const accepted = await changes.analyzeEntitySchemaChange(typeDeps, key(actor), kind.id, change.id, {
          expected_change_version: change.version,
        });
        const [claim] = await worker`select app.claim_entity_schema_analysis() as batch`;
        assertEquals(claim.batch.id, accepted.analysis_id);
        const convert = compileMigration(claim.batch.target, claim.batch.migration, claim.batch.recovery_keys);
        assertEquals(
          (await worker`select app.complete_entity_schema_analysis_batch(${claim.batch.id},${claim.batch.fence},${
            worker.json(
              claim.batch.rows.map((
                r: {
                  entity_id: string;
                  properties: Record<string, unknown>;
                  recovery_properties?: Record<string, unknown>;
                },
              ) => convert(r.entity_id, r.properties, r.recovery_properties)),
            )
          }) as accepted`)[0].accepted,
          true,
        );
        return changes.getEntitySchemaChange(typeDeps, actor, kind.id, change.id);
      };
      const activate = (change: Change, actor: Actor = executor) =>
        migrations.startEntitySchemaMigration(typeDeps, key(actor), kind.id, change.id, {
          expected_change_version: change.version,
          expected_schema_version: change.source_schema_version,
          analysis_id: change.analysis!.id,
          fingerprint: change.fingerprint,
        });
      const execute = async (id: string, userId: string = b.userId) => {
        for (let step = 0; step < 3; step++) {
          const [claim] = await worker`select app.claim_entity_schema_migration() as batch`;
          assertEquals(claim.batch.id, id);
          assertEquals(claim.batch.initiated_by, userId);
          if (claim.batch.status === "committing") {
            assertEquals(
              (await worker`select app.commit_entity_schema_migration(${id},${claim.batch.fence},${claim.batch.source_template_fingerprint},${SEARCH_PIPELINE}) as committed`)[
                0
              ].committed,
              true,
            );
            return;
          }
          const prepared = await prepareMigrationBatch(claim.batch, new Date());
          assertEquals(
            (await worker`select app.stage_entity_schema_migration(${id},${claim.batch.fence},${
              worker.json(prepared.results)
            }) as accepted`)[0].accepted,
            true,
          );
        }
        throw new Error("standalone commit was not reached");
      };
      const schema = await types.getEntitySchema(typeDeps, author, { type_id: kind.id });
      const draft = await changes.createEntitySchemaChange(typeDeps, key(author), kind.id, {
        expected_schema_version: 1,
        edits: [{
          op: "update_property",
          key: "prop_1",
          field: { ...schema.schema.properties.prop_1, maxLength: 1 },
          required: true,
        }],
        migration: { rules: [], overrides: [{ entity_id: entityId, key: "prop_1", value: "X" }] },
      });
      const ready = await analyze(draft, author);
      const first = await activate(ready, author);
      await execute(first.job_id, a.userId);
      const succeeded = await migrations.getEntitySchemaMigration(typeDeps, executor, first.job_id);
      assertEquals(succeeded.recovery!.status, "available");
      const [publishedSource] =
        await admin`select initiated_by,source_expires_at from app.entity_schema_migrations where workspace_id=${workspaceId} and id=${first.job_id}`;
      assertEquals(publishedSource.initiated_by, a.userId);
      await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, b.userId, {
        expected_version: 1,
        grants: grants.slice(0, 1),
      });
      assertEquals(
        (await assertRejects(() =>
          migrations.createEntitySchemaRecovery(typeDeps, key(executor), first.job_id, {
            expected_job_version: succeeded.version,
            expected_schema_version: 2,
          }), AppError)).code,
        "forbidden",
      );
      await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, b.userId, {
        expected_version: 2,
        grants,
      });
      await workspaces.leaveWorkspace(workspaceDeps, key(a), workspaceId, { expected_version: 2 });
      const recovery = await migrations.createEntitySchemaRecovery(typeDeps, key(executor), first.job_id, {
        expected_job_version: succeeded.version,
        expected_schema_version: 2,
      });
      assertEquals(
        (await admin`select recovery_source_job_id,initiated_by from app.entity_schema_changes where workspace_id=${workspaceId} and id=${recovery.id}`)[
          0
        ],
        { recovery_source_job_id: first.job_id, initiated_by: b.userId },
      );
      const restore = await activate(await analyze(recovery, executor));
      await execute(restore.job_id);
      assertEquals(
        (await admin`select properties,schema_version from app.entities where workspace_id=${workspaceId} and id=${entityId}`)
          .map((r) => ({ properties: r.properties, schema_version: Number(r.schema_version) })),
        [{ properties: { prop_1: "12", prop_2: `${APP_IDENTIFIER_RULE_ID}:${externalId}` }, schema_version: 3 }],
      );
      assertEquals(
        (await admin`select initiated_by,source_expires_at from app.entity_schema_migrations where workspace_id=${workspaceId} and id=${first.job_id}`)[
          0
        ],
        publishedSource,
      );
      const restored = await migrations.getEntitySchemaMigration(typeDeps, executor, restore.job_id);
      const third = await migrations.createEntitySchemaRecovery(typeDeps, key(executor), restore.job_id, {
        expected_job_version: restored.version,
        expected_schema_version: 3,
      });
      const expired = await activate(await analyze(third, executor));
      await admin`update app.entity_schema_migrations set source_expires_at=clock_timestamp()-interval '1 second' where workspace_id=${workspaceId} and id in(${first.job_id},${expired.job_id})`;
      assertEquals(
        (await assertRejects(() =>
          migrations.createEntitySchemaRecovery(typeDeps, key(executor), first.job_id, {
            expected_job_version: succeeded.version,
            expected_schema_version: 3,
          }), AppError)).code,
        "migration_source_expired",
      );
      assertEquals((await worker`select app.claim_entity_schema_migration() as batch`)[0].batch, null);
      const expiredJob = await migrations.getEntitySchemaMigration(typeDeps, executor, expired.job_id);
      assertEquals(
        (await migrations.cancelEntitySchemaMigration(typeDeps, key(executor), expired.job_id, {
          expected_job_version: expiredJob.version,
        })).status,
        "cancelled",
      );
      await admin`select private.cleanup_entity_schema_sources()`;
      const terminal =
        await admin`select id,source_definition,source_templates,source_references from app.entity_schema_migrations where workspace_id=${workspaceId} and id in(${first.job_id},${expired.job_id})`;
      assertEquals(terminal.length, 2);
      assertEquals(
        terminal.every((j) =>
          JSON.stringify(j.source_definition) === "{}" && JSON.stringify(j.source_templates) === "{}" &&
          j.source_references === null
        ),
        true,
      );
      assertEquals(
        Number(
          (await admin`select count(*) count from private.entity_schema_migration_rows where workspace_id=${workspaceId} and job_id in(${first.job_id},${expired.job_id})`)[
            0
          ].count,
        ),
        0,
      );
      const [retained] =
        await admin`select source_definition from app.entity_schema_migrations where workspace_id=${workspaceId} and id=${restore.job_id}`;
      assertEquals(JSON.stringify(retained.source_definition) === "{}", false);
      assertEquals(
        Number(
          (await admin`select count(*) count from private.entity_schema_migration_rows where workspace_id=${workspaceId} and job_id=${restore.job_id}`)[
            0
          ].count,
        ),
        1,
      );
      return;
    }
    const target = await exportDataModel(modelDeps, author);
    target.entity_types[0].schema.properties.prop_1.maxLength = 1;
    const input = { mode: "update", document: JSON.stringify(target) };
    const preview = await previewDataModel(modelDeps, author, input);
    const saved = await prepareDataModel(modelDeps, key(author), {
      ...input,
      preview_fingerprint: preview.fingerprint,
    });
    await analyzeDataModel(modelDeps, key(author), saved.id, {
      expected_version: saved.version,
      conversions: [{
        type_ref: target.entity_types[0].ref,
        migration: {
          rules: [],
          overrides: scenario === "repair" ? [] : [{ entity_id: entityId, key: "prop_1", value: "X" }],
        },
      }],
    });
    if (scenario === "analysis_expiry" || scenario === "seal_analysis") {
      const [queued] =
        await admin`select a.id,a.fence from app.entity_schema_analyses a join app.data_model_children c on c.workspace_id=a.workspace_id and c.analysis_id=a.id where c.workspace_id=${workspaceId} and c.model_id=${saved.id}`;
      if (scenario === "seal_analysis") {
        await runInWorkspace(sql, executor, {
          mode: "business",
          requirements: grants as workspaces.WorkspaceRequirement[],
        }, async (tx) => {
          const clock = await assertRejects(() =>
            tx.savepoint((nested) =>
              nested`update app.entity_schema_analyses set created_at=created_at+interval '1 day' where workspace_id=${executor.workspaceId} and id=${queued.id}`
            )
          );
          assertEquals((clock as { code?: string }).code, "23514");
          assertEquals((clock as Error).message, "schema_analysis_source_immutable");
          const row = await assertRejects(() =>
            tx.savepoint((nested) =>
              nested`update private.entity_schema_analysis_rows set properties='{"prop_1":"tampered"}' where workspace_id=${executor.workspaceId} and analysis_id=${queued.id}`
            )
          );
          assertEquals((row as { code?: string }).code, "23514");
          assertEquals((row as Error).message, "schema_analysis_source_row_immutable");
        });
      } else {
        await admin`update app.entity_schema_analyses set created_at=clock_timestamp()-interval '31 days' where workspace_id=${workspaceId} and id=${queued.id}`;
        assertEquals((await worker`select app.claim_entity_schema_analysis() as batch`)[0].batch, null);
        await workspaces.leaveWorkspace(workspaceDeps, key(a), workspaceId, { expected_version: 2 });
        await worker`select app.prune_entity_schema_sources()`;
        const [expired] =
          await admin`select status,fence,lease_until from app.entity_schema_analyses where workspace_id=${workspaceId} and id=${queued.id}`;
        assertEquals(expired.status, "failed");
        assertEquals(Number(expired.fence) > Number(queued.fence), true);
        assertEquals(expired.lease_until, null);
        assertEquals(
          Number(
            (await admin`select count(*) count from private.entity_schema_analysis_rows where workspace_id=${workspaceId} and analysis_id=${queued.id}`)[
              0
            ].count,
          ),
          0,
        );
      }
      return;
    }
    const [analysis] = await worker`select app.claim_entity_schema_analysis() as batch`;
    assertEquals(Boolean(analysis.batch), true);
    const convert = compileMigration(analysis.batch.target, analysis.batch.migration, analysis.batch.recovery_keys);
    assertEquals(
      (await worker`select app.complete_entity_schema_analysis_batch(${analysis.batch.id},${analysis.batch.fence},${
        worker.json(analysis.batch.rows.map((row: { entity_id: string; properties: Record<string, unknown> }) =>
          convert(row.entity_id, row.properties)
        ))
      }) as accepted`)[0].accepted,
      true,
    );
    const ready = await getDataModelChange(modelDeps, author, saved.id);
    if (scenario === "repair") {
      assertEquals(ready.status, "needs_conversion");
      const changeId = ready.group!.children[0].change.id;
      const errorsInput = { analysis_id: analysis.batch.id, failures_only: true };
      const failedRows = await changes.getEntitySchemaAnalysisRows(typeDeps, executor, kind.id, changeId, errorsInput);
      assertEquals(failedRows.items.length, 1);
      assertEquals(failedRows.items[0].before, { prop_1: "12" });
      assertEquals(failedRows.items[0].errors.length > 0, true);
      await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, b.userId, {
        expected_version: 1,
        grants: grants.slice(0, 1),
      });
      assertEquals(
        (await assertRejects(
          () => changes.getEntitySchemaAnalysisRows(typeDeps, executor, kind.id, changeId, errorsInput),
          AppError,
        )).code,
        "forbidden",
      );
      await workspaces.updateWorkspaceMember(workspaceDeps, key(a), workspaceId, b.userId, {
        expected_version: 2,
        grants,
      });
      await workspaces.leaveWorkspace(workspaceDeps, key(a), workspaceId, { expected_version: 2 });
      await analyzeDataModel(modelDeps, key(executor), saved.id, {
        expected_version: ready.version,
        conversions: [{
          type_ref: target.entity_types[0].ref,
          migration: { rules: [], overrides: [{ entity_id: entityId, key: "prop_1", value: "X" }] },
        }],
      });
      const [fixed] = await worker`select app.claim_entity_schema_analysis() as batch`;
      const fix = compileMigration(fixed.batch.target, fixed.batch.migration, fixed.batch.recovery_keys);
      assertEquals(
        (await worker`select app.complete_entity_schema_analysis_batch(${fixed.batch.id},${fixed.batch.fence},${
          worker.json(fixed.batch.rows.map((r: { entity_id: string; properties: Record<string, unknown> }) =>
            fix(r.entity_id, r.properties)
          ))
        }) as accepted`)[0].accepted,
        true,
      );
      const fixedReady = await getDataModelChange(modelDeps, executor, saved.id);
      assertEquals(fixedReady.status, "ready");
      await applyDataModel(modelDeps, key(executor), saved.id, { expected_version: fixedReady.version });
      const [claim] = await worker`select app.claim_data_model_conversion() as batch`;
      assertEquals(claim.batch.child.initiated_by, b.userId);
      const prepared = await prepareMigrationBatch(claim.batch.child, new Date());
      assertEquals(
        (await worker`select app.stage_data_model_conversion(${claim.batch.id},${claim.batch.fence},${claim.batch.child.id},${claim.batch.child.fence},${
          worker.json(prepared.results)
        }) as accepted`)[0].accepted,
        true,
      );
      const [committing] = await worker`select app.claim_data_model_conversion() as batch`;
      assertEquals(
        (await worker`select app.commit_data_model_conversion(${committing.batch.id},${committing.batch.fence},${SEARCH_PIPELINE}) as committed`)[
          0
        ].committed,
        true,
      );
      assertEquals((await getDataModelChange(modelDeps, executor, saved.id)).status, "applied");
      assertEquals(
        (await admin`select properties from app.entities where workspace_id=${workspaceId} and id=${entityId}`)[0]
          .properties,
        { prop_1: "X" },
      );
      assertEquals(
        Number(
          (await admin`select count(*) count from private.entity_schema_analysis_rows where workspace_id=${workspaceId} and analysis_id=${analysis.batch.id} and jsonb_array_length(errors)>0`)[
            0
          ].count,
        ),
        1,
      );
      return;
    }
    await applyDataModel(modelDeps, key(author), saved.id, { expected_version: ready.version });
    if (scenario === "analysis_dependency") {
      await admin`update app.entity_schema_analyses set created_at=clock_timestamp()-interval '31 days' where workspace_id=${workspaceId} and id=${analysis.batch.id}`;
      await worker`select app.prune_entity_schema_sources()`;
      assertEquals(
        (await admin`select status from app.entity_schema_analyses where workspace_id=${workspaceId} and id=${analysis.batch.id}`)[
          0
        ].status,
        "succeeded",
      );
      assertEquals(
        Number(
          (await admin`select count(*) count from private.entity_schema_analysis_rows where workspace_id=${workspaceId} and analysis_id=${analysis.batch.id}`)[
            0
          ].count,
        ),
        1,
      );
      assertEquals(
        (await worker`select app.claim_data_model_conversion() as batch`)[0].batch.child.initiated_by,
        a.userId,
      );
      return;
    }
    if (["seal_model", "seal_model_snapshots", "seal_job"].includes(scenario)) {
      const [accepted] =
        await admin`select id from app.entity_schema_migrations where workspace_id=${workspaceId} and model_change_id=${saved.id}`;
      await runInWorkspace(sql, executor, {
        mode: "business",
        requirements: grants as workspaces.WorkspaceRequirement[],
      }, async (tx) => {
        const reject = async (write: (nested: typeof tx) => Promise<unknown>, message: string) => {
          const error = await assertRejects(() => tx.savepoint(write));
          assertEquals((error as { code?: string }).code, "23514");
          assertEquals((error as Error).message, message);
        };
        if (scenario === "seal_model") {
          await reject(
            (nested) =>
              nested`update app.data_model_changes set source_expires_at=source_expires_at+interval '1 day' where workspace_id=${executor.workspaceId} and id=${saved.id}`,
            "model_plan_source_expiry_immutable",
          );
        } else if (scenario === "seal_model_snapshots") {
          for (const column of ["source_templates", "source_memberships"] as const) {
            await reject(
              (nested) =>
                nested`update app.data_model_changes set ${nested(column)}='{}'::jsonb
                where workspace_id=${executor.workspaceId} and id=${saved.id}`,
              "model_plan_source_snapshot_immutable",
            );
          }
        } else {
          await reject(
            (nested) =>
              nested`update app.entity_schema_migrations set source_expires_at=source_expires_at+interval '1 day' where workspace_id=${executor.workspaceId} and id=${accepted.id}`,
            "schema_job_source_immutable",
          );
          await reject(
            (nested) =>
              nested`update app.entity_schema_migrations set target=jsonb_set(target,'{schema,properties,prop_1,maxLength}','2') where workspace_id=${executor.workspaceId} and id=${accepted.id}`,
            "schema_job_source_immutable",
          );
          await reject(
            (nested) =>
              nested`update private.entity_schema_migration_rows set source_properties='{"prop_1":"偽"}' where workspace_id=${executor.workspaceId} and job_id=${accepted.id}`,
            "schema_job_source_row_immutable",
          );
        }
      });
      return;
    }
    if (scenario === "coordinator") {
      await runInWorkspace(sql, executor, {
        mode: "business",
        requirements: grants as import("../../functions/_shared/core/workspaces/application.ts").WorkspaceRequirement[],
      }, async (tx) => {
        const error = await assertRejects(() =>
          tx.savepoint((nested) =>
            nested`update app.data_model_changes set initiated_by=${b.userId} where workspace_id=${executor.workspaceId} and id=${saved.id}`
          )
        );
        assertEquals((error as { code?: string }).code, "23514");
        assertEquals((error as Error).message, "model_plan_initiator_immutable");
      });
      assertEquals(
        (await admin`select initiated_by from app.data_model_changes where workspace_id=${workspaceId} and id=${saved.id}`)[
          0
        ].initiated_by,
        a.userId,
      );
      return;
    }
    if (scenario === "restore" || scenario === "restore_committing") {
      if (scenario === "restore_committing") {
        const [preparing] = await worker`select app.claim_data_model_conversion() as batch`;
        const prepared = await prepareMigrationBatch(preparing.batch.child, new Date());
        assertEquals(
          (await worker`select app.stage_data_model_conversion(${preparing.batch.id},${preparing.batch.fence},${preparing.batch.child.id},${preparing.batch.child.fence},${
            worker.json(prepared.results)
          }) as accepted`)[0].accepted,
          true,
        );
        assertEquals((await worker`select app.claim_data_model_conversion() as batch`)[0].batch.status, "committing");
      }
      await workspaces.deleteWorkspace(workspaceDeps, key(a), workspaceId, { expected_generation: 1 });
      await workspaces.restoreWorkspace(workspaceDeps, key(a), workspaceId, { expected_generation: 2 });
      assertEquals((await worker`select app.claim_data_model_conversion() as batch`)[0].batch, null);
      const stale = await getDataModelChange(modelDeps, executor, saved.id);
      const cancelled = await changeDataModelGroup(modelDeps, key(executor), saved.id, {
        expected_version: stale.version,
      }, "cancel");
      assertEquals(cancelled.status, "cancelled");
      const [old] = await admin`select j.status,j.workspace_generation,j.initiated_by,t.schema_write_locked
        from app.entity_schema_migrations j join app.entity_types t on t.workspace_id=j.workspace_id and t.id=j.type_id
        where j.workspace_id=${workspaceId} and j.model_change_id=${saved.id}`;
      assertEquals(old.status, "cancelled");
      assertEquals(old.schema_write_locked, false);
      assertEquals(Number(old.workspace_generation), 1);
      assertEquals(old.initiated_by, a.userId);
      assertEquals(
        Number(
          (await admin`select count(*) count from private.entity_schema_migration_rows r join app.entity_schema_migrations j on j.workspace_id=r.workspace_id and j.id=r.job_id where j.workspace_id=${workspaceId} and j.model_change_id=${saved.id}`)[
            0
          ].count,
        ),
        1,
      );
      assertEquals(
        (await admin`select status from app.entity_schema_analyses where workspace_id=${workspaceId} and id=${analysis.batch.id}`)[
          0
        ].status,
        "succeeded",
      );
      const freshPreview = await previewDataModel(modelDeps, executor, input);
      const fresh = await prepareDataModel(modelDeps, key(executor), {
        ...input,
        preview_fingerprint: freshPreview.fingerprint,
      });
      assertEquals(fresh.status, "needs_conversion");
      await analyzeDataModel(modelDeps, key(executor), fresh.id, {
        expected_version: fresh.version,
        conversions: [{
          type_ref: target.entity_types[0].ref,
          migration: { rules: [], overrides: [{ entity_id: entityId, key: "prop_1", value: "X" }] },
        }],
      });
      const [newAnalysis] = await worker`select app.claim_entity_schema_analysis() as batch`;
      assertEquals(Boolean(newAnalysis.batch), true);
      const [epoch] =
        await admin`select workspace_generation from app.entity_schema_analyses where workspace_id=${workspaceId} and id=${newAnalysis.batch.id}`;
      assertEquals(Number(epoch.workspace_generation), 3);
      return;
    }
    const [claim] = await worker`select app.claim_data_model_conversion() as batch`;
    assertEquals(Boolean(claim.batch?.child), true);
    const batch = claim.batch;
    assertEquals(
      (await worker`select app.fail_data_model_conversion(${batch.id},${batch.fence},${batch.child.id},${batch.child.fence},'migration_worker_failed',true) as accepted`)[
        0
      ].accepted,
      true,
    );
    const [oldJob] =
      await admin`select id,initiated_by,workspace_generation,source_expires_at,source_definition,source_templates,source_references,migration,status,failure_reason
      from app.entity_schema_migrations where workspace_id=${workspaceId} and id=${batch.child.id}`;
    const oldRows =
      await admin`select to_jsonb(r)-array['job_id','owner_id'] as sealed from private.entity_schema_migration_rows r
      where workspace_id=${workspaceId} and job_id=${oldJob.id} order by entity_id`;
    await workspaces.leaveWorkspace(workspaceDeps, key(a), workspaceId, { expected_version: 2 });
    const failed = await getDataModelChange(modelDeps, executor, saved.id);
    const retried = await changeDataModelGroup(
      modelDeps,
      key(executor),
      saved.id,
      { expected_version: failed.version },
      "retry",
    );
    assertEquals(retried.status, "queued");
    const [current] =
      await admin`select j.* from app.data_model_children c join app.entity_schema_migrations j on j.workspace_id=c.workspace_id and j.id=c.job_id
      where c.workspace_id=${workspaceId} and c.model_id=${saved.id}`;
    assertEquals(current.id === oldJob.id, false);
    assertEquals(current.initiated_by, b.userId);
    assertEquals(current.retry_source_job_id, oldJob.id);
    assertEquals(Number(current.workspace_generation), Number(oldJob.workspace_generation));
    assertEquals(current.source_expires_at, oldJob.source_expires_at);
    for (const field of ["source_definition", "source_templates", "source_references", "migration"]) {
      assertEquals(current[field], oldJob[field]);
    }
    assertEquals(
      await admin`select to_jsonb(r)-array['job_id','owner_id'] as sealed from private.entity_schema_migration_rows r
      where workspace_id=${workspaceId} and job_id=${current.id} order by entity_id`,
      oldRows,
    );
    const [retained] =
      await admin`select status,failure_reason,initiated_by from app.entity_schema_migrations where workspace_id=${workspaceId} and id=${oldJob.id}`;
    assertEquals(retained, { status: oldJob.status, failure_reason: oldJob.failure_reason, initiated_by: a.userId });
    assertEquals(
      (await worker`select app.claim_data_model_conversion() as batch`)[0].batch.child.initiated_by,
      b.userId,
    );
  } finally {
    if (workspaceId) {
      await admin`delete from pgmq.q_search_index where message->>'workspace_id'=${workspaceId}`;
      await admin`delete from app.workspaces where id=${workspaceId}`;
    }
    for (const actor of [a, b]) await admin`delete from auth.users where id=${actor.userId}`;
  }
}

dbTest(
  "shared manager retry creates a new immutable job after the original executor leaves",
  () => retryOrRestoreFixture("retry"),
);
dbTest(
  "restored workspace cancels stale conversion and accepts a fresh generation plan",
  () => retryOrRestoreFixture("restore"),
);

dbTest(
  "queued conversion coordinator cannot inherit a different member's authority",
  () => retryOrRestoreFixture("coordinator"),
);

dbTest(
  "restored workspace cancels a fenced committing job without reviving its source",
  () => retryOrRestoreFixture("restore_committing"),
);

dbTest(
  "shared manager reads protected failure rows and repairs after the analyst leaves",
  () => retryOrRestoreFixture("repair"),
);

dbTest(
  "standalone activation recovery and expiry use current workspace authority",
  () => retryOrRestoreFixture("recovery"),
);

dbTest(
  "queued schema job execution source and expiry are immutable to app_user",
  () => retryOrRestoreFixture("seal_job"),
);
dbTest(
  "queued model source expiry cannot be extended by another authorized manager",
  () => retryOrRestoreFixture("seal_model"),
);

dbTest(
  "queued model retained source snapshots cannot be rewritten by an authorized manager",
  () => retryOrRestoreFixture("seal_model_snapshots"),
);

dbTest(
  "expired queued analysis cannot claim before bounded source maintenance",
  () => retryOrRestoreFixture("analysis_expiry"),
);
dbTest(
  "live accepted source protects its older analysis from pruning",
  () => retryOrRestoreFixture("analysis_dependency"),
);
dbTest(
  "queued analysis clock and captured values are immutable to app_user",
  () => retryOrRestoreFixture("seal_analysis"),
);
dbTest(
  "expired model source is pruned without historical coordinator authority",
  () => twoKindPublicationFixture(false, true),
);
