import { assertEquals, assertRejects } from "@std/assert";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate, taskListQuery, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { taskChangePreview } from "../../functions/_shared/contracts/task-change.ts";
import { recordListQuery } from "../../functions/_shared/contracts/record.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 2, prepare: false });
const ed = { uow: new SqlEntityUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest("task preview uses live owner selections without changing tasks or recording preview events", async () => {
  const f = await fixtureOwner(admin), other = await fixtureOwner(admin);
  try {
    const own = await entity.createEntity(
      ed,
      f.actor,
      entityCreate.parse({ id: crypto.randomUUID(), ...{ prop1: "현재 대상" } }),
    );
    const foreign = await entity.createEntity(
      ed,
      other.actor,
      entityCreate.parse({ id: crypto.randomUUID(), ...{ prop1: "타인 대상" } }),
    );
    const deleted = await entity.createEntity(
      ed,
      f.actor,
      entityCreate.parse({ id: crypto.randomUUID(), ...{ prop1: "삭제 대상" } }),
    );
    await entity.deleteEntity(ed, f.actor, deleted.id, deleted.version);
    const task = await activity.createTask(
      ad,
      f.actor,
      taskCreate.parse({ id: crypto.randomUUID(), ...{ kind: "once", title: "검증 업무", summary: "현재 값" } }),
    );
    const before = await activity.getTask(ad, f.actor, task.id);
    const records = await activity.listRecords(ad, f.actor, recordListQuery.parse({ limit: 100 }));
    for (const target of [foreign.id, deleted.id, crypto.randomUUID()]) {
      const create = taskCreate.parse({
        id: crypto.randomUUID(),
        ...{
          kind: "once",
          title: "거부 업무",
          summary: "대상 검증",
          entity_ids: [own.id, target],
        },
      });
      const patch = taskUpdate.parse({
        expected_version: task.version,
        title: "거부 수정",
        entity_ids: [own.id, target],
      });
      for (
        const input of [{ action: "create", input: (({ id: _id, ...content }) => content)(create) }, {
          action: "update",
          id: task.id,
          input: patch,
        }]
      ) {
        const error = await assertRejects(
          () => activity.previewTaskChange(ad, f.actor, taskChangePreview.parse(input)),
          AppError,
        );
        assertEquals(error.code, "invalid_reference");
      }
      const createError = await assertRejects(() => activity.createTask(ad, f.actor, create), AppError);
      const updateError = await assertRejects(() => activity.updateTask(ad, f.actor, task.id, patch), AppError);
      assertEquals([createError.code, updateError.code], ["invalid_reference", "invalid_reference"]);
    }
    for (const selection of [{}, { entity_ids: [] }, { entity_ids: [own.id] }]) {
      assertEquals(
        (await activity.previewTaskChange(
          ad,
          f.actor,
          taskChangePreview.parse({
            action: "update",
            id: task.id,
            input: { expected_version: task.version, title: "수정 미리보기", ...selection },
          }),
        )).changed,
        true,
      );
    }
    assertEquals(await activity.getTask(ad, f.actor, task.id), before);
    assertEquals((await activity.listTasks(ad, f.actor, taskListQuery.parse({}))).items.map((t) => t.id), [task.id]);
    assertEquals(await activity.listRecords(ad, f.actor, recordListQuery.parse({ limit: 100 })), records);
  } finally {
    await f.cleanup();
    await other.cleanup();
  }
});
