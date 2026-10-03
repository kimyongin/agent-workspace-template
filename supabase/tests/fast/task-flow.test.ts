import { assertEquals, assertRejects } from "@std/assert";
import { taskComplete, taskCreate, taskResult } from "../../functions/_shared/contracts/task.ts";
import { recordResult } from "../../functions/_shared/contracts/record.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import type { Task } from "../../functions/_shared/core/activity/domain.ts";
import type { ActivityRecord, ActivityStore, StoredRequest } from "../../functions/_shared/core/activity/ports.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type { IndexJob } from "../../functions/_shared/core/shared/store.ts";
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
function fixture() {
  const tasks = new Map<string, Task>();
  const records = new Map<string, ActivityRecord>();
  const requests = new Map<string, StoredRequest>();
  const jobs: IndexJob[] = [];
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
    deleteTask: unsupported,
    getRecord: unsupported,
    getRecordSummaries: unsupported,
    listRecords: unsupported,
    occurrenceRecords: unsupported,
    updateRecord: unsupported,
    deleteRecord: unsupported,
    detachRecords: unsupported,
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
  return { deps, app, config, unused, tasks, records, jobs };
}

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

async function post(app: ReturnType<typeof createHttpApp>, path: string, input: unknown) {
  return await app.fetch(
    new Request(`https://app.invalid/api${path}`, {
      method: "POST",
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

Deno.test("HTTP production default still rejects missing bearer token before any port runs", async () => {
  const f = fixture();
  const app = createHttpApp(f.deps, f.config, f.unused, f.unused, f.unused);
  const response = await app.fetch(new Request("https://app.invalid/api/tasks"));
  assertEquals(response.status, 401);
  assertEquals(response.headers.get("WWW-Authenticate"), 'Bearer error="invalid_token"');
  assertEquals((await response.json()).code, "unauthenticated");
  assertEquals(f.tasks.size, 0);
});
