import { assertEquals, assertRejects } from "@std/assert";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { taskCreate, taskListQuery, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 1, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest("workspace task writer creates and edits shared tasks independently of settings and revoked receipts", async () => {
  const f = await businessWorkspaceFixture(admin, sql);
  try {
    const input = taskCreate.parse({ kind: "once", title: "공유 할 일", body: "할 일 권한으로 공유한 본문" });
    const none = await assertRejects(() => activity.createTask(deps, businessRequest(f.manager), input), AppError);
    assertEquals(none.code, "forbidden");
    await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
    const request = businessRequest(f.member);
    const created = await activity.createTask(deps, request, input);
    assertEquals((await activity.getTask(deps, f.member, created.id)).body, input.body);
    assertEquals((await activity.listTasks(deps, f.member, taskListQuery.parse({}))).items.map((t) => t.id), [created.id]);
    const updated = await activity.updateTask(deps, businessRequest(f.member), created.id,
      taskUpdate.parse({ expected_version: created.version, title: "共同 작업 완료 준비" }));
    assertEquals(updated.title, "共同 작업 완료 준비");
    assertEquals(updated.version, created.version + 1);
    const other = await f.addWorkspace("별도 할 일 공간");
    await f.grant(other.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
    assertEquals((await activity.listTasks(deps, other.member, taskListQuery.parse({}))).items, []);
    assertEquals((await assertRejects(() => activity.getTask(deps, other.member, created.id), AppError)).code, "not_found");
    await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "read" }]);
    assertEquals((await activity.getTask(deps, f.member, created.id)).title, updated.title);
    assertEquals((await assertRejects(() => activity.updateTask(deps, businessRequest(f.member), created.id,
      taskUpdate.parse({ expected_version: updated.version, body: "읽기 권한의 변경" })), AppError)).code, "forbidden");
    await f.grant(f.member, []);
    assertEquals((await assertRejects(() => activity.createTask(deps, request, input), AppError)).code, "forbidden");
    assertEquals((await activity.listTasks(deps, f.member, taskListQuery.parse({}))).items, []);
  } finally {
    await f.cleanup();
  }
});
