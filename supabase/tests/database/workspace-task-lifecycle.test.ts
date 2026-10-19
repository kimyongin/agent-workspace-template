import { assertEquals, assertRejects } from "@std/assert";
import { Hono } from "hono";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { taskComplete, taskCreate, taskListQuery } from "../../functions/_shared/contracts/task.ts";
import { recordListQuery } from "../../functions/_shared/contracts/record.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { activityRoutes } from "../../functions/_shared/adapters/http/activity-routes.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 1, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest(
  "workspace task soft delete restore retains result ownership and result removal creates no recursive event",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
      const task = await activity.createTask(
        deps,
        businessRequest(f.member),
        taskCreate.parse({ kind: "once", title: "보존할 공동 업무" }),
      );
      const completed = await activity.completeTask(
        deps,
        businessRequest(f.member),
        task.id,
        taskComplete.parse({ expected_version: task.version, body: "보존할 수행 결과" }),
      );
      await activity.deleteTask(deps, businessRequest(f.member), task.id, completed.task.version);
      const deleted = await activity.getTask(deps, f.member, task.id);
      assertEquals(typeof Reflect.get(deleted, "deleted_at"), "string");
      assertEquals(deleted.result_record_id, completed.record.id);
      assertEquals((await activity.getRecord(deps, f.member, completed.record.id)).task_id, task.id);
      assertEquals((await activity.listTasks(deps, f.member, taskListQuery.parse({}))).items, []);
      // This route uses the real activity adapter and actual app_user store. Actor
      // injection here does not claim token-verification/transport coverage.
      const app = new Hono<HttpEnv>();
      app.use("*", async (c, next) => {
        c.set("actor", businessRequest(f.member));
        await next();
      });
      app.onError((error) => {
        const { status, body } = toErrorBody(error);
        return new Response(JSON.stringify(body), { status });
      });
      app.route("/", activityRoutes(deps));
      const restore = () =>
        app.request(`/tasks/${task.id}/restore`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ expected_version: deleted.version }),
        });
      await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "read" }]);
      assertEquals((await restore()).status, 403);
      await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
      const response = await restore();
      assertEquals(response.status, 200);
      const restored = await response.json();
      assertEquals(restored.id, task.id);
      assertEquals(restored.deleted_at, null);
      assertEquals(restored.version, deleted.version + 1);
      const before = await activity.listRecords(deps, f.member, recordListQuery.parse({ task_id: task.id }));
      await activity.deleteRecord(deps, businessRequest(f.member), completed.record.id, completed.record.version);
      const after = await activity.listRecords(deps, f.member, recordListQuery.parse({ task_id: task.id }));
      assertEquals(after.items.length, before.items.length - 1);
      assertEquals((await activity.getTask(deps, f.member, task.id)).status, "done");
      assertEquals((await activity.getTask(deps, f.member, task.id)).result_record, null);
      const open = await activity.createTask(
        deps,
        businessRequest(f.member),
        taskCreate.parse({ kind: "once", title: "삭제한 미완료 업무" }),
      );
      await activity.deleteTask(deps, businessRequest(f.member), open.id, open.version);
      const removed = await activity.getTask(deps, f.member, open.id);
      assertEquals(
        (await assertRejects(() =>
          activity.completeTask(
            deps,
            businessRequest(f.member),
            open.id,
            taskComplete.parse({ expected_version: removed.version, body: "삭제 뒤 수행 불가" }),
          ), AppError)).code,
        "conflict",
      );
    } finally {
      await f.cleanup();
    }
  },
);
