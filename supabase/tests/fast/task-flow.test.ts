import { assertEquals, assertRejects } from "@std/assert";
import { taskComplete, taskCreate, taskResult, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { recordCreate, recordResult } from "../../functions/_shared/contracts/record.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import type { Task } from "../../functions/_shared/core/activity/domain.ts";
import type { ActivityRecord, ActivityStore, StoredRequest } from "../../functions/_shared/core/activity/ports.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type { IndexJob } from "../../functions/_shared/core/shared/store.ts";
import { searchInputHash } from "../../functions/_shared/core/shared/operations.ts";
import { createHttpApp } from "../../functions/_shared/adapters/http/app.ts";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";

const actor = { userId: "00000000-0000-4000-8000-000000000001" };
const now = "2026-10-04T01:00:00.000Z";
const createInput = { kind: "once", title: "준비", summary: "완료 흐름 검증", request_id: crypto.randomUUID() };
const completeInput = {
  expected_version: 1,
  title: "결과",
  summary: "수행 완료",
  body: "실제 결과 본문",
  request_id: crypto.randomUUID(),
};
const unsupported = () => {
  throw new Error("task-flow fixture: unsupported port operation");
};

// Only this serial flow's storage operations. No SQL, ownership, locks or rollback simulation.
function fixture(storageNow = () => now) {
  const tasks = new Map<string, Task>();
  const records = new Map<string, ActivityRecord>();
  const requests = new Map<string, StoredRequest>();
  const jobs: IndexJob[] = [];
  const mutations: string[] = [];
  const key = (operation: string, id: string) => `${operation}:${id}`;
  const store: ActivityStore = {
    lockRequest: () => Promise.resolve(), // Serial retry only; concurrency belongs to the real DB tests.
    findRequest: (operation, id) => Promise.resolve(structuredClone(requests.get(key(operation, id)) ?? null)),
    saveRequest: (operation, id, request_hash, response) => {
      requests.set(key(operation, id), structuredClone({ request_hash, response }));
      return Promise.resolve();
    },
    getTask: (id) => Promise.resolve(structuredClone(tasks.get(id) ?? null)),
    insertTask: (input) => {
      const task: Task = {
        ...input,
        id: crypto.randomUUID(),
        version: 1,
        created_at: now,
        updated_at: now,
        completed_at: null,
        result_record_id: null,
      };
      tasks.set(task.id, task);
      return Promise.resolve(structuredClone(task));
    },
    updateTask: (id, changes) => {
      mutations.push(`update:${id}`);
      const current = tasks.get(id)!;
      const task = { ...current, ...changes, version: current.version + 1, updated_at: now };
      tasks.set(id, task);
      return Promise.resolve(structuredClone(task));
    },
    insertRecord: (input) => {
      const record: ActivityRecord = {
        ...input,
        id: crypto.randomUUID(),
        occurred_at: input.occurred_at ?? now,
        tag_ids: input.tag_ids ?? [],
        applied_principle_ids: input.applied_principle_ids ?? [],
        applied_principles: [],
        version: 1,
        created_at: now,
        updated_at: now,
      };
      records.set(record.id, record);
      return Promise.resolve(structuredClone(record));
    },
    enqueueIndex: (job) => {
      jobs.push(structuredClone(job));
      return Promise.resolve();
    },
    listTasks: unsupported,
    deleteTask: (id) => {
      mutations.push(`delete:${id}`);
      tasks.delete(id);
      return Promise.resolve();
    },
    getRecord: unsupported,
    getRecordSummaries: unsupported,
    listRecords: unsupported,
    occurrenceRecords: unsupported,
    updateRecord: unsupported,
    deleteRecord: unsupported,
    detachRecords: (taskId) => {
      mutations.push(`detach:${taskId}`);
      for (const [id, record] of records) {
        if (record.task_id === taskId) {
          records.set(id, {
            ...record,
            task_id: null,
            occurrence_on: null,
            version: record.version + 1,
            updated_at: storageNow(),
          });
        }
      }
      return Promise.resolve();
    },
    taskWithResult: unsupported,
  };
  const deps: activity.ActivityDeps = {
    clock: { now: () => new Date(now) },
    uow: {
      run: (received, fn) => {
        assertEquals(received, actor);
        return fn(store);
      },
    },
  };
  const unused = { uow: { run: unsupported } };
  const config = {
    basePath: "/api",
    token: { audience: "authenticated", issuer: "https://auth.invalid" },
    allowedOrigins: [],
  };
  const app = createHttpApp(deps, config, unused, unused, unused, (request, policy) => {
    assertEquals(request.headers.get("authorization"), "Bearer fixture");
    assertEquals(policy, config.token);
    return Promise.resolve(actor);
  });
  return { deps, app, config, unused, tasks, records, jobs, mutations };
}

function snapshot(f: ReturnType<typeof fixture>) {
  return structuredClone({ tasks: [...f.tasks], records: [...f.records], jobs: f.jobs, mutations: f.mutations });
}

Deno.test("application: task content edits index only changed title/summary; stale mutations write nothing", async () => {
  const f = fixture();
  let task = await activity.createTask(f.deps, actor, taskCreate.parse(createInput));
  for (const patch of [{ title: "새 제목" }, { summary: "새 요약" }]) {
    task = await activity.updateTask(
      f.deps,
      actor,
      task.id,
      taskUpdate.parse({ expected_version: task.version, ...patch }),
    );
    taskResult.parse(task);
    assertEquals(f.jobs.at(-1), { kind: "task", id: task.id, input_hash: await searchInputHash(task) });
  }
  assertEquals(task.version, 3);
  assertEquals(new Set(f.jobs.map((job) => job.input_hash)).size, 3);
  task = await activity.updateTask(
    f.deps,
    actor,
    task.id,
    taskUpdate.parse({
      expected_version: 3,
      title: task.title,
      summary: task.summary,
      body: "검색 대상이 아닌 본문",
      due_on: "2026-10-05",
    }),
  );
  assertEquals(task.version, 4);
  assertEquals(task.body, "검색 대상이 아닌 본문");
  assertEquals(task.due_on, "2026-10-05");
  assertEquals(f.jobs.length, 3);
  const before = snapshot(f);
  for (
    const mutate of [
      () =>
        activity.updateTask(f.deps, actor, task.id, taskUpdate.parse({ expected_version: 3, title: "오래된 수정" })),
      () => activity.deleteTask(f.deps, actor, task.id, 3),
    ]
  ) {
    const error = await assertRejects(mutate, AppError);
    assertEquals(error.code, "conflict");
    assertEquals(snapshot(f), before);
  }
  await activity.deleteTask(f.deps, actor, task.id, 4);
  assertEquals(f.tasks.has(task.id), false);
  assertEquals(f.jobs.length, 3);
});

Deno.test("application: deleting completed/recurring tasks detaches history and preserves unrelated records", async () => {
  for (const kind of ["once", "recurring"] as const) {
    let detachedAt = now;
    const f = fixture(() => detachedAt);
    const task = await activity.createTask(
      f.deps,
      actor,
      taskCreate.parse(
        kind === "once" ? createInput : {
          kind,
          title: "반복 수행",
          summary: "회차 기록 보존",
          recurrence: { freq: "daily", starts_on: "2026-10-01" },
          timezone: "Asia/Seoul",
        },
      ),
    );
    const input = recordCreate.parse({ title: "기록", summary: "보존할 요약", body: "보존할 본문" });
    const unrelated = await activity.createRecord(f.deps, actor, input);
    const linked = kind === "once"
      ? (await activity.completeTask(f.deps, actor, task.id, taskComplete.parse(completeInput))).record
      : await activity.recordOccurrence(f.deps, actor, task.id, "2026-10-03", input);
    assertEquals(linked.task_id, task.id);
    assertEquals(linked.occurrence_on, kind === "once" ? null : "2026-10-03");
    const current = f.tasks.get(task.id)!;
    if (kind === "once") assertEquals(current.result_record_id, linked.id);
    assertEquals(linked.updated_at, now);
    detachedAt = "2026-10-04T02:00:00.000Z";
    const before = snapshot(f);
    const stale = await assertRejects(() => activity.deleteTask(f.deps, actor, task.id, current.version + 1), AppError);
    assertEquals(stale.code, "conflict");
    assertEquals(snapshot(f), before);
    await activity.deleteTask(f.deps, actor, task.id, current.version);
    assertEquals(f.mutations.slice(-2), [`detach:${task.id}`, `delete:${task.id}`]);
    assertEquals(f.tasks.size, 0);
    assertEquals(f.records.size, 2);
    assertEquals(recordResult.parse(f.records.get(linked.id)), {
      ...linked,
      task_id: null,
      occurrence_on: null,
      version: linked.version + 1,
      updated_at: detachedAt,
    });
    assertEquals(f.records.get(unrelated.id), unrelated);
    assertEquals(f.jobs, before.jobs);
    const deleted = snapshot(f);
    for (const id of [task.id, crypto.randomUUID()]) {
      for (
        const mutate of [
          () => activity.updateTask(f.deps, actor, id, taskUpdate.parse({ expected_version: 1, title: "수정" })),
          () => activity.deleteTask(f.deps, actor, id, 1),
        ]
      ) {
        assertEquals((await assertRejects(mutate, AppError)).code, "not_found");
        assertEquals(snapshot(f), deleted);
      }
    }
  }
});

Deno.test("application: create → complete → identical serial retry uses real business rules", async () => {
  const f = fixture();
  const task = await activity.createTask(f.deps, actor, taskCreate.parse(createInput));
  const input = taskComplete.parse(completeInput);
  const versionError = await assertRejects(
    () => activity.completeTask(f.deps, actor, task.id, { ...input, expected_version: 2 }),
    AppError,
  );
  assertEquals(versionError.code, "conflict");
  assertEquals(f.records.size, 0);
  assertEquals(f.tasks.get(task.id)?.status, "open");
  const result = await activity.completeTask(f.deps, actor, task.id, input);
  taskResult.parse(result.task);
  recordResult.parse(result.record);
  assertEquals(result.task.status, "done");
  assertEquals(result.task.version, 2);
  assertEquals(result.task.completed_at, now);
  assertEquals(result.task.result_record_id, result.record.id);
  assertEquals(result.record.task_id, task.id);
  assertEquals(await activity.completeTask(f.deps, actor, task.id, input), result);
  assertEquals(f.records.size, 1);
  assertEquals(f.jobs.map((job) => job.kind), ["task", "record"]);
  const error = await assertRejects(
    () => activity.completeTask(f.deps, actor, task.id, { ...input, body: "different" }),
    AppError,
  );
  assertEquals(error.code, "conflict");
  assertEquals(f.records.size, 1);
});

async function post(app: ReturnType<typeof createHttpApp>, path: string, input?: unknown, method = "POST") {
  return await app.fetch(
    new Request(`https://app.invalid/api${path}`, {
      method,
      headers: { authorization: "Bearer fixture", "content-type": "application/json" },
      body: JSON.stringify(input),
    }),
  );
}

Deno.test("HTTP routes and MCP ToolDef schema/handler share task outcomes and input/errors (no transport)", async () => {
  const f = fixture();
  const tools = activityTools(f.deps);
  const create = tools.find((tool) => tool.name === "create_task")!;
  const complete = tools.find((tool) => tool.name === "complete_task")!;
  assertEquals(create.input.safeParse(createInput).success, true);
  const created = await post(f.app, "/tasks", createInput);
  assertEquals(created.status, 201);
  const task = taskResult.parse(await created.json());
  assertEquals(await create.handler(createInput, actor), task); // Same request through the other adapter.
  const args = { id: task.id, ...completeInput };
  assertEquals(complete.input.safeParse(args).success, true);
  const result = await complete.handler(args, actor);
  const retry = await post(f.app, `/tasks/${task.id}/complete`, completeInput);
  assertEquals(retry.status, 200);
  assertEquals(await retry.json(), result);
  assertEquals(f.records.size, 1);
  assertEquals(f.jobs.length, 2);

  for (
    const [path, tool, input, code, status] of [
      ["/tasks", create, { ...createInput, title: "" }, "invalid_input", 400],
      ["/tasks", create, { ...createInput, owner_id: actor.userId }, "invalid_input", 400],
      [`/tasks/${task.id}/complete`, complete, { ...completeInput, expected_version: 0 }, "invalid_input", 400],
      [`/tasks/${task.id}/complete`, complete, { ...completeInput, request_id: crypto.randomUUID() }, "conflict", 409],
      ["/tasks/bad-id/complete", complete, completeInput, "not_found", 404],
    ] as const
  ) {
    const http = await post(f.app, path, input);
    assertEquals(http.status, status);
    const mcpInput = tool === complete ? { id: path.split("/")[2], ...input } : input;
    const error = await assertRejects(async () => await tool.handler(mcpInput, actor), AppError);
    const mapped = toErrorBody(error);
    assertEquals(mapped.body.code, code);
    assertEquals(await http.json(), mapped.body);
  }
  assertEquals(complete.input.safeParse({ ...args, expected_version: 0 }).success, false);
  assertEquals(create.input.safeParse({ ...createInput, owner_id: actor.userId }).success, false);
  assertEquals(f.records.size, 1);
  assertEquals(f.jobs.length, 2);
});

Deno.test("HTTP PATCH/DELETE and MCP task mutation schema/handler share validation and no-write errors", async () => {
  const f = fixture();
  const tools = activityTools(f.deps);
  const update = tools.find((tool) => tool.name === "update_task")!;
  const remove = tools.find((tool) => tool.name === "delete_task")!;
  const task = await activity.createTask(f.deps, actor, taskCreate.parse(createInput));
  const path = `/tasks/${task.id}`;
  const patch = { expected_version: 1, title: "HTTP 수정" };
  assertEquals(update.input.safeParse({ id: task.id, ...patch }).success, true);
  const edited = await post(f.app, path, patch, "PATCH");
  assertEquals(edited.status, 200);
  assertEquals(taskResult.parse(await edited.json()), f.tasks.get(task.id));
  const mcpEdited = await update.handler({ id: task.id, expected_version: 2, summary: "MCP 수정" }, actor);
  assertEquals(taskResult.parse(mcpEdited), f.tasks.get(task.id));
  assertEquals(f.tasks.get(task.id)?.title, "HTTP 수정");
  assertEquals(f.tasks.get(task.id)?.summary, "MCP 수정");
  assertEquals(f.tasks.get(task.id)?.version, 3);
  assertEquals(f.jobs.length, 3);

  const errors = [
    { tool: update, input: { expected_version: 0, title: "수정" }, code: "invalid_input", status: 400 },
    { tool: update, input: { expected_version: 3, status: "done" }, code: "invalid_input", status: 400 },
    { tool: update, input: { expected_version: 3, timezone: "Asia/Seoul" }, code: "invalid_input", status: 400 },
    { tool: update, input: { expected_version: 2, title: "오래된 수정" }, code: "conflict", status: 409 },
    { tool: remove, input: { expected_version: 0 }, code: "invalid_input", status: 400 },
    { tool: remove, input: { expected_version: 2 }, code: "conflict", status: 409 },
  ];
  const before = snapshot(f);
  for (const { tool, input, code, status } of errors) {
    const isDelete = tool === remove;
    const http = await post(
      f.app,
      isDelete ? `${path}?expected_version=${input.expected_version}` : path,
      isDelete ? undefined : input,
      isDelete ? "DELETE" : "PATCH",
    );
    assertEquals(http.status, status);
    const error = await assertRejects(async () => await tool.handler({ id: task.id, ...input }, actor), AppError);
    const mapped = toErrorBody(error);
    assertEquals(mapped.body.code, code);
    assertEquals(await http.json(), mapped.body);
    assertEquals(snapshot(f), before);
  }
  assertEquals(update.input.safeParse({ id: task.id, expected_version: 3, status: "done" }).success, false);
  assertEquals(remove.input.safeParse({ id: task.id, expected_version: 0 }).success, false);
  assertEquals(remove.input.safeParse({ id: task.id, expected_version: 3 }).success, true);
  const deleted = await post(f.app, `${path}?expected_version=3`, undefined, "DELETE");
  assertEquals(deleted.status, 204);
  assertEquals(await deleted.text(), "");
  const another = await activity.createTask(f.deps, actor, taskCreate.parse({ ...createInput, request_id: undefined }));
  assertEquals(await remove.handler({ id: another.id, expected_version: 1 }, actor), { deleted: another.id });
  assertEquals(f.tasks.size, 0);
  const after = snapshot(f);
  for (const id of [task.id, crypto.randomUUID()]) {
    for (const tool of [update, remove]) {
      const input = tool === update ? { expected_version: 1, title: "수정" } : { expected_version: 1 };
      const http = await post(
        f.app,
        `/tasks/${id}${tool === remove ? "?expected_version=1" : ""}`,
        tool === remove ? undefined : input,
        tool === remove ? "DELETE" : "PATCH",
      );
      assertEquals(http.status, 404);
      const error = await assertRejects(async () => await tool.handler({ id, ...input }, actor), AppError);
      assertEquals(error.code, "not_found");
      assertEquals(await http.json(), toErrorBody(error).body);
      assertEquals(snapshot(f), after);
    }
  }
});

Deno.test("HTTP production default still rejects missing bearer token before any port runs", async () => {
  const f = fixture();
  const app = createHttpApp(f.deps, f.config, f.unused, f.unused, f.unused);
  const response = await app.fetch(new Request("https://app.invalid/api/tasks"));
  assertEquals(response.status, 401);
  assertEquals(response.headers.get("WWW-Authenticate"), 'Bearer error="invalid_token"');
  assertEquals((await response.json()).code, "unauthenticated");
  assertEquals(f.tasks.size, 0);
});
