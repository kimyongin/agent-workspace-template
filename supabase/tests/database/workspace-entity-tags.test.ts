import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { assertEquals, assertRejects } from "@std/assert";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import * as tags from "../../functions/_shared/core/tags/application.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { SqlTagUnitOfWork } from "../../functions/_shared/adapters/supabase/tag-store.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }),
  sql = connect(urls.direct, { max: 5, prepare: false });
const entityDeps = { uow: new SqlEntityUnitOfWork(sql) },
  tagDeps = { uow: new SqlTagUnitOfWork(sql) };

dbTest(
  "workspace entity tag connections reject foreign scope and roll back late record tag failure",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      const kind = await f.createKind("분류 대상");
      await f.grantKind(f.manager, kind.id, "write");
      await f.grantKind(f.member, kind.id, "read");
      const entity = await entities.createEntity(
        entityDeps,
        businessRequest(f.manager),
        entityCreate.parse({
          entity_type_id: kind.id,
          schema_version: 1,
          properties: { prop_1: "분류가 바뀌어도 보존" },
        }),
      );
      const entityTag = await tags.createTag(
        tagDeps,
        businessRequest(f.manager),
        { scope: "entity", name: "자료 태그" },
      );
      const recordTag = await tags.createTag(
        tagDeps,
        businessRequest(f.manager),
        { scope: "record", name: "기록 전용" },
      );
      const other = await f.addWorkspace("다른 분류 공간");
      const foreignTag = await tags.createTag(
        tagDeps,
        businessRequest(other.manager),
        {
          scope: "entity",
          name: "자료 태그",
        },
      );
      const input = {
        target_kind: "entity",
        target_id: entity.id,
        expected_version: 1,
        tag_ids: [entityTag.id],
      };
      assertEquals(
        (await assertRejects(
          async () =>
            await tags.setTagConnections(
              tagDeps,
              businessRequest(f.member),
              input,
            ),
          AppError,
        )).code,
        "forbidden",
      );
      for (const tag_id of [recordTag.id, foreignTag.id]) {
        assertEquals(
          (await assertRejects(
            async () =>
              await tags.setTagConnections(
                tagDeps,
                businessRequest(f.manager),
                { ...input, tag_ids: [tag_id] },
              ),
            AppError,
          ))
            .code,
          "invalid_reference",
        );
      }
      assertEquals(
        (await assertRejects(
          async () =>
            await tags.setTagConnections(
              tagDeps,
              businessRequest(other.manager),
              input,
            ),
          AppError,
        )).code,
        "not_found",
      );
      const request = businessRequest(f.manager);
      // This invalid automatic-record scope is checked after the target links,
      // version and record insert, so rejection proves the transaction rolls back.
      assertEquals(
        (await assertRejects(
          async () =>
            await tags.setTagConnections(tagDeps, request, {
              ...input,
              change_tag_ids: [entityTag.id],
            }),
          AppError,
        )).code,
        "invalid_reference",
      );
      const before = await entities.getEntity(entityDeps, f.manager, entity.id);
      assertEquals([
        before.tag_ids,
        before.version,
        before.properties.prop_1,
        before.records.count,
      ], [
        [],
        1,
        "분류가 바뀌어도 보존",
        1,
      ]);
      const [receipt] =
        await admin`select count(*) n from private.workspace_request_results where workspace_id=${f.workspaceId} and request_key=${
          request.request!.key
        }`;
      assertEquals(Number(receipt.n), 0);
      const linkedRequest = businessRequest(f.manager);
      const linked = await tags.setTagConnections(
        tagDeps,
        linkedRequest,
        input,
      );
      assertEquals([linked.tag_ids, linked.version], [[entityTag.id], 2]);
      assertEquals(
        await tags.setTagConnections(tagDeps, linkedRequest, input),
        linked,
      );
      assertEquals(
        (await assertRejects(
          async () =>
            await tags.setTagConnections(tagDeps, businessRequest(f.manager), {
              ...input,
              tag_ids: [],
            }),
          AppError,
        )).code,
        "conflict",
      );
      await f.grantKind(f.manager, kind.id, "read");
      assertEquals(
        (await assertRejects(
          async () => await tags.setTagConnections(tagDeps, linkedRequest, input),
          AppError,
        )).code,
        "forbidden",
      );
      const after = await entities.getEntity(entityDeps, f.member, entity.id);
      assertEquals([after.tag_ids, after.version, after.records.count], [
        [entityTag.id],
        2,
        2,
      ]);
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "workspace tag deletion authorizes every hidden affected kind before any unlink or receipt",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      const left = await f.createKind("공개 분류"),
        right = await f.createKind("비공개 분류");
      for (const kind of [left, right]) {
        await f.grantKind(f.manager, kind.id, "write");
      }
      await f.grantKind(f.member, left.id, "write");
      const values = [];
      for (const kind of [left, right]) {
        values.push(
          await entities.createEntity(
            entityDeps,
            businessRequest(f.manager),
            entityCreate.parse({
              entity_type_id: kind.id,
              schema_version: 1,
              properties: { prop_1: "분류 대상" },
            }),
          ),
        );
      }
      const tag = await tags.createTag(tagDeps, businessRequest(f.manager), {
        scope: "entity",
        name: "함께 쓰는 분류",
      });
      for (const value of values) {
        await tags.setTagConnections(tagDeps, businessRequest(f.manager), {
          target_kind: "entity",
          target_id: value.id,
          expected_version: 1,
          tag_ids: [tag.id],
        });
      }
      const deniedRequest = businessRequest(f.member);
      const denied = await assertRejects(
        async () => await tags.deleteTag(tagDeps, deniedRequest, tag.id, 1),
        AppError,
      );
      assertEquals(denied.code, "forbidden");
      for (const value of values) {
        const unchanged = await entities.getEntity(
          entityDeps,
          f.manager,
          value.id,
        );
        assertEquals([
          unchanged.tag_ids,
          unchanged.version,
          unchanged.records.count,
        ], [[tag.id], 2, 2]);
      }
      assertEquals(
        Number(
          (await admin`select count(*) n from private.workspace_request_results where workspace_id=${f.workspaceId} and request_key=${
            deniedRequest.request!.key
          }`)[0].n,
        ),
        0,
      );
      await f.grantKind(f.member, right.id, "write");
      const request = businessRequest(f.member);
      assertEquals(await tags.deleteTag(tagDeps, request, tag.id, 1), {
        deleted: true,
      });
      assertEquals(await tags.deleteTag(tagDeps, request, tag.id, 1), {
        deleted: true,
      });
      for (const value of values) {
        const changed = await entities.getEntity(
          entityDeps,
          f.manager,
          value.id,
        );
        assertEquals(
          [changed.tag_ids, changed.version, changed.records.count],
          [[], 3, 3],
        );
      }
      assertEquals(
        (await tags.listTags(tagDeps, f.manager, {
          scope: "entity",
          limit: 100,
        })).items,
        [],
      );
      const [receipt] =
        await admin`select footprint from private.workspace_request_results where workspace_id=${f.workspaceId} and request_key=${
          request.request!.key
        }`;
      assertEquals(
        receipt.footprint,
        [left.id, right.id].sort().map((target_id) => ({
          target_kind: "entity_type",
          target_id,
          access: "write",
        })),
      );
      await f.grantKind(f.member, right.id, "none");
      assertEquals(
        (await assertRejects(
          async () => await tags.deleteTag(tagDeps, request, tag.id, 1),
          AppError,
        )).code,
        "forbidden",
      );
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "workspace dictionary deletion updates task and record tags without copying protected entity context",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      const hidden = await f.createKind("업무에서 숨길 자료");
      await f.grant(f.manager, [{
        target_kind: "settings",
        target_id: "*",
        access: "write",
      }, {
        target_kind: "tasks",
        target_id: "*",
        access: "write",
      }, {
        target_kind: "entity_type",
        target_id: hidden.id,
        access: "write",
      }]);
      await f.grant(f.member, [{
        target_kind: "tasks",
        target_id: "*",
        access: "write",
      }]);
      const entity = await entities.createEntity(
        entityDeps,
        businessRequest(f.manager),
        entityCreate.parse({
          entity_type_id: hidden.id,
          schema_version: 1,
          properties: { prop_1: "자동 기록에 복사하면 안 되는 비밀" },
        }),
      );
      const taskTag = await tags.createTag(
        tagDeps,
        businessRequest(f.manager),
        { scope: "task", name: "할 일 분류" },
      );
      const recordTag = await tags.createTag(
        tagDeps,
        businessRequest(f.manager),
        {
          scope: "record",
          name: "기록 분류",
        },
      );
      const context = [{
        id: entity.id,
        title: entity.title,
        captured_at: new Date().toISOString(),
        source: "selection",
      }];
      // These minimal #513 storage fixtures do not claim task/result CRUD. The
      // public operation under test is dictionary deletion across saved parents.
      const saved = await runInWorkspace(sql, f.manager, {
        mode: "business",
        requirements: [{
          target_kind: "tasks",
          target_id: "*",
          access: "write",
        }, {
          target_kind: "entity_type",
          target_id: hidden.id,
          access: "read",
        }],
      }, async (tx) => {
        const [task] =
          await tx`insert into app.tasks(workspace_id,kind,title,body,status,entity_ids,entity_context) values(${f.workspaceId},'once','분류할 업무','공유 업무 본문','open',array[${entity.id}]::text[],${
            tx.json(context)
          }) returning id`;
        const [record] =
          await tx`insert into app.records(workspace_id,task_id,body,record_kind) values(${f.workspaceId},${task.id},'보존할 수행 결과','result') returning id`;
        await tx`insert into app.task_tags(workspace_id,task_id,tag_id) values(${f.workspaceId},${task.id},${taskTag.id})`;
        await tx`insert into app.record_tags(workspace_id,record_id,tag_id) values(${f.workspaceId},${record.id},${recordTag.id})`;
        return { taskId: String(task.id), recordId: String(record.id) };
      });
      assertEquals(
        await tags.deleteTag(tagDeps, businessRequest(f.member), taskTag.id, 1),
        { deleted: true },
      );
      const [task] =
        await admin`select title,body,entity_ids,entity_context,version from app.tasks where workspace_id=${f.workspaceId} and id=${saved.taskId}`;
      assertEquals([
        task.title,
        task.body,
        task.entity_ids,
        task.entity_context,
        task.version,
      ], [
        "분류할 업무",
        "공유 업무 본문",
        [entity.id],
        context,
        2,
      ]);
      const changes =
        await admin`select body,task_id,entity_id,change_metadata from app.records where workspace_id=${f.workspaceId} and task_id=${saved.taskId} and record_kind='change'`;
      assertEquals(changes.length, 1);
      assertEquals([changes[0].task_id, changes[0].entity_id], [
        saved.taskId,
        null,
      ]);
      assertEquals(JSON.stringify(changes[0]).includes(entity.title), false);
      assertEquals(
        await tags.deleteTag(
          tagDeps,
          businessRequest(f.member),
          recordTag.id,
          1,
        ),
        { deleted: true },
      );
      const [record] =
        await admin`select body,task_id,entity_id,version from app.records where workspace_id=${f.workspaceId} and id=${saved.recordId}`;
      assertEquals([
        record.body,
        record.task_id,
        record.entity_id,
        record.version,
      ], [
        "보존할 수행 결과",
        saved.taskId,
        null,
        2,
      ]);
      assertEquals(
        Number(
          (await admin`select count(*) n from app.records where workspace_id=${f.workspaceId} and task_id=${saved.taskId} and record_kind='change'`)[
            0
          ].n,
        ),
        1,
      );
      const [state] =
        await admin`select source_version from app.search_index_state where workspace_id=${f.workspaceId} and id=${saved.recordId}`;
      assertEquals(Number(state.source_version), 2);
    } finally {
      await f.cleanup();
    }
  },
);

