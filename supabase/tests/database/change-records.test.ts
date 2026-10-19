import { requestActor } from "../_request.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { entityCreate, entityUpdate } from "../../functions/_shared/contracts/entity.ts";
import { taskComplete, taskCreate, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { recordListQuery, recordResult, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import * as e from "../../functions/_shared/core/entity/application.ts";
import * as a from "../../functions/_shared/core/activity/application.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
import * as tags from "../../functions/_shared/core/tags/application.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 3, prepare: false }),
  ed = { uow: new SqlEntityUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest(
  "no-op recurring rule object order and tag set order preserve version/index/history",
  async () => {
    const workspace = await businessWorkspaceFixture(admin, sql);
    const f = { ...workspace, actor: workspace.member };
    await f.grant(f.actor, [{
      target_kind: "tasks",
      target_id: "*",
      access: "write",
    }]);
    try {
      const tagDeps = { uow: new SqlTagUnitOfWork(sql) };
      const dictionary = await Promise.all(
        ["one", "two"].map((name) =>
          tags.createTag(tagDeps, requestActor(f.actor), {
            name,
            scope: "task",
          })
        ),
      );
      const tag_ids = dictionary.map((t) => t.id as string),
        recurrence = { freq: "daily", starts_on: "2020-01-01" };
      const task = await a.createTask(
        ad,
        requestActor(f.actor),
        taskCreate.parse({
          ...{
            kind: "recurring",
            title: "동일 규칙",
            recurrence,
            timezone: "Asia/Seoul",
          },
        }),
      );
      const linked = await tags.setTagConnections(
        tagDeps,
        requestActor(f.actor),
        {
          target_kind: "task",
          target_id: task.id,
          expected_version: task.version,
          tag_ids,
        },
      );
      const before =
        await admin`select id,version,updated_at from app.tasks where workspace_id=${f.workspaceId} and id=${task.id}`;
      const queue =
        await admin`select message from pgmq.q_search_index where message->>'workspace_id'=${f.workspaceId} order by msg_id`;
      const same = await a.updateTask(
        ad,
        requestActor(f.actor),
        task.id,
        taskUpdate.parse({
          expected_version: linked.version,
          change_note: "변경 없음",
          recurrence: { starts_on: "2020-01-01", freq: "daily" },
        }),
      );
      assertEquals(same.version, linked.version);
      assertEquals(
        await tags.setTagConnections(tagDeps, requestActor(f.actor), {
          target_kind: "task",
          target_id: task.id,
          expected_version: linked.version,
          tag_ids: [...tag_ids].reverse(),
        }),
        linked,
      );
      assertEquals(
        await admin`select id,version,updated_at from app.tasks where workspace_id=${f.workspaceId} and id=${task.id}`,
        before,
      );
      assertEquals(
        await admin`select message from pgmq.q_search_index where message->>'workspace_id'=${f.workspaceId} order by msg_id`,
        queue,
      );
      assertEquals(
        (await admin`select count(*)::int n from app.records where workspace_id=${f.workspaceId}`)[
          0
        ].n,
        2,
      );
    } finally {
      await f.cleanup();
    }
  },
);
dbTest(
  "business mutations have one change record; record memo edits preserve facts without another event",
  async () => {
    const workspace = await businessWorkspaceFixture(admin, sql);
    const f = { ...workspace, actor: workspace.member };
    await f.grant(f.actor, [{
      target_kind: "tasks",
      target_id: "*",
      access: "write",
    }]);
    try {
      const kind = await f.createKind("자동 기록 원본");
      await f.grantKind(f.actor, kind.id, "write");
      const schema = { entity_type_id: kind.id, schema_version: 1 };
      const A = { ...f.actor, source: "mcp" as const };
      const entity = await e.createEntity(
        ed,
        requestActor(A),
        entityCreate.parse({
          ...schema,
          source: "app",
          external_id: crypto.randomUUID(),
          properties: { prop_1: "대상" },
        }),
      );
      const count = async () =>
        Number(
          (await admin`select count(*)::int n from app.records where workspace_id=${f.workspaceId} and record_kind='change'`)[
            0
          ]
            .n,
        );
      assertEquals(await count(), 1);
      await e.getEntity(ed, A, entity.id);
      await e.updateEntity(
        ed,
        requestActor(A),
        entity.id,
        entityUpdate.parse({
          schema_version: schema.schema_version,
          expected_version: entity.version,
          properties: { prop_1: "대상" },
          change_note: "같은 값",
        }),
      );
      assertEquals(await count(), 1);
      const i = entityUpdate.parse({
        schema_version: schema.schema_version,
        expected_version: entity.version,
        properties: { prop_1: "변경된 대상" },
        change_note: "실측",
      });
      const updated = await e.updateEntity(ed, requestActor(A), entity.id, i);
      await assertRejects(() => e.updateEntity(ed, requestActor(A), entity.id, i));
      assertEquals(await count(), 2);
      const rows = await a.listRecords(
        ad,
        A,
        recordListQuery.parse({ record_kind: "change" }),
      );
      rows.items.forEach((r) => recordResult.parse(r));
      const event = rows.items.find((r) => r.change?.action === "update")!;
      assertEquals(event.body, "실측");
      assertEquals([event.change!.before, event.change!.after], [null, null]);
      assertEquals(event.change!.source, "mcp");
      assertEquals(
        event.change!.path,
        `/entities/${encodeURIComponent(entity.id)}`,
      );
      const immutable = {
        expected_version: event.version,
        body: "설명",
        change_note: "설명 정정",
        change: { target_id: crypto.randomUUID() },
      };
      assertEquals(recordUpdate.safeParse(immutable).success, false);
      const corrected = await a.updateRecord(
        ad,
        requestActor(A),
        event.id,
        recordUpdate.parse({
          expected_version: event.version,
          body: "설명 정정",
        }),
      );
      assertEquals(corrected.change, event.change);
      assertEquals(corrected.body, "설명 정정");
      assertEquals(await count(), 2);
      await a.deleteRecord(
        ad,
        requestActor(A),
        corrected.id,
        corrected.version,
      );
      assertEquals(
        (await e.getEntity(ed, A, entity.id)).properties.prop_1,
        "변경된 대상",
      );
      assertEquals(await count(), 1);
      const task = await a.createTask(
        ad,
        requestActor(A),
        taskCreate.parse({
          ...{ kind: "once", title: "행동", entity_ids: [entity.id] },
        }),
      );
      assertEquals(await count(), 2);
      const taskUpdated = await a.updateTask(
        ad,
        requestActor(A),
        task.id,
        taskUpdate.parse({
          expected_version: task.version,
          title: "새 행동",
          change_note: "계획 수정",
        }),
      );
      assertEquals(await count(), 3);
      const completion = await a.completeTask(
        ad,
        requestActor(A),
        task.id,
        taskComplete.parse({
          expected_version: taskUpdated.version,
          body: "실제 결과",
        }),
      );
      assertEquals(completion.record.record_kind, "result");
      assertEquals(await count(), 3);
      await a.deleteTask(ad, requestActor(A), task.id, completion.task.version);
      assertEquals(await count(), 4);
      assertEquals(
        (await a.getRecord(ad, A, completion.record.id)).task_id,
        task.id,
      );
      const record = completion.record;
      assertEquals(await count(), 4);
      const recordUpdated = await a.updateRecord(
        ad,
        requestActor(A),
        record.id,
        recordUpdate.parse({
          expected_version: record.version,
          body: "정정 본문",
        }),
      );
      assertEquals(await count(), 4);
      await a.deleteRecord(
        ad,
        requestActor(A),
        record.id,
        recordUpdated.version,
      );
      assertEquals(await count(), 4);
      await e.deleteEntity(
        ed,
        requestActor(A),
        entity.id,
        updated.version,
        "불필요",
      );
      assertEquals(await count(), 5);
      const deleted = (await a.listRecords(
        ad,
        A,
        recordListQuery.parse({ record_kind: "change" }),
      )).items.find((r) => r.change?.target_kind === "entity" && r.change.action === "delete")!;
      assertEquals(deleted.change!.path, null);
      assertEquals([deleted.change!.before, deleted.change!.after], [
        null,
        null,
      ]);
      assertEquals(deleted.change!.target_title, "변경된 대상");
      assert(JSON.stringify(deleted.change).includes("대상"));
    } finally {
      await f.cleanup();
    }
  },
);
dbTest(
  "business history or record index failure rolls back content/version/request; record retry adds no event",
  async () => {
    const workspace = await businessWorkspaceFixture(admin, sql);
    const f = { ...workspace, actor: workspace.member };
    await f.grant(f.actor, [{
      target_kind: "tasks",
      target_id: "*",
      access: "write",
    }]);
    try {
      const kind = await f.createKind("자동 기록 원본");
      await f.grantKind(f.actor, kind.id, "write");
      const schema = { entity_type_id: kind.id, schema_version: 1 };
      const A = f.actor,
        entity = await e.createEntity(
          ed,
          requestActor(A),
          entityCreate.parse({
            ...schema,
            source: "app",
            external_id: crypto.randomUUID(),
            properties: { prop_1: "대상" },
          }),
        ),
        task = await a.createTask(
          ad,
          requestActor(A),
          taskCreate.parse({ ...{ kind: "once", title: "행동" } }),
        ),
        resultRoot = await a.createTask(
          ad,
          requestActor(A),
          taskCreate.parse({ kind: "once", title: "별도 수행 원본" }),
        ),
        record = (await a.completeTask(ad, requestActor(A), resultRoot.id, {
          expected_version: resultRoot.version,
          body: "기록",
        })).record;
      const broken = <S>(store: S) =>
        new Proxy(store as object, {
          get: (target, key) =>
            key === "appendChange"
              ? () => Promise.reject(Error("required history failure"))
              : typeof Reflect.get(target, key) === "function"
              ? Reflect.get(target, key).bind(target)
              : Reflect.get(target, key),
        }) as S;
      const badE = {
        uow: {
          run: <T>(
            actor: typeof A,
            fn: Parameters<typeof ed.uow.run<T>>[1],
            entry?: Parameters<typeof ed.uow.run<T>>[2],
          ) => ed.uow.run(actor, (s) => fn(broken(s)), entry),
        },
      };
      const badA = {
        ...ad,
        uow: {
          run: <T>(
            actor: typeof A,
            fn: Parameters<typeof ad.uow.run<T>>[1],
            entry?: Parameters<typeof ad.uow.run<T>>[2],
          ) => ad.uow.run(actor, (s) => fn(broken(s)), entry),
        },
      };
      const badRecord = {
        ...ad,
        uow: {
          run: <T>(
            actor: typeof A,
            fn: Parameters<typeof ad.uow.run<T>>[1],
            entry?: Parameters<typeof ad.uow.run<T>>[2],
          ) =>
            ad.uow.run(actor, (s) =>
              fn(
                new Proxy(s, {
                  get: (target, key) =>
                    key === "enqueueIndex"
                      ? () => Promise.reject(Error("index queue failure"))
                      : typeof Reflect.get(target, key) === "function"
                      ? Reflect.get(target, key).bind(target)
                      : Reflect.get(target, key),
                }),
              ), entry),
        },
      };
      const ei = entityUpdate.parse({
          schema_version: schema.schema_version,
          expected_version: 1,
          properties: { prop_1: "새 이름" },
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
      await assertRejects(() => e.updateEntity(badE, requestActor(A), entity.id, ei));
      await assertRejects(() => a.updateTask(badA, requestActor(A), task.id, ti));
      await assertRejects(() => a.updateRecord(badRecord, requestActor(A), record.id, ri));
      assertEquals((await e.getEntity(ed, A, entity.id)).version, 1);
      assertEquals((await a.getTask(ad, A, task.id)).title, task.title);
      assertEquals((await a.getRecord(ad, A, record.id)).body, record.body);
      assertEquals(
        (await admin`select id from app.records where workspace_id=${f.workspaceId} and record_kind='change'`)
          .length,
        3,
      );
      await e.updateEntity(ed, requestActor(A), entity.id, ei);
      await a.updateTask(ad, requestActor(A), task.id, ti);
      await a.updateRecord(ad, requestActor(A), record.id, ri);
      assertEquals(
        (await admin`select id from app.records where workspace_id=${f.workspaceId} and record_kind='change'`)
          .length,
        5,
      );
    } finally {
      await f.cleanup();
    }
  },
);
