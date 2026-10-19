import { requestActor } from "../_request.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { taskComplete, taskCreate, taskResult, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { occurrenceRecordCreate, recordResult } from "../../functions/_shared/contracts/record.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import type { Task } from "../../functions/_shared/core/activity/domain.ts";
import type { ActivityRecord, ActivityStore } from "../../functions/_shared/core/activity/ports.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type { IndexJob } from "../../functions/_shared/core/shared/store.ts";
import { createHttpApp } from "../../functions/_shared/adapters/http/app.ts";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";

const actor = { userId: "00000000-0000-4000-8000-000000000001" };
const now = "2026-10-04T01:00:00.000Z";
const createInput = { kind: "once", title: "준비" };
const completeInput = {
  expected_version: 1,
  body: "실제 결과 본문",
};
const unsupported = () => {
  throw new Error("task-flow fixture: unsupported port operation");
};

// Only this serial flow's storage operations. No SQL, ownership, locks or rollback simulation.
function fixture() {
  const tasks = new Map<string, Task>();
  const records = new Map<string, ActivityRecord>();

  const jobs: IndexJob[] = [];
  const mutations: string[] = [];

  const store: ActivityStore = {
    executeRequest: <T>(_request: unknown, execute: () => Promise<T>) => execute(),
    appendChange: () => Promise.resolve(),
    getTask: (id) => Promise.resolve(structuredClone(tasks.get(id) ?? null)),
    insertTask: (input) => {
      const task: Task = {
        ...input,
        entity_context: [],
        deleted_at: null,
        created_by: actor.userId,
        created_by_name: null,
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
        entity_id: null,
        record_kind: "result",
        created_by: null,
        created_by_name: null,
        change: null,
        id: crypto.randomUUID(),
        occurred_at: input.occurred_at ?? now,
        tag_ids: [],
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
    getRecord: unsupported,
    getRecordBodies: unsupported,
    listRecords: unsupported,
    occurrenceRecords: unsupported,
    updateRecord: unsupported,
    deleteRecord: unsupported,
    taskWithResult: unsupported,
  };
  const deps: activity.ActivityDeps = {
    clock: { now: () => new Date(now) },
    uow: {
      run: (received, fn) => {
        assertEquals(received.userId, actor.userId);
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
  const app = createHttpApp(deps, config, unused, unused, (request, policy) => {
    assertEquals(request.headers.get("authorization"), "Bearer fixture");
    assertEquals(policy, config.token);
    return Promise.resolve(actor);
  });
  return { deps, app, config, unused, tasks, records, jobs, mutations };
}

function snapshot(f: ReturnType<typeof fixture>) {
  return structuredClone({ tasks: [...f.tasks], records: [...f.records], jobs: f.jobs, mutations: f.mutations });
}

Deno.test("application: task edits never index latest task state; stale mutations write nothing", async () => {
  const f = fixture();
  let task = await activity.createTask(f.deps, requestActor(actor), taskCreate.parse({ ...createInput }));
  for (const patch of [{ title: "새 제목" }, { body: "새 본문" }]) {
    task = await activity.updateTask(
      f.deps,
      requestActor(actor),
      task.id,
      taskUpdate.parse({ change_note: "테스트 변경 이유", expected_version: task.version, ...patch }),
    );
    taskResult.parse(task);
    assertEquals(f.jobs.length, 0);
  }
  assertEquals(task.version, 3);
  assertEquals(f.jobs.length, 0);
  task = await activity.updateTask(
    f.deps,
    requestActor(actor),
    task.id,
    taskUpdate.parse({
      change_note: "테스트 변경 이유",
      expected_version: 3,
      title: task.title,
      body: "검색 대상이 아닌 본문",
      due_on: "2026-10-05",
    }),
  );
  assertEquals(task.version, 4);
  assertEquals(task.body, "검색 대상이 아닌 본문");
  assertEquals(task.due_on, "2026-10-05");
  assertEquals(f.jobs.length, 0);
  const before = snapshot(f);
  for (
    const mutate of [
      () =>
        activity.updateTask(
          f.deps,
          requestActor(actor),
          task.id,
          taskUpdate.parse({ change_note: "테스트 변경 이유", expected_version: 3, title: "오래된 수정" }),
        ),
      () => activity.deleteTask(f.deps, requestActor(actor), task.id, 3),
    ]
  ) {
    const error = await assertRejects(mutate, AppError);
    assertEquals(error.code, "conflict");
    assertEquals(snapshot(f), before);
  }
  await activity.deleteTask(f.deps, requestActor(actor), task.id, 4);
  assertEquals(f.tasks.get(task.id)?.deleted_at, now);
  assertEquals(f.jobs.length, 0);
});

Deno.test("application: task soft deletion and restoration preserve result parent and occurrence history", async () => {
  for (const kind of ["once", "recurring"] as const) {
    const f = fixture();
    const task = await activity.createTask(
      f.deps,
      requestActor(actor),
      taskCreate.parse(
        kind === "once" ? createInput : {
          kind,
          title: "반복 수행",
          recurrence: { freq: "daily", starts_on: "2026-10-01" },
          timezone: "Asia/Seoul",
        },
      ),
    );
    const other = await activity.createTask(f.deps, requestActor(actor), taskCreate.parse(createInput));
    const unrelated =
      (await activity.completeTask(f.deps, requestActor(actor), other.id, taskComplete.parse(completeInput))).record;
    const input = occurrenceRecordCreate.parse({ body: "보존할 본문" });
    const linked = kind === "once"
      ? (await activity.completeTask(f.deps, requestActor(actor), task.id, taskComplete.parse(completeInput))).record
      : await activity.recordOccurrence(f.deps, requestActor(actor), task.id, "2026-10-03", input);
    assertEquals(linked.task_id, task.id);
    assertEquals(linked.entity_id, null);
    assertEquals(linked.occurrence_on, kind === "once" ? null : "2026-10-03");
    const current = f.tasks.get(task.id)!;
    if (kind === "once") assertEquals(current.result_record_id, linked.id);
    const before = snapshot(f);
    assertEquals(
      (await assertRejects(
        () => activity.deleteTask(f.deps, requestActor(actor), task.id, current.version + 1),
        AppError,
      )).code,
      "conflict",
    );
    assertEquals(snapshot(f), before);
    await activity.deleteTask(f.deps, requestActor(actor), task.id, current.version);
    const deletedTask = f.tasks.get(task.id)!;
    assertEquals([deletedTask.deleted_at, deletedTask.version], [now, current.version + 1]);
    assertEquals(f.tasks.size, 2);
    assertEquals(f.records.size, 2);
    assertEquals(recordResult.parse(f.records.get(linked.id)), linked);
    assertEquals(f.records.get(unrelated.id), unrelated);
    assertEquals(f.jobs, before.jobs);
    const deleted = snapshot(f);
    for (
      const mutate of [
        () =>
          activity.updateTask(
            f.deps,
            requestActor(actor),
            task.id,
            taskUpdate.parse({ expected_version: deletedTask.version, title: "수정" }),
          ),
        () => activity.deleteTask(f.deps, requestActor(actor), task.id, deletedTask.version),
        () =>
          kind === "once"
            ? activity.completeTask(f.deps, requestActor(actor), task.id, {
              expected_version: deletedTask.version,
              body: "삭제 후 결과",
            })
            : activity.recordOccurrence(f.deps, requestActor(actor), task.id, "2026-10-03", input),
      ]
    ) {
      assertEquals((await assertRejects(mutate, AppError)).code, "conflict");
      assertEquals(snapshot(f), deleted);
    }
    const restored = await activity.restoreTask(f.deps, requestActor(actor), task.id, deletedTask.version);
    assertEquals([restored.id, restored.deleted_at, restored.version], [task.id, null, deletedTask.version + 1]);
    assertEquals([restored.status, restored.result_record_id], [current.status, current.result_record_id]);
    assertEquals(recordResult.parse(f.records.get(linked.id)), linked);
    assertEquals(f.records.get(unrelated.id), unrelated);
    assertEquals(f.jobs, before.jobs);
  }
});

Deno.test("application: create → complete → identical serial retry uses real business rules", async () => {
  const f = fixture();
  const task = await activity.createTask(f.deps, requestActor(actor), taskCreate.parse({ ...createInput }));
  const input = taskComplete.parse(completeInput);
  const versionError = await assertRejects(
    () => activity.completeTask(f.deps, requestActor(actor), task.id, { ...input, expected_version: 2 }),
    AppError,
  );
  assertEquals(versionError.code, "conflict");
  assertEquals(f.records.size, 0);
  assertEquals(f.tasks.get(task.id)?.status, "open");
  const result = await activity.completeTask(f.deps, requestActor(actor), task.id, input);
  taskResult.parse(result.task);
  recordResult.parse(result.record);
  assertEquals(result.task.status, "done");
  assertEquals(result.task.version, 2);
  assertEquals(result.task.completed_at, now);
  assertEquals(result.task.result_record_id, result.record.id);
  assertEquals(result.record.task_id, task.id);
  await assertRejects(() => activity.completeTask(f.deps, requestActor(actor), task.id, input), AppError);
  assertEquals(f.records.size, 1);
  assertEquals(f.jobs.map((job) => job.kind), ["record"]);
  const error = await assertRejects(
    () => activity.completeTask(f.deps, requestActor(actor), task.id, { ...input, body: "different" }),
    AppError,
  );
  assertEquals(error.code, "conflict");
  assertEquals(f.records.size, 1);
});

async function post(app: ReturnType<typeof createHttpApp>, path: string, input?: unknown, method = "POST") {
  return await app.fetch(
    new Request(`https://app.invalid/api${path}`, {
      method,
      headers: {
        "Idempotency-Key": crypto.randomUUID(),
        "X-Workspace-Id": "fc48a529-57ed-429a-9080-0f78a8563375",
        authorization: "Bearer fixture",
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    }),
  );
}

Deno.test("HTTP routes and MCP ToolDef schema/handler share task outcomes and input/errors (no transport)", async () => {
  const f = fixture();
  const tools = activityTools(f.deps);
  const create = tools.find((tool) => tool.name === "create_task")!;
  const complete = tools.find((tool) => tool.name === "complete_task")!;
  assertEquals(create.input.safeParse({ request_key: crypto.randomUUID(), ...createInput }).success, true);
  const created = await post(f.app, "/tasks", createInput);
  assertEquals(created.status, 201);
  const task = taskResult.parse(await created.json());
  await create.handler({ request_key: crypto.randomUUID(), ...createInput }, actor); // A separate creation intent gets a separate ID.
  const args = { id: task.id, ...completeInput };
  assertEquals(complete.input.safeParse({ request_key: crypto.randomUUID(), ...args }).success, true);
  await complete.handler({ request_key: crypto.randomUUID(), ...args }, actor);
  const retry = await post(f.app, `/tasks/${task.id}/complete`, completeInput);
  assertEquals(retry.status, 409);
  assertEquals((await retry.json()).code, "conflict");
  assertEquals(f.records.size, 1);
  assertEquals(f.jobs.length, 1);

  for (
    const [path, tool, input, code, status] of [
      ["/tasks", create, { ...createInput, title: "" }, "invalid_input", 400],
      ["/tasks", create, { ...createInput, owner_id: actor.userId }, "invalid_input", 400],
      [
        `/tasks/${task.id}/complete`,
        complete,
        { ...completeInput, change_note: "테스트 변경 이유", expected_version: 0 },
        "invalid_input",
        400,
      ],
      [`/tasks/${task.id}/complete`, complete, { ...completeInput }, "conflict", 409],
      ["/tasks/bad-id/complete", complete, completeInput, "not_found", 404],
    ] as const
  ) {
    const http = await post(f.app, path, input);
    assertEquals(http.status, status);
    const mcpInput = tool === complete ? { id: path.split("/")[2], ...input } : input;
    const error = await assertRejects(
      async () => await tool.handler({ request_key: crypto.randomUUID(), ...mcpInput }, actor),
      AppError,
    );
    const mapped = toErrorBody(error);
    assertEquals(mapped.body.code, code);
    assertEquals(await http.json(), mapped.body);
  }
  assertEquals(
    complete.input.safeParse({
      request_key: crypto.randomUUID(),
      ...{ ...args, change_note: "테스트 변경 이유", expected_version: 0 },
    }).success,
    false,
  );
  assertEquals(
    create.input.safeParse({ request_key: crypto.randomUUID(), ...{ ...createInput, owner_id: actor.userId } }).success,
    false,
  );
  assertEquals(f.records.size, 1);
  assertEquals(f.jobs.length, 1);
});

Deno.test("HTTP PATCH/POST delete and MCP task mutation schema/handler share validation and no-write errors", async () => {
  const f = fixture();
  const tools = activityTools(f.deps);
  const update = tools.find((tool) => tool.name === "update_task")!;
  const remove = tools.find((tool) => tool.name === "delete_task")!;
  const task = await activity.createTask(f.deps, requestActor(actor), taskCreate.parse({ ...createInput }));
  const path = `/tasks/${task.id}`;
  const patch = { change_note: "테스트 변경 이유", expected_version: 1, title: "HTTP 수정" };
  assertEquals(
    update.input.safeParse({ request_key: crypto.randomUUID(), ...{ id: task.id, ...patch } }).success,
    true,
  );
  const edited = await post(f.app, path, patch, "PATCH");
  assertEquals(edited.status, 200);
  assertEquals(taskResult.parse(await edited.json()), f.tasks.get(task.id));
  const mcpEdited = await update.handler({
    request_key: crypto.randomUUID(),
    ...{
      change_note: "테스트 변경 이유",
      id: task.id,
      expected_version: 2,
      body: "MCP 수정",
    },
  }, actor);
  assertEquals(taskResult.parse(mcpEdited), f.tasks.get(task.id));
  assertEquals(f.tasks.get(task.id)?.title, "HTTP 수정");
  assertEquals(f.tasks.get(task.id)?.body, "MCP 수정");
  assertEquals(f.tasks.get(task.id)?.version, 3);
  assertEquals(f.jobs.length, 0);

  const errors = [
    {
      tool: update,
      input: { change_note: "테스트 변경 이유", expected_version: 0, title: "수정" },
      code: "invalid_input",
      status: 400,
    },
    {
      tool: update,
      input: { change_note: "테스트 변경 이유", expected_version: 3, status: "done" },
      code: "invalid_input",
      status: 400,
    },
    {
      tool: update,
      input: { change_note: "테스트 변경 이유", expected_version: 3, timezone: "Asia/Seoul" },
      code: "invalid_input",
      status: 400,
    },
    {
      tool: update,
      input: { change_note: "테스트 변경 이유", expected_version: 2, title: "오래된 수정" },
      code: "conflict",
      status: 409,
    },
    {
      tool: remove,
      input: { change_note: "테스트 변경 이유", expected_version: 0 },
      code: "invalid_input",
      status: 400,
    },
    { tool: remove, input: { change_note: "테스트 변경 이유", expected_version: 2 }, code: "conflict", status: 409 },
  ];
  const before = snapshot(f);
  for (const { tool, input, code, status } of errors) {
    const isDelete = tool === remove;
    const http = await post(
      f.app,
      isDelete ? `${path}/delete` : path,
      input,
      isDelete ? "POST" : "PATCH",
    );
    assertEquals(http.status, status);
    const error = await assertRejects(
      async () => await tool.handler({ request_key: crypto.randomUUID(), ...{ id: task.id, ...input } }, actor),
      AppError,
    );
    const mapped = toErrorBody(error);
    assertEquals(mapped.body.code, code);
    assertEquals(await http.json(), mapped.body);
    assertEquals(snapshot(f), before);
  }
  assertEquals(
    update.input.safeParse({
      request_key: crypto.randomUUID(),
      ...{ change_note: "테스트 변경 이유", id: task.id, expected_version: 3, status: "done" },
    })
      .success,
    false,
  );
  assertEquals(
    remove.input.safeParse({
      request_key: crypto.randomUUID(),
      ...{ change_note: "테스트 변경 이유", id: task.id, expected_version: 0 },
    }).success,
    false,
  );
  assertEquals(
    remove.input.safeParse({
      request_key: crypto.randomUUID(),
      ...{ change_note: "테스트 변경 이유", id: task.id, expected_version: 3 },
    }).success,
    true,
  );
  const deleted = await post(f.app, `${path}/delete`, { expected_version: 3 });
  assertEquals(deleted.status, 204);
  assertEquals(await deleted.text(), "");
  const another = await activity.createTask(
    f.deps,
    requestActor(actor),
    taskCreate.parse({ ...createInput }),
  );
  assertEquals(
    await remove.handler({
      request_key: crypto.randomUUID(),
      ...{ change_note: "테스트 변경 이유", id: another.id, expected_version: 1 },
    }, actor),
    {
      deleted: another.id,
    },
  );
  assertEquals(f.tasks.size, 2);
  assertEquals([...f.tasks.values()].every((task) => task.deleted_at === now), true);
  const after = snapshot(f);
  for (const id of [task.id, crypto.randomUUID()]) {
    for (const tool of [update, remove]) {
      const input = tool === update
        ? { change_note: "테스트 변경 이유", expected_version: 1, title: "수정" }
        : { change_note: "테스트 변경 이유", expected_version: 1 };
      const http = await post(
        f.app,
        `/tasks/${id}${tool === remove ? "/delete" : ""}`,
        input,
        tool === remove ? "POST" : "PATCH",
      );
      assertEquals(http.status, id === task.id ? 409 : 404);
      const error = await assertRejects(
        async () => await tool.handler({ request_key: crypto.randomUUID(), ...{ id, ...input } }, actor),
        AppError,
      );
      assertEquals(error.code, id === task.id ? "conflict" : "not_found");
      assertEquals(await http.json(), toErrorBody(error).body);
      assertEquals(snapshot(f), after);
    }
  }
});

Deno.test("HTTP production default still rejects missing bearer token before any port runs", async () => {
  const f = fixture();
  const app = createHttpApp(f.deps, f.config, f.unused, f.unused);
  const response = await app.fetch(new Request("https://app.invalid/api/tasks"));
  assertEquals(response.status, 401);
  assertEquals(response.headers.get("WWW-Authenticate"), 'Bearer error="invalid_token"');
  assertEquals((await response.json()).code, "unauthenticated");
  assertEquals(f.tasks.size, 0);
});

Deno.test("removed principle HTTP routes return 404 without reading or writing business storage", async () => {
  const f = fixture();
  for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
    for (
      const path of [
        "/principles",
        "/principles/current",
        "/principles/20261016-ABCDEFGH",
        "/principles/20261016-ABCDEFGH/delete",
      ]
    ) {
      const response = await f.app.request(path, { method, headers: { authorization: "Bearer test" } });
      assertEquals(response.status, 404);
      await response.body?.cancel();
    }
  }
  assertEquals(f.jobs.length, 0);
  assertEquals(f.tasks.size, 0);
  assertEquals(f.records.size, 0);
});
