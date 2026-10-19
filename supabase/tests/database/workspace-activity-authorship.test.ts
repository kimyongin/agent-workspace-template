import { assertEquals } from "@std/assert";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { taskComplete, taskCreate } from "../../functions/_shared/contracts/task.ts";
import { recordListQuery } from "../../functions/_shared/contracts/record.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 1, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest("workspace task results retain bounded author display after the initiating account is deleted", async () => {
  const f = await businessWorkspaceFixture(admin, sql);
  try {
    // Decorative profile fixture only; the explicit task grant authorizes every command.
    await admin`update auth.users set raw_user_meta_data=${
      admin.json({ full_name: "공동 업무 작성자", email: "private-author@example.test" })
    } where id=${f.member.userId}`;
    await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
    await f.grant(f.manager, [
      { target_kind: "settings", target_id: "*", access: "write" },
      { target_kind: "tasks", target_id: "*", access: "read" },
    ]);
    const task = await activity.createTask(
      deps,
      businessRequest(f.member),
      taskCreate.parse({ kind: "once", title: "작성자 탈퇴 뒤에도 유지할 업무" }),
    );
    assertEquals(task.created_by_name, "공동 업무 작성자");
    const result = await activity.completeTask(
      deps,
      businessRequest(f.member),
      task.id,
      taskComplete.parse({ expected_version: task.version, body: "공동으로 보존하는 수행 결과" }),
    );
    assertEquals(Reflect.get(result.record, "created_by_name"), "공동 업무 작성자");
    assertEquals(Reflect.get(result.record, "created_by"), f.member.userId);
    assertEquals(JSON.stringify(result.record).includes("private-author@example.test"), false);
    // This deletion owns only the fixture's initiating Auth UID, never a live account.
    await admin`delete from auth.users where id=${f.member.userId}`;
    const retained = await activity.getTask(deps, f.manager, task.id);
    assertEquals(retained.created_by, null);
    assertEquals(retained.created_by_name, "공동 업무 작성자");
    assertEquals(retained.result_record, { id: result.record.id, body: result.record.body });
    const record = await activity.getRecord(deps, f.manager, result.record.id);
    assertEquals(record.task_id, task.id);
    assertEquals(Reflect.get(record, "created_by"), null);
    assertEquals(Reflect.get(record, "created_by_name"), "공동 업무 작성자");
    assertEquals(record.body, result.record.body);
    const history = await activity.listRecords(deps, f.manager, recordListQuery.parse({ task_id: task.id }));
    assertEquals(history.items.length, 2);
    assertEquals(history.items.every((item) => Reflect.get(item, "created_by") === null), true);
    assertEquals(history.items.every((item) => Reflect.get(item, "created_by_name") === "공동 업무 작성자"), true);
  } finally {
    await f.cleanup();
  }
});
