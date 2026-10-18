import { entityFixture } from "./_entity.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import type { WorkspaceGrant } from "../../functions/_shared/contracts/workspace.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { SqlWorkspaceUnitOfWork } from "../../functions/_shared/adapters/supabase/workspace-store.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { replayRetainedWorkspaceRequest } from "../../functions/_shared/adapters/supabase/workspace-request-ledger.ts";
import { requestIdentity } from "../../functions/_shared/core/shared/request.ts";
import * as workspaces from "../../functions/_shared/core/workspaces/application.ts";
import { asUser, connect, dbTest, outcome, urls } from "./_db.ts";
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
      const actor = key(f.a);
      const created = await Promise.all(
        Array.from(
          { length: 3 },
          () =>
            workspaces.createWorkspace(deps, { ...actor, request: { key: actor.request.key } }, { name: "첫 공간" }),
        ),
      );
      const first = created[0];
      for (const result of created) assertEquals(result, first);
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
        await denied(
          () =>
            deps.uow.account(f.a, async (s) => {
              await s.create("롤백될 공간");
              throw new Error("rollback");
            }),
          "internal",
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

dbTest("all scoped legacy store delegates use workspace receipts for normal and retained replay", async () => {
  const f = await fixture();
  try {
    const first = await f.create(f.a), second = await f.create(f.a);
    await workspaces.updateWorkspaceMember(deps, key(f.a), first.id, f.a.userId, {
      expected_version: 1,
      grants: [settings, taskRead],
    });
    const actor = { ...key(f.a), workspaceId: first.id };
    const request = await requestIdentity(actor, "scoped.delegate.probe", null, {});
    const { SqlActorStore } = await import("../../functions/_shared/adapters/supabase/sql-context.ts");
    const { replayRetainedSqlRequest } = await import("../../functions/_shared/adapters/supabase/request-ledger.ts");
    let executions = 0;
    const execute = () =>
      runInWorkspace(
        sql,
        actor,
        { mode: "business", requirements: [taskRead] },
        (tx) =>
          new SqlActorStore(tx, actor).executeRequest(
            request,
            () => Promise.resolve({ body: "첫 공간", attempt: ++executions }),
          ),
      );
    assertEquals(await execute(), { body: "첫 공간", attempt: 1 });
    assertEquals(await execute(), { body: "첫 공간", attempt: 1 });
    const other = { ...actor, workspaceId: second.id };
    const otherRequest = await requestIdentity(other, "scoped.delegate.probe", null, {});
    assertEquals(
      await runInWorkspace(
        sql,
        other,
        { mode: "business", requirements: [] },
        (tx) => new SqlActorStore(tx, other).executeRequest(otherRequest, () => Promise.resolve({ body: "둘째 공간" })),
      ),
      { body: "둘째 공간" },
    );
    await workspaces.updateWorkspaceMember(deps, key(f.a), first.id, f.a.userId, {
      expected_version: 2,
      grants: [settings],
    });
    await denied(execute);
    await denied(() =>
      runInWorkspace(
        sql,
        actor,
        { mode: "business", requirements: [] },
        (tx) => replayRetainedSqlRequest(tx, actor, request),
      )
    );
    assertEquals(executions, 1);
  } finally {
    await f.cleanup();
  }
});

dbTest("pooled connection clears actor and workspace after commit and rollback before another scope", async () => {
  const f = await fixture(), reused = connect(urls.direct, { max: 1, prepare: false });
  try {
    const a = await f.create(f.a), b = await f.create(f.b);
    const inspect = async (actor: Actor, id: string) =>
      await runInWorkspace(
        reused,
        { ...actor, workspaceId: id },
        { mode: "business", requirements: [] },
        async (tx) => {
          const [row] =
            await tx`select current_user as role,app.current_workspace_id()::text as workspace,current_setting('request.jwt.claims')::jsonb->>'sub' as actor`;
          return row;
        },
      );
    assertEquals(await inspect(f.a, a.id), { role: "app_user", workspace: a.id, actor: f.a.userId });
    assertEquals(await inspect(f.b, b.id), { role: "app_user", workspace: b.id, actor: f.b.userId });
    await denied(
      () =>
        runInWorkspace(
          reused,
          { ...f.a, workspaceId: a.id },
          { mode: "business", requirements: [] },
          () => Promise.reject(new AppError("conflict", "rollback")),
        ),
      "conflict",
    );
    const [after] =
      await reused`select current_user as role,current_setting('request.workspace_id',true) as workspace,current_setting('request.jwt.claims',true) as actor`;
    assertEquals(after.role, "app_server");
    assert(!after.workspace);
    assert(!after.actor);
    await denied(
      async () =>
        await Promise.resolve(
          runInWorkspace(reused, { ...f.a, workspaceId: "" }, { mode: "business", requirements: [] }, () =>
            Promise.resolve()),
        ),
      "invalid_input",
    );
    await denied(() => inspect(f.b, a.id));
    assertEquals(await inspect(f.b, b.id), { role: "app_user", workspace: b.id, actor: f.b.userId });
  } finally {
    await reused.end();
    await f.cleanup();
  }
});

dbTest("scoped kind anchors reject direct owner-policy escapes and cross-workspace grant targets", async () => {
  const f = await fixture();
  try {
    const first = await f.create(f.a), second = await f.create(f.a), foreign = await f.create(f.b);
    const kind = await entityFixture(admin, f.a.userId);
    await admin`update app.entity_types set workspace_id=${first.id} where id=${kind.entity_type_id}`;
    const direct = async (id: string, fn: (tx: import("postgres").TransactionSql) => Promise<unknown>) =>
      await asUser(sql, f.a.userId, async (tx) => {
        await tx`select set_config('request.workspace_id',${id},true)`;
        return await fn(tx);
      });
    const readable = await direct(
      first.id,
      (tx) => tx`select id from app.entity_types where id=${kind.entity_type_id}`,
    ) as { id: string }[];
    assertEquals(readable.length, 1);
    const cross = await direct(
      second.id,
      (tx) => tx`select id from app.entity_types where id=${kind.entity_type_id}`,
    ) as unknown[];
    assertEquals(cross.length, 0);
    const moved = await direct(
      second.id,
      (tx) => tx`update app.entity_types set workspace_id=${second.id} where id=${kind.entity_type_id} returning id`,
    ) as unknown[];
    assertEquals(moved.length, 0);
    const injected = await outcome(
      direct(
        foreign.id,
        (tx) =>
          tx`insert into app.entity_types(owner_id,workspace_id) values(${f.a.userId},${foreign.id}) returning id`,
      ),
    );
    assert(injected.startsWith("42501"));
    await denied(
      () =>
        workspaces.updateWorkspaceMember(deps, key(f.a), second.id, f.a.userId, {
          expected_version: 1,
          grants: [settings, { target_kind: "entity_type", target_id: kind.entity_type_id, access: "read" }],
        }),
      "invalid_input",
    );
    const readPermission = await runInWorkspace(
      sql,
      { ...f.a, workspaceId: first.id },
      { mode: "business", requirements: [] },
      async (tx) =>
        (await tx`select app.workspace_allows('entity_type',${kind.entity_type_id},'read') as allowed`)[0].allowed,
    );
    assertEquals(readPermission, false); // Settings-write can read minimal definitions but grants no material-data access.
    await workspaces.updateWorkspaceMember(deps, key(f.a), first.id, f.a.userId, {
      expected_version: 1,
      grants: [settings, { target_kind: "entity_type", target_id: kind.entity_type_id, access: "read" }],
    });
    await runInWorkspace(sql, { ...f.a, workspaceId: first.id }, {
      mode: "business",
      requirements: [{ target_kind: "entity_type", target_id: kind.entity_type_id, access: "read" }],
    }, () => Promise.resolve());
    await admin`update auth.users set raw_user_meta_data=${
      admin.json({ full_name: "  표시 이름\n ", email: "never-expose@example.test" })
    } where id=${f.a.userId}`;
    const member = (await workspaces.listWorkspaceMembers(deps, f.a, first.id)).items[0];
    assertEquals(member.display_name, "표시 이름");
    assertEquals(JSON.stringify(member).includes("never-expose@example.test"), false);
  } finally {
    await f.cleanup();
  }
});
