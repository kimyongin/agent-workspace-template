import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlBusinessSettingsUnitOfWork } from "../../functions/_shared/adapters/supabase/business-settings-store.ts";
import { getBusinessSettings, updateBusinessSettings } from "../../functions/_shared/core/settings/application.ts";
import { entityCreate, entityListQuery, entityRekey, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { recordCreate } from "../../functions/_shared/contracts/record.ts";
import { taskComplete, taskCreate, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, fixtureOwner, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { prepare: false, max: 3 });
const ed = { uow: new SqlEntityUnitOfWork(sql) }, sd = { uow: new SqlBusinessSettingsUnitOfWork(sql) };
const ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest(
  "namespaced identity isolates owners, preserves exact IDs, restores retained links, and rekeys atomically",
  async () => {
    const f = await fixtureOwner(admin), other = await fixtureOwner(admin);
    try {
      for (const actor of [f.actor, other.actor]) {
        const saved = await getBusinessSettings(sd, actor);
        await updateBusinessSettings(sd, actor, {
          expected_version: saved.version,
          sections: {
            entity_identity: {
              generation: "manual",
              default_source: "crm",
              sources: [{ code: "app", label: "앱" }, { code: "crm", label: "고객 시스템" }],
            },
          },
        });
      }
      const input = entityCreate.parse({
        source: "crm",
        external_id: "000Ab:/한글%",
        prop1: "보관 고객",
        prop2: 0,
        prop4: "c",
      });
      const created = await entities.createEntity(ed, f.actor, input),
        foreign = await entities.createEntity(ed, other.actor, input);
      assertEquals(created.id, "crm:000Ab:/한글%");
      assertEquals(foreign.id, created.id);
      const task = await activity.createTask(
        ad,
        f.actor,
        taskCreate.parse({ id: crypto.randomUUID(), kind: "once", title: "연결 유지", entity_ids: [created.id] }),
      );
      const record = await activity.createRecord(
        ad,
        f.actor,
        recordCreate.parse({
          id: crypto.randomUUID(),
          body: "본문의 crm:000Ab:/한글% 는 그대로",
          entity_ids: [created.id],
        }),
      );
      await entities.deleteEntity(ed, f.actor, created.id, created.version);
      const deleted = await entities.getEntity(ed, f.actor, created.id);
      assert(deleted.deleted_at);
      assertEquals(deleted.version, 2);
      assertEquals((await entities.listEntities(ed, f.actor, entityListQuery.parse({}))).items, []);
      assertEquals((await activity.getTask(ad, f.actor, task.id)).entity_ids, [created.id]);
      await assertRejects(() => entities.createEntity(ed, f.actor, input), AppError);
      await assertRejects(() =>
        activity.createRecord(
          ad,
          f.actor,
          recordCreate.parse({ id: crypto.randomUUID(), body: "새 선택 거부", entity_ids: [created.id] }),
        ), AppError);
      const edited = await activity.updateTask(
        ad,
        f.actor,
        task.id,
        taskUpdate.parse({ expected_version: 1, title: "삭제 대상 연결 유지", entity_ids: [created.id] }),
      );
      const completed = await activity.completeTask(
        ad,
        f.actor,
        task.id,
        taskComplete.parse({ expected_version: edited.version, body: "보관된 문맥을 상속한 결과" }),
      );
      assertEquals(completed.record.entity_ids, [created.id]);
      const restore = () =>
        entities.createEntity(
          ed,
          f.actor,
          entityCreate.parse({
            source: "crm",
            external_id: input.external_id,
            expected_version: 2,
            prop3: "2026-10-09",
          }),
        );
      const competing = await Promise.allSettled([restore(), restore()]);
      assertEquals(competing.filter((r) => r.status === "fulfilled").length, 1);
      const restored = (competing.find((r) =>
        r.status === "fulfilled"
      ) as PromiseFulfilledResult<Awaited<ReturnType<typeof restore>>>).value;
      assertEquals([restored.prop1, restored.prop2, restored.prop4, restored.version], ["보관 고객", 0, "c", 3]);
      await assertRejects(() =>
        entities.updateEntity(
          ed,
          f.actor,
          restored.id,
          entityUpdate.parse({ expected_version: 1, prop1: "삭제 전 요청" }),
        ), AppError);
      const collision = await entities.createEntity(
        ed,
        f.actor,
        entityCreate.parse({ source: "app", external_id: "000Ab:/한글%", prop1: "다른 발급처" }),
      );
      await entities.deleteEntity(ed, f.actor, collision.id, 1);
      await assertRejects(() =>
        entities.rekeyEntity(
          ed,
          f.actor,
          restored.id,
          entityRekey.parse({ source: "app", external_id: input.external_id, expected_version: 3 }),
        ), AppError);
      assertEquals((await activity.getRecord(ad, f.actor, record.id)).entity_ids, [restored.id]);
      await assertRejects(
        () =>
          entities.rekeyEntity(
            ed,
            f.actor,
            restored.id,
            entityRekey.parse({
              source: "crm",
              external_id: "failed:/ID",
              expected_version: 3,
              change_tag_ids: [crypto.randomUUID()],
            }),
          ),
        AppError,
      );
      assertEquals((await entities.getEntity(ed, f.actor, restored.id)).version, 3);
      assertEquals((await activity.getRecord(ad, f.actor, record.id)).entity_ids, [restored.id]);
      const rekeyed = await entities.rekeyEntity(
        ed,
        f.actor,
        restored.id,
        entityRekey.parse({ source: "crm", external_id: "새:/ID%", expected_version: 3 }),
      );
      assertEquals(rekeyed.id, "crm:새:/ID%");
      const readRecord = await activity.getRecord(ad, f.actor, record.id);
      assertEquals(readRecord.entity_ids, [rekeyed.id]);
      assertEquals(
        readRecord.entity_context.map((c) => c.id),
        [rekeyed.id],
      );
      assertEquals(readRecord.body, record.body);
      assertEquals((await activity.getTask(ad, f.actor, task.id)).entity_ids, [rekeyed.id]);
      assertEquals((await entities.getEntity(ed, other.actor, foreign.id)).version, 1);
      await assertRejects(() => entities.getEntity(ed, f.actor, created.id), AppError);
    } finally {
      await f.cleanup();
      await other.cleanup();
    }
  },
);
