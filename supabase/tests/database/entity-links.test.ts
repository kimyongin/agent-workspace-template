import { recordCreate, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
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
      const first = await entity.createEntity(
        ed,
        f.actor,
        entityCreate.parse({ source: "app", external_id: crypto.randomUUID(), ...{ prop1: "공동 대상 1" } }),
      );
      const second = await entity.createEntity(
        ed,
        f.actor,
        entityCreate.parse({ source: "app", external_id: crypto.randomUUID(), ...{ prop1: "공동 대상 2" } }),
      );
      const ids = [first.id, second.id].sort();
      const task = await activity.createTask(
        ad,
        f.actor,
        taskCreate.parse({
          id: crypto.randomUUID(),
          ...{ kind: "once", title: "공동 업무", entity_ids: ids },
        }),
      );
      const unlinked = await activity.createTask(
        ad,
        f.actor,
        taskCreate.parse({ id: crypto.randomUUID(), ...{ kind: "once", title: "개인 업무" } }),
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
          taskCreate.parse({
            id: crypto.randomUUID(),
            ...{ kind: "once", title: "없는 대상", entity_ids: [crypto.randomUUID()] },
          }),
        )
      );
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "soft target deletion preserves live membership and preserves exact task/record captured context",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const first = await entity.createEntity(
        ed,
        f.actor,
        entityCreate.parse({ source: "app", external_id: crypto.randomUUID(), ...{ prop1: "삭제 전 첫 대상" } }),
      );
      const second = await entity.createEntity(
        ed,
        f.actor,
        entityCreate.parse({ source: "app", external_id: crypto.randomUUID(), ...{ prop1: "삭제 전 둘째 대상" } }),
      );
      const ids = [first.id, second.id].sort();
      const task = await activity.createTask(
        ad,
        f.actor,
        taskCreate.parse({
          id: crypto.randomUUID(),
          ...{ kind: "once", title: "남은 업무", entity_ids: ids },
        }),
      );
      const record = await activity.createRecord(
        ad,
        f.actor,
        recordCreate.parse({ id: crypto.randomUUID(), ...{ body: "당시 자료", entity_ids: ids } }),
      );
      await entity.deleteEntity(ed, f.actor, ids[1], 1);
      const remaining = await activity.getTask(ad, f.actor, task.id);
      assertEquals([remaining.entity_ids, remaining.entity_context], [
        ids,
        task.entity_context,
      ]);
      assertEquals(remaining.version, task.version);
      await entity.deleteEntity(ed, f.actor, ids[0], 1);
      const detached = await activity.getTask(ad, f.actor, task.id);
      assertEquals(detached.entity_ids, ids);
      assertEquals(detached.entity_context, task.entity_context);
      assertEquals(detached.version, task.version);
      assertEquals(
        (await activity.listTasks(ad, f.actor, taskListQuery.parse({ entity_id: ids[0] }))).items.map((t) => t.id),
        [task.id],
      );
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

