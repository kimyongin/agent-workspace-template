import { assertEquals } from "@std/assert";
import { compileMigration } from "../../functions/_shared/core/entity-types/conversions.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { connect, dbTest, urls } from "./_db.ts";
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
  } finally {
    if (workspaceId) await admin`delete from app.workspaces where id=${workspaceId}`;
    for (const actor of [a, b]) await admin`delete from auth.users where id=${actor.userId}`;
  }
});
