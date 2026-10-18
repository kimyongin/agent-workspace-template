import { assertEquals, assertRejects } from "@std/assert";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { taskComplete, taskCreate, taskListQuery, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { recordListQuery } from "../../functions/_shared/contracts/record.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 1, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
const entityDeps = { uow: new SqlEntityUnitOfWork(sql) };

dbTest(
  "workspace task associations redact revoked kinds while own content edits preserve hidden stored references",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      const kind = await f.createKind("보호된 자료 종류");
      await f.grantKind(f.manager, kind.id, "write");
      const entity = await entities.createEntity(
        entityDeps,
        businessRequest(f.manager),
        entityCreate.parse({
          entity_type_id: kind.id,
          schema_version: 1,
          properties: { prop_1: "보호된 연결 자료 제목" },
        }),
      );
      await f.grant(f.member, [
        { target_kind: "tasks", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: kind.id, access: "read" },
      ]);
      const request = businessRequest(f.member);
      const input = taskCreate.parse({
        kind: "once",
        title: "할 일 공유 제목",
        body: "직접 쓴 공유 본문",
        entity_ids: [entity.id],
      });
      const task = await activity.createTask(deps, request, input);
      assertEquals(task.entity_context.map((item) => item.title), ["보호된 연결 자료 제목"]);
      await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
      const hidden = await activity.getTask(deps, f.member, task.id);
      assertEquals(hidden.entity_ids, []);
      assertEquals(hidden.entity_context, []);
      assertEquals((await activity.listTasks(deps, f.member, taskListQuery.parse({}))).items[0].entity_context, []);
      const updated = await activity.updateTask(
        deps,
        businessRequest(f.member),
        task.id,
        taskUpdate.parse({ expected_version: task.version, body: "권한을 유지한 할 일 본문 수정" }),
      );
      assertEquals(updated.body, "권한을 유지한 할 일 본문 수정");
      assertEquals(updated.entity_context, []);
      const [stored] =
        await admin`select entity_ids,entity_context from app.tasks where workspace_id=${f.workspaceId} and id=${task.id}`;
      assertEquals(stored.entity_ids, [entity.id]);
      assertEquals(stored.entity_context[0].title, "보호된 연결 자료 제목");
      const selection = await activity.updateTask(
        deps,
        businessRequest(f.member),
        task.id,
        taskUpdate.parse({ expected_version: updated.version, entity_ids: [] }),
      );
      assertEquals(selection.entity_ids, []);
      const [retained] =
        await admin`select entity_ids from app.tasks where workspace_id=${f.workspaceId} and id=${task.id}`;
      assertEquals(retained.entity_ids, [entity.id]);
      assertEquals((await assertRejects(() => activity.createTask(deps, request, input), AppError)).code, "forbidden");
      const completed = await activity.completeTask(
        deps,
        businessRequest(f.member),
        task.id,
        taskComplete.parse({ expected_version: selection.version, body: "할 일 읽기 권한으로 공유할 수행 결과" }),
      );
      assertEquals(completed.record.task_id, task.id);
      assertEquals("entity_context" in completed.record, false);
      const history = await activity.listRecords(deps, f.member, recordListQuery.parse({ task_id: task.id }));
      assertEquals(JSON.stringify(history).includes("보호된 연결 자료 제목"), false);
      assertEquals(JSON.stringify(history).includes("보호된 자료 종류"), false);
      await f.grantKind(f.member, kind.id, "read");
      assertEquals((await activity.getTask(deps, f.member, task.id)).entity_context.map((item) => item.title), [
        "보호된 연결 자료 제목",
      ]);
    } finally {
      await f.cleanup();
    }
  },
);
