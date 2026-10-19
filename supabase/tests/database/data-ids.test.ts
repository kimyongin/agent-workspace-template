import { assert, assertEquals } from "@std/assert";
import { connect, dbTest, urls } from "./_db.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { completeTask, createTask } from "../../functions/_shared/core/activity/application.ts";
import { createTag, setTagConnections } from "../../functions/_shared/core/tags/application.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
const admin = connect(urls.admin, { max: 4 }), server = connect(urls.direct, { max: 4 });
const format = /^\d{8}-[A-Z0-9]{8}$/;
dbTest("서버 날짜형 ID 기본값은 공간 안의 저장된 대상·연결·수행 결과를 지원한다", async () => {
  const fixture = await businessWorkspaceFixture(admin, server), actor = fixture.manager;
  try {
    const requirements = [
      { target_kind: "settings", target_id: "*", access: "write" },
      { target_kind: "tasks", target_id: "*", access: "write" },
    ] as const;
    await fixture.grant(actor, [...requirements]);
    const tags = { uow: new SqlTagUnitOfWork(server) };
    const activity = { uow: new SqlUnitOfWork(server), clock: { now: () => new Date() } };
    const tag = await createTag(tags, businessRequest(actor), { name: "키 검증", scope: "task" });
    const task = await createTask(
      activity,
      businessRequest(actor),
      taskCreate.parse({ kind: "once", title: "키 검증" }),
    );
    const linked = await setTagConnections(tags, businessRequest(actor), {
      target_kind: "task",
      target_id: task.id,
      expected_version: task.version,
      tag_ids: [tag.id],
    });
    const completed = await completeTask(activity, businessRequest(actor), task.id, {
      expected_version: linked.version,
      body: "키 검증",
    });
    for (const value of [tag.id, task.id, completed.record.id]) assert(format.test(value));
    await runInWorkspace(server, actor, { mode: "business", requirements: [...requirements] }, async (tx) => {
      const [result] =
        await tx`select r.task_id,t.title from app.records r join app.tasks t on t.workspace_id=r.workspace_id and t.id=r.task_id where r.workspace_id=${fixture.workspaceId} and r.id=${completed.record.id}`;
      assertEquals(result, { task_id: task.id, title: "키 검증" });
      const [connection] =
        await tx`select tag_id from app.task_tags where workspace_id=${fixture.workspaceId} and task_id=${task.id}`;
      assertEquals(connection.tag_id, tag.id);
    });
  } finally {
    await fixture.cleanup();
  }
});
