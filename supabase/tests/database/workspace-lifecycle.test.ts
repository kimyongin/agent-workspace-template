import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlWorkspaceUnitOfWork } from "../../functions/_shared/adapters/supabase/workspace-store.ts";
import { createWorkspace } from "../../functions/_shared/core/workspaces/application.ts";
import * as workspaces from "../../functions/_shared/core/workspaces/application.ts";
import {
  lockWorkspace,
  runInWorkspace,
  workspaceAccount,
} from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { replayRetainedWorkspaceRequest } from "../../functions/_shared/adapters/supabase/workspace-request-ledger.ts";
import { requestIdentity } from "../../functions/_shared/core/shared/request.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, outcome, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 3 });
const sql = connect(urls.direct, { max: 3, prepare: false });
const deps = { uow: new SqlWorkspaceUnitOfWork(sql) };
const keyed = (actor: { userId: string }) => ({ ...actor, request: { key: crypto.randomUUID() } });

dbTest(
  "the final manager may leave a deleted workspace without destroying it or gaining restore authority",
  async () => {
    const actor = { userId: crypto.randomUUID() };
    let id: string | undefined;
    await admin`insert into auth.users(id,email) values(${actor.userId},${`workspace517-${actor.userId}@example.test`})`;
    try {
      id = (await createWorkspace(deps, keyed(actor), { name: "탈퇴 후 보존" })).workspace.id;
      await workspaces.deleteWorkspace(deps, keyed(actor), id, { expected_generation: 1 });
      const request = keyed(actor), input = { expected_version: 1 };
      assertEquals(await workspaces.leaveWorkspace(deps, request, id, input), { left: true });
      assertEquals((await workspaces.listDeletedWorkspaces(deps, actor)).items, []);
      assertEquals(
        (await assertRejects(() => workspaces.leaveWorkspace(deps, request, id, input), AppError)).code,
        "forbidden",
      );
      assertEquals(
        (await assertRejects(
          () => workspaces.restoreWorkspace(deps, keyed(actor), id, { expected_generation: 2 }),
          AppError,
        )).code,
        "forbidden",
      );
      const [preserved] = await admin`select deleted_at is not null as deleted from app.workspaces where id=${id}`;
      assertEquals(preserved, { deleted: true });
    } finally {
      if (id) await admin`delete from app.workspaces where id=${id}`;
      await admin`delete from auth.users where id=${actor.userId}`;
    }
  },
);

