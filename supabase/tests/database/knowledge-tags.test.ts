import { assertEquals, assertMatch, assertRejects } from "@std/assert";
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
        entityTag = await tags.createTag(td, A, tagCreate.parse({ scope: "entity", name: "분류" })),
        activityTag = await tags.createTag(td, A, tagCreate.parse({ scope: "activity", name: "분류" }));
      await assertRejects(() => tags.createTag(td, A, tagCreate.parse({ scope: "entity", name: "분류" })));
      const foreign = await tags.createTag(td, b.actor, tagCreate.parse({ scope: "entity", name: "외부" }));
      for (const tag of [activityTag.id, foreign.id, crypto.randomUUID()]) {
        await assertRejects(() => e.createEntity(ed, A, entityCreate.parse({ prop1: "거부", tag_ids: [tag] })));
      }
      for (
        const create of [
          () =>
            a.createTask(
              ad,
              A,
              taskCreate.parse({ kind: "once", title: "거부", summary: "요약", tag_ids: [entityTag.id] }),
            ),
          () => a.createRecord(ad, A, recordCreate.parse({ title: "거부", summary: "요약", tag_ids: [entityTag.id] })),
        ]
      ) await assertRejects(create);
      const entity = await e.createEntity(ed, A, entityCreate.parse({ prop1: "대상", tag_ids: [entityTag.id] }));
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
        recordCreate.parse({ title: "활동", summary: "요약", body: "보존", tag_ids: [activityTag.id] }),
      );
      assertEquals(
        (await a.listRecords(ad, A, recordListQuery.parse({ tag_id: activityTag.id }))).items.map((r) => r.id),
        [record.id],
      );
      await a.updateRecord(
        ad,
        A,
        record.id,
        recordUpdate.parse({ expected_version: record.version, change_note: "분류 제거", tag_ids: [] }),
      );
      await e.updateEntity(
        ed,
        A,
        entity.id,
        entityUpdate.parse({ expected_version: entity.version, change_note: "속성 갱신", prop2: 20 }),
      );
      await tags.createTag(td, A, tagCreate.parse({ scope: "entity", name: "둘째" }));
      const page = await tags.listTags(td, A, tagListQuery.parse({ scope: "entity", limit: 1 }));
      await assertRejects(() =>
        tags.listTags(td, A, tagListQuery.parse({ scope: "activity", cursor: page.next_cursor! }))
      );
      await tags.deleteTag(td, A, entityTag.id, entityTag.version);
      assertEquals((await e.getEntity(ed, A, entity.id)).tag_ids, []);
      assertEquals((await e.getEntity(ed, A, entity.id)).version, entity.version + 2);
      const changes = await a.listRecords(ad, A, recordListQuery.parse({ record_kind: "change" }));
      const entityChange = changes.items.find((r) =>
        r.change?.target_id === entity.id && r.change.action === "update"
      )!;
      assertEquals((entityChange.change!.before!.tags as { name: string }[])[0].name, "분류");
    } finally {
      await f.cleanup();
      await b.cleanup();
    }
  },
);
