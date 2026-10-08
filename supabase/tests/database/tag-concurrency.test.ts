import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { tagCreate } from "../../functions/_shared/contracts/tag.ts";
import { entityCreate, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { recordCreate, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import * as t from "../../functions/_shared/core/tags/application.ts";
import * as e from "../../functions/_shared/core/entity/application.ts";
import * as a from "../../functions/_shared/core/activity/application.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 3 });
const td = { uow: new SqlTagUnitOfWork(sql) },
  ed = { uow: new SqlEntityUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

for (
  const [kind, scenario] of (["entity", "task", "record"] as const).flatMap((kind) =>
    (["remove links", "edit content", "delete parent"] as const).map((scenario) => [kind, scenario] as const)
  )
) {
  dbTest(
    `Read Committed ${kind} ${scenario}: waiting tag deletion changes only existing links once`,
    async () => {
      const f = await fixtureOwner(admin);
      const ready = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
      let editing: Promise<unknown> | undefined, deleting: Promise<unknown> | undefined;
      try {
        const scope = kind;
        const first = await t.createTag(
          td,
          f.actor,
          tagCreate.parse({ id: crypto.randomUUID(), ...{ name: "removed", scope } }),
        );
        const other = await t.createTag(
          td,
          f.actor,
          tagCreate.parse({ id: crypto.randomUUID(), ...{ name: "also removed", scope } }),
        );
        const tag_ids = [first.id, other.id];
        const parent = kind === "entity"
          ? await e.createEntity(
            ed,
            f.actor,
            entityCreate.parse({ source: "app", external_id: crypto.randomUUID(), ...{ prop1: "parent", tag_ids } }),
          )
          : kind === "task"
          ? await a.createTask(
            ad,
            f.actor,
            taskCreate.parse({
              id: crypto.randomUUID(),
              ...{ kind: "once", title: "parent", tag_ids },
            }),
          )
          : await a.createRecord(
            ad,
            f.actor,
            recordCreate.parse({ id: crypto.randomUUID(), ...{ body: "parent", tag_ids } }),
          );
        // Hold the real application transaction after its edit, before commit.
        const heldE: e.EntityDeps = {
          uow: {
            run: (actor, fn) =>
              ed.uow.run(actor, async (s) => {
                const result = await fn(s);
                ready.resolve();
                await release.promise;
                return result;
              }),
          },
        };
        const heldA: a.ActivityDeps = {
          ...ad,
          uow: {
            run: (actor, fn) =>
              ad.uow.run(actor, async (s) => {
                const result = await fn(s);
                ready.resolve();
                await release.promise;
                return result;
              }),
          },
        };
        const patch = {
          expected_version: parent.version,
          ...(kind === "record" ? {} : { change_note: scenario === "edit content" ? "edit content" : "remove both" }),
          ...(scenario === "edit content"
            ? (kind === "entity"
              ? { prop1: "edited parent" }
              : kind === "record"
              ? { body: "edited parent" }
              : { title: "edited parent" })
            : { tag_ids: [] }),
        };
        editing = scenario === "delete parent"
          ? kind === "entity"
            ? e.deleteEntity(heldE, f.actor, parent.id, parent.version)
            : kind === "task"
            ? a.deleteTask(heldA, f.actor, parent.id, parent.version)
            : a.deleteRecord(heldA, f.actor, parent.id, parent.version)
          : kind === "entity"
          ? e.updateEntity(heldE, f.actor, parent.id, entityUpdate.parse(patch))
          : kind === "task"
          ? a.updateTask(heldA, f.actor, parent.id, taskUpdate.parse(patch))
          : a.updateRecord(heldA, f.actor, parent.id, recordUpdate.parse(patch));
        await Promise.race([
          ready.promise,
          editing.then(() => {
            throw Error("edit did not reach barrier");
          }),
        ]);
        deleting = t.deleteTag(td, f.actor, first.id, first.version, "delete dictionary entry");
        // Verify PostgreSQL is actually waiting on the parent lock before committing the edit.
        let waited = false;
        for (let n = 0; n < 100; n++) {
          const rows = await admin`select query from pg_stat_activity where wait_event_type='Lock'
          and query like ${`%from app.${kind === "entity" ? "entities" : `${kind}s`}%`}`;
          if (rows.length) {
            waited = true;
            break;
          }
          await new Promise((r) => setTimeout(r, 50));
        }
        release.resolve();
        await Promise.all([editing, deleting]);
        assert(waited, "observed real SELECT waiting on parent row lock");
        await assertRejects(() => t.deleteTag(td, f.actor, first.id, first.version, "delete dictionary entry"));
        const events = await admin`select body,change_metadata from app.records where owner_id=${f.actor.userId}
        and change_metadata->>'target_id'=${parent.id} and change_metadata->>'action'='update' order by occurred_at`;
        if (scenario === "delete parent") {
          if (kind === "entity") {
            const retained = await e.getEntity(ed, f.actor, parent.id);
            assert(retained.deleted_at);
            assertEquals(retained.tag_ids, [other.id]);
            assertEquals(retained.version, parent.version + 2);
            assertEquals(events.length, 1);
            return;
          }
          assertEquals(
            (await admin`select id from ${admin(`app.${kind}s`)} where id=${parent.id}`).length,
            0,
          );
          assertEquals(events.length, 0);
          return;
        }
        const final = kind === "entity"
          ? await e.getEntity(ed, f.actor, parent.id)
          : kind === "task"
          ? await a.getTask(ad, f.actor, parent.id)
          : await a.getRecord(ad, f.actor, parent.id);
        if (scenario === "edit content") {
          assertEquals(final.tag_ids, [other.id]);
          assertEquals(final.version, parent.version + 2);
          assertEquals(
            kind === "entity"
              ? (final as { prop1: string }).prop1
              : kind === "record"
              ? (final as { body: string }).body
              : (final as { title: string }).title,
            "edited parent",
          );
          assertEquals(events.length, kind === "record" ? 0 : 2);
          if (kind !== "record") {
            const unlink = events.find((r) => r.body === "delete dictionary entry")!;
            assertEquals([unlink.change_metadata.before, unlink.change_metadata.after], [null, null]);
            assertEquals(unlink.change_metadata.target_title, "edited parent");
          }
        } else {
          assertEquals(final.tag_ids, []);
          assertEquals(final.version, parent.version + 1);
          assertEquals(events.length, kind === "record" ? 0 : 1);
          if (kind !== "record") {
            assertEquals(events[0].body, "remove both");
            assertEquals([events[0].change_metadata.before, events[0].change_metadata.after], [null, null]);
          }
        }
      } finally {
        release.resolve();
        await Promise.allSettled([editing, deleting]);
        await f.cleanup();
      }
    },
  );
}
