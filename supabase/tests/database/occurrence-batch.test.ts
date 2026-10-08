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
    const taskA = await createTask(deps, a.actor, taskCreate.parse({ ...input, id: crypto.randomUUID() }));
    const taskB = await createTask(deps, b.actor, taskCreate.parse({ ...input, id: crypto.randomUUID() }));
    const first = crypto.randomUUID(), second = crypto.randomUUID(), foreign = crypto.randomUUID();
    for (
      const [actor, task, id, occurred_at] of [
        [a.actor, taskA, second, "2026-10-08T02:00:00Z"],
        [b.actor, taskB, foreign, "2026-10-08T01:00:00Z"],
        [a.actor, taskA, first, "2026-10-08T01:00:00Z"],
      ] as const
    ) {
      await uow.run(
        actor,
        (store) => store.insertRecord({ id, body: "fact", task_id: task.id, occurrence_on: "2026-10-08", occurred_at }),
      );
    }
    const read = (actor: typeof a.actor, ids: string[]) =>
      uow.run(actor, (store) => store.occurrenceRecords(ids, "2026-10-08", "2026-10-08"));
    assertEquals(await read(a.actor, [taskB.id, taskA.id]), [
      { task_id: taskA.id, id: first, occurrence_on: "2026-10-08" },
      { task_id: taskA.id, id: second, occurrence_on: "2026-10-08" },
    ]);
    assertEquals(await read(a.actor, []), []);
    assertEquals(await read(b.actor, [taskA.id, taskB.id]), [{
      task_id: taskB.id,
      id: foreign,
      occurrence_on: "2026-10-08",
    }]);
  } finally {
    await a.cleanup();
    await b.cleanup();
    await sql.end();
    await admin.end();
  }
});
