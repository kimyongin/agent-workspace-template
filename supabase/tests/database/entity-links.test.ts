import { recordCreate, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate, taskListQuery } from "../../functions/_shared/contracts/task.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 3, prepare: false });
const ed = { uow: new SqlEntityUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest(
  "selected task targets are returned by both related lists and entity filters; no targets remain optional",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const first = await entity.createEntity(ed, f.actor, entityCreate.parse({ prop1: "공동 대상 1" }));
      const second = await entity.createEntity(ed, f.actor, entityCreate.parse({ prop1: "공동 대상 2" }));
      const ids = [first.id, second.id].sort();
      const task = await activity.createTask(
        ad,
        f.actor,
        taskCreate.parse({ kind: "once", title: "공동 업무", summary: "두 대상", entity_ids: ids }),
      );
      const unlinked = await activity.createTask(
        ad,
        f.actor,
        taskCreate.parse({ kind: "once", title: "개인 업무", summary: "대상 없음" }),
      );
      assertEquals((await activity.getTask(ad, f.actor, task.id)).entity_ids, ids);
      assertEquals(unlinked.entity_ids, []);
      for (const id of ids) {
        assertEquals(
          (await activity.listTasks(ad, f.actor, taskListQuery.parse({ entity_id: id }))).items.map((row) => row.id),
          [task.id],
        );
        assertEquals((await entity.getEntity(ed, f.actor, id)).tasks.items.map((row) => row.id), [task.id]);
      }
      await assertRejects(() =>
        activity.createTask(
          ad,
          f.actor,
          taskCreate.parse({ kind: "once", title: "없는 대상", summary: "거부", entity_ids: [crypto.randomUUID()] }),
        )
      );
    } finally {
      await f.cleanup();
    }
  },
);

dbTest("legacy single-target SQL writes remain visible through expanded public related/list reads", async () => {
  const f = await fixtureOwner(admin);
  try {
    const first = await entity.createEntity(ed, f.actor, entityCreate.parse({ prop1: "구 소비자 대상" }));
    // Compatibility writer stands for the deployed prior adapter. Observation remains public business reads.
    const [legacy] = await admin`insert into app.tasks(owner_id,kind,title,summary,status,entity_id)
      values(${f.actor.userId},'once','구 소비자 업무','단일 대상','open',${first.id}) returning id`;
    assertEquals(
      (await activity.listTasks(ad, f.actor, taskListQuery.parse({ entity_id: first.id }))).items.map((row) => row.id),
      [legacy.id],
    );
    assertEquals((await activity.getTask(ad, f.actor, legacy.id)).entity_ids, [first.id]);
  } finally {
    await f.cleanup();
  }
});

dbTest(
  "legacy FK-only target deletion removes only the selected task target and preserves record captured context",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const first = await entity.createEntity(ed, f.actor, entityCreate.parse({ prop1: "삭제 전 첫 대상" }));
      const second = await entity.createEntity(ed, f.actor, entityCreate.parse({ prop1: "삭제 전 둘째 대상" }));
      const ids = [first.id, second.id].sort();
      const task = await activity.createTask(
        ad,
        f.actor,
        taskCreate.parse({ kind: "once", title: "남은 업무", summary: "보존", entity_ids: ids }),
      );
      const record = await activity.createRecord(
        ad,
        f.actor,
        recordCreate.parse({ title: "당시 자료", summary: "메모", entity_ids: ids }),
      );
      await admin`delete from app.entities where id=${ids[1]}`;
      const remaining = await activity.getTask(ad, f.actor, task.id);
      assertEquals([remaining.entity_ids, remaining.entity_id, remaining.entity_context.map((e) => e.id)], [
        [ids[0]],
        ids[0],
        [ids[0]],
      ]);
      await admin`delete from app.entities where id=${ids[0]}`;
      assertEquals((await activity.getTask(ad, f.actor, task.id)).entity_ids, []);
      assertEquals((await activity.listTasks(ad, f.actor, taskListQuery.parse({ entity_id: ids[0] }))).items, []);
      const read = await activity.getRecord(ad, f.actor, record.id);
      assertEquals(read.entity_ids, ids);
      assertEquals(read.entity_context, record.entity_context);
      const edited = await activity.updateRecord(
        ad,
        f.actor,
        record.id,
        recordUpdate.parse({ expected_version: read.version, body: "삭제 후에도 메모 편집", entity_ids: ids }),
      );
      assertEquals(edited.entity_context, record.entity_context);
      assertEquals(edited.entity_ids, ids);
    } finally {
      await f.cleanup();
    }
  },
);
