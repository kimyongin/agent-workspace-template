import * as registry from "../../functions/_shared/core/entity-issuers/application.ts";
import { SqlEntityIssuerUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import { assertEquals, assertRejects } from "@std/assert";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { SqlBusinessSettingsUnitOfWork } from "../../functions/_shared/adapters/supabase/business-settings-store.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import * as tag from "../../functions/_shared/core/tags/application.ts";
import * as settings from "../../functions/_shared/core/settings/application.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { directEntitySource, entityFixture } from "./_entity.ts";
import { recordCreate } from "../../functions/_shared/contracts/record.ts";
import { tagCreate } from "../../functions/_shared/contracts/tag.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.pooler, { max: 6, prepare: false });
const clock = { now: () => new Date("2026-10-11T12:00:00Z") };
const ad = { uow: new SqlUnitOfWork(sql), clock };
const ed = { uow: new SqlEntityUnitOfWork(sql) };
const td = { uow: new SqlTagUnitOfWork(sql) };
const sd = { uow: new SqlBusinessSettingsUnitOfWork(sql), clock };
const keyed = (actor: Actor): Actor => ({ ...actor, request: { key: crypto.randomUUID() } });
async function replay<T>(actor: Actor, write: (a: Actor) => Promise<T>): Promise<T> {
  const attempt = keyed(actor);
  const results = await Promise.all([write(attempt), write({ ...attempt, request: { key: attempt.request!.key } })]);
  assertEquals(results[1], results[0]);
  assertEquals(await write(attempt), results[0]);
  return results[0];
}
async function code(write: () => Promise<unknown>, expected: string) {
  assertEquals((await assertRejects(write, AppError)).code, expected);
}

dbTest("completion, recurring transitions, occurrence and record mutations replay their original result", async () => {
  const f = await fixtureOwner(admin);
  try {
    const once = await activity.createTask(ad, keyed(f.actor), taskCreate.parse({ kind: "once", title: "complete" }));
    const done = await replay(
      f.actor,
      (a) => activity.completeTask(ad, a, once.id, { expected_version: 1, body: "performed" }),
    );
    assertEquals((await activity.getTask(ad, f.actor, once.id)).version, 2);
    assertEquals(
      (await activity.listRecords(ad, f.actor, { task_id: once.id, record_kind: "result", limit: 100 })).items.length,
      1,
    );
    const task = await activity.createTask(
      ad,
      keyed(f.actor),
      taskCreate.parse({
        kind: "recurring",
        title: "repeat",
        timezone: "Asia/Seoul",
        recurrence: { freq: "daily", starts_on: "2026-10-01" },
      }),
    );
    const stopped = await replay(f.actor, (a) => activity.stopTask(ad, a, task.id, 1));
    await replay(f.actor, (a) => activity.resumeTask(ad, a, task.id, stopped.version));
    const occurrence = await replay(
      f.actor,
      (a) => activity.recordOccurrence(ad, a, task.id, "2026-10-10", { body: "once per intent" }),
    );
    assertEquals(
      (await activity.listRecords(ad, f.actor, { task_id: task.id, record_kind: "result", limit: 100 })).items.length,
      1,
    );
    const created = await replay(f.actor, (a) => activity.createRecord(ad, a, recordCreate.parse({ body: "memo" })));
    const updated = await replay(
      f.actor,
      (a) => activity.updateRecord(ad, a, created.id, { expected_version: 1, body: "edited" }),
    );
    await replay(f.actor, (a) => activity.deleteRecord(ad, a, created.id, updated.version));
    await code(() => activity.getRecord(ad, f.actor, created.id), "not_found");
    assertEquals((await activity.getRecord(ad, f.actor, done.record.id)).body, "performed");
    assertEquals((await activity.getRecord(ad, f.actor, occurrence.id)).body, "once per intent");
  } finally {
    await f.cleanup();
  }
});

dbTest("tag writes replay without reapplying changed or deleted objects", async () => {
  const f = await fixtureOwner(admin);
  try {
    const createdTag = await replay(
      f.actor,
      (a) => tag.createTag(td, a, tagCreate.parse({ name: "one", scope: "record" })),
    );
    const renamed = await replay(
      f.actor,
      (a) => tag.renameTag(td, a, createdTag.id, { name: "two", expected_version: 1 }),
    );
    await replay(f.actor, (a) => tag.deleteTag(td, a, createdTag.id, renamed.version));
    assertEquals((await tag.listTags(td, f.actor, { limit: 100, scope: "record" })).items, []);
  } finally {
    await f.cleanup();
  }
});

dbTest(
  "issuer settings lookup allocates nothing; first write validates type identity while replay survives configuration edits and restore",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const schema = await entityFixture(admin, f.actor.userId);
      const savedSettings = await registry.getEntityTypeIdentity(
        { uow: new SqlEntityIssuerUnitOfWork(sql) },
        f.actor,
        schema.entity_type_id,
      );
      const input = entityCreate.parse({
        ...schema,
        source: savedSettings.default_source,
        identity_version: savedSettings.version,
        properties: { prop_1: "auto" },
      });
      const createAttempt = keyed(f.actor);
      const auto = await entity.createEntity(ed, createAttempt, input);
      const setup = await directEntitySource(sql, f.actor, schema.entity_type_id);
      assertEquals(setup.identity.version, savedSettings.version + 1);
      assertEquals(await entity.createEntity(ed, createAttempt, input), auto);
      await code(() => entity.createEntity(ed, keyed(f.actor), input), "settings_changed");
      await code(
        () =>
          entity.createEntity(
            ed,
            keyed(f.actor),
            entityCreate.parse({ ...schema, properties: { prop_1: "no explicit identity" } }),
          ),
        "invalid_input",
      );
      const explicitInput = entityCreate.parse({
        ...schema,
        source: "app",
        external_id: "000AbC",
        properties: { prop_1: "external" },
      });
      const explicitAttempt = keyed(f.actor);
      const explicit = await entity.createEntity(ed, explicitAttempt, explicitInput);
      assertEquals(explicit.id, `app:${schema.entity_type_id}:000AbC`);
      const updated = await replay(
        f.actor,
        (a) =>
          entity.updateEntity(ed, a, explicit.id, {
            schema_version: schema.schema_version,
            expected_version: 1,
            properties: { prop_1: "updated" },
          }),
      );
      await code(
        () =>
          entity.updateEntity(ed, keyed(f.actor), explicit.id, {
            schema_version: schema.schema_version,
            expected_version: updated.version,
            ...{ source: "app", external_id: "000XYZ" },
          }),
        "entity_type_immutable",
      );
      assertEquals(await entity.createEntity(ed, explicitAttempt, explicitInput), explicit);
      await replay(f.actor, (a) => entity.deleteEntity(ed, a, updated.id, updated.version));
      const deleted = await entity.getEntity(ed, f.actor, updated.id);
      const restoreInput = entityCreate.parse({
        ...schema,
        properties: {},
        source: "app",
        external_id: "000AbC",
        expected_version: deleted.version,
      });
      const restored = await replay(f.actor, (a) => entity.createEntity(ed, a, restoreInput));
      assertEquals(restored.properties.prop_1, "updated");
      await registry.updateEntityIssuer(setup.deps, keyed(f.actor), "app", { expected_version: 1, label: "renamed" });
      assertEquals(await entity.createEntity(ed, explicitAttempt, explicitInput), explicit);
      const templates = { id: "record_templates", expected_version: 0, value: {} };
      const oldSettingsAttempt = keyed(f.actor);
      const oldSettings = await settings.updateBusinessSettings(sd, oldSettingsAttempt, templates);
      await settings.updateBusinessSettings(sd, keyed(f.actor), { ...templates, expected_version: 1 });
      assertEquals(await settings.updateBusinessSettings(sd, oldSettingsAttempt, templates), oldSettings);
    } finally {
      await f.cleanup();
    }
  },
);

