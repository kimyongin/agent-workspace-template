import { assert, assertEquals, assertRejects } from "@std/assert";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { taskComplete, taskCreate, taskListQuery } from "../../functions/_shared/contracts/task.ts";
import { recordListQuery } from "../../functions/_shared/contracts/record.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 1, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest(
  "workspace activity cursors cannot follow the same account into another workspace",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      await f.grant(f.member, [{
        target_kind: "tasks",
        target_id: "*",
        access: "write",
      }]);
      for (const title of ["첫째 공유 할 일", "둘째 공유 할 일"]) {
        const task = await activity.createTask(
          deps,
          businessRequest(f.member),
          taskCreate.parse({ kind: "once", title }),
        );
        await activity.completeTask(
          deps,
          businessRequest(f.member),
          task.id,
          taskComplete.parse({
            expected_version: task.version,
            body: `${title} 결과`,
          }),
        );
      }
      const tasks = await activity.listTasks(
        deps,
        f.member,
        taskListQuery.parse({ limit: 1 }),
      );
      const records = await activity.listRecords(
        deps,
        f.member,
        recordListQuery.parse({ limit: 1, record_kind: "result" }),
      );
      assert(tasks.next_cursor);
      assert(records.next_cursor);
      assertEquals(
        (await activity.listTasks(
          deps,
          f.member,
          taskListQuery.parse({ limit: 1, cursor: tasks.next_cursor }),
        )).items.length,
        1,
      );
      assertEquals(
        (await activity.listRecords(
          deps,
          f.member,
          recordListQuery.parse({
            limit: 1,
            record_kind: "result",
            cursor: records.next_cursor,
          }),
        )).items.length,
        1,
      );
      const other = await f.addWorkspace("다른 목록 공간");
      await f.grant(other.member, [{
        target_kind: "tasks",
        target_id: "*",
        access: "write",
      }]);
      assertEquals(other.member.userId, f.member.userId);
      assertEquals(
        (await assertRejects(() =>
          activity.listTasks(
            deps,
            other.member,
            taskListQuery.parse({ limit: 1, cursor: tasks.next_cursor }),
          ), AppError)).code,
        "invalid_input",
      );
      assertEquals(
        (await assertRejects(() =>
          activity.listRecords(
            deps,
            other.member,
            recordListQuery.parse({
              limit: 1,
              record_kind: "result",
              cursor: records.next_cursor,
            }),
          ), AppError)).code,
        "invalid_input",
      );
      assertEquals(
        (await activity.listTasks(deps, other.member, taskListQuery.parse({})))
          .items,
        [],
      );
      assertEquals(
        (await activity.listRecords(
          deps,
          other.member,
          recordListQuery.parse({}),
        )).items,
        [],
      );
    } finally {
      await f.cleanup();
    }
  },
);
