// 유스케이스 + 실제 저장 어댑터: 완료 중 일부가 실패하면 할 일·결과 기록·큐가 모두 롤백된다.
import { assertEquals, assertRejects } from "@std/assert";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import type { ActivityStore, UnitOfWork } from "../../functions/_shared/core/activity/ports.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { connect, dbTest, devUsers, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const { a: A } = await devUsers(admin);
const sql = connect(urls.pooler, { max: 2, prepare: false });
const real = new SqlUnitOfWork(sql);
const clock = { now: () => new Date() };

/** 지정한 저장 단계에서 실패하는 작업 단위(부분 실패 재현용). */
function failingAt(step: keyof ActivityStore): UnitOfWork {
  return {
    run: (actor, fn) =>
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
        )),
  };
}

async function counts(taskId: string) {
  const [r] = await admin<{ status: string; records: number; msgs: number }[]>`
    select (select status from app.tasks where id = ${taskId}) as status,
           (select count(*)::int from app.records where task_id = ${taskId}) as records,
           (select count(*)::int from pgmq.q_search_index) as msgs`;
  return r;
}

for (const step of ["insertRecord", "updateTask", "enqueueIndex"] as const) {
  dbTest(`완료 중 ${step} 뒤 실패하면 모두 롤백된다`, async () => {
    const actor = { userId: A };
    const task = await activity.createTask({ uow: real, clock }, actor, {
      kind: "once",
      title: "롤백 시험",
      summary: "부분 실패",
      body: "",
    });
    const before = await counts(task.id);
    await assertRejects(() =>
      activity.completeTask({ uow: failingAt(step), clock }, actor, task.id, {
        change_note: "테스트 변경 이유",
        expected_version: 1,
        title: "결과",
        summary: "결과 요약",
        body: "",
      })
    );
    assertEquals(await counts(task.id), before);
    assertEquals(before.status, "open");
    // 실패 뒤 같은 완료가 정상 경로로 다시 성공한다.
    const done = await activity.completeTask({ uow: real, clock }, actor, task.id, {
      change_note: "테스트 변경 이유",
      expected_version: 1,
      title: "결과",
      summary: "결과 요약",
      body: "",
    });
    assertEquals(done.task.status, "done");
  });
}
