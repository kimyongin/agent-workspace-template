import { assertEquals } from "@std/assert";
import type postgres from "postgres";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import {
  recordListQuery,
  recordUpdate,
} from "../../functions/_shared/contracts/record.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import {
  businessRequest,
  businessWorkspaceFixture,
} from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 1, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date() } };
const authority = {
  mode: "business" as const,
  requirements: [{
    target_kind: "tasks" as const,
    target_id: "*",
    access: "write" as const,
  }],
};

dbTest(
  "workspace automatic record facts stay immutable for a currently authorized app role",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      await f.grant(f.member, authority.requirements);
      const task = await activity.createTask(
        deps,
        businessRequest(f.member),
        taskCreate.parse({ kind: "once", title: "불변 사건 정보" }),
      );
      const event = (await activity.listRecords(
        deps,
        f.member,
        recordListQuery.parse({ task_id: task.id, record_kind: "change" }),
      )).items[0];
      const probe = (
        write: (tx: postgres.TransactionSql) => Promise<unknown>,
      ) =>
        runInWorkspace(
          sql,
          f.member,
          authority,
          (tx) =>
            tx.savepoint(write).then(
              () => "ok",
              (error: { code: string }) => error.code,
            ),
        );
      assertEquals(
        await probe((tx) =>
          tx`update app.records set change_metadata=jsonb_set(change_metadata,'{action}','"delete"') where workspace_id=${f.workspaceId} and id=${event.id}`
        ),
        "23514",
      );
      assertEquals(
        await probe((tx) =>
          tx`update app.records set change_metadata=null where workspace_id=${f.workspaceId} and id=${event.id}`
        ),
        "23514",
      );
      assertEquals(
        await probe((tx) =>
          tx`update app.records set record_kind='result' where workspace_id=${f.workspaceId} and id=${event.id}`
        ),
        "23514",
      );
      assertEquals(
        await probe((tx) =>
          tx`update app.records set occurred_at=occurred_at+interval '1 minute' where workspace_id=${f.workspaceId} and id=${event.id}`
        ),
        "23514",
      );
      assertEquals(await activity.getRecord(deps, f.member, event.id), event);
      const corrected = await activity.updateRecord(
        deps,
        businessRequest(f.member),
        event.id,
        recordUpdate.parse({
          expected_version: event.version,
          body: "사건을 바꾸지 않는 메모 정정",
        }),
      );
      assertEquals(corrected.change, event.change);
      assertEquals(corrected.occurred_at, event.occurred_at);
      assertEquals(corrected.record_kind, "change");
      assertEquals(corrected.body, "사건을 바꾸지 않는 메모 정정");
      assertEquals(
        (await activity.listRecords(
          deps,
          f.member,
          recordListQuery.parse({ task_id: task.id }),
        )).items.length,
        1,
      );
    } finally {
      await f.cleanup();
    }
  },
);
