import { assertEquals } from "@std/assert";
import { SqlWorkspaceUnitOfWork } from "../../functions/_shared/adapters/supabase/workspace-store.ts";
import { createWorkspace } from "../../functions/_shared/core/workspaces/application.ts";
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
      await outcome(admin`update auth.users set banned_until=clock_timestamp()+interval '1 day' where id=${actor.userId}`),
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
