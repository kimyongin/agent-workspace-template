import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { createHttpApp } from "../../functions/_shared/adapters/http/app.ts";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import { taskCreate, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import { asUser, connect, dbTest, outcome, urls } from "./_db.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.pooler, { max: 6, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
const keyed = (actor: Actor, key: string = crypto.randomUUID()): Actor => ({ ...actor, request: { key } });
const input = taskCreate.parse({ kind: "once", title: "요청 재현", body: "" });

async function taskFixture() {
  const fixture = await businessWorkspaceFixture(admin, sql);
  await fixture.grant(fixture.manager, [{ target_kind: "settings", target_id: "*", access: "write" }, {
    target_kind: "tasks",
    target_id: "*",
    access: "write",
  }]);
  return fixture;
}
async function code(fn: () => Promise<unknown>, expected: string) {
  const error = await assertRejects(fn, AppError);
  assertEquals(error.code, expected);
}
async function effects(workspace: string) {
  const [row] = await admin`select
    (select count(*)::int from app.tasks where workspace_id=${workspace} and deleted_at is null) tasks,
    (select count(*)::int from app.records where workspace_id=${workspace} and record_kind='change') changes,
    (select count(*)::int from pgmq.q_search_index where message->>'workspace_id'=${workspace}) jobs,
    (select count(*)::int from private.workspace_request_results where workspace_id=${workspace} and operation like 'task.%' and completed_at is not null) receipts`;
  return row;
}

dbTest("same key concurrent task creation and lost-response retry commit one business event", async () => {
  const f = await taskFixture();
  try {
    const actor = keyed(f.manager);
    const results = await Promise.all(
      Array.from(
        { length: 4 },
        () => activity.createTask(deps, { ...actor, request: { key: actor.request!.key } }, input),
      ),
    );
    for (const result of results) assertEquals(result, results[0]);
    assert(/^\d{8}-[A-Za-z0-9]{8}$/.test(results[0].id));
    assertEquals(await effects(f.workspaceId), { tasks: 1, changes: 1, jobs: 1, receipts: 1 });
    assertEquals(await activity.createTask(deps, actor, input), results[0]);
    await code(() => activity.createTask(deps, actor, { ...input, title: "다른 내용" }), "idempotency_key_reused");
    const patch = taskUpdate.parse({ expected_version: 1, title: "수정" });
    const changeActor = keyed(f.manager);
    const updated = await activity.updateTask(deps, changeActor, results[0].id, patch);
    assertEquals(await activity.updateTask(deps, changeActor, results[0].id, patch), updated);
    await code(() => activity.updateTask(deps, keyed(f.manager), results[0].id, patch), "conflict");
    await code(() => activity.updateTask(deps, actor, results[0].id, patch), "idempotency_key_reused");
    const deletion = keyed(f.manager);
    await activity.deleteTask(deps, deletion, updated.id, updated.version);
    await activity.deleteTask(deps, deletion, updated.id, updated.version);
    assertEquals(await activity.createTask(deps, actor, input), results[0]);
    assert((await activity.getTask(deps, f.manager, updated.id)).deleted_at);
    assertEquals(await effects(f.workspaceId), { tasks: 0, changes: 3, jobs: 3, receipts: 3 });
  } finally {
    await f.cleanup();
  }
});

dbTest("failed write rolls back business effects and ledger and the same key can retry", async () => {
  const f = await taskFixture();
  try {
    const actor = keyed(f.manager);
    const failing = {
      ...deps,
      uow: {
        run: <T>(
          a: Actor,
          fn: (store: import("../../functions/_shared/core/activity/ports.ts").ActivityStore) => Promise<T>,
          entry?: import("../../functions/_shared/core/activity/ports.ts").ActivityEntry,
        ) =>
          deps.uow.run(a, (store) =>
            fn(
              new Proxy(store, {
                get(target, prop, receiver) {
                  const value = Reflect.get(target, prop, receiver);
                  if (prop === "appendChange") {
                    return async (...args: unknown[]) => {
                      await value.apply(target, args);
                      throw new Error("injected failure before commit");
                    };
                  }
                  return typeof value === "function" ? value.bind(target) : value;
                },
              }),
            ), entry),
      },
    };
    await assertRejects(() => activity.createTask(failing, actor, input));
    assertEquals(await effects(f.workspaceId), { tasks: 0, changes: 0, jobs: 0, receipts: 0 });
    const result = await activity.createTask(deps, actor, input);
    assertEquals((await activity.getTask(deps, actor, result.id)).id, result.id);
  } finally {
    await f.cleanup();
  }
});

dbTest("HTTP and MCP use the same workspace/key/payload and preserve creation and deletion envelopes", async () => {
  const f = await taskFixture();
  try {
    const unused = {
      uow: {
        run: () => {
          throw new Error("unused");
        },
      },
    };
    const app = createHttpApp(
      deps,
      { basePath: "", token: {} as never, allowedOrigins: [] },
      unused,
      {} as never,
      () => Promise.resolve(f.manager),
    );
    const tools = activityTools(deps);
    const key = crypto.randomUUID();
    const response = await app.request("/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Workspace-Id": f.workspaceId,
        "Idempotency-Key": key.toUpperCase(),
      },
      body: JSON.stringify(input),
    });
    assertEquals(response.status, 201);
    const created = await response.json();
    assertEquals(
      await tools.find((t) => t.name === "create_task")!.handler({ ...input, request_key: key }, f.manager),
      created,
    );
    const replay = await app.request("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Id": f.workspaceId, "Idempotency-Key": key },
      body: JSON.stringify({ body: "", title: input.title, kind: "once" }),
    });
    assertEquals(replay.status, 201);
    assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
    assertEquals(await replay.json(), created);
    const deleteKey = crypto.randomUUID();
    const deleted = await app.request(`/tasks/${created.id}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Id": f.workspaceId, "Idempotency-Key": deleteKey },
      body: JSON.stringify({ expected_version: 1 }),
    });
    assertEquals(deleted.status, 204);
    assertEquals(
      await tools.find((t) => t.name === "delete_task")!.handler({
        id: created.id,
        expected_version: 1,
        request_key: deleteKey,
      }, f.manager),
      { deleted: created.id },
    );
    const deletionReplay = await app.request(`/tasks/${created.id}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Id": f.workspaceId, "Idempotency-Key": deleteKey },
      body: JSON.stringify({ expected_version: 1 }),
    });
    assertEquals(deletionReplay.status, 204);
    assertEquals(deletionReplay.headers.get("Idempotency-Replayed"), "true");
    await admin`update private.workspace_request_results set completed_at=clock_timestamp()-interval '30 days' where workspace_id=${f.workspaceId} and executor_id=${f.manager.userId} and request_key=${key}::uuid`;
    const expired = await app.request("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Id": f.workspaceId, "Idempotency-Key": key },
      body: JSON.stringify(input),
    });
    assertEquals(expired.status, 410);
    assertEquals((await expired.json()).code, "result_expired");
    await code(
      () => tools.find((t) => t.name === "create_task")!.handler({ ...input, request_key: key }, f.manager),
      "result_expired",
    );
    await code(
      () =>
        tools.find((t) => t.name === "create_task")!.handler(
          { ...input, title: "다른 입력", request_key: key },
          f.manager,
        ),
      "idempotency_key_reused",
    );
    // Dispose only this test's exact expired rows; unrelated retained results
    // are outside the fixture's ownership and are never maintenance targets.
    await admin`delete from private.workspace_request_results where workspace_id=${f.workspaceId} and executor_id=${f.manager.userId} and completed_at<=clock_timestamp()-interval '30 days'`;
    const renewed = await tools.find((t) => t.name === "create_task")!.handler(
      { ...input, request_key: key },
      f.manager,
    ) as { id: string };
    assert(renewed.id !== created.id);
    const renewedReplay = await app.request("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Workspace-Id": f.workspaceId, "Idempotency-Key": key },
      body: JSON.stringify(input),
    });
    assertEquals(renewedReplay.headers.get("Idempotency-Replayed"), "true");
    assertEquals(await renewedReplay.json(), renewed);
  } finally {
    await f.cleanup();
  }
});

