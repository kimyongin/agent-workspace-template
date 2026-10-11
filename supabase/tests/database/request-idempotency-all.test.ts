import { assertEquals, assertRejects } from "@std/assert";
import type { Actor } from "../../functions/_shared/core/shared/actor.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlPrincipleUnitOfWork } from "../../functions/_shared/adapters/supabase/principle-store.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { SqlBusinessSettingsUnitOfWork } from "../../functions/_shared/adapters/supabase/business-settings-store.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import * as principle from "../../functions/_shared/core/principles/application.ts";
import * as tag from "../../functions/_shared/core/tags/application.ts";
import * as settings from "../../functions/_shared/core/settings/application.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { principleCreate } from "../../functions/_shared/contracts/principle.ts";
import { recordCreate } from "../../functions/_shared/contracts/record.ts";
import { tagCreate } from "../../functions/_shared/contracts/tag.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.pooler, { max: 6, prepare: false });
const clock = { now: () => new Date("2026-10-11T12:00:00Z") };
const ad = { uow: new SqlUnitOfWork(sql), clock };
const ed = { uow: new SqlEntityUnitOfWork(sql) };
const pd = { uow: new SqlPrincipleUnitOfWork(sql) };
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

dbTest("tag and current principle writes replay without reapplying changed or deleted objects", async () => {
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
    const created = await replay(
      f.actor,
      (a) => principle.createPrinciple(pd, a, principleCreate.parse({ title: "rule", body: "first" })),
    );
    const updated = await replay(
      f.actor,
      (a) => principle.updatePrinciple(pd, a, created.id, { expected_version: 1, body: "second" }),
    );
    await replay(f.actor, (a) => principle.deletePrinciple(pd, a, created.id, updated.version));
    assertEquals((await principle.currentPrinciple(pd, f.actor)).current, null);
  } finally {
    await f.cleanup();
  }
});

dbTest(
  "entity preparation reserves nothing; first write validates settings while replay survives settings, rekey and restore",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const prepared = await entity.prepareEntityRegistration(ed, f.actor, {});
      assertEquals(prepared.external_id, undefined);
      assertEquals(prepared.id, undefined);
      const input = entityCreate.parse({
        source: prepared.source,
        settings_version: prepared.settings_version,
        prop1: "auto",
      });
      const createAttempt = keyed(f.actor);
      const auto = await entity.createEntity(ed, createAttempt, input);
      const identity = {
        generation: "manual" as const,
        default_source: "app",
        sources: [{ code: "app", label: "앱", generation: "manual" as const }],
      };
      const settingInput = { id: "entity_identity", expected_version: 0, value: identity };
      const saved = await replay(f.actor, (a) => settings.updateBusinessSettings(sd, a, settingInput));
      assertEquals(saved.versions.entity_identity, 1);
      assertEquals(await entity.createEntity(ed, createAttempt, input), auto);
      await code(() => entity.createEntity(ed, keyed(f.actor), input), "settings_changed");
      await code(
        () => entity.createEntity(ed, keyed(f.actor), entityCreate.parse({ prop1: "no explicit identity" })),
        "invalid_input",
      );
      const explicitInput = entityCreate.parse({ source: "app", external_id: "000AbC", prop1: "external" });
      const explicitAttempt = keyed(f.actor);
      const explicit = await entity.createEntity(ed, explicitAttempt, explicitInput);
      assertEquals(explicit.id, "app:000AbC");
      const updated = await replay(
        f.actor,
        (a) => entity.updateEntity(ed, a, explicit.id, { expected_version: 1, prop1: "updated" }),
      );
      const rekeyed = await replay(
        f.actor,
        (a) =>
          entity.rekeyEntity(ed, a, explicit.id, {
            expected_version: updated.version,
            source: "app",
            external_id: "000XYZ",
          }),
      );
      assertEquals(await entity.createEntity(ed, explicitAttempt, explicitInput), explicit);
      await code(() => entity.getEntity(ed, f.actor, explicit.id), "not_found");
      await replay(f.actor, (a) => entity.deleteEntity(ed, a, rekeyed.id, rekeyed.version));
      const deleted = await entity.getEntity(ed, f.actor, rekeyed.id);
      const restoreInput = entityCreate.parse({
        source: "app",
        external_id: "000XYZ",
        expected_version: deleted.version,
      });
      const restored = await replay(f.actor, (a) => entity.createEntity(ed, a, restoreInput));
      assertEquals(restored.prop1, "updated");
      const nextSettings = {
        ...settingInput,
        expected_version: 1,
        value: { ...identity, sources: [{ code: "app", label: "renamed", generation: "manual" }] },
      };
      await settings.updateBusinessSettings(sd, keyed(f.actor), nextSettings);
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
