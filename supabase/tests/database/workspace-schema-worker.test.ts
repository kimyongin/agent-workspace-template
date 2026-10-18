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
    const externalId = crypto.randomUUID(), entityId = `app:${type.id}:${externalId}`;
    await runInWorkspace(sql, author, {
      mode: "business",
      requirements: [{ target_kind: "entity_type", target_id: type.id, access: "write" }],
    }, (tx) =>
      tx`insert into app.entities(workspace_id,id,source,external_id,entity_type_id,schema_version,properties)
      values(${author.workspaceId},${entityId},'app',${externalId},${type.id},1,'{"prop_1":"A가 작성한 공유 원본"}')`);
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
      [{ entity_id: entityId, properties: { prop_1: "A가 작성한 공유 원본" } }],
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
import { analyzeDataModel } from "../../functions/_shared/core/data-model/groups.ts";
import { prepareMigrationBatch } from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";

const modelDeps = { uow: new SqlDataModelUnitOfWork(sql, SqlDataModelGroupStore) };
dbTest(
  "shared two-kind durable conversion publishes one workspace and one immutable entity parent per record",
  async () => {
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
        const externalId = crypto.randomUUID(), id = `app:${kind.id}:${externalId}`;
        entities.push(id);
        await runInWorkspace(
          sql,
          author,
          {
            mode: "business",
            requirements: [{ target_kind: "entity_type", target_id: kind.id, access: "write" }],
          },
          (tx) =>
            tx`insert into app.entities(workspace_id,id,source,external_id,entity_type_id,schema_version,properties)
        values(${author.workspaceId},${id},'app',${externalId},${kind.id},1,${
              tx.json({ prop_1: String(12 + index) })
            })`,
        );
      }
      const before = await exportDataModel(modelDeps, executor), target = structuredClone(before);
      for (const kind of target.entity_types) {
        kind.schema.properties.prop_1.maxLength = 1;
      }
      const input = { mode: "update", document: JSON.stringify(target) };
      const preview = await previewDataModel(modelDeps, executor, input);
      const saved = await prepareDataModel(modelDeps, key(executor), {
        ...input,
        preview_fingerprint: preview.fingerprint,
      });
      assertEquals(saved.status, "needs_conversion");
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
          const [result] =
            await worker`select app.commit_data_model_conversion(${batch.id},${batch.fence},${SEARCH_PIPELINE}) as committed`;
          assertEquals(result.committed, true);
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
          { properties: { prop_1: "X" }, schema_version: 2 },
          { properties: { prop_1: "X" }, schema_version: 2 },
        ]);
        const records =
          await tx`select workspace_id,owner_id,entity_id,task_id,created_by from app.records where workspace_id=${executor.workspaceId}`;
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
        }
      });
    } finally {
      if (workspaceId) await admin`delete from app.workspaces where id=${workspaceId}`;
      for (const actor of [a, b]) await admin`delete from auth.users where id=${actor.userId}`;
    }
  },
);
