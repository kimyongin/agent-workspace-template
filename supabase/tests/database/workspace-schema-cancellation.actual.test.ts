import { APP_IDENTIFIER_RULE_ID } from "../../functions/_shared/contracts/entity-issuer.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { runInWorkspace, workspaceAccount } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { createEntity, getEntity } from "../../functions/_shared/core/entity/application.ts";
import { createTask } from "../../functions/_shared/core/activity/application.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import * as changes from "../../functions/_shared/core/entity-types/schema-changes.ts";
import * as migrations from "../../functions/_shared/core/entity-types/schema-migrations.ts";
import * as workspaces from "../../functions/_shared/core/workspaces/application.ts";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { prepareMigrationBatch } from "../../functions/_shared/core/entity-types/migration-preparation.ts";
import { SEARCH_PIPELINE } from "../../functions/_shared/core/search/config.ts";
import type { WorkspaceActor } from "../../functions/_shared/core/workspaces/application.ts";

const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 3 });
const workerUrl = new URL(urls.admin);
workerUrl.username = "app_worker";
workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
const worker = connect(workerUrl.toString(), { max: 1 });
const typeDeps = { uow: new SqlEntityTypeUnitOfWork(sql) }, entityDeps = { uow: new SqlEntityUnitOfWork(sql) };
const probe = (actor: WorkspaceActor, id: string, kind = "migration") =>
  runInWorkspace(
    sql,
    actor,
    { mode: "business", requirements: [] },
    async (tx) =>
      (await tx`select app.workspace_schema_execution_current(${kind},${id}::uuid) as current`)[0].current as boolean,
  );
async function rejectedCode(run: () => Promise<unknown>, expected: string) {
  assertEquals((await assertRejects(run) as { code: string }).code, expected);
}
async function standalone(linkedTask = false) {
  const fixture = await businessWorkspaceFixture(admin, sql);
  try {
    const kind = await fixture.createKind("독립 변환 취소");
    await fixture.grantKind(fixture.manager, kind.id, "write");
    const entity = await createEntity(entityDeps, businessRequest(fixture.manager), {
      entity_type_id: kind.id,
      schema_version: 1,
      properties: { prop_1: "게시 전 원본" },
    });
    if (linkedTask) {
      await fixture.grant(fixture.manager, [
        { target_kind: "settings", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: kind.id, access: "write" },
        { target_kind: "tasks", target_id: "*", access: "write" },
      ]);
      await createTask(
        { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } },
        businessRequest(fixture.manager),
        taskCreate.parse({ kind: "once", title: "보호된 참조", entity_ids: [entity.id] }),
      );
    }
    const change = await changes.createEntitySchemaChange(typeDeps, businessRequest(fixture.manager), kind.id, {
      expected_schema_version: 1,
      edits: [{
        op: "add_property",
        client_ref: "quantity",
        field: { type: "integer", "x-order": 30 },
        required: true,
      }],
      migration: { rules: [{ op: "fill", key: "prop_3", value: 7 }], overrides: [] },
    });
    await changes.analyzeEntitySchemaChange(typeDeps, businessRequest(fixture.manager), kind.id, change.id, {
      expected_change_version: change.version,
    });
    const [{ batch: analysis }] = await worker`select app.claim_entity_schema_analysis() as batch`;
    assertEquals(analysis.workspace_id, fixture.workspaceId);
    const convert = compileMigration(analysis.target, analysis.migration);
    const results = analysis.rows.map((row: { entity_id: string; properties: Record<string, unknown> }) =>
      convert(row.entity_id, row.properties)
    );
    assertEquals(
      (await worker`select app.complete_entity_schema_analysis_batch(${analysis.id},${analysis.fence},${
        worker.json(results)
      }) as accepted`)[0].accepted,
      true,
    );
    const ready = await changes.getEntitySchemaChange(typeDeps, fixture.manager, kind.id, change.id);
    const accepted = await migrations.startEntitySchemaMigration(
      typeDeps,
      businessRequest(fixture.manager),
      kind.id,
      change.id,
      {
        expected_change_version: ready.version,
        expected_schema_version: 1,
        analysis_id: ready.analysis!.id,
        fingerprint: ready.fingerprint,
      },
    );
    for (let step = 0; step < 4; step++) {
      const [{ batch }] = await worker`select app.claim_entity_schema_migration() as batch`;
      assertEquals(batch.id, accepted.job_id);
      if (batch.status === "committing") return { fixture, kind, entity, batch };
      const prepared = await prepareMigrationBatch(batch, new Date());
      assertEquals(prepared.stale, false);
      assertEquals(
        (await worker`select app.stage_entity_schema_migration(${batch.id},${batch.fence},${
          worker.json(prepared.results)
        }) as accepted`)[0].accepted,
        true,
      );
    }
    throw new Error("standalone did not reach committing");
  } catch (error) {
    await fixture.cleanup();
    throw error;
  }
}

