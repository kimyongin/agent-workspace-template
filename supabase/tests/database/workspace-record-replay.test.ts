import { assertEquals, assertRejects } from "@std/assert";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { taskComplete, taskCreate } from "../../functions/_shared/contracts/task.ts";
import { recordListQuery, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 1, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest("workspace record retries replay deleted targets only under current saved parent authority", async () => {
  const f = await businessWorkspaceFixture(admin, sql);
  try {
    await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
    const task = await activity.createTask(
      deps,
      businessRequest(f.member),
      taskCreate.parse({ kind: "once", title: "응답 불명 후 재확인" }),
    );
    const result = await activity.completeTask(
      deps,
      businessRequest(f.member),
      task.id,
      taskComplete.parse({ expected_version: task.version, body: "원래 수행 결과" }),
    );
    const memoRequest = businessRequest(f.member);
    const patch = recordUpdate.parse({ expected_version: result.record.version, body: "정정한 수행 결과" });
    const edited = await activity.updateRecord(deps, memoRequest, result.record.id, patch);
    const deleteRequest = businessRequest(f.member);
    await activity.deleteRecord(deps, deleteRequest, edited.id, edited.version);
    const retained = await activity.listRecords(deps, f.member, recordListQuery.parse({ task_id: task.id }));
    await activity.deleteRecord(deps, deleteRequest, edited.id, edited.version);
    assertEquals(await activity.updateRecord(deps, memoRequest, edited.id, patch), edited);
    assertEquals(
      (await activity.listRecords(deps, f.member, recordListQuery.parse({ task_id: task.id }))).items.length,
      retained.items.length,
    );
    assertEquals((await activity.getTask(deps, f.member, task.id)).result_record, null);
    await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "read" }]);
    assertEquals(
      (await assertRejects(() => activity.deleteRecord(deps, deleteRequest, edited.id, edited.version), AppError)).code,
      "forbidden",
    );
    assertEquals(
      (await assertRejects(() => activity.updateRecord(deps, memoRequest, edited.id, patch), AppError)).code,
      "forbidden",
    );
    await f.grant(f.member, []);
    assertEquals(
      (await assertRejects(() => activity.deleteRecord(deps, deleteRequest, edited.id, edited.version), AppError)).code,
      "forbidden",
    );
    await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
    assertEquals(
      (await assertRejects(
        () => activity.deleteRecord(deps, businessRequest(f.member), edited.id, edited.version),
        AppError,
      )).code,
      "not_found",
    );
    assertEquals(
      (await assertRejects(() => activity.deleteRecord(deps, deleteRequest, edited.id, edited.version + 1), AppError))
        .code,
      "idempotency_key_reused",
    );
    await activity.deleteRecord(deps, deleteRequest, edited.id, edited.version);
    assertEquals(await activity.updateRecord(deps, memoRequest, edited.id, patch), edited);
    const other = await f.addWorkspace("다른 공간의 요청 원장");
    await f.grant(other.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
    assertEquals(
      (await assertRejects(
        () =>
          activity.deleteRecord(deps, { ...deleteRequest, workspaceId: other.workspaceId }, edited.id, edited.version),
        AppError,
      )).code,
      "not_found",
    );
  } finally {
    await f.cleanup();
  }
});
