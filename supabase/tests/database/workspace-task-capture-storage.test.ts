import { assertEquals } from "@std/assert";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { taskCreate, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 1, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
const entityDeps = { uow: new SqlEntityUnitOfWork(sql) };

dbTest(
  "workspace task raw association columns deny app user while safe projection and visible edits preserve hidden captures",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      const hiddenKind = await f.createKind("보호된 연결 종류");
      const visibleKind = await f.createKind("읽을 수 있는 연결 종류");
      await f.grantKind(f.manager, hiddenKind.id, "write");
      await f.grantKind(f.manager, visibleKind.id, "write");
      const create = (type: string, title: string) =>
        entities.createEntity(
          entityDeps,
          businessRequest(f.manager),
          entityCreate.parse({ entity_type_id: type, schema_version: 1, properties: { prop_1: title } }),
        );
      const hidden = await create(hiddenKind.id, "숨겨야 하는 과거 캡처");
      const visible = await create(visibleKind.id, "해제할 수 있는 현재 자료");
      await f.grant(f.member, [
        { target_kind: "tasks", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: hiddenKind.id, access: "read" },
        { target_kind: "entity_type", target_id: visibleKind.id, access: "read" },
      ]);
      const task = await activity.createTask(
        deps,
        businessRequest(f.member),
        taskCreate.parse({
          kind: "once",
          title: "공유한 할 일 본문만 접근",
          entity_ids: [hidden.id, visible.id],
        }),
      );
      await f.grantKind(f.member, hiddenKind.id, "none");
      const authority = {
        mode: "business" as const,
        requirements: [{ target_kind: "tasks" as const, target_id: "*", access: "read" as const }],
      };
      for (const column of ["entity_ids", "entity_context"] as const) {
        const code = await runInWorkspace(sql, f.member, authority, (tx) =>
          tx.savepoint(async (probe) => {
            await probe`select ${probe(column)} from app.tasks where workspace_id=${f.workspaceId} and id=${task.id}`;
          }).then(() => "ok", (error: { code: string }) => error.code));
        assertEquals(code, "42501");
      }
      const projected = await runInWorkspace(sql, f.member, authority, async (tx) => {
        const [row] = await tx`select app.workspace_task_associations(${task.id}) as associations`;
        return row.associations;
      });
      assertEquals(projected.entity_ids, [visible.id]);
      assertEquals(projected.entity_context.map((item: { title: string }) => item.title), ["해제할 수 있는 현재 자료"]);
      const updated = await activity.updateTask(
        deps,
        businessRequest(f.member),
        task.id,
        taskUpdate.parse({ expected_version: task.version, entity_ids: [] }),
      );
      assertEquals(updated.entity_ids, []);
      const [stored] =
        await admin`select entity_ids,entity_context from app.tasks where workspace_id=${f.workspaceId} and id=${task.id}`;
      assertEquals(stored.entity_ids, [hidden.id]);
      assertEquals(stored.entity_context.map((item: { title: string }) => item.title), ["숨겨야 하는 과거 캡처"]);
      await f.grantKind(f.member, hiddenKind.id, "read");
      assertEquals((await activity.getTask(deps, f.member, task.id)).entity_context.map((item) => item.title), [
        "숨겨야 하는 과거 캡처",
      ]);
    } finally {
      await f.cleanup();
    }
  },
);
