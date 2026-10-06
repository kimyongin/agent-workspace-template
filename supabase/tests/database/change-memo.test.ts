import { assertEquals, assertRejects } from "@std/assert";
import { entityCreate, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { recordListQuery } from "../../functions/_shared/contracts/record.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 3, prepare: false });
const ed = { uow: new SqlEntityUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
dbTest("business save preserves exact entered memo, factual blank default, no-op, retry and rollback", async () => {
  const f = await fixtureOwner(admin), other = await fixtureOwner(admin);
  try {
    const e = await entity.createEntity(
      ed,
      f.actor,
      entityCreate.parse({ id: crypto.randomUUID(), prop1: "대상", prop2: 10, change_note: "" }),
    );
    const records = () =>
      activity.listRecords(ad, f.actor, recordListQuery.parse({ record_kind: "change", limit: 100 }));
    assertEquals((await records()).items.find((r) => r.change?.target_id === e.id)!.body, "대상 등록");
    const memo = "  상세 근거\n" + "가".repeat(21000);
    const patch = entityUpdate.parse({ expected_version: e.version, prop2: 20, change_note: memo });
    const saved = await entity.updateEntity(ed, f.actor, e.id, patch);
    await assertRejects(() => entity.updateEntity(ed, f.actor, e.id, patch));
    await assertRejects(() =>
      entity.updateEntity(ed, other.actor, e.id, { ...patch, expected_version: saved.version })
    );
    const events = await records(), change = events.items.find((r) => r.change?.action === "update")!;
    assertEquals(change.body, memo);
    assertEquals([change.change!.before, change.change!.after], [null, null]);
    assertEquals(["title", "summary", "change_note"].some((key) => key in change), false);
    await entity.updateEntity(
      ed,
      f.actor,
      e.id,
      entityUpdate.parse({ expected_version: saved.version, prop2: 20, change_note: "다른 메모" }),
    );
    assertEquals(await records(), events);
    const failing: entity.EntityDeps = {
      uow: {
        run: (actor, fn) =>
          ed.uow.run(actor, (s) =>
            fn(
              new Proxy(s, {
                get: (target, key) =>
                  key === "appendChange" ? () => Promise.reject(Error("failed record")) : Reflect.get(target, key),
              }),
            )),
      },
    };
    await assertRejects(() =>
      entity.updateEntity(failing, f.actor, e.id, entityUpdate.parse({ expected_version: saved.version, prop2: 30 }))
    );
    assertEquals((await entity.getEntity(ed, f.actor, e.id)).prop2, 20);
    assertEquals(await records(), events);
    const updated = await entity.updateEntity(
      ed,
      f.actor,
      e.id,
      entityUpdate.parse({ expected_version: saved.version, prop2: 30, change_note: "   " }),
    );
    assertEquals((await records()).items.find((r) => r.body === "대상 수정 (속성 2)")!.change!.target_id, e.id);
    await entity.deleteEntity(ed, f.actor, e.id, updated.version, "삭제 근거");
    assertEquals((await records()).items.find((r) => r.change?.action === "delete")!.body, "삭제 근거");
  } finally {
    await f.cleanup();
    await other.cleanup();
  }
});
