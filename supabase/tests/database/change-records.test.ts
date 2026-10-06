import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { entityCreate, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { taskComplete, taskCreate, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { recordCreate, recordListQuery, recordResult, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import * as e from "../../functions/_shared/core/entity/application.ts";
import * as a from "../../functions/_shared/core/activity/application.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 3, prepare: false }),
  ed = { uow: new SqlEntityUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest("no-op recurring rule object order and tag set order preserve version/index/history", async () => {
  const f = await fixtureOwner(admin);
  try {
    const tags =
      await admin`insert into app.tags(owner_id,name,scope) values(${f.actor.userId},'one','activity'),(${f.actor.userId},'two','activity') returning id`;
    const tag_ids = tags.map((t) => t.id as string),
      recurrence = { freq: "daily", starts_on: "2020-01-01" };
    const task = await a.createTask(
      ad,
      f.actor,
      taskCreate.parse({
        id: crypto.randomUUID(),
        ...{
          kind: "recurring",
          title: "동일 규칙",
          recurrence,
          timezone: "Asia/Seoul",
          tag_ids,
        },
      }),
    );
    const before = await admin`select id,version,updated_at from app.tasks where id=${task.id}`;
    const queue =
      await admin`select message from pgmq.q_search_index where message->>'owner_id'=${f.actor.userId} order by msg_id`;
    const same = await a.updateTask(
      ad,
      f.actor,
      task.id,
      taskUpdate.parse({
        expected_version: task.version,
        change_note: "변경 없음",
        recurrence: { starts_on: "2020-01-01", freq: "daily" },
        tag_ids: [...tag_ids].reverse(),
      }),
    );
    assertEquals(same.version, task.version);
    assertEquals(await admin`select id,version,updated_at from app.tasks where id=${task.id}`, before);
    assertEquals(
      await admin`select message from pgmq.q_search_index where message->>'owner_id'=${f.actor.userId} order by msg_id`,
      queue,
    );
    assertEquals((await admin`select count(*)::int n from app.records where owner_id=${f.actor.userId}`)[0].n, 1);
  } finally {
    await f.cleanup();
  }
});
dbTest(
  "business mutations have one change record; record memo edits preserve facts without another event",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const A = { ...f.actor, source: "mcp" as const };
      const entity = await e.createEntity(
        ed,
        A,
        entityCreate.parse({ id: crypto.randomUUID(), ...{ prop1: "대상", prop2: 10 } }),
      );
      const count = async () =>
        Number(
          (await admin`select count(*)::int n from app.records where owner_id=${A.userId} and record_kind='change'`)[0]
            .n,
        );
      assertEquals(await count(), 1);
      await e.getEntity(ed, A, entity.id);
      await e.updateEntity(
        ed,
        A,
        entity.id,
        entityUpdate.parse({ expected_version: entity.version, prop2: 10, change_note: "같은 값" }),
      );
      assertEquals(await count(), 1);
      const i = entityUpdate.parse({
        expected_version: entity.version,
        prop2: 20,
        change_note: "실측",
      });
      const updated = await e.updateEntity(ed, A, entity.id, i);
      await assertRejects(() => e.updateEntity(ed, A, entity.id, i));
      assertEquals(await count(), 2);
      const rows = await a.listRecords(ad, A, recordListQuery.parse({ record_kind: "change" }));
      rows.items.forEach((r) => recordResult.parse(r));
      const event = rows.items.find((r) => r.change?.action === "update")!;
      assertEquals(event.body, "실측");
      assertEquals([event.change!.before, event.change!.after], [null, null]);
      assertEquals(event.change!.source, "mcp");
      assertEquals(event.change!.path, `/entities/${entity.id}`);
      const immutable = {
        expected_version: event.version,
        body: "설명",
        change_note: "설명 정정",
        change: { target_id: crypto.randomUUID() },
      };
      assertEquals(recordUpdate.safeParse(immutable).success, false);
      const corrected = await a.updateRecord(
        ad,
        A,
        event.id,
        recordUpdate.parse({ expected_version: event.version, body: "설명 정정" }),
      );
      assertEquals(corrected.change, event.change);
      assertEquals(corrected.body, "설명 정정");
      assertEquals(await count(), 2);
      await a.deleteRecord(ad, A, corrected.id, corrected.version);
      assertEquals((await e.getEntity(ed, A, entity.id)).prop2, 20);
      assertEquals(await count(), 2);
      const task = await a.createTask(
        ad,
        A,
        taskCreate.parse({
          id: crypto.randomUUID(),
          ...{ kind: "once", title: "행동", entity_ids: [entity.id] },
        }),
      );
      assertEquals(await count(), 3);
      const taskUpdated = await a.updateTask(
        ad,
        A,
        task.id,
        taskUpdate.parse({ expected_version: task.version, title: "새 행동", change_note: "계획 수정" }),
      );
      assertEquals(await count(), 4);
      const completion = await a.completeTask(
        ad,
        A,
        task.id,
        taskComplete.parse({ expected_version: taskUpdated.version, body: "실제 결과" }),
      );
      assertEquals(completion.record.record_kind, "result");
      assertEquals(await count(), 4);
      await a.deleteTask(ad, A, task.id, completion.task.version);
      assertEquals(await count(), 5);
      assertEquals((await a.getRecord(ad, A, completion.record.id)).task_id, null);
      const record = await a.createRecord(
        ad,
        A,
        recordCreate.parse({
          id: crypto.randomUUID(),
          ...{ body: "직접 기록" },
        }),
      );
      assertEquals(await count(), 6);
      const recordUpdated = await a.updateRecord(
        ad,
        A,
        record.id,
        recordUpdate.parse({ expected_version: record.version, body: "정정 본문" }),
      );
      assertEquals(await count(), 6);
      await a.deleteRecord(ad, A, record.id, recordUpdated.version);
      assertEquals(await count(), 7);
      await e.deleteEntity(ed, A, entity.id, updated.version, "불필요");
      assertEquals(await count(), 8);
      const deleted = (await a.listRecords(ad, A, recordListQuery.parse({ record_kind: "change" }))).items.find((r) =>
        r.change?.target_kind === "entity" && r.change.action === "delete"
      )!;
      assertEquals(deleted.change!.path, null);
      assertEquals([deleted.change!.before, deleted.change!.after], [null, null]);
      assertEquals(deleted.change!.target_title, "대상");
      assert(JSON.stringify(deleted.change).includes("대상"));
    } finally {
      await f.cleanup();
    }
  },
);
dbTest(
  "business history or record index failure rolls back content/version/request; record retry adds no event",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const A = f.actor,
        entity = await e.createEntity(ed, A, entityCreate.parse({ id: crypto.randomUUID(), ...{ prop1: "대상" } })),
        task = await a.createTask(
          ad,
          A,
          taskCreate.parse({ id: crypto.randomUUID(), ...{ kind: "once", title: "행동" } }),
        ),
        record = await a.createRecord(
          ad,
          A,
          recordCreate.parse({ id: crypto.randomUUID(), ...{ body: "기록" } }),
        );
      const broken = <S>(store: S) =>
        new Proxy(store as object, {
          get: (target, key) =>
            key === "appendChange" ? () => Promise.reject(Error("required history failure")) : Reflect.get(target, key),
        }) as S;
      const badE = {
        uow: {
          run: <T>(actor: typeof A, fn: Parameters<typeof ed.uow.run<T>>[1]) => ed.uow.run(actor, (s) => fn(broken(s))),
        },
      };
      const badA = {
        ...ad,
        uow: {
          run: <T>(actor: typeof A, fn: Parameters<typeof ad.uow.run<T>>[1]) => ad.uow.run(actor, (s) => fn(broken(s))),
        },
      };
      const badRecord = {
        ...ad,
        uow: {
          run: <T>(actor: typeof A, fn: Parameters<typeof ad.uow.run<T>>[1]) =>
            ad.uow.run(actor, (s) =>
              fn(
                new Proxy(s, {
                  get: (target, key) =>
                    key === "enqueueIndex"
                      ? () => Promise.reject(Error("index queue failure"))
                      : Reflect.get(target, key),
                }),
              )),
        },
      };
      const ei = entityUpdate.parse({
          expected_version: 1,
          prop1: "새 이름",
          change_note: "정정",
        }),
        ti = taskUpdate.parse({
          expected_version: 1,
          title: "새 계획",
          change_note: "정정",
        }),
        ri = recordUpdate.parse({
          expected_version: 1,
          body: "새 관찰",
        });
      await assertRejects(() => e.updateEntity(badE, A, entity.id, ei));
      await assertRejects(() => a.updateTask(badA, A, task.id, ti));
      await assertRejects(() => a.updateRecord(badRecord, A, record.id, ri));
      assertEquals((await e.getEntity(ed, A, entity.id)).version, 1);
      assertEquals((await a.getTask(ad, A, task.id)).title, task.title);
      assertEquals((await a.getRecord(ad, A, record.id)).body, record.body);
      assertEquals(
        (await admin`select id from app.records where owner_id=${A.userId} and record_kind='change'`).length,
        3,
      );
      await e.updateEntity(ed, A, entity.id, ei);
      await a.updateTask(ad, A, task.id, ti);
      await a.updateRecord(ad, A, record.id, ri);
      assertEquals(
        (await admin`select id from app.records where owner_id=${A.userId} and record_kind='change'`).length,
        5,
      );
    } finally {
      await f.cleanup();
    }
  },
);
