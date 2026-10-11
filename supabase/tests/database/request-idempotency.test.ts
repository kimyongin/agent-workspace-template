import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { createHttpApp } from "../../functions/_shared/adapters/http/app.ts";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import { taskCreate, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import { asUser, connect, dbTest, fixtureOwner, outcome, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.pooler, { max: 6, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
const keyed = (actor: Actor, key: string = crypto.randomUUID()): Actor => ({ ...actor, request: { key } });
const input = taskCreate.parse({ kind: "once", title: "요청 재현", body: "" });

async function code(fn: () => Promise<unknown>, expected: string) {
  const error = await assertRejects(fn, AppError);
  assertEquals(error.code, expected);
}
async function effects(owner: string) {
  const [row] = await admin`select
    (select count(*)::int from app.tasks where owner_id=${owner}) tasks,
    (select count(*)::int from app.records where owner_id=${owner} and record_kind='change') changes,
    (select count(*)::int from pgmq.q_search_index where message->>'owner_id'=${owner}) jobs,
    (select count(*)::int from private.request_results where owner_id=${owner} and completed_at is not null) receipts`;
  return row;
}

dbTest("same key concurrent task creation and lost-response retry commit one business event", async () => {
  const f = await fixtureOwner(admin);
  try {
    const actor = keyed(f.actor);
    const results = await Promise.all(
      Array.from(
        { length: 4 },
        () => activity.createTask(deps, { ...actor, request: { key: actor.request!.key } }, input),
      ),
    );
    for (const result of results) assertEquals(result, results[0]);
    assert(/^\d{8}-[A-Za-z0-9]{8}$/.test(results[0].id));
    assertEquals(await effects(actor.userId), { tasks: 1, changes: 1, jobs: 1, receipts: 1 });
    assertEquals(await activity.createTask(deps, actor, input), results[0]);
    await code(() => activity.createTask(deps, actor, { ...input, title: "다른 내용" }), "idempotency_key_reused");
    const patch = taskUpdate.parse({ expected_version: 1, title: "수정" });
    const changeActor = keyed(f.actor);
    const updated = await activity.updateTask(deps, changeActor, results[0].id, patch);
    assertEquals(await activity.updateTask(deps, changeActor, results[0].id, patch), updated);
    await code(() => activity.updateTask(deps, keyed(f.actor), results[0].id, patch), "conflict");
    await code(() => activity.updateTask(deps, actor, results[0].id, patch), "idempotency_key_reused");
    const deletion = keyed(f.actor);
    await activity.deleteTask(deps, deletion, updated.id, updated.version);
    await activity.deleteTask(deps, deletion, updated.id, updated.version);
    assertEquals(await activity.createTask(deps, actor, input), results[0]);
    await code(() => activity.getTask(deps, f.actor, updated.id), "not_found");
    assertEquals(await effects(actor.userId), { tasks: 0, changes: 3, jobs: 3, receipts: 3 });
  } finally {
    await f.cleanup();
  }
});

dbTest("failed write leaves neither ledger nor reservations and the same key can retry", async () => {
  const f = await fixtureOwner(admin);
  try {
    const actor = keyed(f.actor);
    const failing = {
      ...deps,
      uow: {
        run: <T>(
          a: Actor,
          fn: (store: import("../../functions/_shared/core/activity/ports.ts").ActivityStore) => Promise<T>,
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
            )),
      },
    };
    const [{ n: before }] = await admin`select count(*)::int n from private.data_id_reservations`;
    await assertRejects(() => activity.createTask(failing, actor, input));
    assertEquals(await effects(actor.userId), { tasks: 0, changes: 0, jobs: 0, receipts: 0 });
    const [{ n: after }] = await admin`select count(*)::int n from private.data_id_reservations`;
    assertEquals(after, before);
    const result = await activity.createTask(deps, actor, input);
    assertEquals((await activity.getTask(deps, actor, result.id)).id, result.id);
  } finally {
    await f.cleanup();
  }
});

dbTest("HTTP and MCP use the same owner/key/payload and preserve creation and deletion envelopes", async () => {
  const f = await fixtureOwner(admin);
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
      unused,
      {} as never,
      () => Promise.resolve(f.actor),
    );
    const tools = activityTools(deps);
    const key = crypto.randomUUID();
    const response = await app.request("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key.toUpperCase() },
      body: JSON.stringify(input),
    });
    assertEquals(response.status, 201);
    const created = await response.json();
    assertEquals(
      await tools.find((t) => t.name === "create_task")!.handler({ ...input, request_key: key }, f.actor),
      created,
    );
    const replay = await app.request("/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": key },
      body: JSON.stringify({ body: "", title: input.title, kind: "once" }),
    });
    assertEquals(replay.status, 201);
    assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
    assertEquals(await replay.json(), created);
    const deleteKey = crypto.randomUUID();
    const deleted = await app.request(`/tasks/${created.id}/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": deleteKey },
      body: JSON.stringify({ expected_version: 1 }),
    });
    assertEquals(deleted.status, 204);
    assertEquals(
      await tools.find((t) => t.name === "delete_task")!.handler({
        id: created.id,
        expected_version: 1,
        request_key: deleteKey,
      }, f.actor),
      { deleted: created.id },
    );
    const deletionReplay = await app.request(`/tasks/${created.id}?expected_version=1`, {
      method: "DELETE",
      headers: { "Idempotency-Key": deleteKey },
    });
    assertEquals(deletionReplay.status, 204);
    assertEquals(deletionReplay.headers.get("Idempotency-Replayed"), "true");
  } finally {
    await f.cleanup();
  }
});

dbTest("owners have isolated keys and deleted owners cannot replay with an old Actor", async () => {
  const f = await fixtureOwner(admin), other = await fixtureOwner(admin);
  try {
    const actor = keyed(f.actor);
    const created = await activity.createTask(deps, actor, input);
    const second = await activity.createTask(deps, keyed(other.actor, actor.request!.key), input);
    assert(created.id !== second.id);
    await code(
      () => activity.updateTask(deps, keyed(other.actor), created.id, { expected_version: 1, title: "foreign" }),
      "not_found",
    );
    assert(
      (await outcome(asUser(sql, actor.userId, (tx) => tx`select * from private.request_results`))).startsWith("42501"),
    );
    assert(
      (await outcome(asUser(sql, actor.userId, (tx) => tx`select * from private.request_capacity`))).startsWith(
        "42501",
      ),
    );
    await f.cleanup();
    await code(() => activity.createTask(deps, actor, input), "unauthenticated");
  } finally {
    await f.cleanup();
    await other.cleanup();
  }
});

dbTest("expired results remain tombstones and full owners can replay but cannot commit new keys", async () => {
  const f = await fixtureOwner(admin);
  try {
    const actor = keyed(f.actor), fresh = keyed(f.actor);
    const created = await activity.createTask(deps, actor, input);
    await admin`update private.request_capacity set used=100000 where owner_id=${actor.userId}`;
    assertEquals(await activity.createTask(deps, actor, input), created);
    await code(() => activity.createTask(deps, fresh, input), "idempotency_capacity_exceeded");
    await admin`update private.request_results set completed_at=clock_timestamp()-interval '31 days' where owner_id=${actor.userId}`;
    await code(() => activity.createTask(deps, actor, input), "result_expired");
    await admin`select private.expire_request_results()`;
    await code(() => activity.createTask(deps, actor, input), "result_expired");
    const [{ result, used }] =
      await admin`select r.result,c.used from private.request_results r join private.request_capacity c using(owner_id) where owner_id=${actor.userId}`;
    assertEquals(result, null);
    assertEquals(used, 100000);
    assertEquals((await activity.getTask(deps, f.actor, created.id)).id, created.id);
  } finally {
    await f.cleanup();
  }
});

dbTest("a competing request waits at most two seconds and never executes a second event", async () => {
  const f = await fixtureOwner(admin);
  let release!: () => void, started!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    started = resolve;
  });
  const actor = keyed(f.actor);
  const slow = {
    ...deps,
    uow: {
      run: <T>(
        a: Actor,
        fn: (store: import("../../functions/_shared/core/activity/ports.ts").ActivityStore) => Promise<T>,
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
          )),
    },
  };
  const first = activity.createTask(slow, actor, input);
  try {
    await ready;
    await code(() => activity.createTask(deps, keyed(f.actor, actor.request!.key), input), "request_in_progress");
    release();
    const created = await first;
    assertEquals(await activity.createTask(deps, keyed(f.actor, actor.request!.key), input), created);
    assertEquals(await effects(actor.userId), { tasks: 1, changes: 1, jobs: 1, receipts: 1 });
  } finally {
    release();
    await first.catch(() => {});
    await f.cleanup();
  }
});

dbTest("the last owner capacity slot is atomic under different-key competition", async () => {
  const f = await fixtureOwner(admin);
  try {
    const actor = keyed(f.actor);
    await activity.createTask(deps, actor, input);
    await admin`update private.request_capacity set used=99999 where owner_id=${actor.userId}`;
    const results = await Promise.allSettled([
      activity.createTask(deps, keyed(f.actor), input),
      activity.createTask(deps, keyed(f.actor), input),
    ]);
    assertEquals(results.filter((r) => r.status === "fulfilled").length, 1);
    const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assertEquals((failed.reason as AppError).code, "idempotency_capacity_exceeded");
    assertEquals(await effects(actor.userId), { tasks: 2, changes: 2, jobs: 2, receipts: 2 });
  } finally {
    await f.cleanup();
  }
});

dbTest("lifetime quota counts committed requests once and excludes replays and rolled-back writes", async () => {
  const f = await fixtureOwner(admin);
  try {
    const actor = keyed(f.actor);
    const created = await activity.createTask(deps, actor, input);
    const used = async () => {
      const [row] = await admin`select used from private.request_capacity where owner_id=${f.actor.userId}`;
      return row?.used;
    };
    assertEquals(await used(), 1);
    assertEquals(await activity.createTask(deps, actor, input), created);
    assertEquals(await used(), 1);
    await code(
      () => activity.updateTask(deps, keyed(f.actor), created.id, { expected_version: 99, title: "rejected" }),
      "conflict",
    );
    assertEquals(await used(), 1);
    const changed = await activity.updateTask(deps, keyed(f.actor), created.id, {
      expected_version: 1,
      title: "committed",
    });
    assertEquals(changed.version, 2);
    assertEquals(await used(), 2);
    assertEquals(await effects(f.actor.userId), { tasks: 1, changes: 2, jobs: 2, receipts: 2 });
  } finally {
    await f.cleanup();
  }
});
