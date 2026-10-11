import { requestActor } from "../_request.ts";
import { assertEquals } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { createTask } from "../../functions/_shared/core/activity/application.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";

dbTest("batch occurrence facts preserve owner isolation, empty selection and record order", async () => {
  const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 1, prepare: false });
  const a = await fixtureOwner(admin), b = await fixtureOwner(admin);
  try {
    const uow = new SqlUnitOfWork(sql), deps = { uow, clock: { now: () => new Date("2026-10-08T00:00:00Z") } };
    const input = {
      kind: "recurring",
      title: "batch",
      timezone: "Asia/Seoul",
      recurrence: { freq: "daily", starts_on: "2020-01-01" },
    };
    const taskA = await createTask(deps, requestActor(a.actor), taskCreate.parse({ ...input }));
    const taskB = await createTask(deps, requestActor(b.actor), taskCreate.parse({ ...input }));
    const ids: string[] = [];
    for (
      const [actor, task, occurred_at] of [
        [a.actor, taskA, "2026-10-08T02:00:00Z"],
        [b.actor, taskB, "2026-10-08T01:00:00Z"],
        [a.actor, taskA, "2026-10-08T01:00:00Z"],
      ] as const
    ) {
      const record = await uow.run(
        actor,
        (store) => store.insertRecord({ body: "fact", task_id: task.id, occurrence_on: "2026-10-08", occurred_at }),
      );
      ids.push(record.id);
    }
    const read = async (
      actor: typeof a.actor,
      ids: string[],
    ) => [...await uow.run(actor, (store) => store.occurrenceRecords(ids, "2026-10-08", "2026-10-08"))];
    assertEquals(await read(a.actor, [taskB.id, taskA.id]), [
      { task_id: taskA.id, id: ids[2], occurrence_on: "2026-10-08" },
      { task_id: taskA.id, id: ids[0], occurrence_on: "2026-10-08" },
    ]);
    assertEquals(await read(a.actor, []), []);
    assertEquals(await read(b.actor, [taskA.id, taskB.id]), [{
      task_id: taskB.id,
      id: ids[1],
      occurrence_on: "2026-10-08",
    }]);
  } finally {
    await a.cleanup();
    await b.cleanup();
    await sql.end();
    await admin.end();
  }
});
