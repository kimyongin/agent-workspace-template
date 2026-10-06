import { assertEquals, assertRejects } from "@std/assert";
import { Hono } from "hono";
import { activityRoutes } from "../../functions/_shared/adapters/http/activity-routes.ts";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import type { ActivityStore } from "../../functions/_shared/core/activity/ports.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type { Task } from "../../functions/_shared/core/activity/domain.ts";

function fixture() {
  const actor = { userId: crypto.randomUUID() }, available = crypto.randomUUID();
  const task: Task = {
    id: crypto.randomUUID(),
    kind: "once",
    title: "현재 업무",
    summary: "대상 없는 업무",
    body: "",
    due_on: null,
    recurrence: null,
    timezone: null,
    status: "open",
    completed_at: null,
    result_record_id: null,
    pauses: [],
    tag_ids: [],
    entity_ids: [],
    entity_context: [],
    version: 3,
    created_at: "2026-10-06T00:00:00Z",
    updated_at: "2026-10-06T00:00:00Z",
  };
  const store = new Proxy({
    getTask: (id: string) => Promise.resolve(id === task.id ? structuredClone(task) : null),
    validateEntitySelection: (ids: string[]) =>
      ids.every((id) => id === available)
        ? Promise.resolve()
        : Promise.reject(new AppError("invalid_reference", "엔터티가 없거나 접근할 수 없습니다")),
  }, {
    get: (value, key) =>
      Reflect.get(value, key) ?? (() => {
        throw Error("Preview must not write");
      }),
  }) as unknown as ActivityStore;
  const deps = {
    clock: { now: () => new Date("2026-10-06T00:00:00Z") },
    uow: { run: <T>(_a: typeof actor, fn: (s: ActivityStore) => Promise<T>) => fn(store) },
  };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  app.route("/", activityRoutes(deps));
  app.onError((error, c) => {
    const r = toErrorBody(error);
    return c.json(r.body, r.status as 400);
  });
  return {
    available,
    task,
    http: (input: unknown) =>
      app.request("/tasks/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    mcp: (input: Record<string, unknown>) =>
      activityTools(deps).find((t) => t.name === "preview_task_change")!.handler(input, actor),
  };
}

Deno.test("task update preview checks explicit selections, preserves omission, and rejects retired aliases", async () => {
  const f = fixture(), before = structuredClone(f.task);
  const patch = {
    action: "update",
    id: f.task.id,
    input: { expected_version: 3, title: "수정 업무", entity_ids: [crypto.randomUUID()] },
  };
  assertEquals((await f.http(patch)).status, 400);
  await assertRejects(() => f.mcp(patch), AppError, "엔터티가 없거나 접근할 수 없습니다");
  for (const selection of [{}, { entity_ids: [] }, { entity_ids: [f.available] }]) {
    const input = { ...patch, input: { expected_version: 3, title: "수정 업무", ...selection } };
    const response = await f.http(input);
    assertEquals(response.status, 200);
    assertEquals(await response.json(), await f.mcp(input));
  }
  const inconsistent = { ...patch, input: { ...patch.input, entity_id: f.available } };
  assertEquals((await f.http(inconsistent)).status, 400);
  await assertRejects(async () => await f.mcp(inconsistent), AppError, "입력이 계약에 맞지 않습니다");
  assertEquals(f.task, before);
});

Deno.test("task preview refuses unavailable selections through HTTP and MCP without writing", async () => {
  const actor = { userId: crypto.randomUUID() }, unavailable = crypto.randomUUID();
  const store = new Proxy({
    validateEntitySelection: () =>
      Promise.reject(new AppError("invalid_reference", "엔터티가 없거나 접근할 수 없습니다")),
  }, {
    get: (value, key) =>
      Reflect.get(value, key) ?? (() => {
        throw Error("Preview must not write");
      }),
  }) as unknown as ActivityStore;
  const deps = {
    clock: { now: () => new Date("2026-10-06T00:00:00Z") },
    uow: { run: <T>(_a: typeof actor, fn: (s: ActivityStore) => Promise<T>) => fn(store) },
  };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", actor);
    await next();
  });
  app.route("/", activityRoutes(deps));
  app.onError((error, c) => {
    const r = toErrorBody(error);
    return c.json(r.body, r.status as 400);
  });
  const input = {
    action: "create",
    input: { kind: "once", title: "연결 업무", summary: "대상 검증", entity_ids: [unavailable] },
  };
  const response = await app.request("/tasks/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  assertEquals(response.status, 400);
  assertEquals((await response.json()).code, "invalid_reference");
  await assertRejects(
    () => activityTools(deps).find((t) => t.name === "preview_task_change")!.handler(input, actor),
    AppError,
    "엔터티가 없거나 접근할 수 없습니다",
  );
});
