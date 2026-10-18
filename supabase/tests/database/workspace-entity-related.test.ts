import { assertEquals } from "@std/assert";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 }), sql = connect(urls.direct, { max: 3, prepare: false });
const deps = { uow: new SqlEntityUnitOfWork(sql) };

dbTest("workspace entity related previews require task read and count only directly owned records", async () => {
  const f = await businessWorkspaceFixture(admin, sql);
  try {
    const kind = await f.createKind("대상 자료");
    await f.grantKind(f.manager, kind.id, "write");
    await f.grantKind(f.member, kind.id, "read");
    await f.grant(f.manager, [
      { target_kind: "settings", target_id: "*", access: "write" },
      { target_kind: "tasks", target_id: "*", access: "write" },
      { target_kind: "entity_type", target_id: kind.id, access: "write" },
    ]);
    const entity = await entities.createEntity(
      deps,
      businessRequest(f.manager),
      entityCreate.parse({
        entity_type_id: kind.id,
        schema_version: 1,
        properties: { prop_1: "관련 정보 권한 경계" },
      }),
    );
    // A minimal stored task/result fixture exercises the entity detail reader;
    // task/result commands themselves belong to #515.
    const taskId = await runInWorkspace(sql, f.manager, {
      mode: "business",
      requirements: [
        { target_kind: "tasks", target_id: "*", access: "write" },
        { target_kind: "entity_type", target_id: kind.id, access: "read" },
      ],
    }, async (tx) => {
      const [task] = await tx`insert into app.tasks(workspace_id,kind,title,body,status,entity_ids,entity_context)
        values(${f.workspaceId},'once','업무 읽기에만 공개할 제목','업무 본문','open',array[${entity.id}]::text[],'[]'::jsonb) returning id`;
      await tx`insert into app.records(workspace_id,task_id,body,record_kind)
        values(${f.workspaceId},${task.id},'자료 소속이 아닌 업무 결과','result')`;
      return String(task.id);
    });
    const hidden = await entities.getEntity(deps, f.member, entity.id);
    assertEquals(hidden.tasks, { count: 0, items: [] });
    assertEquals(hidden.records.count, 1);
    await f.grant(f.member, [
      { target_kind: "entity_type", target_id: kind.id, access: "read" },
      { target_kind: "tasks", target_id: "*", access: "read" },
    ]);
    const readable = await entities.getEntity(deps, f.member, entity.id);
    assertEquals(readable.tasks.count, 1);
    assertEquals(readable.tasks.items.map(({ id, title }) => ({ id, title })), [
      { id: taskId, title: "업무 읽기에만 공개할 제목" },
    ]);
    assertEquals(readable.records.count, 1);
    assertEquals(readable.records.items.some(({ body }) => body.includes("업무 결과")), false);
    await f.grant(f.member, [{ target_kind: "entity_type", target_id: kind.id, access: "read" }]);
    assertEquals((await entities.getEntity(deps, f.member, entity.id)).tasks, { count: 0, items: [] });
  } finally {
    await f.cleanup();
  }
});
