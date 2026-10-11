import { assertEquals } from "@std/assert";
import { listOccurrences, listTasks } from "../../functions/_shared/core/activity/application.ts";
import { newTask, type Task } from "../../functions/_shared/core/activity/domain.ts";
import type { ActivityStore } from "../../functions/_shared/core/activity/ports.ts";
import { taskCreate, taskListQuery } from "../../functions/_shared/contracts/task.ts";

Deno.test("date and period occurrence reads agree across timezones and historical records with one batch read", async () => {
  const actor = { userId: crypto.randomUUID() }, date = "2026-10-08";
  const tasks: Task[] = ["Asia/Seoul", "America/New_York", "Asia/Seoul"].map((timezone, i) => ({
    ...newTask(taskCreate.parse({
      kind: "recurring",
      title: timezone,
      timezone,
      recurrence: i === 2
        ? { freq: "weekly", weekdays: [1], starts_on: "2020-01-01" }
        : { freq: "daily", starts_on: "2020-01-01" },
    })),
    id: `00000000-0000-4000-8000-00000000000${i + 1}`,
    version: 1,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
    completed_at: null,
    result_record_id: null,
  }));
  const reads: string[][] = [];
  const facts = ["historical-first", "historical-second"].map((id) => ({
    task_id: tasks[2].id,
    id,
    occurrence_on: date,
  }));
  const store = new Proxy({
    executeRequest: <T>(_request: unknown, execute: () => Promise<T>) => execute(),
    listTasks: () => Promise.resolve(tasks),
    getTask: (id: string) => Promise.resolve(tasks.find((task) => task.id === id) ?? null),
    occurrenceRecords: (ids: string[]) => {
      assertEquals(Array.isArray(ids), true);
      reads.push(ids);
      return Promise.resolve(facts.filter((record) => ids.includes(record.task_id)));
    },
  }, {
    get: (target, key) =>
      key in target ? target[key as keyof typeof target] : () => {
        throw new Error(`Unexpected port ${String(key)}`);
      },
  }) as unknown as ActivityStore;
  const deps = {
    clock: { now: () => new Date("2026-10-07T16:00:00Z") },
    uow: {
      run: <T>(received: typeof actor, fn: (store: ActivityStore) => Promise<T>) => {
        assertEquals(received, actor);
        return fn(store);
      },
    },
  };
  const first = await listTasks(deps, actor, taskListQuery.parse({ occurrence_on: date, limit: 2 }));
  assertEquals(reads, [tasks.map((task) => task.id)]);
  assertEquals(first.items.map((task) => [task.id, task.occurrence]), [
    [tasks[2].id, { date, status: "done", record_ids: ["historical-first", "historical-second"], in_rule: false }],
    [tasks[1].id, { date, status: "upcoming", record_ids: [], in_rule: true }],
  ]);
  const second = await listTasks(
    deps,
    actor,
    taskListQuery.parse({ occurrence_on: date, limit: 2, cursor: first.next_cursor }),
  );
  assertEquals(second.items.map((task) => task.occurrence), [{ date, status: "due", record_ids: [], in_rule: true }]);
  assertEquals(second.next_cursor, null);
  for (const item of [...first.items, ...second.items]) {
    const period = await listOccurrences(deps, actor, item.id, { from: date, to: date });
    assertEquals(period.items, [item.occurrence]);
  }
  assertEquals(reads.length, 5); // Two date pages and three single-task periods, never a read per candidate.
});
