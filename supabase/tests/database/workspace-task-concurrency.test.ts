import { assert, assertEquals, assertRejects } from "@std/assert";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { recordListQuery } from "../../functions/_shared/contracts/record.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const applicationName = `activity515-concurrency-${crypto.randomUUID()}`;
const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 3, prepare: false, connection: { application_name: applicationName } });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date("2026-10-04T12:00:00Z") } };

async function waitedOnOwnedTransaction() {
  for (let n = 0; n < 100; n++) {
    const rows = await admin`select waiter.pid from pg_stat_activity waiter
      where waiter.application_name=${applicationName} and waiter.wait_event_type='Lock'
      and exists(select 1 from pg_stat_activity holder where holder.application_name=${applicationName}
        and holder.state='idle in transaction' and holder.pid=any(pg_blocking_pids(waiter.pid)))`;
    if (rows.length) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return false;
}

for (const first of ["stop", "occurrence"] as const) {
  dbTest(`workspace recurring ${first} commit serializes the other command against fresh task state`, async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let holding: Promise<unknown> | undefined, waiting: Promise<unknown> | undefined;
    try {
      await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
      const task = await activity.createTask(
        deps,
        businessRequest(f.member),
        taskCreate.parse({
          kind: "recurring",
          title: "동시 반복 상태",
          timezone: "UTC",
          recurrence: { freq: "daily", starts_on: "2026-10-01" },
        }),
      );
      const held: activity.ActivityDeps = {
        ...deps,
        uow: {
          run: (actor, execute, entry) =>
            deps.uow.run(actor, async (store) => {
              const result = await execute(store);
              ready.resolve();
              await release.promise;
              return result;
            }, entry),
        },
      };
      const stopRequest = businessRequest(f.member), occurrenceRequest = businessRequest(f.member);
      holding = first === "stop"
        ? activity.stopTask(held, stopRequest, task.id, task.version)
        : activity.recordOccurrence(held, occurrenceRequest, task.id, "2026-10-04", { body: "동시 수행 결과" });
      await Promise.race([
        ready.promise,
        holding.then(() => {
          throw new Error("write missed transaction barrier");
        }),
      ]);
      waiting = first === "stop"
        ? activity.recordOccurrence(deps, occurrenceRequest, task.id, "2026-10-04", { body: "동시 수행 결과" })
        : activity.stopTask(deps, stopRequest, task.id, task.version);
      void waiting.catch(() => {});
      assert(await waitedOnOwnedTransaction(), "observed a real wait on this fixture's transaction");
      release.resolve();
      const heldResult = await holding;
      if (first === "stop") {
        assertEquals((await assertRejects(() => waiting!, AppError)).code, "invalid_input");
        assertEquals(
          (await activity.listRecords(
            deps,
            f.member,
            recordListQuery.parse({ task_id: task.id, record_kind: "result" }),
          )).items,
          [],
        );
        assertEquals(
          (await admin`select count(*)::int n from private.workspace_request_results
          where workspace_id=${f.workspaceId} and request_key=${occurrenceRequest.request!.key}`)[0].n,
          0,
        );
      } else {
        await waiting;
        const results = (await activity.listRecords(
          deps,
          f.member,
          recordListQuery.parse({ task_id: task.id, record_kind: "result" }),
        )).items;
        assertEquals(results.length, 1);
        assertEquals([results[0].task_id, results[0].entity_id, results[0].occurrence_on], [
          task.id,
          null,
          "2026-10-04",
        ]);
        assertEquals(
          (await activity.listOccurrences(deps, f.member, task.id, { from: "2026-10-04", to: "2026-10-04" })).items[0]
            .record_ids,
          [results[0].id],
        );
      }
      const stopped = await activity.getTask(deps, f.member, task.id);
      assertEquals([stopped.status, stopped.version], ["stopped", task.version + 1]);
      const stopResult = first === "stop" ? heldResult : await waiting;
      assertEquals(await activity.stopTask(deps, stopRequest, task.id, task.version), stopResult);
    } finally {
      release.resolve();
      await Promise.allSettled([holding, waiting]);
      await f.cleanup();
    }
  });
}

dbTest("workspace distinct completion attempts preserve one result and one winning receipt", async () => {
  const f = await businessWorkspaceFixture(admin, sql);
  try {
    await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
    const task = await activity.createTask(
      deps,
      businessRequest(f.member),
      taskCreate.parse({ kind: "once", title: "동시 완료" }),
    );
    const attempts = [businessRequest(f.member), businessRequest(f.member)];
    const settled = await Promise.allSettled(
      attempts.map((actor) =>
        activity.completeTask(deps, actor, task.id, { expected_version: task.version, body: "한 번의 완료 결과" })
      ),
    );
    const winners = settled.filter((result) => result.status === "fulfilled");
    assertEquals(winners.length, 1);
    const rejected = settled.find((result) => result.status === "rejected") as PromiseRejectedResult;
    assert(rejected.reason instanceof AppError);
    assertEquals(rejected.reason.code, "conflict");
    const results =
      (await activity.listRecords(deps, f.member, recordListQuery.parse({ task_id: task.id, record_kind: "result" })))
        .items;
    assertEquals(results.length, 1);
    assertEquals((await activity.getTask(deps, f.member, task.id)).result_record_id, results[0].id);
    assertEquals(
      (await admin`select count(*)::int n from private.workspace_request_results where workspace_id=${f.workspaceId}
      and request_key=any(${attempts.map((actor) => actor.request!.key)}::uuid[])`)[0].n,
      1,
    );
    assertEquals(
      (await admin`select count(*)::int n from app.search_index_state where workspace_id=${f.workspaceId} and id=${
        results[0].id
      }`)[0].n,
      1,
    );
    assertEquals(
      (await admin`select count(*)::int n from pgmq.q_search_index where message->>'workspace_id'=${f.workspaceId} and message->>'id'=${
        results[0].id
      }`)[0].n,
      1,
    );
  } finally {
    await f.cleanup();
  }
});
