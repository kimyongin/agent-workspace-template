import { assertEquals, assertRejects } from "@std/assert";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { taskComplete, taskCreate } from "../../functions/_shared/contracts/task.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 1, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest("workspace task completion stores one immutable task result and replays the same atomic outcome", async () => {
  const f = await businessWorkspaceFixture(admin, sql);
  try {
    await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
    const created = await activity.createTask(
      deps,
      businessRequest(f.member),
      taskCreate.parse({
        kind: "once",
        title: "완료할 공동 업무",
        body: "공동 업무 본문",
      }),
    );
    const request = businessRequest(f.member);
    const input = taskComplete.parse({ expected_version: created.version, body: "실제 수행 결과" });
    const completed = await activity.completeTask(deps, request, created.id, input);
    assertEquals(completed.task.status, "done");
    assertEquals(completed.task.result_record_id, completed.record.id);
    assertEquals(completed.record.task_id, created.id);
    assertEquals("entity_ids" in completed.record, false);
    assertEquals("entity_context" in completed.record, false);
    assertEquals((await activity.getTask(deps, f.member, created.id)).result_record, {
      id: completed.record.id,
      body: input.body,
    });
    assertEquals(await activity.completeTask(deps, request, created.id, input), completed);
    const other = await f.addWorkspace("다른 완료 업무 공간");
    await f.grant(other.member, [{ target_kind: "tasks", target_id: "*", access: "read" }]);
    assertEquals(
      (await assertRejects(() => activity.getRecord(deps, other.member, completed.record.id), AppError)).code,
      "not_found",
    );
    // Supplemental storage checks follow successful public creation and reading.
    const [stored] =
      await admin`select owner_id,workspace_id,entity_id,task_id,created_by from app.records where id=${completed.record.id}`;
    assertEquals({ ...stored }, {
      owner_id: null,
      workspace_id: f.workspaceId,
      entity_id: null,
      task_id: created.id,
      created_by: f.member.userId,
    });
    const [index] =
      await admin`select count(*)::integer as count from app.search_index_state where workspace_id=${f.workspaceId} and kind='record' and id=${completed.record.id}`;
    assertEquals(index.count, 1);
  } finally {
    await f.cleanup();
  }
});
