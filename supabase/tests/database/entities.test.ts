import { requestActor } from "../_request.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { entityCreate, entityListQuery, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { taskComplete, taskCreate, taskListQuery, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { recordCreate, recordListQuery, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { asUser, connect, dbTest, devUsers, outcome, urls } from "./_db.ts";
import { entityFixture } from "./_entity.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { prepare: false, max: 3 }),
  users = await devUsers(admin);
const A = { userId: users.a },
  B = { userId: users.b },
  d = { uow: new SqlEntityUnitOfWork(sql) },
  a = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
const create = async (name: string, actor = A, extra = {}) =>
  entity.createEntity(
    d,
    requestActor(actor),
    entityCreate.parse({
      ...await entityFixture(admin, actor.userId),
      source: "app",
      external_id: crypto.randomUUID(),
      properties: { prop_1: name, ...extra },
    }),
  );
dbTest("Entity DB: same owner 참조 거부·삭제 링크 보존·원문/버전/태그/색인 보존", async () => {
  const e = await create("링크 보존"), foreign = await create("외부", B);
  const task = await activity.createTask(
    a,
    requestActor(A),
    taskCreate.parse({
      ...{ kind: "once", title: "행동", entity_ids: [e.id] },
    }),
  );
  const record = await activity.createRecord(
    a,
    requestActor(A),
    recordCreate.parse({
      ...{ body: "기록 원문", entity_ids: [e.id] },
    }),
  );
  for (const ref of [foreign.id, `app:${crypto.randomUUID()}`]) {
    for (
      const run of [
        () =>
          activity.updateTask(
            a,
            requestActor(A),
            task.id,
            taskUpdate.parse({ change_note: "테스트 변경 이유", expected_version: 1, entity_ids: [ref] }),
          ),
        () =>
          activity.updateRecord(
            a,
            requestActor(A),
            record.id,
            recordUpdate.parse({ expected_version: 1, entity_ids: [ref] }),
          ),
      ]
    ) {
      const error = await assertRejects(run, AppError);
      assertEquals(error.code, "invalid_reference");
    }
  }
  const completed = await activity.completeTask(
    a,
    requestActor(A),
    task.id,
    taskComplete.parse({ expected_version: 1, body: "완료 결과" }),
  );
  assertEquals(completed.record.entity_ids, [e.id]);
  const detail = await entity.getEntity(d, A, e.id);
  assertEquals([detail.tasks.count, detail.records.count], [1, 4]);
  assertEquals((await activity.listTasks(a, A, taskListQuery.parse({ entity_id: e.id }))).items.map((t) => t.id), [
    task.id,
  ]);
  assertEquals((await activity.listRecords(a, A, recordListQuery.parse({ entity_id: e.id }))).items.length, 4);
  await entity.deleteEntity(d, requestActor(A), e.id, 1);
  const detached = await activity.getTask(a, A, task.id);
  assertEquals(detached.entity_ids, [e.id]);
  assertEquals(detached.entity_context, task.entity_context);
  assertEquals(detached.version, completed.task.version);
  assertEquals((await activity.listTasks(a, A, taskListQuery.parse({ entity_id: e.id }))).items.map((t) => t.id), [
    task.id,
  ]);
  const current = await activity.getRecord(a, A, record.id);
  assertEquals([current.body, current.entity_ids, current.version], ["기록 원문", [e.id], 1]);
  assertEquals(
    (await admin`select count(*)::integer as n from app.search_index_state where id::text=${e.id}`)[0].n,
    0,
  );
  await admin`delete from app.tasks where id=${task.id}`;
  await admin`delete from app.records where id in (${record.id},${completed.record.id})`;
  await entity.deleteEntity(d, requestActor(B), foreign.id, 1);
});
dbTest("Entity DB: RLS·직접 접근 차단·선택 검증·멱등성·버전 경쟁", async () => {
  const schema = await entityFixture(admin, A.userId);
  const input = entityCreate.parse({
    ...schema,
    source: "app",
    external_id: crypto.randomUUID(),
    properties: { prop_1: "멱등" },
  });
  const results = await Promise.allSettled([
    entity.createEntity(d, requestActor(A), input),
    entity.createEntity(d, requestActor(A), input),
  ]);
  assertEquals(results.filter((r) => r.status === "fulfilled").length, 1);
  const e = (results.find((r) =>
    r.status === "fulfilled"
  ) as PromiseFulfilledResult<Awaited<ReturnType<typeof entity.createEntity>>>).value;
  assertEquals(
    (await asUser(sql, users.b, (tx) =>
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
        requestActor(A),
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
  await assertRejects(() => entity.deleteEntity(d, requestActor(A), e.id, 1), AppError);
  await entity.deleteEntity(d, requestActor(A), e.id, 2);
});
dbTest("Entity DB: representative cursors preserve Unicode and owner/filter scope", async () => {
  const marker = crypto.randomUUID(), schema = await entityFixture(admin, A.userId);
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
      "invalid_input",
    );
    await assertRejects(() => entity.listEntities(d, A, { ...q, keyword: marker + "다", cursor }), AppError);
  }
  for (const item of items) await entity.deleteEntity(d, requestActor(A), item.id, item.version);
});
Deno.test({
  name: "#350 pending: Entity DB typed numeric/date filters and property cursors",
  ignore: true,
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const marker = crypto.randomUUID(), items = [];
    const schema = await entityFixture(admin, A.userId);
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
        "invalid_input",
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
    for (const e of items) await entity.deleteEntity(d, requestActor(A), e.id, 1);
  },
});
