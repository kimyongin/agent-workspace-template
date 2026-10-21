import { requestActor } from "../_request.ts";
import { assertEquals, assertRejects } from "@std/assert";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { tagCreate } from "../../functions/_shared/contracts/tag.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import * as t from "../../functions/_shared/core/tags/application.ts";
import * as e from "../../functions/_shared/core/entity/application.ts";
import * as a from "../../functions/_shared/core/activity/application.ts";
import { connect, dbTest, urls } from "./_db.ts";
import { businessWorkspaceFixture } from "./_workspace-business.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.pooler, { max: 3, prepare: false });
const td = { uow: new SqlTagUnitOfWork(sql) },
  ed = { uow: new SqlEntityUnitOfWork(sql) },
  ad = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
dbTest(
  "tag delete atomically records each changed parent once, preserves event facts, retries, and suppresses automatic-record recursion",
  async () => {
    const workspace = await businessWorkspaceFixture(admin, sql);
    const f = { ...workspace, actor: workspace.member };
    await f.grant(f.actor, [{
      target_kind: "tasks",
      target_id: "*",
      access: "write",
    }]);
    try {
      const definition = await f.createKind("분류 대상");
      await f.grantKind(f.actor, definition.id, "write");
      const schema = { entity_type_id: definition.id, schema_version: 1 };
      const actor = { ...f.actor, source: "mcp" as const };
      const tag = await t.createTag(
        td,
        requestActor(actor),
        tagCreate.parse({ ...{ scope: "record", name: "活動分類" } }),
      );
      const entityTag = await t.createTag(
        td,
        requestActor(actor),
        tagCreate.parse({ ...{ scope: "entity", name: "対象分類" } }),
      );
      const entity = await e.createEntity(
        ed,
        requestActor(actor),
        entityCreate.parse({
          ...schema,
          properties: { prop_1: "対象" },
        }),
      );
      const taskTag = await t.createTag(
        td,
        requestActor(actor),
        tagCreate.parse({ name: "計画分類", scope: "task" }),
      );
      const task = await a.createTask(
        ad,
        requestActor(actor),
        taskCreate.parse({
          ...{ kind: "once", title: "計画", change_tag_ids: [tag.id] },
        }),
      );
      await t.setTagConnections(td, requestActor(actor), {
        target_kind: "entity",
        target_id: entity.id,
        expected_version: entity.version,
        tag_ids: [entityTag.id],
      });
      const classified = await t.setTagConnections(td, requestActor(actor), {
        target_kind: "task",
        target_id: task.id,
        expected_version: task.version,
        tag_ids: [taskTag.id],
      });
      const record = (await a.completeTask(ad, requestActor(actor), task.id, {
        expected_version: classified.version,
        body: "観察",
      })).record;
      await t.setTagConnections(td, requestActor(actor), {
        target_kind: "record",
        target_id: record.id,
        expected_version: record.version,
        tag_ids: [tag.id],
      });
      const [automatic] =
        await admin`select id from app.records where workspace_id=${f.workspaceId} and record_kind='change' and task_id=${task.id} and change_metadata->>'action'='create' order by id limit 1`;
      const count = async () =>
        (await admin`select count(*)::int n from app.records where workspace_id=${f.workspaceId} and record_kind='change'`)[
          0
        ].n;
      assertEquals(await count(), 4);
      await t.deleteTag(
        td,
        requestActor(actor),
        taskTag.id,
        taskTag.version,
        "計画分類の削除",
      );
      await assertRejects(() =>
        t.deleteTag(
          td,
          requestActor(actor),
          taskTag.id,
          taskTag.version,
          "計画分類の削除",
        )
      );
      assertEquals(await count(), 5);
      assertEquals((await a.getTask(ad, actor, task.id)).tag_ids, []);
      assertEquals((await a.getRecord(ad, actor, record.id)).tag_ids, [tag.id]);
      await t.deleteTag(td, requestActor(actor), tag.id, tag.version);
      assertEquals(await count(), 5);
      assertEquals((await a.getRecord(ad, actor, automatic.id)).tag_ids, []);
      const changes =
        await admin`select change_metadata from app.records where workspace_id=${f.workspaceId} and change_metadata->>'action'='update' and body='計画分類の削除' order by id`;
      assertEquals(changes.length, 1);
      for (const change of changes) {
        assertEquals([
          change.change_metadata.before,
          change.change_metadata.after,
        ], [null, null]);
        assertEquals(change.change_metadata.source, "mcp");
      }
      await t.deleteTag(
        td,
        requestActor(actor),
        entityTag.id,
        entityTag.version,
        "対象分類の削除",
      );
      assertEquals(await count(), 6);
      assertEquals((await e.getEntity(ed, actor, entity.id)).tag_ids, []);
      const [entityChange] =
        await admin`select change_metadata,body from app.records where workspace_id=${f.workspaceId} and change_metadata->>'target_id'=${entity.id} and change_metadata->>'action'='update' and body='対象分類の削除' order by id desc limit 1`;
      assertEquals([
        entityChange.change_metadata.before,
        entityChange.change_metadata.after,
      ], [null, null]);
      assertEquals(entityChange.change_metadata.target_title, "対象");
      assertEquals(entityChange.body, "対象分類の削除");
    } finally {
      await f.cleanup();
    }
  },
);
dbTest(
  "tag unlink required-history failure rolls back all parent versions/links/tag/queue/request, then same-key retry once",
  async () => {
    const workspace = await businessWorkspaceFixture(admin, sql);
    const f = { ...workspace, actor: workspace.member };
    await f.grant(f.actor, [{
      target_kind: "tasks",
      target_id: "*",
      access: "write",
    }]);
    try {
      const actor = f.actor,
        tag = await t.createTag(
          td,
          requestActor(actor),
          tagCreate.parse({ ...{ name: "分類" } }),
        );
      const taskTag = await t.createTag(
        td,
        requestActor(actor),
        tagCreate.parse({ name: "計画分類", scope: "task" }),
      );
      const task = await a.createTask(
        ad,
        requestActor(actor),
        taskCreate.parse({
          ...{ kind: "once", title: "計画" },
        }),
      );
      const classified = await t.setTagConnections(td, requestActor(actor), {
        target_kind: "task",
        target_id: task.id,
        expected_version: task.version,
        tag_ids: [taskTag.id],
      });
      const record = (await a.completeTask(ad, requestActor(actor), task.id, {
        expected_version: classified.version,
        body: "観察",
      })).record;
      await t.setTagConnections(td, requestActor(actor), {
        target_kind: "record",
        target_id: record.id,
        expected_version: record.version,
        tag_ids: [tag.id],
      });
      const beforeTask = await a.getTask(ad, actor, task.id),
        beforeRecord = await a.getRecord(ad, actor, record.id);
      const queue =
        await admin`select message from pgmq.q_search_index where message->>'workspace_id'=${f.workspaceId} order by msg_id`;
      let n = 0;
      const bad: t.TagDeps = {
        uow: {
          run: (actor, fn, entry) =>
            td.uow.run(
              actor,
              (s) =>
                fn(
                  new Proxy(s, {
                    get: (target, key) =>
                      key === "appendChange"
                        ? async (
                          input: Parameters<typeof s.appendChange>[0],
                        ) => {
                          if (++n === 1) {
                            throw Error("required business history failed");
                          }
                          return await s.appendChange(input);
                        }
                        : typeof Reflect.get(target, key) === "function"
                        ? Reflect.get(target, key).bind(target)
                        : Reflect.get(target, key),
                  }),
                ),
              entry,
            ),
        },
      };
      await assertRejects(() =>
        t.deleteTag(
          bad,
          requestActor(actor),
          taskTag.id,
          taskTag.version,
          "計画分類の削除",
        )
      );
      assertEquals(await a.getTask(ad, actor, task.id), beforeTask);
      assertEquals(await a.getRecord(ad, actor, record.id), beforeRecord);
      assertEquals(
        (await admin`select id from app.tags where id=${tag.id}`).length,
        1,
      );
      assertEquals(
        await admin`select message from pgmq.q_search_index where message->>'workspace_id'=${f.workspaceId} order by msg_id`,
        queue,
      );
      await t.deleteTag(
        td,
        requestActor(actor),
        taskTag.id,
        taskTag.version,
        "計画分類の削除",
      );
      await assertRejects(() =>
        t.deleteTag(
          td,
          requestActor(actor),
          taskTag.id,
          taskTag.version,
          "計画分類の削除",
        )
      );
      assertEquals(
        (await admin`select count(*)::int n from app.records where workspace_id=${f.workspaceId}`)[
          0
        ].n,
        4,
      );
    } finally {
      await f.cleanup();
    }
  },
);
