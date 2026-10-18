import { assertEquals } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import * as workspaces from "../../functions/_shared/core/workspaces/application.ts";
import * as types from "../../functions/_shared/core/entity-types/application.ts";
import * as changes from "../../functions/_shared/core/entity-types/schema-changes.ts";
import { SqlWorkspaceUnitOfWork } from "../../functions/_shared/adapters/supabase/workspace-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 2, prepare: false });
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
  } finally {
    if (workspaceId) await admin`delete from app.workspaces where id=${workspaceId}`;
    for (const actor of [a, b]) await admin`delete from auth.users where id=${actor.userId}`;
  }
});
