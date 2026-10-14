import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { createEntityType } from "../../functions/_shared/core/entity-types/application.ts";
import { requestActor } from "../_request.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import * as registry from "../../functions/_shared/core/entity-issuers/application.ts";
import { SqlEntityIssuerUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import { entityCreate, entityListQuery, type EntityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { recordCreate } from "../../functions/_shared/contracts/record.ts";
import { taskComplete, taskCreate, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { asUser, connect, dbTest, fixtureOwner, urls } from "./_db.ts";
import { directEntitySource, entityFixture } from "./_entity.ts";

// Invalid identity fields intentionally reach the public core guard, rather than failing a test-side parser.
const updateInput = (value: unknown) => value as EntityUpdate;
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { prepare: false, max: 3 });
const ed = { uow: new SqlEntityUnitOfWork(sql) };
const ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest("발급처 설정 조회 후 자동 식별자는 생성 성공에서 반환한다", async () => {
  const f = await fixtureOwner(admin);
  try {
    const schema = await entityFixture(admin, f.actor.userId);
    const settings = await registry.getEntityTypeIdentity(
      { uow: new SqlEntityIssuerUnitOfWork(sql) },
      f.actor,
      schema.entity_type_id,
    );
    const source = settings.default_source;
    const saved = await entities.createEntity(
      ed,
      requestActor(f.actor),
      entityCreate.parse({
        ...schema,
        source,
        identity_version: settings.version,
        properties: { prop_1: "짧은 자동 식별자" },
      }),
    );
    assert(/^\d{8}-[A-Z0-9]{8}$/.test(saved.external_id));
    assertEquals(saved.id, `${source}:${schema.entity_type_id}:${saved.external_id}`);
  } finally {
    await f.cleanup();
  }
});

dbTest(
  "발급처 소프트 삭제는 새 식별만 막고 기존 값·관계를 보존하며 중지 상태에서도 같은 엔터티를 되살린다",
  async () => {
    const f = await fixtureOwner(admin);
    try {
      const schema = await entityFixture(admin, f.actor.userId);
      const setup = await directEntitySource(sql, f.actor, schema.entity_type_id);
      const entity = await entities.createEntity(
        ed,
        requestActor(f.actor),
        entityCreate.parse({ ...schema, source: "crm", external_id: "보존", properties: { prop_1: "발급처 보존" } }),
      );
      const task = await activity.createTask(
        ad,
        requestActor(f.actor),
        taskCreate.parse({ kind: "once", title: "연결", entity_ids: [entity.id] }),
      );
      await registry.updateEntityTypeIdentity(setup.deps, requestActor(f.actor), schema.entity_type_id, {
        label: "번호",
        default_source: "app",
        expected_version: setup.identity.version,
        sources: setup.identity.sources.map(({ code, rule_id, active }) => ({ code, rule_id, active })),
      });
      await registry.updateEntityIssuer(setup.deps, requestActor(f.actor), "crm", {
        expected_version: setup.issuer.version,
        active: false,
      });
      assertEquals((await activity.getTask(ad, f.actor, task.id)).entity_ids, [entity.id]);
      await assertRejects(
        () =>
          entities.createEntity(
            ed,
            requestActor(f.actor),
            entityCreate.parse({ ...schema, source: "crm", external_id: "새 ID", properties: { prop_1: "금지" } }),
          ),
        AppError,
      );
      await assertRejects(
        () =>
          entities.updateEntity(
            ed,
            requestActor(f.actor),
            entity.id,
            updateInput({
              schema_version: schema.schema_version,
              source: "crm",
              external_id: "변경 ID",
              expected_version: 1,
            }),
          ),
        AppError,
      );
      const edited = await entities.updateEntity(
        ed,
        requestActor(f.actor),
        entity.id,
        updateInput({
          schema_version: schema.schema_version,
          expected_version: 1,
          properties: { prop_1: "기존 값 편집 가능" },
        }),
      );
      await entities.deleteEntity(ed, requestActor(f.actor), entity.id, edited.version);
      const restore = () =>
        entities.createEntity(
          ed,
          requestActor(f.actor),
          entityCreate.parse({ ...schema, source: "crm", external_id: "보존", expected_version: 3, properties: {} }),
        );
      const restored = await restore();
      assertEquals([restored.id, restored.properties.prop_1, restored.version, restored.deleted_at], [
        entity.id,
        "기존 값 편집 가능",
        4,
        null,
      ]);
      assertEquals((await activity.getTask(ad, f.actor, task.id)).entity_ids, [entity.id]);
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "namespaced identity isolates owners, preserves exact IDs, restores retained links, and rejects identity edits atomically",
  async () => {
    const f = await fixtureOwner(admin), other = await fixtureOwner(admin);
    try {
      const schema = await entityFixture(admin, f.actor.userId),
        foreignSchema = await entityFixture(admin, other.actor.userId);
      await directEntitySource(sql, f.actor, schema.entity_type_id);
      await directEntitySource(sql, other.actor, foreignSchema.entity_type_id);
      const input = entityCreate.parse({
        ...schema,
        source: "crm",
        external_id: "000Ab:/한글%",
        properties: { prop_1: "보관 고객", prop_2: 0, prop_4: "c" },
      });
      const created = await entities.createEntity(ed, requestActor(f.actor), input),
        foreign = await entities.createEntity(ed, requestActor(other.actor), { ...input, ...foreignSchema });
      assertEquals(created.id, `crm:${schema.entity_type_id}:000Ab:/한글%`);
      assertEquals(foreign.external_id, created.external_id);
      await assertRejects(() => entities.getEntity(ed, other.actor, created.id), AppError);
      const task = await activity.createTask(
        ad,
        requestActor(f.actor),
        taskCreate.parse({ kind: "once", title: "연결 유지", entity_ids: [created.id] }),
      );
      const record = await activity.createRecord(
        ad,
        requestActor(f.actor),
        recordCreate.parse({
          body: "본문의 crm:000Ab:/한글% 는 그대로",
          entity_ids: [created.id],
        }),
      );
      await entities.deleteEntity(ed, requestActor(f.actor), created.id, created.version);
      const deleted = await entities.getEntity(ed, f.actor, created.id);
      assert(deleted.deleted_at);
      assertEquals(deleted.version, 2);
      assertEquals((await entities.listEntities(ed, f.actor, entityListQuery.parse({}))).items, []);
      assertEquals((await activity.getTask(ad, f.actor, task.id)).entity_ids, [created.id]);
      await assertRejects(() => entities.createEntity(ed, requestActor(f.actor), input), AppError);
      await assertRejects(() =>
        activity.createRecord(
          ad,
          requestActor(f.actor),
          recordCreate.parse({ body: "새 선택 거부", entity_ids: [created.id] }),
        ), AppError);
      const edited = await activity.updateTask(
        ad,
        requestActor(f.actor),
        task.id,
        taskUpdate.parse({ expected_version: 1, title: "삭제 대상 연결 유지", entity_ids: [created.id] }),
      );
      const completed = await activity.completeTask(
        ad,
        requestActor(f.actor),
        task.id,
        taskComplete.parse({ expected_version: edited.version, body: "보관된 문맥을 상속한 결과" }),
      );
      assertEquals(completed.record.entity_ids, [created.id]);
      const restore = () =>
        entities.createEntity(
          ed,
          requestActor(f.actor),
          entityCreate.parse({
            ...schema,
            source: "crm",
            external_id: input.external_id,
            expected_version: 2,
            properties: { prop_3: "2026-10-09" },
          }),
        );
      const competing = await Promise.allSettled([restore(), restore()]);
      assertEquals(competing.filter((r) => r.status === "fulfilled").length, 1);
      const restored = (competing.find((r) =>
        r.status === "fulfilled"
      ) as PromiseFulfilledResult<Awaited<ReturnType<typeof restore>>>).value;
      assertEquals([
        restored.properties.prop_1,
        restored.properties.prop_2,
        restored.properties.prop_4,
        restored.version,
      ], ["보관 고객", 0, "c", 3]);
      await assertRejects(() =>
        entities.updateEntity(
          ed,
          requestActor(f.actor),
          restored.id,
          updateInput({
            schema_version: schema.schema_version,
            expected_version: 1,
            properties: { prop_1: "삭제 전 요청" },
          }),
        ), AppError);
      const collision = await entities.createEntity(
        ed,
        requestActor(f.actor),
        entityCreate.parse({
          ...schema,
          source: "app",
          external_id: "000Ab:/한글%",
          properties: { prop_1: "다른 발급처" },
        }),
      );
      await entities.deleteEntity(ed, requestActor(f.actor), collision.id, 1);
      await assertRejects(() =>
        entities.updateEntity(
          ed,
          requestActor(f.actor),
          restored.id,
          updateInput({
            schema_version: schema.schema_version,
            source: "app",
            external_id: input.external_id,
            expected_version: 3,
          }),
        ), AppError);
      assertEquals((await activity.getRecord(ad, f.actor, record.id)).entity_ids, [restored.id]);
      await assertRejects(
        () =>
          entities.updateEntity(
            ed,
            requestActor(f.actor),
            restored.id,
            updateInput({
              schema_version: schema.schema_version,
              properties: { prop_1: "실패한 속성 변경" },
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
      for (const field of ["source", "external_id", "entity_type_id"]) {
        await assertRejects(
          () =>
            entities.updateEntity(
              ed,
              requestActor(f.actor),
              restored.id,
              updateInput({ schema_version: schema.schema_version, expected_version: 3, [field]: "replacement" }),
            ),
          AppError,
        );
      }
      const updated = await entities.updateEntity(
        ed,
        requestActor(f.actor),
        restored.id,
        updateInput({
          schema_version: schema.schema_version,
          expected_version: 3,
          properties: { prop_1: "속성 변경" },
        }),
      );
      assertEquals(updated.id, restored.id);
      const readRecord = await activity.getRecord(ad, f.actor, record.id);
      assertEquals(readRecord.entity_ids, [restored.id]);
      assertEquals(readRecord.entity_context.map((c) => c.id), [restored.id]);
      assertEquals(readRecord.body, record.body);
      assertEquals((await activity.getTask(ad, f.actor, task.id)).entity_ids, [restored.id]);
      assertEquals((await entities.getEntity(ed, other.actor, foreign.id)).version, 1);
      const order = await createEntityType({ uow: new SqlEntityTypeUnitOfWork(sql) }, requestActor(f.actor), {
        label: "주문",
      });
      await directEntitySource(sql, f.actor, order.id);
      const sameNumber = await entities.createEntity(
        ed,
        requestActor(f.actor),
        entityCreate.parse({
          entity_type_id: order.id.toUpperCase(),
          schema_version: 1,
          source: "crm",
          external_id: input.external_id,
          properties: { prop_1: "같은 번호 주문" },
        }),
      );
      assertEquals(sameNumber.id, `crm:${order.id}:000Ab:/한글%`);
      assertEquals(
        new Set(
          (await entities.listEntities(ed, f.actor, entityListQuery.parse({ source: "crm" }))).items.map((row) =>
            row.id
          ),
        ),
        new Set([restored.id, sameNumber.id]),
      );
      for (
        const [field, value] of [["id", "replacement"], ["source", "app"], ["external_id", "replacement"], [
          "entity_type_id",
          order.id,
        ]]
      ) {
        const failure = await assertRejects(() =>
          asUser(sql, f.actor.userId, (tx) => tx`update app.entities set ${tx(field)}=${value} where id=${restored.id}`)
        );
        assertEquals((failure as { code?: string }).code, "23514");
      }
      assertEquals((await entities.getEntity(ed, f.actor, restored.id)).version, updated.version);
    } finally {
      await f.cleanup();
      await other.cleanup();
    }
  },
);
