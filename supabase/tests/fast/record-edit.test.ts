import { assertEquals, assertRejects } from "@std/assert";
import { Hono } from "hono";
import { activityRoutes } from "../../functions/_shared/adapters/http/activity-routes.ts";
import type { HttpEnv } from "../../functions/_shared/adapters/http/input.ts";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import { toErrorBody } from "../../functions/_shared/adapters/errors.ts";
import type { ActivityRecord, ActivityStore } from "../../functions/_shared/core/activity/ports.ts";
import type { IndexJob } from "../../functions/_shared/core/shared/store.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";

// Serial in-memory database boundary. Real DB tests own rollback/concurrency/RLS.
function fixture(kind: "user" | "result" | "change") {
  const actor = { userId: crypto.randomUUID() }, now = "2026-10-06T01:00:00.000Z";
  let row: ActivityRecord = {
    id: crypto.randomUUID(),
    record_kind: kind,
    body: "본문",
    occurred_at: now,
    created_at: now,
    updated_at: now,
    version: 1,
    task_id: kind === "result" ? crypto.randomUUID() : null,
    occurrence_on: kind === "result" ? "2026-10-06" : null,
    tag_ids: [],
    change: kind === "change"
      ? {
        event_id: crypto.randomUUID(),
        target_kind: "entity",
        target_id: crypto.randomUUID(),
        target_title: "대상",
        action: "update",
        source: "http",
        before: null,
        after: null,
        path: null,
      }
      : null,
  };
  const jobs: IndexJob[] = [];
  const store = new Proxy({
    executeRequest: <T>(_request: unknown, execute: () => Promise<T>) => execute(),
    getRecord: () => Promise.resolve(structuredClone(row)),
    updateRecord: (_id: string, patch: object) => {
      row = { ...row, ...patch, version: row.version + 1 };
      return Promise.resolve(structuredClone(row));
    },
    appendChange: () => {
      throw Error("Record edits must not generate another record");
    },
    enqueueIndex: (job: IndexJob) => {
      jobs.push(job);
      return Promise.resolve();
    },
  }, {
    get: (target, key) =>
      Reflect.get(target, key) ?? (() => {
        throw Error("Unused storage operation");
      }),
  }) as unknown as ActivityStore;
  const deps = {
    clock: { now: () => new Date(now) },
    uow: { run: <T>(_actor: typeof actor, fn: (s: ActivityStore) => Promise<T>) => fn(store) },
  };
  const app = new Hono<HttpEnv>();
  app.use("*", async (c, next) => {
    c.set("actor", { ...actor, request: { key: c.req.header("Idempotency-Key") ?? crypto.randomUUID() } });
    await next();
  });
  app.route("/", activityRoutes(deps));
  app.onError((e, c) => {
    const r = toErrorBody(e);
    return c.json(r.body, r.status as 400);
  });
  const tools = activityTools(deps);
  return {
    initial: structuredClone(row),
    jobs,
    http: (input: unknown) =>
      app.request(`/records/${row.id}`, {
        method: "PATCH",
        headers: { "Idempotency-Key": crypto.randomUUID(), "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
    call: (input: object) =>
      tools.find((t) => t.name === "update_record")!.handler({
        request_key: crypto.randomUUID(),
        ...{ id: row.id, ...input },
      }, actor),
    read: async () =>
      await tools.find((t) => t.name === "get_record")!.handler({ id: row.id }, actor) as ActivityRecord,
  };
}

for (const kind of ["user", "result", "change"] as const) {
  Deno.test(`${kind}: HTTP edit without reason and MCP retry preserve facts, without another log`, async () => {
    const f = fixture(kind),
      patch = { expected_version: 1, body: "정정" };
    const web = await f.http(patch);
    assertEquals(web.status, 200);
    const updated = await web.json();
    await assertRejects(() => f.call(patch));
    assertEquals(await f.read(), updated);
    assertEquals([updated.version, updated.body], [2, "정정"]);
    assertEquals([updated.change, updated.occurred_at, updated.task_id, updated.occurrence_on], [
      f.initial.change,
      f.initial.occurred_at,
      f.initial.task_id,
      f.initial.occurrence_on,
    ]);
    assertEquals("applied_principle_ids" in updated, false);
    assertEquals(f.jobs.length, 1);
    assertEquals(await f.call({ expected_version: 2, body: "정정" }), updated);
    const stale = await f.http({ expected_version: 1, body: "오래된 수정" });
    assertEquals(stale.status, 409);
    assertEquals((await f.read()).body, "정정");
  });
}
Deno.test("change: HTTP/MCP reject event identity and occurrence changes", async () => {
  const f = fixture("change");
  for (
    const patch of [{ occurred_at: "2020-01-01T00:00:00Z" }, { change: { action: "delete" } }, {
      task_id: crypto.randomUUID(),
    }]
  ) {
    assertEquals((await f.http({ expected_version: 1, ...patch })).status, 400);
    await assertRejects(async () => await f.call({ expected_version: 1, ...patch }), AppError);
  }
  assertEquals((await f.read()).version, 1);
});