dbTest(
  "workspace tag deletion includes a concurrently linked kind in its durable authority footprint",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    const name = `tag-delete-${crypto.randomUUID()}`;
    const deletingSql = connect(urls.direct, {
      max: 1,
      prepare: false,
      connection: { application_name: name },
    });
    let release = () => {};
    let held: Promise<unknown> | undefined;
    let deleting: Promise<{ error?: unknown }> | undefined;
    try {
      const first = await f.createKind("먼저 연결한 종류"),
        arriving = await f.createKind("동시에 연결한 종류");
      for (const kind of [first, arriving]) {
        await f.grantKind(f.manager, kind.id, "write");
        await f.grantKind(f.member, kind.id, "write");
      }
      const values = [];
      for (const kind of [first, arriving]) {
        values.push(
          await entities.createEntity(
            entityDeps,
            businessRequest(f.manager),
            entityCreate.parse({
              entity_type_id: kind.id,
              schema_version: 1,
              properties: { prop_1: "동시 분류 대상" },
            }),
          ),
        );
      }
      const tag = await tags.createTag(tagDeps, businessRequest(f.manager), {
        scope: "entity",
        name: "경합 분류",
      });
      await tags.setTagConnections(tagDeps, businessRequest(f.manager), {
        target_kind: "entity",
        target_id: values[0].id,
        expected_version: 1,
        tag_ids: [tag.id],
      });
      let ready!: () => void;
      const locked = new Promise<void>((resolve) => ready = resolve);
      const gate = new Promise<void>((resolve) => release = resolve);
      held = runInWorkspace(sql, f.manager, {
        mode: "business",
        requirements: [{
          target_kind: "entity_type",
          target_id: first.id,
          access: "write",
        }],
      }, async (tx) => {
        await tx`select app.lock_business_entity_type(${first.id}::uuid,true)`;
        ready();
        await gate;
      });
      await locked;
      const request = businessRequest(f.member);
      deleting = tags.deleteTag(
        { uow: new SqlTagUnitOfWork(deletingSql) },
        request,
        tag.id,
        1,
      )
        .then(() => ({}), (error: unknown) => ({ error }));
      const deadline = Date.now() + 3000;
      let waiting = false;
      while (Date.now() < deadline) {
        const [row] = await admin`select exists(select 1 from pg_stat_activity
        where application_name=${name} and wait_event_type='Lock'
        and query like '%lock_business_entity_type%') waiting`;
        if (row.waiting) {
          waiting = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      assertEquals(
        waiting,
        true,
        "public deletion must have resolved initial authority before its kind lock waits",
      );
      await tags.setTagConnections(tagDeps, businessRequest(f.manager), {
        target_kind: "entity",
        target_id: values[1].id,
        expected_version: 1,
        tag_ids: [tag.id],
      });
      release();
      await held;
      const outcome = await deleting;
      if (outcome.error) {
        assertEquals(
          outcome.error instanceof AppError && outcome.error.code,
          "conflict",
        );
        // A safe stale-target conflict owns no receipt and may be retried.
        assertEquals(await tags.deleteTag(tagDeps, request, tag.id, 1), {
          deleted: true,
        });
      }
      const [receipt] = await admin`select footprint from private.workspace_request_results
      where workspace_id=${f.workspaceId} and request_key=${request.request!.key}`;
      assertEquals(
        receipt.footprint,
        [first.id, arriving.id].sort().map((target_id) => ({
          target_kind: "entity_type",
          target_id,
          access: "write",
        })),
      );
      for (const value of values) {
        const saved = await entities.getEntity(entityDeps, f.manager, value.id);
        assertEquals([saved.tag_ids, saved.version, saved.records.count], [
          [],
          3,
          3,
        ]);
      }
      await f.grantKind(f.member, arriving.id, "none");
      assertEquals(
        (await assertRejects(
          async () => await tags.deleteTag(tagDeps, request, tag.id, 1),
          AppError,
        )).code,
        "forbidden",
      );
    } finally {
      release();
      await held?.catch(() => {});
      await deleting;
      await deletingSql.end();
      await f.cleanup();
    }
  },
);