dbTest("workspaces have isolated keys and deleted actors cannot replay with an old Actor", async () => {
  const f = await taskFixture(), other = await taskFixture();
  try {
    const actor = keyed(f.manager);
    const created = await activity.createTask(deps, actor, input);
    const second = await activity.createTask(deps, keyed(other.manager, actor.request!.key), input);
    assert(created.id !== second.id);
    await code(
      () => activity.updateTask(deps, keyed(other.manager), created.id, { expected_version: 1, title: "foreign" }),
      "not_found",
    );
    assert(
      (await outcome(asUser(sql, actor.userId, (tx) => tx`select * from private.workspace_request_results`)))
        .startsWith("42501"),
    );
    await f.cleanup();
    await code(() => activity.createTask(deps, actor, input), "unauthenticated");
  } finally {
    await f.cleanup();
    await other.cleanup();
  }
});

dbTest("30-day results expire before cleanup and cleaned keys can create a new request", async () => {
  const f = await taskFixture();
  try {
    const actor = keyed(f.manager);
    const created = await activity.createTask(deps, actor, input);
    await admin`update private.workspace_request_results set completed_at=clock_timestamp()-interval '30 days'+interval '1 minute' where workspace_id=${f.workspaceId} and executor_id=${actor.userId}`;
    assertEquals(await activity.createTask(deps, actor, input), created);
    await code(() => activity.createTask(deps, actor, { ...input, title: "다른 입력" }), "idempotency_key_reused");
    await admin`update private.workspace_request_results set completed_at=clock_timestamp()-interval '30 days' where workspace_id=${f.workspaceId} and executor_id=${actor.userId}`;
    await code(() => activity.createTask(deps, actor, input), "result_expired");
    await admin`update private.workspace_request_results set completed_at=clock_timestamp()-interval '31 days' where workspace_id=${f.workspaceId} and executor_id=${actor.userId}`;
    await code(() => activity.createTask(deps, actor, input), "result_expired");
    // Dispose only this test's exact expired rows; unrelated retained results
    // are outside the fixture's ownership and are never maintenance targets.
    await admin`delete from private.workspace_request_results where workspace_id=${f.workspaceId} and executor_id=${f.manager.userId} and completed_at<=clock_timestamp()-interval '30 days'`;
    assertEquals(
      (await admin`select count(*)::int n from private.workspace_request_results where workspace_id=${f.workspaceId} and executor_id=${actor.userId}`)[
        0
      ].n,
      0,
    );
    const fresh = await activity.createTask(deps, keyed(f.manager, actor.request!.key), input);
    assert(fresh.id !== created.id);
    assertEquals((await activity.getTask(deps, f.manager, created.id)).id, created.id);
    assertEquals((await activity.getTask(deps, f.manager, fresh.id)).id, fresh.id);
  } finally {
    await f.cleanup();
  }
});

