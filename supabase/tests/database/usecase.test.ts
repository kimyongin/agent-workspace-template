import { businessWorkspaceFixture } from "./_workspace-business.ts";
import { requestActor } from "../_request.ts";
// 유스케이스 + 실제 저장 어댑터: 완료 중 일부가 실패하면 할 일·결과 기록·큐가 모두 롤백된다.
import { assertEquals, assertRejects } from "@std/assert";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import type { ActivityStore, UnitOfWork } from "../../functions/_shared/core/activity/ports.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.pooler, { max: 2, prepare: false });
const real = new SqlUnitOfWork(sql);
const clock = { now: () => new Date() };

/** 지정한 저장 단계에서 실패하는 작업 단위(부분 실패 재현용). */
function failingAt(step: keyof ActivityStore): UnitOfWork {
  return {
    run: (actor, fn, entry) =>
      real.run(actor, (store) =>
        fn(
          new Proxy(store, {
            get(target, prop, receiver) {
              const v = Reflect.get(target, prop, receiver);
              if (prop !== step) return typeof v === "function" ? v.bind(target) : v;
              return async (...args: unknown[]) => {
                await (v as (...a: unknown[]) => Promise<unknown>).apply(target, args);
                throw new Error(`${String(step)} 뒤 실패`);
              };
            },
          }),
        ), entry),
  };
}

async function counts(workspaceId: string, taskId: string) {
  const [r] = await admin<{ status: string; records: number; msgs: number }[]>`
    select (select status from app.tasks where workspace_id=${workspaceId} and id = ${taskId}) as status,
           (select count(*)::int from app.records where workspace_id=${workspaceId} and task_id = ${taskId}) as records,
           (select count(*)::int from pgmq.q_search_index where message->>'workspace_id'=${workspaceId}) as msgs`;
  return r;
}

for (const step of ["insertRecord", "updateTask", "enqueueIndex"] as const) {
  dbTest(`완료 중 ${step} 뒤 실패하면 모두 롤백된다`, async () => {
    const fixture = await businessWorkspaceFixture(admin, sql), actor = fixture.manager;
    try {
      await fixture.grant(actor, [{ target_kind: "settings", target_id: "*", access: "write" }, {
        target_kind: "tasks",
        target_id: "*",
        access: "write",
      }]);
      const task = await activity.createTask({ uow: real, clock }, requestActor(actor), {
        kind: "once",
        title: "롤백 시험",
        body: "",
      });
      const before = await counts(fixture.workspaceId, task.id);
      const completionActor = requestActor(actor);
      await assertRejects(() =>
        activity.completeTask({ uow: failingAt(step), clock }, completionActor, task.id, {
          expected_version: 1,
          body: "결과 본문",
        })
      );
      assertEquals(await counts(fixture.workspaceId, task.id), before);
      assertEquals(before.status, "open");
      // 실패 뒤 같은 완료가 정상 경로로 다시 성공한다.
      const done = await activity.completeTask({ uow: real, clock }, completionActor, task.id, {
        expected_version: 1,
        body: "결과 본문",
      });
      assertEquals(done.task.status, "done");
    } finally {
      await fixture.cleanup();
    }
  });
}