for (const lost of ["account", "kind-permission", "membership", "generation"] as const) {
  dbTest(
    `standalone committing cancellation preserves current winner and releases stranded locks after ${lost} loss`,
    async () => {
      const { fixture: f, kind, entity, batch } = await standalone();
      try {
        assertEquals(await probe(f.manager, batch.id), true);
        const original = await migrations.getEntitySchemaMigration(typeDeps, f.manager, batch.id);
        const winner = await migrations.cancelEntitySchemaMigration(typeDeps, businessRequest(f.manager), batch.id, {
          expected_job_version: original.version,
        });
        assertEquals([winner.status, winner.version], ["committing", original.version]);
        await f.grant(f.member, [{ target_kind: "settings", target_id: "*", access: "write" }]);
        await f.grantKind(f.member, kind.id, "write");
        if (lost === "account") await admin`delete from auth.users where id=${f.manager.userId}`;
        else if (lost === "kind-permission") await f.grantKind(f.manager, kind.id, "none");
        else if (lost === "membership") {
          const members = await workspaces.listWorkspaceMembers(f.workspaceDeps, f.member, f.workspaceId);
          const initiator = members.items.find((member) => member.user_id === f.manager.userId)!;
          await workspaces.removeWorkspaceMember(
            f.workspaceDeps,
            businessRequest(f.member),
            f.workspaceId,
            f.manager.userId,
            { expected_version: initiator.version },
          );
        } else {
          await workspaces.deleteWorkspace(f.workspaceDeps, businessRequest(f.member), f.workspaceId, {
            expected_generation: 1,
          });
          await workspaces.restoreWorkspace(f.workspaceDeps, businessRequest(f.member), f.workspaceId, {
            expected_generation: 2,
          });
        }
        assertEquals(await probe(f.member, batch.id), false);
        assertEquals(
          (await worker`select app.commit_entity_schema_migration(${batch.id},${batch.fence},${batch.source_template_fingerprint},${SEARCH_PIPELINE}) as committed`)[
            0
          ].committed,
          false,
        );
        const current = await migrations.getEntitySchemaMigration(typeDeps, f.member, batch.id);
        const cancelled = await migrations.cancelEntitySchemaMigration(typeDeps, businessRequest(f.member), batch.id, {
          expected_job_version: current.version,
        });
        assertEquals(cancelled.status, "cancelled");
        assertEquals(
          (await admin`select schema_write_locked from app.entity_types where workspace_id=${f.workspaceId} and id=${kind.id}`)[
            0
          ].schema_write_locked,
          false,
        );
        assertEquals((await getEntity(entityDeps, f.member, entity.id)).properties, entity.properties);
      } finally {
        await f.cleanup();
      }
    },
  );
}

dbTest(
  "schema execution boolean is restricted to current settings writers with the complete stored protected footprint",
  async () => {
    const { fixture: f, kind, batch } = await standalone(true);
    try {
      const roles = ["anon", "authenticated", "app_server", "app_worker", "app_user"];
      for (const role of roles) {
        assertEquals(
          (await admin`select has_function_privilege(${role},'app.workspace_schema_execution_current(text,uuid)','EXECUTE') as allowed`)[
            0
          ].allowed,
          role === "app_user",
        );
      }
      const [{ acl }] =
        await admin`select coalesce(bool_or(x.grantee=0 and x.privilege_type='EXECUTE'),false) as acl from pg_proc p cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) x where p.oid='app.workspace_schema_execution_current(text,uuid)'::regprocedure`;
      assertEquals(acl, false);
      await rejectedCode(() =>
        workspaceAccount(sql, f.manager, async (tx) => {
          await tx`select app.workspace_schema_execution_current('migration',${batch.id})`;
        }), "forbidden");
      await rejectedCode(() => probe(f.manager, batch.id, "invalid"), "invalid_input");
      const other = await f.addWorkspace("別の空間");
      assertEquals(await probe(other.manager, batch.id), false);
      assertEquals(await probe(f.manager, crypto.randomUUID()), false);
      await rejectedCode(() => probe(f.member, batch.id), "forbidden");
      await f.grant(f.member, [{ target_kind: "settings", target_id: "*", access: "read" }]);
      await rejectedCode(() => probe(f.member, batch.id), "forbidden");
      await f.grant(f.member, [{ target_kind: "settings", target_id: "*", access: "write" }]);
      await rejectedCode(() => probe(f.member, batch.id), "forbidden");
      await f.grantKind(f.member, kind.id, "write");
      // The stored task reference remains protected even with settings and root-kind write.
      await rejectedCode(() => probe(f.member, batch.id), "forbidden");
      await f.grant(f.member, [
        { target_kind: "settings", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: kind.id, access: "write" },
        { target_kind: "tasks", target_id: "*", access: "read" },
      ]);
      assertEquals(await probe(f.member, batch.id), true);
      assert(
        (await admin`select required_permissions from app.entity_schema_migrations where workspace_id=${f.workspaceId} and id=${batch.id}`)[
          0
        ].required_permissions.some((permission: { target_kind: string }) => permission.target_kind === "tasks"),
      );
    } finally {
      await f.cleanup();
    }
  },
);
