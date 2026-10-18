import { assert, assertEquals, assertRejects } from "@std/assert";
import type { WorkspaceGrant } from "../../functions/_shared/contracts/workspace.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { SqlWorkspaceUnitOfWork } from "../../functions/_shared/adapters/supabase/workspace-store.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { replayRetainedWorkspaceRequest } from "../../functions/_shared/adapters/supabase/workspace-request-ledger.ts";
import { requestIdentity } from "../../functions/_shared/core/shared/request.ts";
import * as workspaces from "../../functions/_shared/core/workspaces/application.ts";
import { connect, dbTest, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 5, prepare: false });
const deps = { uow: new SqlWorkspaceUnitOfWork(sql) };
const key = (actor: Actor) => ({ ...actor, request: { key: crypto.randomUUID() } });
const settings = { target_kind: "settings" as const, target_id: "*", access: "write" as const };
const taskRead = { target_kind: "tasks" as const, target_id: "*", access: "read" as const };
async function denied(fn: () => Promise<unknown>, expected = "forbidden") {
  const e = await assertRejects(fn, AppError);
  assertEquals(e.code, expected);
}
async function fixture() {
  const users = Array.from({ length: 3 }, () => ({ userId: crypto.randomUUID() }));
  const owned: string[] = [];
  for (const actor of users) {
    const email = `workspace512-${actor.userId}@example.test`;
    await admin`insert into auth.users(id,email) values(${actor.userId},${email})`;
    await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data) values(${crypto.randomUUID()},${actor.userId},'google',${actor.userId},${
      admin.json({ sub: actor.userId, email, email_verified: true })
    })`;
  }
  const create = async (actor: Actor, name = "공간") => {
    const value = await workspaces.createWorkspace(deps, key(actor), { name });
    owned.push(value.workspace.id);
    return value.workspace;
  };
  const join = async (manager: Actor, actor: Actor, id: string, grants: WorkspaceGrant[] = [settings]) => {
    const invitation = await workspaces.inviteWorkspaceMember(deps, key(manager), id, {
      email: `workspace512-${actor.userId}@example.test`,
      grants,
    });
    await workspaces.acceptWorkspaceInvitation(deps, key(actor), invitation.invitation.id);
    return invitation;
  };
  return {
    a: users[0],
    b: users[1],
    c: users[2],
    create,
    join,
    cleanup: async () => {
      for (const id of owned) await admin`delete from app.workspaces where id=${id}`;
      for (const actor of users) await admin`delete from auth.users where id=${actor.userId}`;
    },
  };
}

dbTest(
  "workspace creation is atomic, replay protected, and two spaces never become account-global selection",
  async () => {
    const f = await fixture();
    try {
      const actor = key(f.a), first = await workspaces.createWorkspace(deps, actor, { name: "첫 공간" });
      // This test created an extra root through the public API; track it for exact cleanup.
      const second = await f.create(f.a, "다른 공간");
      try {
        assertEquals(await workspaces.createWorkspace(deps, actor, { name: "첫 공간" }), first);
        assertEquals((await workspaces.listWorkspaces(deps, f.a)).items.map((w) => w.name).sort(), [
          "다른 공간",
          "첫 공간",
        ]);
        assertEquals((await workspaces.workspaceDetails(deps, f.a, second.id)).can_manage, true);
        assertEquals((await workspaces.workspaceDetails(deps, f.a, second.id)).grants, [settings]);
        await denied(() => workspaces.workspaceDetails(deps, f.b, second.id));
        assertEquals((await workspaces.listWorkspaces(deps, f.b)).items, []);
        await assertRejects(
          () =>
            deps.uow.account(f.a, async (s) => {
              await s.create("롤백될 공간");
              throw new Error("rollback");
            }),
          Error,
          "rollback",
        );
        assertEquals((await workspaces.listWorkspaces(deps, f.a)).items.length, 2);
        await admin`update app.workspaces set deleted_at=clock_timestamp() where id=${first.workspace.id}`;
        await denied(() => workspaces.createWorkspace(deps, actor, { name: "첫 공간" }));
      } finally {
        await admin`delete from app.workspaces where id=${first.workspace.id}`;
      }
    } finally {
      await f.cleanup();
    }
  },
);
dbTest("Google invitation matches server identity only, retry does not duplicate or widen membership", async () => {
  const f = await fixture();
  try {
    const w = await f.create(f.a);
    const invite = await workspaces.inviteWorkspaceMember(deps, key(f.a), w.id, {
      email: `workspace512-${f.b.userId}@example.test`,
      grants: [taskRead],
    });
    await denied(() => workspaces.acceptWorkspaceInvitation(deps, key(f.c), invite.invitation.id));
    await admin`update auth.users set raw_user_meta_data=${
      admin.json({ email: invite.invitation.email, email_verified: true, provider: "google" })
    } where id=${f.c.userId}`;
    await denied(() => workspaces.acceptWorkspaceInvitation(deps, key(f.c), invite.invitation.id));
    await admin`update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','"true"') where user_id=${f.b.userId}`;
    await denied(() => workspaces.acceptWorkspaceInvitation(deps, key(f.b), invite.invitation.id));
    await admin`update auth.identities set identity_data=jsonb_set(identity_data,'{email_verified}','true') where user_id=${f.b.userId}`;
    const actor = key(f.b);
    await workspaces.acceptWorkspaceInvitation(deps, actor, invite.invitation.id);
    await workspaces.acceptWorkspaceInvitation(deps, actor, invite.invitation.id);
    assertEquals((await workspaces.listWorkspaceMembers(deps, f.a, w.id)).items.length, 2);
    assertEquals((await workspaces.workspaceDetails(deps, f.b, w.id)).grants, [taskRead]);
    await admin`update auth.users set email=${`changed-${f.b.userId}@example.test`} where id=${f.b.userId}`;
    assertEquals((await workspaces.workspaceDetails(deps, f.b, w.id)).grants, [taskRead]);
    await denied(() =>
      workspaces.updateWorkspaceMember(deps, key(f.b), w.id, f.b.userId, { expected_version: 1, grants: [settings] })
    );
  } finally {
    await f.cleanup();
  }
});
dbTest("concurrent administrator demotions retain one real administrator and stale versions reject", async () => {
  const f = await fixture();
  try {
    const w = await f.create(f.a);
    await f.join(f.a, f.b, w.id);
    const result = await Promise.allSettled(
      [f.a, f.b].map((actor) =>
        workspaces.updateWorkspaceMember(deps, key(actor), w.id, actor.userId, { expected_version: 1, grants: [] })
      ),
    );
    assertEquals(result.filter((r) => r.status === "fulfilled").length, 1);
    const manager = await workspaces.workspaceDetails(deps, f.a, w.id).then((r) => r.can_manage ? f.a : f.b);
    assertEquals(
      (await workspaces.listWorkspaceMembers(deps, manager, w.id)).items.filter((m) =>
        m.grants.some((g) => g.target_kind === "settings" && g.access === "write")
      ).length,
      1,
    );
    const own = (await workspaces.listWorkspaceMembers(deps, manager, w.id)).items.find((m) =>
      m.user_id === manager.userId
    )!;
    await denied(
      () => workspaces.leaveWorkspace(deps, key(manager), w.id, { expected_version: own.version }),
      "conflict",
    );
    await denied(
      () =>
        workspaces.updateWorkspaceMember(deps, key(manager), w.id, manager.userId, {
          expected_version: own.version + 1,
          grants: [settings],
        }),
      "conflict",
    );
  } finally {
    await f.cleanup();
  }
});
dbTest("normal and retained success replay recheck current grants, including linked disclosure targets", async () => {
  const f = await fixture();
  try {
    const w = await f.create(f.a);
    await f.join(f.a, f.b, w.id, [settings, taskRead]);
    const actor = { ...key(f.b), workspaceId: w.id }, request = await requestIdentity(actor, "probe", null, {});
    let executions = 0;
    const entry = { mode: "business" as const, requirements: [taskRead, settings] };
    const execute = () =>
      deps.uow.workspace(actor, entry, (s) =>
        s.executeRequest(request, () => {
          executions++;
          return Promise.resolve({ protected_context: "보호된 값" });
        }));
    assertEquals(await execute(), { protected_context: "보호된 값" });
    await execute();
    assertEquals(executions, 1);
    await workspaces.updateWorkspaceMember(deps, key(f.a), w.id, f.b.userId, {
      expected_version: 1,
      grants: [settings],
    });
    await denied(execute);
    await denied(() =>
      runInWorkspace(
        sql,
        actor,
        { mode: "business", requirements: [] },
        (tx) => replayRetainedWorkspaceRequest(tx, actor, request, []),
      )
    );
    const other = { ...actor, workspaceId: (await f.create(f.b)).id };
    const separate = await deps.uow.workspace(
      other,
      { mode: "business", requirements: [] },
      (s) => s.executeRequest(request, () => Promise.resolve({ independent: true })),
    );
    assertEquals(separate, { independent: true });
  } finally {
    await f.cleanup();
  }
});
dbTest(
  "exclusive revocation waiter sees fresh state after shared business lock, including receipt replay",
  async () => {
    const f = await fixture();
    try {
      const w = await f.create(f.a);
      await f.join(f.a, f.b, w.id, [taskRead]);
      let release!: () => void, entered!: () => void;
      const held = new Promise<void>((resolve) => release = resolve),
        ready = new Promise<void>((resolve) => entered = resolve);
      const business = runInWorkspace(sql, { ...f.b, workspaceId: w.id }, {
        mode: "business",
        requirements: [taskRead],
      }, async () => {
        entered();
        await held;
      });
      await ready;
      let changed = false;
      const revoke = workspaces.updateWorkspaceMember(deps, key(f.a), w.id, f.b.userId, {
        expected_version: 1,
        grants: [],
      }).then(() => {
        changed = true;
      });
      await new Promise((r) => setTimeout(r, 30));
      assertEquals(changed, false);
      release();
      await business;
      await revoke;
      await denied(() =>
        runInWorkspace(
          sql,
          { ...f.b, workspaceId: w.id },
          { mode: "business", requirements: [taskRead] },
          () => Promise.resolve(),
        )
      );
      // Reverse order is the stale REPEATABLE READ regression: hold control update, then start a waiting read.
      await workspaces.updateWorkspaceMember(deps, key(f.a), w.id, f.b.userId, {
        expected_version: 2,
        grants: [taskRead],
      });
      let unlock!: () => void, controlEntered!: () => void;
      const pause = new Promise<void>((r) => unlock = r),
        locked = new Promise<void>((r) => controlEntered = r);
      const control = deps.uow.workspace(
        { ...f.a, workspaceId: w.id },
        { mode: "control", requirements: [settings] },
        async (s) => {
          await s.updateMember(f.b.userId, [], 3);
          controlEntered();
          await pause;
        },
      );
      await locked;
      const waiting = runInWorkspace(
        sql,
        { ...f.b, workspaceId: w.id },
        { mode: "business", requirements: [taskRead] },
        () => Promise.resolve(),
      );
      await new Promise((r) => setTimeout(r, 30));
      unlock();
      await control;
      await denied(() => waiting);
    } finally {
      await f.cleanup();
    }
  },
);
dbTest("application roles cannot bypass workspace storage or expose permission/receipt helpers", async () => {
  const roles =
    await admin`select rolname,rolsuper,rolbypassrls from pg_roles where rolname in ('app_user','app_server','app_worker')`;
  for (const role of roles) {
    assertEquals(role.rolsuper, false);
    assertEquals(role.rolbypassrls, false);
  }
  const [acl] = await admin`select has_table_privilege('app_server','private.workspace_grants','SELECT') as server_read,
  has_table_privilege('app_user','private.workspace_grants','UPDATE') as user_write,
  has_function_privilege('authenticated','app.workspace_update_member(uuid,jsonb,integer)','EXECUTE') as direct_control,
  has_function_privilege('anon','app.begin_workspace_request(uuid,text,text,jsonb)','EXECUTE') as direct_receipt`;
  assertEquals(acl, { server_read: false, user_write: false, direct_control: false, direct_receipt: false });
  assert(roles.length === 3);
});
