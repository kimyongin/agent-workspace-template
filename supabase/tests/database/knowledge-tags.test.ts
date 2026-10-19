import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { tagListQuery } from "../../functions/_shared/contracts/tag.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { recordListQuery, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import * as tags from "../../functions/_shared/core/tags/application.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 1, prepare: false });
const td = { uow: new SqlTagUnitOfWork(sql) },
  ed = { uow: new SqlEntityUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest(
  "workspace tag dictionaries enforce scope and workspace on independently saved parents",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      const kind = await f.createKind("분류 원본");
      await f.grant(f.member, [{
        target_kind: "tasks",
        target_id: "*",
        access: "write",
      }, { target_kind: "entity_type", target_id: kind.id, access: "write" }]);
      const actor = f.member;
      const entityTag = await tags.createTag(td, businessRequest(actor), {
        scope: "entity",
        name: "분류",
      });
      const taskTag = await tags.createTag(td, businessRequest(actor), {
        scope: "task",
        name: "분류",
      });
      const resultTag = await tags.createTag(td, businessRequest(actor), {
        scope: "record",
        name: "분류",
      });
      assertThrows(() => tagListQuery.parse({ scope: "activity" }));
      assertThrows(() => taskCreate.parse({ kind: "once", title: "초기 태그 거절", tag_ids: [] }));
      assertThrows(() => recordUpdate.parse({ expected_version: 1, tag_ids: [] }));
      assertEquals(
        (await assertRejects(() =>
          tags.createTag(td, businessRequest(actor), {
            scope: "entity",
            name: "분류",
          }), AppError)).code,
        "conflict",
      );
      const entity = await entities.createEntity(
        ed,
        businessRequest(actor),
        entityCreate.parse({
          entity_type_id: kind.id,
          schema_version: 1,
          properties: { prop_1: "분류 자료" },
        }),
      );
      const task = await activity.createTask(
        ad,
        businessRequest(actor),
        taskCreate.parse({
          kind: "once",
          title: "저장된 분류 계획",
          entity_ids: [entity.id],
        }),
      );
      const taskLinked = await tags.setTagConnections(
        td,
        businessRequest(actor),
        {
          target_kind: "task",
          target_id: task.id,
          expected_version: task.version,
          tag_ids: [taskTag.id],
        },
      );
      const completed = await activity.completeTask(
        ad,
        businessRequest(actor),
        task.id,
        { expected_version: taskLinked.version, body: "독립 분류 결과" },
      );
      assertEquals(completed.record.tag_ids, []);
      const recordLinked = await tags.setTagConnections(
        td,
        businessRequest(actor),
        {
          target_kind: "record",
          target_id: completed.record.id,
          expected_version: completed.record.version,
          tag_ids: [resultTag.id],
        },
      );
      await tags.setTagConnections(td, businessRequest(actor), {
        target_kind: "entity",
        target_id: entity.id,
        expected_version: entity.version,
        tag_ids: [entityTag.id],
      });
      const other = await f.addWorkspace("다른 분류 공간");
      const foreignTag = await tags.createTag(
        td,
        businessRequest(other.member),
        { scope: "task", name: "외부 분류" },
      );
      for (const tagId of [entityTag.id, resultTag.id, foreignTag.id]) {
        assertEquals(
          (await assertRejects(
            () =>
              tags.setTagConnections(td, businessRequest(actor), {
                target_kind: "task",
                target_id: task.id,
                expected_version: completed.task.version,
                tag_ids: [tagId],
              }),
            AppError,
          )).code,
          "invalid_reference",
        );
      }
      await tags.renameTag(td, businessRequest(actor), taskTag.id, {
        name: "할 일만 정정",
        expected_version: taskTag.version,
      });
      assertEquals(
        (await tags.listTags(
          td,
          actor,
          tagListQuery.parse({ scope: "record" }),
        )).items.map((tag) => tag.name),
        ["분류"],
      );
      assertEquals(
        (await activity.listRecords(
          ad,
          actor,
          recordListQuery.parse({ tag_id: resultTag.id }),
        )).items.map((record) => record.id),
        [completed.record.id],
      );
      const corrected = await activity.updateRecord(
        ad,
        businessRequest(actor),
        completed.record.id,
        {
          expected_version: recordLinked.version,
          body: "분류를 보존한 원문 정정",
        },
      );
      assertEquals(corrected.tag_ids, [resultTag.id]);
      await tags.setTagConnections(td, businessRequest(actor), {
        target_kind: "record",
        target_id: corrected.id,
        expected_version: corrected.version,
        tag_ids: [],
      });
      assertEquals(
        (await activity.getRecord(ad, actor, corrected.id)).body,
        corrected.body,
      );
      await tags.createTag(td, businessRequest(actor), {
        scope: "entity",
        name: "둘째",
      });
      const page = await tags.listTags(
        td,
        actor,
        tagListQuery.parse({ scope: "entity", limit: 1 }),
      );
      assertEquals(typeof page.next_cursor, "string");
      await assertRejects(
        () =>
          tags.listTags(
            td,
            actor,
            tagListQuery.parse({ scope: "record", cursor: page.next_cursor! }),
          ),
        AppError,
      );
      await tags.deleteTag(
        td,
        businessRequest(actor),
        entityTag.id,
        entityTag.version,
      );
      const current = await entities.getEntity(ed, actor, entity.id);
      assertEquals(current.tag_ids, []);
      assertEquals(current.version, entity.version + 2);
      const changes = await activity.listRecords(
        ad,
        actor,
        recordListQuery.parse({ entity_id: entity.id, record_kind: "change" }),
      );
      const changed = changes.items.find((record) => record.change?.action === "update")!;
      assertEquals([changed.change!.before, changed.change!.after], [
        null,
        null,
      ]);
      assertEquals(changed.entity_id, entity.id);
      assertEquals(changed.task_id, null);
    } finally {
      await f.cleanup();
    }
  },
);
