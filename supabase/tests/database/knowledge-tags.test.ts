import { assertEquals, assertMatch, assertRejects, assertThrows } from "@std/assert";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { tagCreate, tagListQuery } from "../../functions/_shared/contracts/tag.ts";
import { entityCreate, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { recordCreate, recordListQuery, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import * as tags from "../../functions/_shared/core/tags/application.ts";
import * as e from "../../functions/_shared/core/entity/application.ts";
import * as a from "../../functions/_shared/core/activity/application.ts";
import { asUser, connect, dbTest, fixtureOwner, outcome, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 3, prepare: false }),
  td = { uow: new SqlTagUnitOfWork(sql) },
  ed = { uow: new SqlEntityUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
dbTest(
  "tag dictionaries: same name per scope, cross-scope/owner linking rejected, cursor scope, detach keeps original context",
  async () => {
    const f = await fixtureOwner(admin), b = await fixtureOwner(admin);
    try {
      const A = f.actor,
        entityTag = await tags.createTag(
          td,
          A,
          tagCreate.parse({ id: crypto.randomUUID(), ...{ scope: "entity", name: "분류" } }),
        ),
        activityTag = await tags.createTag(
          td,
          A,
          tagCreate.parse({ id: crypto.randomUUID(), ...{ scope: "record", name: "분류" } }),
        );
      const taskTag = await tags.createTag(
        td,
        A,
        tagCreate.parse({ id: crypto.randomUUID(), scope: "task", name: "분류" }),
      );
      for (const tag of [entityTag, activityTag]) {
        await assertRejects(() =>
          a.createTask(
            ad,
            A,
            taskCreate.parse({ id: crypto.randomUUID(), kind: "once", title: "scope 거부", tag_ids: [tag.id] }),
          )
        );
      }
      await assertRejects(() =>
        a.createRecord(
          ad,
          A,
          recordCreate.parse({ id: crypto.randomUUID(), body: "task scope 거부", tag_ids: [taskTag.id] }),
        )
      );
      const task = await a.createTask(
        ad,
        A,
        taskCreate.parse({ id: crypto.randomUUID(), kind: "once", title: "독립 분류", tag_ids: [taskTag.id] }),
      );
      assertMatch(
        await outcome(
          asUser(
            sql,
            A.userId,
            (tx) =>
              tx`insert into app.task_tags(owner_id,task_id,tag_id) values(${A.userId},${task.id},${activityTag.id})`,
          ),
        ),
        /^23503/,
      );
      assertThrows(() => tagListQuery.parse({ scope: "activity" }));
      await assertRejects(() =>
        tags.createTag(td, A, tagCreate.parse({ id: crypto.randomUUID(), ...{ scope: "entity", name: "분류" } }))
      );
      const foreign = await tags.createTag(
        td,
        b.actor,
        tagCreate.parse({ id: crypto.randomUUID(), ...{ scope: "entity", name: "외부" } }),
      );
      for (const tag of [activityTag.id, foreign.id, crypto.randomUUID()]) {
        await assertRejects(() =>
          e.createEntity(
            ed,
            A,
            entityCreate.parse({
              source: "app",
              external_id: crypto.randomUUID(),
              ...{ prop1: "거부", tag_ids: [tag] },
            }),
          )
        );
      }
      for (
        const create of [
          () =>
            a.createTask(
              ad,
              A,
              taskCreate.parse({
                id: crypto.randomUUID(),
                ...{ kind: "once", title: "거부", tag_ids: [entityTag.id] },
              }),
            ),
          () =>
            a.createRecord(
              ad,
              A,
              recordCreate.parse({
                id: crypto.randomUUID(),
                ...{ body: "거부", tag_ids: [entityTag.id] },
              }),
            ),
        ]
      ) await assertRejects(create);
      const entity = await e.createEntity(
        ed,
        A,
        entityCreate.parse({
          source: "app",
          external_id: crypto.randomUUID(),
          ...{ prop1: "대상", tag_ids: [entityTag.id] },
        }),
      );
      assertMatch(
        await outcome(
          asUser(
            sql,
            A.userId,
            (tx) =>
              tx`insert into app.entity_tags(owner_id,entity_id,tag_id) values(${A.userId},${entity.id},${activityTag.id})`,
          ),
        ),
        /^23503/,
      );
      const record = await a.createRecord(
        ad,
        A,
        recordCreate.parse({
          id: crypto.randomUUID(),
          ...{ body: "보존", tag_ids: [activityTag.id] },
        }),
      );
      assertMatch(
        await outcome(
          asUser(
            sql,
            A.userId,
            (tx) =>
              tx`insert into app.record_tags(owner_id,record_id,tag_id) values(${A.userId},${record.id},${taskTag.id})`,
          ),
        ),
        /^23503/,
      );
      await tags.renameTag(td, A, taskTag.id, { name: "할 일만 정정", expected_version: taskTag.version });
      assertEquals((await tags.listTags(td, A, tagListQuery.parse({ scope: "record" }))).items.map((tag) => tag.name), [
        "분류",
      ]);
      assertEquals(
        (await a.listRecords(ad, A, recordListQuery.parse({ tag_id: activityTag.id }))).items.map((r) => r.id),
        [record.id],
      );
      await a.updateRecord(
        ad,
        A,
        record.id,
        recordUpdate.parse({ expected_version: record.version, tag_ids: [] }),
      );
      await e.updateEntity(
        ed,
        A,
        entity.id,
        entityUpdate.parse({ expected_version: entity.version, change_note: "속성 갱신", prop2: 20 }),
      );
      await tags.createTag(td, A, tagCreate.parse({ id: crypto.randomUUID(), ...{ scope: "entity", name: "둘째" } }));
      const page = await tags.listTags(td, A, tagListQuery.parse({ scope: "entity", limit: 1 }));
      await assertRejects(() =>
        tags.listTags(td, A, tagListQuery.parse({ scope: "record", cursor: page.next_cursor! }))
      );
      await tags.deleteTag(td, A, entityTag.id, entityTag.version);
      assertEquals((await e.getEntity(ed, A, entity.id)).tag_ids, []);
      assertEquals((await e.getEntity(ed, A, entity.id)).version, entity.version + 2);
      const changes = await a.listRecords(ad, A, recordListQuery.parse({ record_kind: "change" }));
      const entityChange = changes.items.find((r) =>
        r.change?.target_id === entity.id && r.change.action === "update"
      )!;
      assertEquals([entityChange.change!.before, entityChange.change!.after], [null, null]);
      assertEquals(entityChange.change!.target_id, entity.id);
    } finally {
      await f.cleanup();
      await b.cleanup();
    }
  },
);