dbTest(
  "concurrent physical and soft Auth removals preserve one real administrator across shared workspaces",
  async () => {
    for (const kind of ["delete", "soft", "mixed"] as const) {
      const users = [{ userId: crypto.randomUUID() }, { userId: crypto.randomUUID() }], roots: string[] = [];
      for (const user of users) {
        const email = `workspace517-${user.userId}@example.test`;
        await admin`insert into auth.users(id,email) values(${user.userId},${email})`;
        await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data) values(${crypto.randomUUID()},${user.userId},'google',${user.userId},${
          admin.json({ sub: user.userId, email, email_verified: true })
        })`;
      }
      try {
        for (const name of ["공동 공간 1", "공동 공간 2"]) {
          const workspace = (await createWorkspace(deps, keyed(users[0]), { name })).workspace;
          roots.push(workspace.id);
          const invitation = await workspaces.inviteWorkspaceMember(deps, keyed(users[0]), workspace.id, {
            email: `workspace517-${users[1].userId}@example.test`,
            grants: [{ target_kind: "settings", target_id: "*", access: "write" }],
          });
          await workspaces.acceptWorkspaceInvitation(deps, keyed(users[1]), invitation.invitation.id);
        }
        const results = await Promise.all(users.map((user, index) =>
          outcome(
            kind === "delete" || kind === "mixed" && index === 0
              ? admin`delete from auth.users where id=${user.userId}`
              : admin`update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=${user.userId}`,
          )
        ));
        assertEquals(
          results.filter((result) => result === "ok").length,
          1,
        );
        assertEquals(results.filter((result) => result === "23514 workspace_final_admin").length, 1);
        const survivor = users[results.findIndex((result) => result !== "ok")];
        for (const id of roots) {
          assertEquals((await workspaces.workspaceDetails(deps, survivor, id)).can_manage, true);
          const members = (await workspaces.listWorkspaceMembers(deps, survivor, id)).items;
          assert(members.some((member) => member.user_id === survivor.userId));
        }
      } finally {
        for (const id of roots) await admin`delete from app.workspaces where id=${id}`;
        for (const user of users) await admin`delete from auth.users where id=${user.userId}`;
      }
    }
  },
);

dbTest(
  "public lifecycle use cases reject nonmanagers, isolate actor receipts and recheck revoked authority",
  async () => {
    const users = Array.from({ length: 3 }, () => ({ userId: crypto.randomUUID() }));
    const [a, b, c] = users;
    let workspaceId: string | undefined;
    const forbidden = async (run: () => Promise<unknown>, expected = "forbidden") =>
      assertEquals((await assertRejects(run, AppError)).code, expected);
    for (const user of users) {
      const email = `workspace517-${user.userId}@example.test`;
      await admin`insert into auth.users(id,email) values(${user.userId},${email})`;
      await admin`insert into auth.identities(id,user_id,provider,provider_id,identity_data) values(${crypto.randomUUID()},${user.userId},'google',${user.userId},${
        admin.json({ sub: user.userId, email, email_verified: true })
      })`;
    }
    try {
      workspaceId = (await createWorkspace(deps, keyed(a), { name: "공개 공간 수명" })).workspace.id;
      for (const user of [b, c]) {
        const invite = await workspaces.inviteWorkspaceMember(deps, keyed(a), workspaceId, {
          email: `workspace517-${user.userId}@example.test`,
          grants: [{
            target_kind: user === b ? "settings" : "tasks",
            target_id: "*",
            access: user === b ? "write" : "read",
          }],
        });
        await workspaces.acceptWorkspaceInvitation(deps, keyed(user), invite.invitation.id);
      }
      assertEquals(
        (await workspaces.listWorkspaces(deps, a)).items.map((item) =>
          (item as typeof item & { can_manage?: boolean }).can_manage
        ),
        [true],
      );
      assertEquals(
        (await workspaces.listWorkspaces(deps, c)).items.map((item) =>
          (item as typeof item & { can_manage?: boolean }).can_manage
        ),
        [false],
      );
      await forbidden(() => workspaces.deleteWorkspace(deps, keyed(c), workspaceId, { expected_generation: 1 }));
      const request = keyed(a), input = { expected_generation: 1 };
      const deleted = await workspaces.deleteWorkspace(deps, request, workspaceId, input);
      assertEquals(await workspaces.deleteWorkspace(deps, request, workspaceId, input), deleted);
      assertEquals((await workspaces.listDeletedWorkspaces(deps, b)).items, [deleted.workspace]);
      assertEquals((await workspaces.listDeletedWorkspaces(deps, c)).items, []);
      await forbidden(() => workspaces.restoreWorkspace(deps, keyed(c), workspaceId, { expected_generation: 2 }));
      await forbidden(
        () => workspaces.deleteWorkspace(deps, { ...b, request: { key: request.request.key } }, workspaceId, input),
        "conflict",
      );
      assertEquals(
        (await workspaces.restoreWorkspace(deps, keyed(b), workspaceId, { expected_generation: 2 })).workspace
          .lifecycle_generation,
        3,
      );
      await workspaces.updateWorkspaceMember(deps, keyed(b), workspaceId, a.userId, {
        expected_version: 1,
        grants: [],
      });
      await forbidden(() => workspaces.deleteWorkspace(deps, request, workspaceId, input));
      const scoped = { ...request, workspaceId };
      const identity = await requestIdentity(scoped, "workspace.delete", workspaceId, input);
      await forbidden(() =>
        deps.uow.workspace(
          scoped,
          { mode: "business", requirements: [] },
          (store) => store.executeRequest(identity, () => Promise.resolve({ unexpected: true })),
        )
      );
      await forbidden(() =>
        runInWorkspace(
          sql,
          scoped,
          { mode: "business", requirements: [] },
          (tx) => replayRetainedWorkspaceRequest(tx, scoped, identity, []),
        )
      );
      await forbidden(
        () => workspaces.deleteWorkspace(deps, keyed(b), workspaceId, { expected_generation: 1 }),
        "conflict",
      );
      await workspaces.deleteWorkspace(deps, keyed(b), workspaceId, { expected_generation: 3 });
      const own = await workspaces.workspaceMembershipDetails(deps, c, workspaceId);
      assertEquals(Object.keys(own).sort(), ["membership_version", "workspace"]);
      assertEquals(Object.keys(own.workspace).sort(), ["deleted_at", "id", "name"]);
      assertEquals(own.membership_version, 1);
      assertEquals(
        await workspaces.leaveWorkspace(deps, keyed(c), workspaceId, { expected_version: own.membership_version }),
        { left: true },
      );
      await forbidden(() => workspaces.workspaceMembershipDetails(deps, c, workspaceId));
      await workspaces.restoreWorkspace(deps, keyed(b), workspaceId, { expected_generation: 4 });
      assertEquals((await workspaces.workspaceDetails(deps, b, workspaceId)).can_manage, true);
    } finally {
      if (workspaceId) await admin`delete from app.workspaces where id=${workspaceId}`;
      for (const user of users) await admin`delete from auth.users where id=${user.userId}`;
    }
  },
);

dbTest("Auth invalidation cannot leave an active workspace without its final valid administrator", async () => {
  const actor = { userId: crypto.randomUUID(), request: { key: crypto.randomUUID() } };
  let workspaceId: string | undefined;
  await admin`insert into auth.users(id,email) values(${actor.userId},${`workspace517-${actor.userId}@example.test`})`;
  try {
    workspaceId = (await createWorkspace(deps, actor, { name: "보호할 공동 공간" })).workspace.id;
    const results = [
      await outcome(admin`update auth.users set deleted_at=clock_timestamp() where id=${actor.userId}`),
      await outcome(
        admin`update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=${actor.userId}`,
      ),
      await outcome(admin`delete from auth.users where id=${actor.userId}`),
    ];
    assertEquals(results, Array(3).fill("23514 workspace_final_admin"));
    const [user] = await admin`select deleted_at,banned_until from auth.users where id=${actor.userId}`;
    assertEquals(user, { deleted_at: null, banned_until: null });
  } finally {
    if (workspaceId) await admin`delete from app.workspaces where id=${workspaceId}`;
    await admin`delete from auth.users where id=${actor.userId}`;
  }
});

dbTest(
  "workspace author snapshots contain a bounded decorative name and never Auth email or metadata secrets",
  async () => {
    const actor = { userId: crypto.randomUUID(), request: { key: crypto.randomUUID() } };
    let workspaceId: string | undefined;
    await admin`insert into auth.users(id,email,raw_user_meta_data) values(${actor.userId},${`workspace517-${actor.userId}@example.test`},${
      admin.json({ full_name: "  공유 작성자\n ", email: "hidden@example.test", secret: "never-publish" })
    })`;
    try {
      workspaceId = (await createWorkspace(deps, actor, { name: "작성자 문맥" })).workspace.id;
      const actual = await workspaceAccount(sql, actor, async (tx) => {
        await lockWorkspace(tx, workspaceId!, "business");
        await tx`select app.authorize_workspace('[]'::jsonb)`;
        return (await tx`select app.workspace_author() as author,app.workspace_generation() as generation`)[0];
      });
      assertEquals(actual, { author: { created_by: actor.userId, created_by_name: "공유 작성자" }, generation: "1" });
    } finally {
      if (workspaceId) await admin`delete from app.workspaces where id=${workspaceId}`;
      await admin`delete from auth.users where id=${actor.userId}`;
    }
  },
);

dbTest(
  "account invalidation waits for an uncommitted first workspace and then preserves its final administrator",
  async () => {
    const actor = { userId: crypto.randomUUID() };
    let workspaceId: string | undefined;
    let release!: () => void, entered!: () => void;
    const held = new Promise<void>((resolve) => release = resolve);
    const ready = new Promise<void>((resolve) => entered = resolve);
    await admin`insert into auth.users(id,email) values(${actor.userId},${`workspace517-${actor.userId}@example.test`})`;
    let creation: Promise<unknown> | undefined;
    let invalidation: Promise<string> | undefined;
    const invalidator = await admin.reserve();
    const [connection] = await invalidator`select pg_backend_pid() as pid`;
    let creatorPid = 0;
    try {
      creation = workspaceAccount(sql, actor, async (tx) => {
        const [creator] = await tx`select pg_backend_pid() as pid,app.workspace_create('동시 생성 공간') as result`;
        creatorPid = creator.pid;
        workspaceId = creator.result.workspace.id;
        entered();
        await held;
      });
      await ready;
      let settled = false;
      invalidation = outcome(invalidator`update auth.users set deleted_at=clock_timestamp() where id=${actor.userId}`)
        .then(
          (result) => {
            settled = true;
            return result;
          },
        );
      let blockedByCreator = false;
      const deadline = Date.now() + 3000;
      while (!settled && Date.now() < deadline) {
        const [waiting] =
          await admin`select ${creatorPid}::integer=any(pg_blocking_pids(${connection.pid})) as blocked`;
        if (waiting.blocked) {
          blockedByCreator = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assert(blockedByCreator, "Auth UPDATE must actually wait on the uncommitted creator connection");
      assertEquals(settled, false);
      release();
      await creation;
      assertEquals(await invalidation, "23514 workspace_final_admin");
      assertEquals(
        (await deps.uow.workspace(
          { ...actor, workspaceId: workspaceId! },
          { mode: "business", requirements: [] },
          (s) => s.details(),
        )).can_manage,
        true,
      );
    } finally {
      release();
      await creation?.catch(() => {});
      await invalidation?.catch(() => {});
      invalidator.release();
      if (workspaceId) await admin`delete from app.workspaces where id=${workspaceId}`;
      await admin`delete from auth.users where id=${actor.userId}`;
    }
  },
);

dbTest(
  "deleted workspace discovery and lifecycle receipts require current management without reopening business replay",
  async () => {
    const actor = { userId: crypto.randomUUID(), request: { key: crypto.randomUUID() } };
    let workspaceId: string | undefined;
    await admin`insert into auth.users(id,email) values(${actor.userId},${`workspace517-${actor.userId}@example.test`})`;
    const fingerprint = "a".repeat(64), requestKey = crypto.randomUUID();
    try {
      workspaceId = (await createWorkspace(deps, actor, { name: "삭제 재확인" })).workspace.id;
      const execute = () =>
        workspaceAccount(sql, actor, async (tx) => {
          await lockWorkspace(tx, workspaceId!, "control");
          const [started] =
            await tx`select app.begin_workspace_lifecycle_request(${requestKey}::uuid,'workspace.delete',${fingerprint}) as receipt`;
          if (started.receipt.state === "replay") return started.receipt.result;
          assertEquals(started.receipt.state, "new");
          const [deleted] = await tx`select app.workspace_set_deleted(1,true) as result`;
          await tx`select app.finish_workspace_request(${requestKey}::uuid,${
            tx.json(deleted.result)
          },'[]'::jsonb,false)`;
          return deleted.result;
        });
      const result = await execute();
      assertEquals(await execute(), result);
      const listed = await workspaceAccount(
        sql,
        actor,
        async (tx) => (await tx`select app.deleted_workspaces() as result`)[0].result,
      );
      assertEquals(listed.items, [result.workspace]);
      const denied = await assertRejects(() =>
        workspaceAccount(sql, actor, async (tx) => {
          await lockWorkspace(tx, workspaceId!, "control");
          await tx`select app.begin_workspace_request(${requestKey}::uuid,'workspace.delete',${fingerprint},'[]'::jsonb)`;
        }), AppError);
      assertEquals(denied.code, "forbidden");
    } finally {
      if (workspaceId) await admin`delete from app.workspaces where id=${workspaceId}`;
      await admin`delete from auth.users where id=${actor.userId}`;
    }
  },
);

dbTest(
  "workspace lifecycle preserves membership, denies ordinary access and restores only through current management",
  async () => {
    const actor = { userId: crypto.randomUUID(), request: { key: crypto.randomUUID() } };
    let workspaceId: string | undefined;
    await admin`insert into auth.users(id,email) values(${actor.userId},${`workspace517-${actor.userId}@example.test`})`;
    try {
      workspaceId = (await createWorkspace(deps, actor, { name: "복원할 공간" })).workspace.id;
      const lifecycle = (deleted: boolean, generation: number) =>
        workspaceAccount(sql, actor, async (tx) => {
          await lockWorkspace(tx, workspaceId!, "control");
          const [row] = await tx`select app.workspace_set_deleted(${generation},${deleted}) as result`;
          return row.result;
        });
      const deleted = await lifecycle(true, 1);
      assertEquals(deleted.workspace.id, workspaceId);
      assertEquals(deleted.workspace.lifecycle_generation, 2);
      const error = await assertRejects(() =>
        deps.uow.workspace({ ...actor, workspaceId: workspaceId! }, {
          mode: "business",
          requirements: [],
        }, (s) => s.details()), AppError);
      assertEquals(error.code, "forbidden");
      const restored = await lifecycle(false, 2);
      assertEquals(restored.workspace.lifecycle_generation, 3);
      assertEquals(restored.workspace.deleted_at, null);
      assertEquals(
        (await deps.uow.workspace(
          { ...actor, workspaceId: workspaceId! },
          { mode: "business", requirements: [] },
          (s) => s.details(),
        )).can_manage,
        true,
      );
    } finally {
      if (workspaceId) await admin`delete from app.workspaces where id=${workspaceId}`;
      await admin`delete from auth.users where id=${actor.userId}`;
    }
  },
);
