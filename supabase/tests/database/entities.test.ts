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
import { entityCreate, entityListQuery, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { taskComplete, taskCreate, taskListQuery, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { recordListQuery } from "../../functions/_shared/contracts/record.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, outcome, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.pooler, { prepare: false, max: 3 });

// Publish the typed fixture through the current whole-model public boundary before any entities exist.
async function typedKind(f: Awaited<ReturnType<typeof businessWorkspaceFixture>>, manager = f.manager) {
  const kind = await f.createKind("검사 자료", manager);
  await f.grantKind(manager, kind.id, "write");
  const modelDeps = { uow: new SqlDataModelUnitOfWork(sql) };
  const document = await exportDataModel(modelDeps, manager);
  const type = document.entity_types.find((value) => value.schema["x-type-id"] === kind.id)!;
  Object.assign(type.schema.properties, {
    prop_2: { type: ["integer", "null"], title: "속성 2", minimum: 0, maximum: 1000000, default: null, "x-order": 20 },
    prop_3: { type: ["string", "null"], title: "속성 3", format: "date", default: null, "x-order": 30 },
    prop_4: {
      type: "string",
      title: "속성 4",
      oneOf: [{ const: "a" }, { const: "b" }, { const: "c" }],
      default: "a",
      "x-order": 40,
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

const fixture = await businessWorkspaceFixture(admin, sql);
const schema = await typedKind(fixture);
const otherWorkspace = await fixture.addWorkspace("다른 자료 공간");
const foreignSchema = await typedKind(fixture, otherWorkspace.manager);
await fixture.grant(fixture.member, [
  { target_kind: "tasks", target_id: "*", access: "write" },
  { target_kind: "entity_type", target_id: schema.entity_type_id, access: "write" },
]);
await fixture.grant(otherWorkspace.member, [{
  target_kind: "entity_type",
  target_id: foreignSchema.entity_type_id,
  access: "write",
}]);
const A = fixture.member, B = otherWorkspace.member;
const d = { uow: new SqlEntityUnitOfWork(sql) }, a = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
function create(name: string, actor = A, extra = {}) {
  const selected = actor.workspaceId === A.workspaceId
    ? schema
    : actor.workspaceId === B.workspaceId
    ? foreignSchema
    : null;
  if (!selected) throw new Error("entity fixture actor has no explicitly configured workspace schema");
  return entity.createEntity(
    d,
    businessRequest(actor),
    entityCreate.parse({
      ...selected,
      source: "app",
      external_id: crypto.randomUUID(),
      properties: { prop_1: name, ...extra },
    }),
  );
}

dbTest("Entity DB: cross-workspace 참조 거부·삭제 링크 보존·원문/버전/태그/색인 보존", async () => {
  const e = await create("링크 보존"), foreign = await create("외부", B);
  const task = await activity.createTask(
    a,
    businessRequest(A),
    taskCreate.parse({
      ...{ kind: "once", title: "행동", entity_ids: [e.id] },
    }),
  );
  for (const ref of [foreign.id, `app:00000000-0000-4000-8000-000000000001:${crypto.randomUUID()}`]) {
    const error = await assertRejects(
      () =>
        activity.updateTask(
          a,
          businessRequest(A),
          task.id,
          taskUpdate.parse({ expected_version: task.version, entity_ids: [ref] }),
        ),
      AppError,
    );
    assertEquals(error.code, "invalid_reference");
  }

  const completed = await activity.completeTask(
    a,
    businessRequest(A),
    task.id,
    taskComplete.parse({ expected_version: 1, body: "완료 결과" }),
  );
  assertEquals([completed.record.entity_id, completed.record.task_id], [null, task.id]);
  const detail = await entity.getEntity(d, A, e.id);
  assertEquals([detail.tasks.count, detail.records.count], [1, 1]);
  assertEquals((await activity.listTasks(a, A, taskListQuery.parse({ entity_id: e.id }))).items.map((t) => t.id), [
    task.id,
  ]);
  assertEquals((await activity.listRecords(a, A, recordListQuery.parse({ entity_id: e.id }))).items.length, 1);
  await entity.deleteEntity(d, businessRequest(A), e.id, 1);
  const detached = await activity.getTask(a, A, task.id);
  assertEquals(detached.entity_ids, [e.id]);
  assertEquals(detached.entity_context, task.entity_context);
  assertEquals(detached.version, completed.task.version);
  assertEquals((await activity.listTasks(a, A, taskListQuery.parse({ entity_id: e.id }))).items.map((t) => t.id), [
    task.id,
  ]);
  const current = await activity.getRecord(a, A, completed.record.id);
  assertEquals([current.body, current.entity_id, current.task_id, current.version], ["완료 결과", null, task.id, 1]);
  assertEquals(
    [...await admin`select state,reason,message_id from app.search_index_state where workspace_id=${A.workspaceId} and kind='entity' and id=${e.id}`],
    [{ state: "excluded", reason: "invalid_input", message_id: null }],
  );
  assertEquals(
    (await admin`select source_id from app.search_chunks where workspace_id=${A.workspaceId} and source_kind='entity' and source_id=${e.id}`)
      .length,
    0,
  );
  assertEquals(
    (await admin`select msg_id from pgmq.q_search_index where message->>'workspace_id'=${A.workspaceId} and message->>'kind'='entity' and message->>'id'=${e.id}`)
      .length,
    0,
  );
  await activity.deleteTask(a, businessRequest(A), task.id, completed.task.version);
  assertEquals((await activity.getRecord(a, A, completed.record.id)).task_id, task.id);
  await entity.deleteEntity(d, businessRequest(B), foreign.id, 1);
});
dbTest("Entity DB: RLS·직접 접근 차단·선택 검증·멱등성·버전 경쟁", async () => {
  const input = entityCreate.parse({
    ...schema,
    source: "app",
    external_id: crypto.randomUUID(),
    properties: { prop_1: "멱등" },
  });
  const results = await Promise.allSettled([
    entity.createEntity(d, businessRequest(A), input),
    entity.createEntity(d, businessRequest(A), input),
  ]);
  assertEquals(results.filter((r) => r.status === "fulfilled").length, 1);
  const e = (results.find((r) =>
    r.status === "fulfilled"
  ) as PromiseFulfilledResult<Awaited<ReturnType<typeof entity.createEntity>>>).value;
  assertEquals(
    (await runInWorkspace(sql, B, {
      mode: "business",
      requirements: [{ target_kind: "entity_type", target_id: foreignSchema.entity_type_id, access: "read" }],
    }, (tx) =>
      tx`select id from app.entities where id=${e.id}`)).length,
    0,
  );
  assertEquals((await assertRejects(() => entity.getEntity(d, B, e.id), AppError)).code, "not_found");
  assert((await outcome(admin.begin(async (tx) => {
    await tx`set local role authenticated`;
    return tx`select * from app.entities`;
  }))).startsWith("42501"));
  const writes = await Promise.allSettled(
    ["정정1", "정정2"].map((title) =>
      entity.updateEntity(
        d,
        businessRequest(A),
        e.id,
        entityUpdate.parse({
          schema_version: schema.schema_version,
          change_note: "테스트 변경 이유",
          expected_version: 1,
          properties: { prop_1: title },
        }),
      )
    ),
  );
  assertEquals(writes.filter((v) => v.status === "fulfilled").length, 1);
  await assertRejects(() => entity.deleteEntity(d, businessRequest(A), e.id, 1), AppError);
  await entity.deleteEntity(d, businessRequest(A), e.id, 2);
});
dbTest("Entity DB: representative cursors preserve Unicode and workspace/filter scope", async () => {
  const marker = crypto.randomUUID();
  const items = [await create(`${marker} 가`), await create(`${marker} 나`)];
  for (const sort of ["updated_at", "title"] as const) {
    const q = entityListQuery.parse({ entity_type_id: schema.entity_type_id, keyword: marker, sort, limit: 1 });
    const first = await entity.listEntities(d, A, q);
    const cursor = first.next_cursor!;
    const second = await entity.listEntities(d, A, { ...q, cursor });
    assertEquals(
      [...first.items, ...second.items].map((row) => row.id),
      sort === "title" ? items.map((row) => row.id) : items.map((row) => row.id).reverse(),
    );
    assertEquals(
      (await assertRejects(() => entity.listEntities(d, B, { ...q, cursor }), AppError)).code,
      "forbidden",
    );
    await assertRejects(() => entity.listEntities(d, A, { ...q, keyword: marker + "다", cursor }), AppError);
  }
  const crossWorkspaceQuery = entityListQuery.parse({ keyword: marker, limit: 1 });
  const scopedPage = await entity.listEntities(d, A, crossWorkspaceQuery);
  assertEquals(typeof scopedPage.next_cursor, "string");
  assertEquals(A.userId, B.userId);
  assertEquals(
    (await assertRejects(
      () => entity.listEntities(d, B, { ...crossWorkspaceQuery, cursor: scopedPage.next_cursor! }),
      AppError,
    )).code,
    "invalid_input",
  );
  for (const item of items) await entity.deleteEntity(d, businessRequest(A), item.id, item.version);
});
Deno.test({
  name: "Entity DB: typed numeric/date AND filters and property cursors",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const marker = crypto.randomUUID(), items = [];
    for (const [n, amount, date] of [["가", null, null], ["나", 0, "2024-02-29"], ["다", 2, "2025-01-01"]] as const) {
      items.push(await create(`${marker} ${n}`, A, { prop_2: amount, prop_3: date, prop_4: "b" }));
    }
    for (
      const sort of ["updated_at", { key: "prop_1", direction: "asc" }, { key: "prop_2", direction: "asc" }, {
        key: "prop_3",
        direction: "asc",
      }] as const
    ) {
      const q = entityListQuery.parse({ entity_type_id: schema.entity_type_id, keyword: marker, sort, limit: 1 });
      let page = await entity.listEntities(d, A, q);
      const ids = [page.items[0].id];
      const cursor = page.next_cursor!;
      while (page.next_cursor) {
        page = await entity.listEntities(d, A, { ...q, cursor: page.next_cursor });
        ids.push(...page.items.map((e) => e.id));
      }
      assertEquals(new Set(ids).size, 3);
      assertEquals(ids, sort === "updated_at" ? items.map((e) => e.id).reverse() : items.map((e) => e.id));
      assertEquals(
        (await assertRejects(() => entity.listEntities(d, B, { ...q, cursor }), AppError)).code,
        "forbidden",
      );
      await assertRejects(() =>
        entity.listEntities(
          d,
          A,
          entityListQuery.parse({ ...q, filters: [{ key: "prop_4", operator: "eq", value: "a" }], cursor }),
        ), AppError);
    }
    assertEquals(
      (await entity.listEntities(
        d,
        A,
        entityListQuery.parse({
          entity_type_id: schema.entity_type_id,
          keyword: marker,
          filters: [
            { key: "prop_3", operator: "gte", value: "2024-02-29" },
            { key: "prop_3", operator: "lte", value: "2024-02-29" },
            { key: "prop_4", operator: "eq", value: "b" },
          ],
        }),
      )).items.map((e) => e.id),
      [items[1].id],
    );
    const crossWorkspaceQuery = entityListQuery.parse({ keyword: marker, limit: 1 });
    const scopedPage = await entity.listEntities(d, A, crossWorkspaceQuery);
    assertEquals(typeof scopedPage.next_cursor, "string");
    assertEquals(
      (await assertRejects(
        () => entity.listEntities(d, B, { ...crossWorkspaceQuery, cursor: scopedPage.next_cursor! }),
        AppError,
      )).code,
      "invalid_input",
    );
    for (const e of items) await entity.deleteEntity(d, businessRequest(A), e.id, 1);
  },
});

dbTest("entity fixture cleanup owns only its explicit workspaces and accounts", async () => {
  await fixture.cleanup();
});