import { createHttpApp } from "../../functions/_shared/adapters/http/app.ts";
import { entityTools } from "../../functions/_shared/adapters/mcp/entity-tools.ts";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";
import { tagTools } from "../../functions/_shared/adapters/mcp/tag-tools.ts";
import { settingsTools } from "../../functions/_shared/adapters/mcp/settings-tools.ts";
dbTest("HTTP and MCP share canonical creation and settings payloads and reject retired allocation", async () => {
  const f = await fixtureOwner(admin);
  try {
    const schema = await entityFixture(admin, f.actor.userId);
    const app = createHttpApp(
      ad,
      { basePath: "/api", allowedOrigins: [], token: {} as never },
      td,
      {} as never,
      () => Promise.resolve(f.actor),
      ed,
      sd,
    );
    const tools = [
      ...entityTools(ed),
      ...activityTools(ad),
      ...tagTools(td),
      ...settingsTools(sd),
    ];
    const cases = [
      { path: "/records", name: "create_record", input: { body: "cross transport" }, status: 201 },
      { path: "/tags", name: "create_tag", input: { name: "cross tag" }, status: 201 },
      {
        path: "/entities",
        name: "create_entity",
        input: { ...schema, source: "app", external_id: "000Case", properties: { prop_1: "cross entity" } },
        status: 201,
      },
      {
        path: "/settings/business",
        name: "update_business_settings",
        input: { id: "record_templates", expected_version: 0, value: {} },
        status: 200,
      },
    ];
    for (const example of cases) {
      const key = crypto.randomUUID(), method = example.status === 201 ? "POST" : "PATCH";
      const send = () =>
        app.request(`/api${example.path}`, {
          method,
          headers: { "content-type": "application/json", "Idempotency-Key": key },
          body: JSON.stringify(example.input),
        });
      const response = await send();
      assertEquals(response.status, example.status);
      const original = await response.json();
      const tool = tools.find((t) => t.name === example.name)!;
      assertEquals(await tool.handler({ ...example.input, request_key: key }, f.actor), original);
      const replayed = await send();
      assertEquals(replayed.status, example.status);
      assertEquals(replayed.headers.get("Idempotency-Replayed"), "true");
      assertEquals(await replayed.json(), original);
    }
    assertEquals(tools.some((t) => t.name === "allocate_data_id"), false);
    const removed = await app.request("/api/ids/allocate", { method: "POST" });
    assertEquals(removed.status, 404);
    await removed.body?.cancel();
    for (
      const [path, validInput] of [
        ["/records", { body: "old" }],
        ["/tags", { name: "old" }],
        ["/tasks", { kind: "once", title: "old" }],
      ] as const
    ) {
      const rejected = await app.request(`/api${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ ...validInput, id: "20261011-ABCDEFGH" }),
      });
      assertEquals(rejected.status, 400);
      await rejected.body?.cancel();
    }
  } finally {
    await f.cleanup();
  }
});

dbTest(
  "a request waiting on a task row does not block unrelated same-owner writes during request completion",
  async () => {
    const f = await fixtureOwner(admin);
    const locked = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
    let holder: Promise<unknown> | undefined,
      waiting: Promise<unknown> | undefined,
      unrelated: Promise<unknown> | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const task = await activity.createTask(
        ad,
        keyed(f.actor),
        taskCreate.parse({ kind: "once", title: "locked task" }),
      );
      holder = ad.uow.run(f.actor, async (store) => {
        await store.getTask(task.id, { forUpdate: true });
        locked.resolve();
        await release.promise;
      });
      await locked.promise;
      waiting = activity.updateTask(ad, keyed(f.actor), task.id, { expected_version: 1, title: "after row release" });
      void waiting.catch(() => {});
      let observed = false;
      for (let n = 0; n < 100; n++) {
        const rows =
          await admin`select 1 from pg_stat_activity where wait_event_type='Lock' and query like '%from app.tasks%'`;
        if (rows.length) {
          observed = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assertEquals(observed, true, "first request is waiting on its business row");
      unrelated = activity.createRecord(ad, keyed(f.actor), recordCreate.parse({ body: "independent record" }));
      void unrelated.catch(() => {});
      const result = await Promise.race([
        unrelated,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("unrelated write blocked before business execution")), 1500);
        }),
      ]);
      assertEquals((result as { body: string }).body, "independent record");
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      release.resolve();
      await Promise.allSettled([holder, waiting, unrelated].filter((p): p is Promise<unknown> => p !== undefined));
      await f.cleanup();
    }
  },
);

dbTest(
  "maximum modern completion bodies and 100 entity contexts commit and replay without duplicate effects",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const schema = await entityFixture(admin, f.actor.userId);
      const entityIds: string[] = [];
      for (let n = 0; n < 100; n++) {
        const created = await entity.createEntity(
          ed,
          keyed(f.actor),
          entityCreate.parse({
            ...schema,
            source: "app",
            external_id: `${n.toString().padStart(3, "0")}${"😀".repeat(197)}`,
            properties: { prop_1: "\u0001".repeat(100) },
          }),
        );
        entityIds.push(created.id);
      }
      // Each escaped control is six UTF-8 JSON bytes, larger than an emoji's four.
      const maximumBody = "\u0001".repeat(22_000);
      const task = await activity.createTask(
        ad,
        keyed(f.actor),
        taskCreate.parse({
          kind: "once",
          title: "\u0001".repeat(100),
          body: maximumBody,
          entity_ids: entityIds,
        }),
      );
      const attempt = keyed(f.actor),
        completion = { expected_version: 1, body: maximumBody };
      const done = await activity.completeTask(
        ad,
        attempt,
        task.id,
        completion,
      );
      assertEquals(done.task.body, maximumBody);
      assertEquals(done.record.body, maximumBody);
      assertEquals(done.task.entity_ids.length, 100);
      assertEquals(done.record.entity_context.length, 100);
      assertEquals(
        await activity.completeTask(ad, attempt, task.id, completion),
        done,
      );
      const [proof] = await admin`select
      (select count(*)::int from app.records where owner_id=${f.actor.userId} and task_id=${task.id} and record_kind='result') results,
      (select count(*)::int from pgmq.q_search_index where message->>'owner_id'=${f.actor.userId} and message->>'id'=${done.record.id}) jobs,
      (select count(*)::int from private.request_results where owner_id=${f.actor.userId} and request_key=${
        attempt.request!.key
      }::uuid) receipts`;
      assertEquals(proof, { results: 1, jobs: 1, receipts: 1 });
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "legacy results above 1 MiB roll back business, ledger, change and queue and the same key can retry",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const task = await activity.createTask(
        ad,
        keyed(f.actor),
        taskCreate.parse({
          kind: "recurring",
          title: "legacy history",
          timezone: "Asia/Seoul",
          recurrence: { freq: "daily", starts_on: "2026-10-01" },
        }),
      );
      const pauses: { stopped_on: string; resumed_on: string | null }[] = Array.from(
        { length: 25_000 },
        () => ({ stopped_on: "2026-10-01", resumed_on: "2026-10-02" }),
      );
      pauses.at(-1)!.resumed_on = null;
      await admin`update app.tasks set status='stopped',pauses=${
        admin.json(pauses)
      } where owner_id=${f.actor.userId} and id=${task.id}`;
      const before = await activity.getTask(ad, f.actor, task.id);
      assertEquals(new TextEncoder().encode(JSON.stringify(before)).byteLength > 1_048_576, true);
      const [counts] = await admin`select
      (select count(*)::int from app.records where owner_id=${f.actor.userId}) records,
      (select count(*)::int from pgmq.q_search_index where message->>'owner_id'=${f.actor.userId}) jobs,
      (select count(*)::int from private.request_results where owner_id=${f.actor.userId}) receipts`;
      const attempt = keyed(f.actor);
      await code(
        () => activity.resumeTask(ad, attempt, task.id, task.version),
        "invalid_input",
      );
      assertEquals(await activity.getTask(ad, f.actor, task.id), before);
      const [after] = await admin`select
      (select count(*)::int from app.records where owner_id=${f.actor.userId}) records,
      (select count(*)::int from pgmq.q_search_index where message->>'owner_id'=${f.actor.userId}) jobs,
      (select count(*)::int from private.request_results where owner_id=${f.actor.userId}) receipts`;
      assertEquals(after, counts);
      // Fixture repair only: production recovery must preserve the original historical data.
      await admin`update app.tasks set pauses=${
        admin.json([pauses.at(-1)!])
      } where owner_id=${f.actor.userId} and id=${task.id}`;
      const resumed = await activity.resumeTask(
        ad,
        attempt,
        task.id,
        task.version,
      );
      assertEquals(resumed.status, "active");
      assertEquals(
        await activity.resumeTask(ad, attempt, task.id, task.version),
        resumed,
      );
    } finally {
      await f.cleanup();
    }
  },
);
