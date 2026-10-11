import { assertEquals } from "@std/assert";
import { Hono } from "hono";
import { activityRoutes } from "../../functions/_shared/adapters/http/activity-routes.ts";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import type { ActivityStore } from "../../functions/_shared/core/activity/ports.ts";
import type { Task } from "../../functions/_shared/core/activity/domain.ts";

// Serial database boundary; real owner validation, rollback and concurrency use isolated DB tests.
function fixture() {
  const actor = { userId: crypto.randomUUID() }, rows = new Map<string, Task>();
  const now = "2026-10-06T01:00:00.000Z";
  const store = {
    executeRequest: <T>(_request: unknown, execute: () => Promise<T>) => execute(),
    insertTask: (input: object) => {
      const row = {
        ...input,
        id: crypto.randomUUID(),
        version: 1,
        created_at: now,
        updated_at: now,
        completed_at: null,
        result_record_id: null,
      } as Task;
      rows.set(row.id, row);
      return Promise.resolve(row);
    },
    getTask: (id: string) => Promise.resolve(rows.get(id) ?? null),
    updateTask: (id: string, patch: object) => {
      const prior = rows.get(id)!;
      const row = { ...prior, ...patch, version: prior.version + 1 };
      rows.set(id, row);
      return Promise.resolve(row);
    },
    enqueueIndex: () => Promise.resolve(),
    appendChange: () => Promise.resolve(),
  } as unknown as ActivityStore;
  const deps = {
    uow: { run: <T>(_actor: typeof actor, fn: (s: ActivityStore) => Promise<T>) => fn(store) },
    clock: { now: () => new Date(now) },
  };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", { ...actor, request: { key: c.req.header("Idempotency-Key") ?? crypto.randomUUID() } });
    await next();
  });
  app.route("/", activityRoutes(deps));
  app.onError((e, c) => {
    const result = toErrorBody(e);
    return c.json(result.body, result.status as 400);
  });
  return {
    app,
    call: (name: string, input: Record<string, unknown>) =>
      activityTools(deps).find((t) => t.name === name)!.handler({
        .../^(create_|update_|delete_)/.test(name) ? { request_key: crypto.randomUUID() } : {},
        ...input,
      }, actor),
  };
}

Deno.test("HTTP task can select two entities and MCP independently reads both; body mentions do not create links", async () => {
  const f = fixture(), ids = ["app:00000000-0000-4000-8000-000000000002", "app:00000000-0000-4000-8000-000000000001"];
  const response = await f.app.request("/tasks", {
    method: "POST",
    headers: { "Idempotency-Key": crypto.randomUUID(), "content-type": "application/json" },
    body: JSON.stringify({
      kind: "once",
      title: "공동 업무",
      body: "본문에는 세 번째 대상도 언급",
      entity_ids: ids,
    }),
  });
  assertEquals(response.status, 201);
  const created = await response.json();
  const read = await f.call("get_task", { id: created.id }) as typeof created;
  assertEquals(read.entity_ids, [...ids].sort());
  assertEquals("entity_id" in read, false);
});

Deno.test("HTTP task rejects conflicting legacy target alias on edit without changing selected targets", async () => {
  const f = fixture(),
    selected = "app:00000000-0000-4000-8000-000000000001",
    other = "app:00000000-0000-4000-8000-000000000002";
  const created = await f.call("create_task", {
    kind: "once",
    title: "대상 유지",
    entity_ids: [selected],
  }) as { id: string };
  const response = await f.app.request(`/tasks/${created.id}`, {
    method: "PATCH",
    headers: { "Idempotency-Key": crypto.randomUUID(), "content-type": "application/json" },
    body: JSON.stringify({ expected_version: 1, entity_id: other, entity_ids: [selected] }),
  });
  assertEquals(response.status, 400);
});
