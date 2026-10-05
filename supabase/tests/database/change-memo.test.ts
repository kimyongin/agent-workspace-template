import { assertEquals, assertRejects } from "@std/assert";
import { entityCreate, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { recordListQuery } from "../../functions/_shared/contracts/record.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { max: 3, prepare: false });
const ed = { uow: new SqlEntityUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
const memo = {
  title: "사용자가 정리한 메모",
  summary: "상담 내용 반영",
  body: "이유와 전체 설명을 자유롭게 함께 남긴다.",
};

dbTest("Entity/Task preview stores nothing; final memo is atomic/idempotent, no-op creates no event", async () => {
  const f = await fixtureOwner(admin), foreign = await fixtureOwner(admin);
  try {
    const e = await entity.createEntity(ed, f.actor, entityCreate.parse({ prop1: "고객", prop2: 10 }));
    const task = await activity.createTask(
      ad,
      f.actor,
      taskCreate.parse({ kind: "once", title: "상담", summary: "준비" }),
    );
    const records = () =>
      activity.listRecords(ad, f.actor, recordListQuery.parse({ record_kind: "change", limit: 100 }));
    const before = await records();
    const ep = await entity.previewEntityChange(ed, f.actor, {
      action: "update",
      id: e.id,
      input: entityUpdate.parse({ expected_version: e.version, prop2: 20 }),
    });
    assertEquals(ep.memo.body, "속성 2: 10 → 20");
    await activity.previewTaskChange(ad, f.actor, {
      action: "update",
      id: task.id,
      input: taskUpdate.parse({ expected_version: task.version, title: "상담 준비" }),
    });
    assertEquals(await records(), before);
    await assertRejects(() =>
      entity.previewEntityChange(ed, foreign.actor, { action: "delete", id: e.id, input: { expected_version: 1 } })
    );
    const patch = entityUpdate.parse({
      expected_version: 1,
      prop2: 20,
      change_memo: memo,
      request_id: crypto.randomUUID(),
    });
    const saved = await entity.updateEntity(ed, f.actor, e.id, patch);
    assertEquals(await entity.updateEntity(ed, f.actor, e.id, patch), saved);
    const changes = await records();
    assertEquals(changes.items.length, before.items.length + 1);
    const record = changes.items.find((r) => r.change?.target_id === e.id && r.change.action === "update")!;
    assertEquals([record.title, record.summary, record.body], [memo.title, memo.summary, memo.body]);
    assertEquals([record.change!.before, record.change!.after], [null, null]);
    assertEquals((await entity.getEntity(ed, f.actor, e.id)).prop2, 20);
    await entity.updateEntity(
      ed,
      f.actor,
      e.id,
      entityUpdate.parse({ expected_version: saved.version, prop2: 20, change_memo: { ...memo, title: "무변경" } }),
    );
    assertEquals((await records()).items.length, changes.items.length);
    await assertRejects(() =>
      entity.updateEntity(ed, f.actor, e.id, { ...patch, change_memo: { ...memo, body: "같은 요청키 다른 메모" } })
    );
    // Failure at the database boundary after the entity update must roll back both.
    const failing: entity.EntityDeps = {
      uow: {
        run: (actor, fn) =>
          ed.uow.run(actor, (s) =>
            fn(
              new Proxy(s, {
                get: (target, key) =>
                  key === "appendChange"
                    ? () => Promise.reject(Error("record storage unavailable"))
                    : Reflect.get(target, key),
              }),
            )),
      },
    };
    await assertRejects(() =>
      entity.updateEntity(
        failing,
        f.actor,
        e.id,
        entityUpdate.parse({
          expected_version: saved.version,
          prop2: 30,
          change_memo: memo,
          request_id: crypto.randomUUID(),
        }),
      )
    );
    assertEquals((await entity.getEntity(ed, f.actor, e.id)).prop2, 20);
    assertEquals((await records()).items.length, changes.items.length);
    const taskPatch = taskUpdate.parse({
      expected_version: task.version,
      title: "상담 준비",
      body: `메모에 포함하지 않은 전체 원문 ${"긴 본문 ".repeat(1000)}`,
      change_memo: memo,
      request_id: crypto.randomUUID(),
    });
    const t = await activity.updateTask(ad, f.actor, task.id, taskPatch);
    assertEquals(await activity.updateTask(ad, f.actor, task.id, taskPatch), t);
    const taskEvent = (await records()).items.find((r) =>
      r.change?.target_id === task.id && r.change.action === "update"
    )!;
    assertEquals(taskEvent.body, memo.body);
    assertEquals([taskEvent.change!.before, taskEvent.change!.after], [null, null]);
    const [stored] = await admin`select change_metadata from app.records where id=${taskEvent.id}`;
    assertEquals(stored.change_metadata.before, null);
    assertEquals(stored.change_metadata.after, null);
    assertEquals(JSON.stringify(stored.change_metadata).includes("메모에 포함하지 않은 전체 원문"), false);
    await activity.deleteTask(ad, f.actor, t.id, t.version, undefined, crypto.randomUUID(), memo);
    const deleted = (await records()).items.find((r) =>
      r.change?.target_id === task.id && r.change.action === "delete"
    )!;
    assertEquals([deleted.body, deleted.change!.target_title], [memo.body, "상담 준비"]);
  } finally {
    await f.cleanup();
    await foreign.cleanup();
  }
});