dbTest("a competing request waits at most two seconds and never executes a second event", async () => {
  const f = await taskFixture();
  let release!: () => void, started!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const actor = keyed(f.manager);
  const slow = {
    ...deps,
    uow: {
      run: <T>(
        a: Actor,
        fn: (store: import("../../functions/_shared/core/activity/ports.ts").ActivityStore) => Promise<T>,
        entry?: import("../../functions/_shared/core/activity/ports.ts").ActivityEntry,
      ) =>
        deps.uow.run(a, (store) =>
          fn(
            new Proxy(store, {
              get(target, prop, receiver) {
                const value = Reflect.get(target, prop, receiver);
                if (prop === "appendChange") {
                  return async (...args: unknown[]) => {
                    await value.apply(target, args);
                    started();
                    await held;
                  };
                }
                return typeof value === "function" ? value.bind(target) : value;
              },
            }),
          ), entry),
    },
  };
  const first = activity.createTask(slow, actor, input);
  try {
    await ready;
    await code(() => activity.createTask(deps, keyed(f.manager, actor.request!.key), input), "request_in_progress");
    release();
    const created = await first;
    assertEquals(await activity.createTask(deps, keyed(f.manager, actor.request!.key), input), created);
    assertEquals(await effects(f.workspaceId), { tasks: 1, changes: 1, jobs: 1, receipts: 1 });
  } finally {
    release();
    await first.catch(() => {});
    await f.cleanup();
  }
});

dbTest("different keys for the same workspace commit independent business events", async () => {
  const f = await taskFixture();
  try {
    const results = await Promise.all([
      activity.createTask(deps, keyed(f.manager), input),
      activity.createTask(deps, keyed(f.manager), input),
    ]);
    assert(results[0].id !== results[1].id);
    assertEquals(await effects(f.workspaceId), { tasks: 2, changes: 2, jobs: 2, receipts: 2 });
  } finally {
    await f.cleanup();
  }
});