dbTest(
  "record selection edits retain capture provenance and rollback atomically; deleted selections permit memo no-op",
  async () => {
    const f = await fixtureOwner(admin), other = await fixtureOwner(admin);
    try {
      const target = await entity.createEntity(
        ed,
        f.actor,
        entityCreate.parse({ source: "app", external_id: crypto.randomUUID(), ...{ prop1: "기록의 대상" } }),
      );
      const foreign = await entity.createEntity(
        ed,
        other.actor,
        entityCreate.parse({ source: "app", external_id: crypto.randomUUID(), ...{ prop1: "다른 소유자" } }),
      );
      let record = await activity.createRecord(
        ad,
        f.actor,
        recordCreate.parse({
          id: crypto.randomUUID(),
          ...{ body: "선택 기록", entity_ids: [target.id] },
        }),
      );
      const original = await activity.getRecord(ad, f.actor, record.id);
      await admin`update app.entities set prop1='현재 바뀐 이름' where id=${target.id}`;
      const memoEdit = await activity.updateRecord(
        ad,
        f.actor,
        record.id,
        recordUpdate.parse({ expected_version: record.version, body: "이름 변경 이후 편집", entity_ids: [target.id] }),
      );
      assertEquals(memoEdit.entity_context, original.entity_context);
      record = memoEdit;
      const beforeRejected = await activity.getRecord(ad, f.actor, record.id);

      for (const id of [foreign.id, crypto.randomUUID()]) {
        await assertRejects(() =>
          activity.updateRecord(
            ad,
            f.actor,
            record.id,
            recordUpdate.parse({ expected_version: record.version, entity_ids: [id] }),
          )
        );
        assertEquals(await activity.getRecord(ad, f.actor, record.id), beforeRejected);
      }
      const patch = recordUpdate.parse({
        expected_version: record.version,
        entity_ids: [],
      });
      const broken: activity.ActivityDeps = {
        ...ad,
        uow: {
          run: (actor, fn) =>
            ad.uow.run(actor, (s) =>
              fn(
                new Proxy(s, {
                  get: (target, key) =>
                    key === "updateRecord"
                      ? async (...args: Parameters<typeof target.updateRecord>) => {
                        await target.updateRecord(...args);
                        throw Error("record update failure");
                      }
                      : Reflect.get(target, key),
                }),
              )),
        },
      };
      await assertRejects(() => activity.updateRecord(broken, f.actor, record.id, patch));
      assertEquals(await activity.getRecord(ad, f.actor, record.id), beforeRejected);
      const cleared = await activity.updateRecord(ad, f.actor, record.id, patch);
      assertEquals([cleared.entity_ids, cleared.entity_context], [[], []]);
      await assertRejects(() => activity.updateRecord(ad, f.actor, record.id, patch));
      record = await activity.updateRecord(
        ad,
        f.actor,
        record.id,
        recordUpdate.parse({ expected_version: cleared.version, entity_ids: [target.id] }),
      );
      await entity.deleteEntity(ed, f.actor, target.id, target.version);
      record = await activity.getRecord(ad, f.actor, record.id);
      const noOp = await activity.updateRecord(
        ad,
        f.actor,
        record.id,
        recordUpdate.parse({ expected_version: record.version, entity_ids: record.entity_ids, body: record.body }),
      );
      assertEquals(noOp, record);
    } finally {
      await f.cleanup();
      await other.cleanup();
    }
  },
);

dbTest(
  "entity deletion history failure restores selections and versions; same-key retry preserves connections",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const target = await entity.createEntity(
        ed,
        f.actor,
        entityCreate.parse({ source: "app", external_id: crypto.randomUUID(), ...{ prop1: "당시 대상" } }),
      );
      const task = await activity.createTask(
        ad,
        f.actor,
        taskCreate.parse({
          id: crypto.randomUUID(),
          ...{ kind: "once", title: "연결된 업무", entity_ids: [target.id] },
        }),
      );
      const record = await activity.createRecord(
        ad,
        f.actor,
        recordCreate.parse({
          id: crypto.randomUUID(),
          ...{ body: "과거 자료", entity_ids: [target.id] },
        }),
      );
      const before = await entity.getEntity(ed, f.actor, target.id);
      const taskBefore = await activity.getTask(ad, f.actor, task.id);
      const recordBefore = await activity.getRecord(ad, f.actor, record.id);
      const broken: entity.EntityDeps = {
        uow: {
          run: (actor, fn) =>
            ed.uow.run(actor, (s) =>
              fn(
                new Proxy(s, {
                  get: (target, key) =>
                    key === "appendChange"
                      ? () => Promise.reject(Error("deletion history failure"))
                      : Reflect.get(target, key),
                }),
              )),
        },
      };
      await assertRejects(() => entity.deleteEntity(broken, f.actor, target.id, target.version, undefined));
      assertEquals(await entity.getEntity(ed, f.actor, target.id), before);
      assertEquals(await activity.getTask(ad, f.actor, task.id), taskBefore);
      assertEquals(await activity.getRecord(ad, f.actor, record.id), recordBefore);

      await entity.deleteEntity(ed, f.actor, target.id, target.version, undefined);
      await assertRejects(() => entity.deleteEntity(ed, f.actor, target.id, target.version));
      const detached = await activity.getTask(ad, f.actor, task.id);
      const historical = await activity.getRecord(ad, f.actor, record.id);
      assertEquals([detached.entity_ids, detached.entity_context, detached.version], [
        [target.id],
        task.entity_context,
        1,
      ]);
      assertEquals([historical.entity_ids, historical.entity_context, historical.version], [
        [target.id],
        record.entity_context,
        1,
      ]);
      assert((await entity.getEntity(ed, f.actor, target.id)).deleted_at);
    } finally {
      await f.cleanup();
    }
  },
);
