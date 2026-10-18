import { requestActor } from "../_request.ts";
import { recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { assert, assertEquals, assertRejects } from "@std/assert";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate, taskListQuery } from "../../functions/_shared/contracts/task.ts";
import * as entity from "../../functions/_shared/core/entity/application.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";

const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 3, prepare: false });
const ed = { uow: new SqlEntityUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };

dbTest(
  "selected task targets are returned by both related lists and entity filters; no targets remain optional",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    const definition = await f.createKind("연결 자료");
    await f.grant(f.member, [{
      target_kind: "tasks",
      target_id: "*",
      access: "write",
    }, {
      target_kind: "entity_type",
      target_id: definition.id,
      access: "write",
    }]);
    const actor = f.member;
    const schema = { entity_type_id: definition.id, schema_version: 1 };
    try {
      const first = await entity.createEntity(
        ed,
        requestActor(actor),
        entityCreate.parse({
          ...schema,
          source: "app",
          external_id: crypto.randomUUID(),
          properties: { prop_1: "공동 대상 1" },
        }),
      );
      const second = await entity.createEntity(
        ed,
        requestActor(actor),
        entityCreate.parse({
          ...schema,
          source: "app",
          external_id: crypto.randomUUID(),
          properties: { prop_1: "공동 대상 2" },
        }),
      );
      const ids = [first.id, second.id].sort();
      const task = await activity.createTask(
        ad,
        requestActor(actor),
        taskCreate.parse({
          ...{ kind: "once", title: "공동 업무", entity_ids: ids },
        }),
      );
      const unlinked = await activity.createTask(
        ad,
        requestActor(actor),
        taskCreate.parse({ ...{ kind: "once", title: "개인 업무" } }),
      );
      assertEquals(
        (await activity.getTask(ad, actor, task.id)).entity_ids,
        ids,
      );
      assertEquals(unlinked.entity_ids, []);
      for (const id of ids) {
        assertEquals(
          (await activity.listTasks(
            ad,
            actor,
            taskListQuery.parse({ entity_id: id }),
          )).items.map((row) => row.id),
          [task.id],
        );
        assertEquals(
          (await entity.getEntity(ed, actor, id)).tasks.items.map((row) => row.id),
          [task.id],
        );
      }
      await assertRejects(() =>
        activity.createTask(
          ad,
          requestActor(actor),
          taskCreate.parse({
            ...{
              kind: "once",
              title: "없는 대상",
              entity_ids: [
                `app:00000000-0000-4000-8000-000000000001:${crypto.randomUUID()}`,
              ],
            },
          }),
        )
      );
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "soft target deletion preserves task captures and immutable result parents",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    const definition = await f.createKind("연결 자료");
    await f.grant(f.member, [{
      target_kind: "tasks",
      target_id: "*",
      access: "write",
    }, {
      target_kind: "entity_type",
      target_id: definition.id,
      access: "write",
    }]);
    const actor = f.member;
    const schema = { entity_type_id: definition.id, schema_version: 1 };
    try {
      const first = await entity.createEntity(
        ed,
        requestActor(actor),
        entityCreate.parse({
          ...schema,
          source: "app",
          external_id: crypto.randomUUID(),
          properties: { prop_1: "삭제 전 첫 대상" },
        }),
      );
      const second = await entity.createEntity(
        ed,
        requestActor(actor),
        entityCreate.parse({
          ...schema,
          source: "app",
          external_id: crypto.randomUUID(),
          properties: { prop_1: "삭제 전 둘째 대상" },
        }),
      );
      const ids = [first.id, second.id].sort();
      const task = await activity.createTask(
        ad,
        requestActor(actor),
        taskCreate.parse({
          ...{ kind: "once", title: "남은 업무", entity_ids: ids },
        }),
      );
      const resultRoot = await activity.createTask(
        ad,
        requestActor(actor),
        taskCreate.parse({ kind: "once", title: "고정 수행 원본" }),
      );
      const record = (await activity.completeTask(ad, requestActor(actor), resultRoot.id, {
        expected_version: resultRoot.version,
        body: "당시 수행 결과",
      })).record;
      await entity.deleteEntity(ed, requestActor(actor), ids[1], 1);
      const remaining = await activity.getTask(ad, actor, task.id);
      assertEquals([remaining.entity_ids, remaining.entity_context], [
        ids,
        task.entity_context,
      ]);
      assertEquals(remaining.version, task.version);
      await entity.deleteEntity(ed, requestActor(actor), ids[0], 1);
      const detached = await activity.getTask(ad, actor, task.id);
      assertEquals(detached.entity_ids, ids);
      assertEquals(detached.entity_context, task.entity_context);
      assertEquals(detached.version, task.version);
      assertEquals(
        (await activity.listTasks(
          ad,
          actor,
          taskListQuery.parse({ entity_id: ids[0] }),
        )).items.map((t) => t.id),
        [task.id],
      );
      const read = await activity.getRecord(ad, actor, record.id);
      assertEquals([read.task_id, read.entity_id], [resultRoot.id, null]);
      assertEquals("entity_context" in read, false);
      const edited = await activity.updateRecord(
        ad,
        requestActor(actor),
        record.id,
        recordUpdate.parse({
          expected_version: read.version,
          body: "삭제 후에도 메모 편집",
        }),
      );
      assertEquals([edited.task_id, edited.entity_id], [resultRoot.id, null]);
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "record memo correction cannot move its immutable task parent and rolls back on downstream failure",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      await f.grant(f.member, [{
        target_kind: "tasks",
        target_id: "*",
        access: "write",
      }]);
      const root = await activity.createTask(
        ad,
        requestActor(f.member),
        taskCreate.parse({ kind: "once", title: "결과 원본" }),
      );
      const record = (await activity.completeTask(ad, requestActor(f.member), root.id, {
        expected_version: root.version,
        body: "고정 소속 결과",
      })).record;
      for (
        const invalid of [{ entity_ids: [] }, { task_id: root.id }, {
          entity_id: null,
        }]
      ) {
        await assertRejects(async () =>
          await activity.updateRecord(
            ad,
            requestActor(f.member),
            record.id,
            recordUpdate.parse({
              expected_version: record.version,
              body: "이동 우회",
              ...invalid,
            }),
          )
        );
        assertEquals(await activity.getRecord(ad, f.member, record.id), record);
      }
      const broken: activity.ActivityDeps = {
        ...ad,
        uow: {
          run: (actor, fn, entry) =>
            ad.uow.run(actor, (store) =>
              fn(
                new Proxy(store, {
                  get(target, key) {
                    if (key === "updateRecord") {
                      return async (
                        ...args: Parameters<typeof target.updateRecord>
                      ) => {
                        await target.updateRecord(...args);
                        throw Error("record update failure");
                      };
                    }
                    const value = Reflect.get(target, key, target);
                    return typeof value === "function" ? value.bind(target) : value;
                  },
                }),
              ), entry),
        },
      };
      const patch = recordUpdate.parse({
        expected_version: record.version,
        body: "같은 결과 메모 정정",
      });
      await assertRejects(() => activity.updateRecord(broken, requestActor(f.member), record.id, patch));
      assertEquals(await activity.getRecord(ad, f.member, record.id), record);
      const corrected = await activity.updateRecord(
        ad,
        requestActor(f.member),
        record.id,
        patch,
      );
      assertEquals(
        [corrected.task_id, corrected.entity_id, corrected.version],
        [root.id, null, record.version + 1],
      );
      assertEquals(
        await activity.updateRecord(ad, requestActor(f.member), record.id, {
          expected_version: corrected.version,
          body: corrected.body,
        }),
        corrected,
      );
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "entity deletion history failure restores selections and versions; same-key retry preserves connections",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    const definition = await f.createKind("연결 자료");
    await f.grant(f.member, [{
      target_kind: "tasks",
      target_id: "*",
      access: "write",
    }, {
      target_kind: "entity_type",
      target_id: definition.id,
      access: "write",
    }]);
    const actor = f.member;
    const schema = { entity_type_id: definition.id, schema_version: 1 };
    try {
      const target = await entity.createEntity(
        ed,
        requestActor(actor),
        entityCreate.parse({
          ...schema,
          source: "app",
          external_id: crypto.randomUUID(),
          properties: { prop_1: "당시 대상" },
        }),
      );
      const task = await activity.createTask(
        ad,
        requestActor(actor),
        taskCreate.parse({
          ...{ kind: "once", title: "연결된 업무", entity_ids: [target.id] },
        }),
      );
      const resultRoot = await activity.createTask(
        ad,
        requestActor(actor),
        taskCreate.parse({ kind: "once", title: "보존할 결과 원본" }),
      );
      const record = (await activity.completeTask(ad, requestActor(actor), resultRoot.id, {
        expected_version: resultRoot.version,
        body: "과거 수행 결과",
      })).record;
      const before = await entity.getEntity(ed, actor, target.id);
      const taskBefore = await activity.getTask(ad, actor, task.id);
      const recordBefore = await activity.getRecord(ad, actor, record.id);
      const broken: entity.EntityDeps = {
        uow: {
          run: (actor, fn, entry) =>
            ed.uow.run(actor, (s) =>
              fn(
                new Proxy(s, {
                  get: (target, key) =>
                    key === "appendChange"
                      ? () => Promise.reject(Error("deletion history failure"))
                      : typeof Reflect.get(target, key) === "function"
                      ? Reflect.get(target, key).bind(target)
                      : Reflect.get(target, key),
                }),
              ), entry),
        },
      };
      await assertRejects(() =>
        entity.deleteEntity(
          broken,
          requestActor(actor),
          target.id,
          target.version,
          undefined,
        )
      );
      assertEquals(await entity.getEntity(ed, actor, target.id), before);
      assertEquals(await activity.getTask(ad, actor, task.id), taskBefore);
      assertEquals(
        await activity.getRecord(ad, actor, record.id),
        recordBefore,
      );

      await entity.deleteEntity(
        ed,
        requestActor(actor),
        target.id,
        target.version,
        undefined,
      );
      await assertRejects(() => entity.deleteEntity(ed, requestActor(actor), target.id, target.version));
      const detached = await activity.getTask(ad, actor, task.id);
      const historical = await activity.getRecord(ad, actor, record.id);
      assertEquals([
        detached.entity_ids,
        detached.entity_context,
        detached.version,
      ], [
        [target.id],
        task.entity_context,
        1,
      ]);
      assertEquals([
        historical.task_id,
        historical.entity_id,
        historical.body,
        historical.version,
      ], [resultRoot.id, null, record.body, record.version]);
      assert((await entity.getEntity(ed, actor, target.id)).deleted_at);
    } finally {
      await f.cleanup();
    }
  },
);
