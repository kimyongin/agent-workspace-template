import { APP_IDENTIFIER_RULE_ID } from "../../functions/_shared/contracts/entity-issuer.ts";
import {
  decodeIdentifierReference,
  encodeIdentifierReference,
  encodeIdentifierValue,
} from "../../functions/_shared/contracts/entity-identifiers.ts";
import { getEntitySchema } from "../../functions/_shared/core/entity-types/application.ts";
import { SqlEntityTypeUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-type-store.ts";
import { createEntityType } from "../../functions/_shared/core/entity-types/application.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { SqlDataModelUnitOfWork } from "../../functions/_shared/adapters/supabase/data-model-store.ts";
import {
  applyDataModel,
  exportDataModel,
  prepareDataModel,
  previewDataModel,
} from "../../functions/_shared/core/data-model/application.ts";

import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import * as registry from "../../functions/_shared/core/entity-issuers/application.ts";
import { SqlEntityIssuerUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-issuer-store.ts";
import { entityCreate, entityListQuery, type EntityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { taskComplete, taskCreate, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { configureIdentifierField, directEntitySource } from "./_entity.ts";

// Invalid identity fields intentionally reach the public core guard, rather than failing a test-side parser.
const updateInput = (value: unknown) => value as EntityUpdate;
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { prepare: false, max: 3 });
const ed = { uow: new SqlEntityUnitOfWork(sql) };
const ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

// Publish the typed fixture through the current whole-model public boundary before any entities exist.
async function typedKind(f: Awaited<ReturnType<typeof businessWorkspaceFixture>>, manager = f.manager) {
  const kind = await f.createKind("검사 자료", manager);
  await f.grantKind(manager, kind.id, "write");
  const modelDeps = { uow: new SqlDataModelUnitOfWork(sql) };
  const document = await exportDataModel(modelDeps, manager);
  const type = document.entity_types.find((value) => value.schema["x-type-id"] === kind.id)!;
  Object.assign(type.schema.properties, {
    prop_3: { type: ["integer", "null"], title: "속성 2", minimum: 0, maximum: 1000000, default: null, "x-order": 30 },
    prop_4: { type: ["string", "null"], title: "속성 3", format: "date", default: null, "x-order": 40 },
    prop_5: {
      type: "string",
      title: "속성 4",
      oneOf: [{ const: "a" }, { const: "b" }, { const: "c" }],
      default: "a",
      "x-order": 50,
    },
  });
  const input = { mode: "update", document: JSON.stringify(document) };
  const review = await previewDataModel(modelDeps, manager, input);
  const change = await prepareDataModel(modelDeps, businessRequest(manager), {
    ...input,
    preview_fingerprint: review.fingerprint,
  });
  const applied = await applyDataModel(modelDeps, businessRequest(manager), change.id, {
    expected_version: change.version,
  });
  assertEquals(applied.status, "applied");
  return { entity_type_id: kind.id, schema_version: 2 };
}

async function identityWorkspaceFixture() {
  const f = await businessWorkspaceFixture(admin, sql);
  try {
    const schema = await typedKind(f);
    await f.grant(f.member, [
      { target_kind: "tasks", target_id: "*", access: "write" },
      { target_kind: "entity_type", target_id: schema.entity_type_id, access: "write" },
    ]);
    return { ...f, actor: f.member, schema };
  } catch (error) {
    await f.cleanup();
    throw error;
  }
}

dbTest("발급처 설정 조회 후 자동 식별자는 생성 성공에서 반환한다", async () => {
  const f = await identityWorkspaceFixture();
  try {
    const schema = f.schema;
    const settings = await getEntitySchema({ uow: new SqlEntityTypeUnitOfWork(sql) }, f.actor, {
      type_id: schema.entity_type_id,
    });
    assertEquals(settings.schema.properties.prop_2["x-identifier"]?.default_kind_id, APP_IDENTIFIER_RULE_ID);
    const saved = await entities.createEntity(
      ed,
      businessRequest(f.actor),
      entityCreate.parse({
        ...schema,
        properties: { prop_1: "짧은 자동 식별자" },
      }),
    );
    assert(/^\d{8}-[A-Z0-9]{8}$/.test(decodeIdentifierReference(saved.id).raw));
    assertEquals(
      saved.id,
      encodeIdentifierReference(schema.entity_type_id, APP_IDENTIFIER_RULE_ID, decodeIdentifierReference(saved.id).raw),
    );
  } finally {
    await f.cleanup();
  }
});

dbTest(
  "발급처 소프트 삭제는 새 식별만 막고 기존 값·관계를 보존하며 중지 상태에서도 같은 엔터티를 되살린다",
  async () => {
    const f = await identityWorkspaceFixture();
    try {
      let schema = f.schema;
      const setup = await directEntitySource(sql, f.manager, schema.entity_type_id);
      schema = setup.schema;
      const entity = await entities.createEntity(
        ed,
        businessRequest(f.actor),
        entityCreate.parse({
          ...schema,
          properties: { prop_2: encodeIdentifierValue(setup.rule.id, "보존"), prop_1: "발급처 보존" },
        }),
      );
      const task = await activity.createTask(
        ad,
        businessRequest(f.actor),
        taskCreate.parse({ kind: "once", title: "연결", entity_ids: [entity.id] }),
      );
      schema = (await configureIdentifierField(sql, f.manager, schema.entity_type_id, {
        allowed_kind_ids: [APP_IDENTIFIER_RULE_ID, setup.rule.id],
        default_kind_id: APP_IDENTIFIER_RULE_ID,
      })).schema;
      await registry.updateEntityIssuer(setup.deps, businessRequest(f.manager), "crm", {
        expected_version: setup.issuer.version,
        active: false,
      });
      assertEquals((await activity.getTask(ad, f.actor, task.id)).entity_ids, [entity.id]);
      await assertRejects(
        () =>
          entities.createEntity(
            ed,
            businessRequest(f.actor),
            entityCreate.parse({
              ...schema,
              properties: { prop_2: encodeIdentifierValue(setup.rule.id, "새 ID"), prop_1: "금지" },
            }),
          ),
        AppError,
      );
      await assertRejects(
        () =>
          entities.updateEntity(
            ed,
            businessRequest(f.actor),
            entity.id,
            updateInput({
              schema_version: schema.schema_version,
              properties: { prop_2: encodeIdentifierValue(setup.rule.id, "변경 ID") },
              expected_version: 1,
            }),
          ),
        AppError,
      );
      const edited = await entities.updateEntity(
        ed,
        businessRequest(f.actor),
        entity.id,
        updateInput({
          schema_version: schema.schema_version,
          expected_version: 1,
          properties: { prop_1: "기존 값 편집 가능" },
        }),
      );
      await entities.deleteEntity(ed, businessRequest(f.actor), entity.id, edited.version);
      const restore = () =>
        entities.restoreEntity(ed, businessRequest(f.actor), entity.id, {
          schema_version: schema.schema_version,
          expected_version: 3,
        });
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
  "namespaced identity isolates workspaces, preserves exact IDs, restores retained links, and rejects identity edits atomically",
  async () => {
    const f = await identityWorkspaceFixture(), other = await identityWorkspaceFixture();
    try {
      const setup = await directEntitySource(sql, f.manager, f.schema.entity_type_id);
      const foreignSetup = await directEntitySource(sql, other.manager, other.schema.entity_type_id);
      const schema = setup.schema, foreignSchema = foreignSetup.schema;
      const input = entityCreate.parse({
        ...schema,
        properties: {
          prop_2: encodeIdentifierValue(setup.rule.id, "000Ab:/한글%"),
          prop_1: "보관 고객",
          prop_3: 0,
          prop_5: "c",
        },
      });
      const created = await entities.createEntity(ed, businessRequest(f.actor), input),
        foreign = await entities.createEntity(ed, businessRequest(other.actor), {
          ...input,
          ...foreignSchema,
          properties: { ...input.properties, prop_2: encodeIdentifierValue(foreignSetup.rule.id, "000Ab:/한글%") },
        });
      assertEquals(created.id, encodeIdentifierReference(schema.entity_type_id, setup.rule.id, "000Ab:/한글%"));
      assertEquals(decodeIdentifierReference(foreign.id).raw, decodeIdentifierReference(created.id).raw);
      await assertRejects(() => entities.getEntity(ed, other.actor, created.id), AppError);
      const task = await activity.createTask(
        ad,
        businessRequest(f.actor),
        taskCreate.parse({ kind: "once", title: "연결 유지", entity_ids: [created.id] }),
      );
      const noteTask = await activity.createTask(
        ad,
        businessRequest(f.actor),
        taskCreate.parse({ kind: "once", title: "본문 보존 수행" }),
      );
      const { record } = await activity.completeTask(ad, businessRequest(f.actor), noteTask.id, {
        expected_version: noteTask.version,
        body: "본문의 crm:000Ab:/한글% 는 그대로",
      });
      await entities.deleteEntity(ed, businessRequest(f.actor), created.id, created.version);
      const deleted = await entities.getEntity(ed, f.actor, created.id);
      assert(deleted.deleted_at);
      assertEquals(deleted.version, 2);
      assertEquals((await entities.listEntities(ed, f.actor, entityListQuery.parse({}))).items, []);
      assertEquals((await activity.getTask(ad, f.actor, task.id)).entity_ids, [created.id]);
      await assertRejects(() => entities.createEntity(ed, businessRequest(f.actor), input), AppError);
      await assertRejects(() =>
        activity.createTask(
          ad,
          businessRequest(f.actor),
          taskCreate.parse({
            kind: "once",
            title: "삭제된 자료에 신규 연결 거부",
            entity_ids: [created.id],
          }),
        ), AppError);
      const edited = await activity.updateTask(
        ad,
        businessRequest(f.actor),
        task.id,
        taskUpdate.parse({ expected_version: 1, title: "삭제 대상 연결 유지", entity_ids: [created.id] }),
      );
      const completed = await activity.completeTask(
        ad,
        businessRequest(f.actor),
        task.id,
        taskComplete.parse({ expected_version: edited.version, body: "보관된 자료를 참조한 수행 결과" }),
      );
      assertEquals([completed.record.entity_id, completed.record.task_id], [null, task.id]);
      const restore = () =>
        entities.restoreEntity(ed, businessRequest(f.actor), created.id, {
          schema_version: schema.schema_version,
          expected_version: 2,
          properties: { prop_4: "2026-10-09" },
        });
      const competing = await Promise.allSettled([restore(), restore()]);
      assertEquals(competing.filter((r) => r.status === "fulfilled").length, 1);
      const restored = (competing.find((r) =>
        r.status === "fulfilled"
      ) as PromiseFulfilledResult<Awaited<ReturnType<typeof restore>>>).value;
      assertEquals([
        restored.properties.prop_1,
        restored.properties.prop_3,
        restored.properties.prop_5,
        restored.version,
      ], ["보관 고객", 0, "c", 3]);
      await assertRejects(() =>
        entities.updateEntity(
          ed,
          businessRequest(f.actor),
          restored.id,
          updateInput({
            schema_version: schema.schema_version,
            expected_version: 1,
            properties: { prop_1: "삭제 전 요청" },
          }),
        ), AppError);
      const collision = await entities.createEntity(
        ed,
        businessRequest(f.actor),
        entityCreate.parse({
          ...schema,
          properties: { prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "000Ab:/한글%"), prop_1: "다른 발급처" },
        }),
      );
      await entities.deleteEntity(ed, businessRequest(f.actor), collision.id, 1);
      await assertRejects(() =>
        entities.updateEntity(
          ed,
          businessRequest(f.actor),
          restored.id,
          updateInput({
            schema_version: schema.schema_version,
            properties: {
              prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, decodeIdentifierReference(created.id).raw),
            },
            expected_version: 3,
          }),
        ), AppError);
      assertEquals((await activity.getRecord(ad, f.actor, record.id)).task_id, noteTask.id);
      await assertRejects(
        () =>
          entities.updateEntity(
            ed,
            businessRequest(f.actor),
            restored.id,
            updateInput({
              schema_version: schema.schema_version,
              properties: { prop_1: "실패한 속성 변경", prop_2: encodeIdentifierValue(setup.rule.id, "failed:/ID") },
              expected_version: 3,
              change_tag_ids: [crypto.randomUUID()],
            }),
          ),
        AppError,
      );
      assertEquals((await entities.getEntity(ed, f.actor, restored.id)).version, 3);
      assertEquals((await activity.getRecord(ad, f.actor, record.id)).task_id, noteTask.id);
      for (const field of ["source", "external_id", "entity_type_id"]) {
        await assertRejects(
          () =>
            entities.updateEntity(
              ed,
              businessRequest(f.actor),
              restored.id,
              updateInput({ schema_version: schema.schema_version, expected_version: 3, [field]: "replacement" }),
            ),
          AppError,
        );
      }
      const updated = await entities.updateEntity(
        ed,
        businessRequest(f.actor),
        restored.id,
        updateInput({
          schema_version: schema.schema_version,
          expected_version: 3,
          properties: { prop_1: "속성 변경" },
        }),
      );
      assertEquals(updated.id, restored.id);
      const readRecord = await activity.getRecord(ad, f.actor, record.id);
      assertEquals([readRecord.entity_id, readRecord.task_id], [null, noteTask.id]);
      assertEquals(readRecord.body, record.body);
      assertEquals((await activity.getTask(ad, f.actor, task.id)).entity_ids, [restored.id]);
      assertEquals((await entities.getEntity(ed, other.actor, foreign.id)).version, 1);
      const order = await createEntityType({ uow: new SqlEntityTypeUnitOfWork(sql) }, businessRequest(f.manager), {
        label: "주문",
      });
      const orderSetup = await directEntitySource(sql, f.manager, order.id);
      await f.grantKind(f.actor, order.id, "write");
      const sameNumber = await entities.createEntity(
        ed,
        businessRequest(f.actor),
        entityCreate.parse({
          entity_type_id: order.id.toUpperCase(),
          schema_version: orderSetup.schema.schema_version,
          properties: {
            prop_2: encodeIdentifierValue(orderSetup.rule.id, decodeIdentifierReference(created.id).raw),
            prop_1: "같은 번호 주문",
          },
        }),
      );
      assertEquals(sameNumber.id, encodeIdentifierReference(order.id, orderSetup.rule.id, "000Ab:/한글%"));
      assertEquals(
        new Set(
          (await entities.listEntities(
            ed,
            f.actor,
            entityListQuery.parse({
              filters: [{ key: "prop_2", operator: "eq", value: encodeIdentifierValue(setup.rule.id, "000Ab:/한글%") }],
            }),
          )).items.map((row) => row.id),
        ),
        new Set([restored.id, sameNumber.id]),
      );
      for (
        const [field, value] of [
          ["id", encodeIdentifierReference(schema.entity_type_id, setup.rule.id, "replacement")],
          ["properties", { ...updated.properties, prop_2: encodeIdentifierValue(setup.rule.id, "replacement") }],
          [
            "entity_type_id",
            order.id,
          ],
        ]
      ) {
        await runInWorkspace(sql, f.actor, {
          mode: "business",
          requirements: [{ target_kind: "entity_type", target_id: schema.entity_type_id, access: "write" }],
        }, async (tx) => {
          const failure = await assertRejects(() =>
            tx.savepoint(async (nested) => {
              const changed = await nested`update app.entities set ${nested(field)}=${
                typeof value === "object" ? nested.json(value) : value
              } where workspace_id=${f.workspaceId} and id=${restored.id} returning id`;
              assertEquals(changed.length, 1, "a zero-row write cannot prove the identity guard");
            })
          );
          assertEquals((failure as { code?: string }).code, "23514");
        });
      }
      assertEquals((await entities.getEntity(ed, f.actor, restored.id)).version, updated.version);
    } finally {
      await f.cleanup();
      await other.cleanup();
    }
  },
);
