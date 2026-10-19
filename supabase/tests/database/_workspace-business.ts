import type postgres from "postgres";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import type { WorkspaceRequirement } from "../../functions/_shared/core/workspaces/application.ts";
import * as workspaces from "../../functions/_shared/core/workspaces/application.ts";
import * as types from "../../functions/_shared/core/entity-types/application.ts";
import { SqlWorkspaceUnitOfWork } from "../../functions/_shared/adapters/supabase/workspace-store.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";

export const businessRequest = (actor: Actor): Actor => ({ ...actor, request: { key: crypto.randomUUID() } });
/** Fresh explicit workspace fixture. No actor receives any default data grant. */
export async function businessWorkspaceFixture(admin: postgres.Sql, sql: postgres.Sql) {
  const workspaceDeps = { uow: new SqlWorkspaceUnitOfWork(sql) };
  const typeDeps = { uow: new SqlEntityTypeUnitOfWork(sql) };
  const accounts = [{ userId: crypto.randomUUID() }, { userId: crypto.randomUUID() }];
  const seeded: string[] = [], owned: string[] = [];
  const versions = new Map<string, number>();
  const grants = new Map<string, WorkspaceRequirement[]>();
  const key = (workspace: string, user: string) => `${workspace}:${user}`;
  const cleanup = async () => {
    for (const id of owned) {
      // Exact fresh fixture ownership is known before the FK can detach an
      // uncertain in-process fake effect. Never select legacy/unowned history.
      const effects = await admin`select id from private.passage_effects where workspace_id=${id}`;
      for (const effect of effects) await admin`delete from private.passage_effects where id=${effect.id}::uuid`;
      await admin`delete from pgmq.q_search_index where message->>'workspace_id'=${id}`;
      await admin`delete from pgmq.a_search_index where message->>'workspace_id'=${id}`;
      await admin`delete from app.workspaces where id=${id}`;
    }
    for (const id of seeded) await admin`delete from auth.users where id=${id}`;
  };
  try {
    for (const account of accounts) {
      const email = `business514-${account.userId}@example.test`;
      await admin`insert into auth.users(id,email) values(${account.userId},${email})`;
      seeded.push(account.userId);
      await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data) values(${crypto.randomUUID()},${account.userId},'google',${account.userId},${
        admin.json({ sub: account.userId, email, email_verified: true })
      })`;
    }
    const addWorkspace = async (name: string) => {
      const id = (await workspaces.createWorkspace(workspaceDeps, businessRequest(accounts[0]), { name })).workspace.id;
      owned.push(id);
      const invitation = await workspaces.inviteWorkspaceMember(workspaceDeps, businessRequest(accounts[0]), id, {
        email: `business514-${accounts[1].userId}@example.test`,
        grants: [],
      });
      await workspaces.acceptWorkspaceInvitation(workspaceDeps, businessRequest(accounts[1]), invitation.invitation.id);
      for (const account of accounts) {
        versions.set(key(id, account.userId), 1);
        grants.set(
          key(id, account.userId),
          account === accounts[0] ? [{ target_kind: "settings", target_id: "*", access: "write" }] : [],
        );
      }
      return {
        workspaceId: id,
        manager: { ...accounts[0], workspaceId: id },
        member: { ...accounts[1], workspaceId: id },
      };
    };
    const primary = await addWorkspace("공유 업무 검증");
    const grant = async (actor: Actor & { workspaceId: string }, next: WorkspaceRequirement[]) => {
      const entry = key(actor.workspaceId, actor.userId);
      await workspaces.updateWorkspaceMember(
        workspaceDeps,
        businessRequest(accounts[0]),
        actor.workspaceId,
        actor.userId,
        {
          expected_version: versions.get(entry)!,
          grants: next,
        },
      );
      versions.set(entry, versions.get(entry)! + 1);
      grants.set(entry, next);
    };
    return {
      ...primary,
      workspaceDeps,
      typeDeps,
      addWorkspace,
      cleanup,
      grant,
      createKind: (label: string, actor = primary.manager) =>
        types.createEntityType(typeDeps, businessRequest(actor), { label }),
      grantKind: async (actor: Actor & { workspaceId: string }, id: string, access: "none" | "read" | "write") => {
        const next = (grants.get(key(actor.workspaceId, actor.userId)) ?? []).filter((item) =>
          item.target_kind !== "entity_type" || item.target_id !== id
        );
        await grant(actor, access === "none" ? next : [...next, { target_kind: "entity_type", target_id: id, access }]);
      },
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
