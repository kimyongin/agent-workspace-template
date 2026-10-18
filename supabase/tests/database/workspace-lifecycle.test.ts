import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlWorkspaceUnitOfWork } from "../../functions/_shared/adapters/supabase/workspace-store.ts";
import { createWorkspace } from "../../functions/_shared/core/workspaces/application.ts";
import { lockWorkspace, workspaceAccount } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, outcome, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 3 });
const sql = connect(urls.direct, { max: 3, prepare: false });
const deps = { uow: new SqlWorkspaceUnitOfWork(sql) };

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
