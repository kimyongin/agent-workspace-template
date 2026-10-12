import { requestActor } from "../_request.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { tagCreate } from "../../functions/_shared/contracts/tag.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { recordCreate } from "../../functions/_shared/contracts/record.ts";
import * as t from "../../functions/_shared/core/tags/application.ts";
import * as e from "../../functions/_shared/core/entity/application.ts";
import * as a from "../../functions/_shared/core/activity/application.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { entityFixture } from "./_entity.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 3, prepare: false });
const td = { uow: new SqlTagUnitOfWork(sql) },
  ed = { uow: new SqlEntityUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
dbTest(
  "tag delete atomically records each changed parent once, preserves event facts, retries, and suppresses automatic-record recursion",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const schema = await entityFixture(admin, f.actor.userId);
      const actor = { ...f.actor, source: "mcp" as const };
      const tag = await t.createTag(
        td,
        requestActor(actor),
        tagCreate.parse({ ...{ scope: "record", name: "活動分類" } }),
      );
      const entityTag = await t.createTag(
        td,
        requestActor(actor),
        tagCreate.parse({ ...{ scope: "entity", name: "対象分類" } }),
      );
      const entity = await e.createEntity(
        ed,
        requestActor(actor),
        entityCreate.parse({
          ...schema,
          source: "app",
          external_id: crypto.randomUUID(),
          properties: { prop_1: "対象" },
          tag_ids: [entityTag.id],
        }),
      );
      const taskTag = await t.createTag(
        td,
        requestActor(actor),
        tagCreate.parse({ name: "計画分類", scope: "task" }),
      );
      const task = await a.createTask(
        ad,
        requestActor(actor),
        taskCreate.parse({
          ...{ kind: "once", title: "計画", tag_ids: [taskTag.id] },
        }),
      );
      const record = await a.createRecord(
        ad,
        requestActor(actor),
        recordCreate.parse({ ...{ body: "観察", tag_ids: [tag.id] } }),
      );
      const [automatic] =
        await admin`select id from app.records where owner_id=${actor.userId} and record_kind='change' order by id limit 1`;
      await admin`insert into app.record_tags(owner_id,record_id,tag_id) values(${actor.userId},${automatic.id},${tag.id})`;
      const count = async () =>
        (await admin`select count(*)::int n from app.records where owner_id=${actor.userId} and record_kind='change'`)[
          0
        ].n;
      assertEquals(await count(), 2);
      await t.deleteTag(td, requestActor(actor), taskTag.id, taskTag.version, undefined);
      await assertRejects(() => t.deleteTag(td, requestActor(actor), taskTag.id, taskTag.version, undefined));
      assertEquals(await count(), 3);
      assertEquals((await a.getTask(ad, actor, task.id)).tag_ids, []);
      assertEquals((await a.getRecord(ad, actor, record.id)).tag_ids, [tag.id]);
      await t.deleteTag(td, requestActor(actor), tag.id, tag.version);
      assertEquals(await count(), 3);
      assertEquals((await a.getRecord(ad, actor, automatic.id)).tag_ids, []);
      const changes =
        await admin`select change_metadata from app.records where owner_id=${actor.userId} and change_metadata->>'action'='update' order by id`;
      assertEquals(changes.length, 1);
      for (const change of changes) {
        assertEquals([change.change_metadata.before, change.change_metadata.after], [null, null]);
        assertEquals(change.change_metadata.source, "mcp");
      }
      await t.deleteTag(td, requestActor(actor), entityTag.id, entityTag.version, "対象分類の削除");
      assertEquals(await count(), 4);
      assertEquals((await e.getEntity(ed, actor, entity.id)).tag_ids, []);
      const [entityChange] =
        await admin`select change_metadata,body from app.records where owner_id=${actor.userId} and change_metadata->>'target_id'=${entity.id} and change_metadata->>'action'='update'`;
      assertEquals([entityChange.change_metadata.before, entityChange.change_metadata.after], [null, null]);
      assertEquals(entityChange.change_metadata.target_title, "対象");
      assertEquals(entityChange.body, "対象分類の削除");
    } finally {
      await f.cleanup();
    }
  },
);
dbTest(
  "tag unlink required-history failure rolls back all parent versions/links/tag/queue/request, then same-key retry once",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const actor = f.actor,
        tag = await t.createTag(td, requestActor(actor), tagCreate.parse({ ...{ name: "分類" } }));
      const taskTag = await t.createTag(
        td,
        requestActor(actor),
        tagCreate.parse({ name: "計画分類", scope: "task" }),
      );
      const task = await a.createTask(
        ad,
        requestActor(actor),
        taskCreate.parse({
          ...{ kind: "once", title: "計画", tag_ids: [taskTag.id] },
        }),
      );
      const record = await a.createRecord(
        ad,
        requestActor(actor),
        recordCreate.parse({ ...{ body: "観察", tag_ids: [tag.id] } }),
      );
      const beforeTask = await a.getTask(ad, actor, task.id), beforeRecord = await a.getRecord(ad, actor, record.id);
      const queue =
        await admin`select message from pgmq.q_search_index where message->>'owner_id'=${actor.userId} order by msg_id`;
      let n = 0;
      const bad: t.TagDeps = {
        uow: {
          run: (actor, fn) =>
            td.uow.run(
              actor,
              (s) =>
                fn(
                  new Proxy(s, {
                    get: (target, key) =>
                      key === "appendChange"
                        ? async (input: Parameters<typeof s.appendChange>[0]) => {
                          if (++n === 1) throw Error("required business history failed");
                          return await s.appendChange(input);
                        }
                        : Reflect.get(target, key),
                  }),
                ),
            ),
        },
      };
      await assertRejects(() => t.deleteTag(bad, requestActor(actor), taskTag.id, taskTag.version, undefined));
      assertEquals(await a.getTask(ad, actor, task.id), beforeTask);
      assertEquals(await a.getRecord(ad, actor, record.id), beforeRecord);
      assertEquals((await admin`select id from app.tags where id=${tag.id}`).length, 1);
      assertEquals(
        await admin`select message from pgmq.q_search_index where message->>'owner_id'=${actor.userId} order by msg_id`,
        queue,
      );
      await t.deleteTag(td, requestActor(actor), taskTag.id, taskTag.version, undefined);
      await assertRejects(() => t.deleteTag(td, requestActor(actor), taskTag.id, taskTag.version, undefined));
      assertEquals((await admin`select count(*)::int n from app.records where owner_id=${actor.userId}`)[0].n, 3);
    } finally {
      await f.cleanup();
    }
  },
);
