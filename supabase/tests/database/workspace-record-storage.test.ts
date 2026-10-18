import { assertEquals, assertNotEquals, assertRejects } from "@std/assert";
import type postgres from "postgres";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import * as entities from "../../functions/_shared/core/entity/application.ts";
import { entityCreate } from "../../functions/_shared/contracts/entity.ts";
import { taskComplete, taskCreate } from "../../functions/_shared/contracts/task.ts";
import { recordListQuery, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { SqlEntityUnitOfWork } from "../../functions/_shared/adapters/supabase/entity-store.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 1, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
const entityDeps = { uow: new SqlEntityUnitOfWork(sql) };

dbTest("workspace records enforce immutable single parents and result kinds through the actual app role", async () => {
  const f = await businessWorkspaceFixture(admin, sql);
  try {
    const kind = await f.createKind("기록 소속 자료");
    await f.grantKind(f.manager, kind.id, "write");
    const entity = await entities.createEntity(
      entityDeps,
      businessRequest(f.manager),
      entityCreate.parse({
        entity_type_id: kind.id,
        schema_version: 1,
        properties: { prop_1: "기록 원본" },
      }),
    );
    const authority = {
      mode: "business" as const,
      requirements: [
        { target_kind: "tasks" as const, target_id: "*", access: "write" as const },
        { target_kind: "entity_type" as const, target_id: kind.id, access: "write" as const },
      ],
    };
    await f.grant(f.member, authority.requirements);
    const task = await activity.createTask(
      deps,
      businessRequest(f.member),
      taskCreate.parse({ kind: "once", title: "불변 결과 소속" }),
    );
    const completed = await activity.completeTask(
      deps,
      businessRequest(f.member),
      task.id,
      taskComplete.parse({ expected_version: task.version, body: "공유된 수행 결과 원문" }),
    );
    const next = await activity.createTask(
      deps,
      businessRequest(f.member),
      taskCreate.parse({ kind: "once", title: "이동 불가 대상" }),
    );
    const other = await f.addWorkspace("교차 소속 불가 공간");
    await f.grant(other.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
    const cross = await activity.createTask(
      deps,
      businessRequest(other.member),
      taskCreate.parse({ kind: "once", title: "다른 공간 소속" }),
    );
    const probe = (write: (tx: postgres.TransactionSql) => Promise<unknown>) =>
      runInWorkspace(
        sql,
        f.member,
        authority,
        (tx) => tx.savepoint(write).then(() => "ok", (error: { code: string }) => error.code),
      );
    // This parent is valid and the current actor has actual task WRITE: the
    // rejection must come from the retired kind storage contract.
    assertEquals(
      await probe((tx) =>
        tx`insert into app.records(workspace_id,task_id,body,record_kind)
      values(${f.workspaceId},${next.id},'일반 기록 우회','user')`
      ),
      "23514",
    );
    assertNotEquals(
      await probe((tx) =>
        tx`insert into app.records(workspace_id,body,record_kind)
      values(${f.workspaceId},'무소속 기록 우회','result')`
      ),
      "ok",
    );
    assertEquals(
      await probe((tx) =>
        tx`insert into app.records(workspace_id,task_id,entity_id,body,record_kind)
      values(${f.workspaceId},${next.id},${entity.id},'이중 소속 우회','result')`
      ),
      "23514",
    );
    assertNotEquals(
      await probe((tx) =>
        tx`insert into app.records(workspace_id,task_id,body,record_kind)
      values(${f.workspaceId},${cross.id},'교차 공간 소속 우회','result')`
      ),
      "ok",
    );
    assertEquals(
      await probe((tx) =>
        tx`insert into app.records(workspace_id,task_id,entity_ids,body,record_kind)
      values(${f.workspaceId},${next.id},array[${entity.id}]::text[],'복수 소속 우회','result')`
      ),
      "23514",
    );
    assertEquals(
      await probe((tx) =>
        tx`update app.records set task_id=${next.id} where workspace_id=${f.workspaceId} and id=${completed.record.id}`
      ),
      "23514",
    );
    assertNotEquals(
      await probe((tx) =>
        tx`update app.records set created_by=${f.manager.userId} where workspace_id=${f.workspaceId} and id=${completed.record.id}`
      ),
      "ok",
    );
    const [author] =
      await admin`select created_by,owner_id from app.records where workspace_id=${f.workspaceId} and id=${completed.record.id}`;
    assertEquals({ ...author }, { created_by: f.member.userId, owner_id: null });
    await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "read" }]);
    assertEquals((await activity.getRecord(deps, f.member, completed.record.id)).body, "공유된 수행 결과 원문");
    assertEquals(
      (await assertRejects(() =>
        activity.updateRecord(
          deps,
          businessRequest(f.member),
          completed.record.id,
          recordUpdate.parse({ expected_version: completed.record.version, body: "읽기 권한의 변경 우회" }),
        ), AppError)).code,
      "forbidden",
    );
    const untouched = await runInWorkspace(
      sql,
      f.member,
      { mode: "business", requirements: [{ target_kind: "tasks", target_id: "*", access: "read" }] },
      (tx) =>
        tx`update app.records set body='직접 SQL 수정 우회' where workspace_id=${f.workspaceId} and id=${completed.record.id} returning id`,
    );
    assertEquals(untouched.length, 0);
    await f.grant(f.member, []);
    const concealed = await runInWorkspace(
      sql,
      f.member,
      { mode: "business", requirements: [] },
      (tx) => tx`select id,body from app.records where workspace_id=${f.workspaceId} and id=${completed.record.id}`,
    );
    assertEquals(concealed.length, 0);
    await f.grantKind(f.member, kind.id, "read");
    const ownHistory = await activity.listRecords(deps, f.member, recordListQuery.parse({ entity_id: entity.id }));
    assertEquals(ownHistory.items.length, 1);
    assertEquals(ownHistory.items[0].entity_id, entity.id);
    assertEquals(
      (await assertRejects(() =>
        activity.updateRecord(
          deps,
          businessRequest(f.member),
          ownHistory.items[0].id,
          recordUpdate.parse({ expected_version: ownHistory.items[0].version, body: "자료 읽기 권한의 변경 우회" }),
        ), AppError)).code,
      "forbidden",
    );
    await f.grantKind(f.member, kind.id, "write");
    const corrected = await activity.updateRecord(
      deps,
      businessRequest(f.member),
      ownHistory.items[0].id,
      recordUpdate.parse({ expected_version: ownHistory.items[0].version, body: "같은 자료 소속 사건 메모 정정" }),
    );
    assertEquals(corrected.entity_id, entity.id);
    assertEquals(
      (await activity.listRecords(deps, f.member, recordListQuery.parse({ entity_id: entity.id }))).items.length,
      1,
    );
  } finally {
    await f.cleanup();
  }
});
