import { assertEquals, assertRejects } from "@std/assert";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as tags from "../../functions/_shared/core/tags/application.ts";
import { taskComplete, taskCreate, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { recordListQuery, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 1, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
const tagDeps = { uow: new SqlTagUnitOfWork(sql) };

dbTest(
  "workspace saved task and result classification stays independent of content and replays current parent authority",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
      const taskTag = await tags.createTag(tagDeps, businessRequest(f.member), { scope: "task", name: "계획 분류" });
      const resultTag = await tags.createTag(tagDeps, businessRequest(f.member), {
        scope: "record",
        name: "결과 분류",
      });
      const task = await activity.createTask(
        deps,
        businessRequest(f.member),
        taskCreate.parse({ kind: "once", title: "저장 뒤 독립 분류" }),
      );
      const taskRequest = businessRequest(f.member);
      const taskInput = {
        target_kind: "task",
        target_id: task.id,
        expected_version: task.version,
        tag_ids: [taskTag.id],
      };
      const connectedTask = await tags.setTagConnections(tagDeps, taskRequest, taskInput);
      assertEquals(connectedTask.tag_ids, [taskTag.id]);
      assertEquals(connectedTask.version, task.version + 1);
      const editedTask = await activity.updateTask(
        deps,
        businessRequest(f.member),
        task.id,
        taskUpdate.parse({ expected_version: connectedTask.version, body: "태그를 덮지 않는 본문 변경" }),
      );
      assertEquals(editedTask.tag_ids, [taskTag.id]);
      const completed = await activity.completeTask(
        deps,
        businessRequest(f.member),
        task.id,
        taskComplete.parse({ expected_version: editedTask.version, body: "먼저 저장한 수행 결과" }),
      );
      assertEquals(completed.record.tag_ids, []);
      const resultRequest = businessRequest(f.member);
      const resultInput = {
        target_kind: "record",
        target_id: completed.record.id,
        expected_version: completed.record.version,
        tag_ids: [resultTag.id],
      };
      const connectedResult = await tags.setTagConnections(tagDeps, resultRequest, resultInput);
      assertEquals(connectedResult.tag_ids, [resultTag.id]);
      const before = await activity.listRecords(deps, f.member, recordListQuery.parse({ task_id: task.id }));
      const editedResult = await activity.updateRecord(
        deps,
        businessRequest(f.member),
        completed.record.id,
        recordUpdate.parse({ expected_version: connectedResult.version, body: "분류를 유지하는 결과 메모 정정" }),
      );
      assertEquals(editedResult.tag_ids, [resultTag.id]);
      const unlinked = await tags.setTagConnections(tagDeps, businessRequest(f.member), {
        target_kind: "record",
        target_id: editedResult.id,
        expected_version: editedResult.version,
        tag_ids: [],
      });
      assertEquals(unlinked.tag_ids, []);
      assertEquals(
        (await activity.listRecords(deps, f.member, recordListQuery.parse({ task_id: task.id }))).items.length,
        before.items.length,
      );
      const taskUnlinked = await tags.setTagConnections(tagDeps, businessRequest(f.member), {
        target_kind: "task",
        target_id: task.id,
        expected_version: completed.task.version,
        tag_ids: [],
      });
      assertEquals(taskUnlinked.tag_ids, []);
      assertEquals(
        (await assertRejects(() =>
          tags.setTagConnections(tagDeps, businessRequest(f.member), {
            target_kind: "task",
            target_id: task.id,
            expected_version: taskUnlinked.version,
            tag_ids: [resultTag.id],
          }), AppError)).code,
        "invalid_reference",
      );
      const automatic = before.items.find((record) => record.record_kind === "change")!;
      assertEquals(
        (await assertRejects(() =>
          tags.setTagConnections(tagDeps, businessRequest(f.member), {
            target_kind: "record",
            target_id: automatic.id,
            expected_version: automatic.version,
            tag_ids: [resultTag.id],
          }), AppError)).code,
        "invalid_input",
      );
      await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "read" }]);
      assertEquals(
        (await assertRejects(() => tags.setTagConnections(tagDeps, taskRequest, taskInput), AppError)).code,
        "forbidden",
      );
      await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
      assertEquals(await tags.setTagConnections(tagDeps, taskRequest, taskInput), connectedTask);
      assertEquals((await activity.getTask(deps, f.member, task.id)).tag_ids, []);
      await activity.deleteRecord(deps, businessRequest(f.member), editedResult.id, unlinked.version);
      assertEquals(await tags.setTagConnections(tagDeps, resultRequest, resultInput), connectedResult);
      assertEquals(
        (await assertRejects(() => tags.setTagConnections(tagDeps, businessRequest(f.member), resultInput), AppError))
          .code,
        "not_found",
      );
      await f.grant(f.member, []);
      assertEquals(
        (await assertRejects(() => tags.setTagConnections(tagDeps, resultRequest, resultInput), AppError)).code,
        "forbidden",
      );
      await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
      const pending = await activity.createTask(
        deps,
        businessRequest(f.member),
        taskCreate.parse({ kind: "once", title: "삭제 뒤 분류 변경 불가" }),
      );
      await activity.deleteTask(deps, businessRequest(f.member), pending.id, pending.version);
      const removed = await activity.getTask(deps, f.member, pending.id);
      assertEquals(
        (await assertRejects(() =>
          tags.setTagConnections(tagDeps, businessRequest(f.member), {
            target_kind: "task",
            target_id: removed.id,
            expected_version: removed.version,
            tag_ids: [taskTag.id],
          }), AppError)).code,
        "conflict",
      );
    } finally {
      await f.cleanup();
    }
  },
);
