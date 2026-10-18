import { assertEquals, assertRejects } from "@std/assert";
import * as activity from "../../functions/_shared/core/activity/application.ts";
import { occurrenceRecordCreate } from "../../functions/_shared/contracts/record.ts";
import { taskCreate } from "../../functions/_shared/contracts/task.ts";
import { SqlUnitOfWork } from "../../functions/_shared/adapters/supabase/activity-store.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { businessRequest, businessWorkspaceFixture } from "./_workspace-business.ts";
import { connect, dbTest, urls } from "./_db.ts";

const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { max: 1, prepare: false });
const deps = { uow: new SqlUnitOfWork(sql), clock: { now: () => new Date("2026-10-04T00:30:00Z") } };

dbTest(
  "workspace recurring task keeps timezone and stop resume rules with current authority before retained responses",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      await f.grant(f.member, [{ target_kind: "tasks", target_id: "*", access: "write" }]);
      const task = await activity.createTask(
        deps,
        businessRequest(f.member),
        taskCreate.parse({
          kind: "recurring",
          title: "공동 반복 업무",
          body: "반복 업무 본문",
          timezone: "America/New_York",
          recurrence: { freq: "daily", starts_on: "2026-10-01" },
        }),
      );
      const range = { from: "2026-10-02", to: "2026-10-04" };
      assertEquals((await activity.listOccurrences(deps, f.member, task.id, range)).items.map((item) => item.status), [
        "missed",
        "due",
        "upcoming",
      ]);
      const result = await activity.recordOccurrence(
        deps,
        businessRequest(f.member),
        task.id,
        "2026-10-03",
        occurrenceRecordCreate.parse({ body: "실제 반복 수행 결과" }),
      );
      assertEquals(result.task_id, task.id);
      assertEquals(result.occurrence_on, "2026-10-03");
      assertEquals("entity_context" in result, false);
      assertEquals(
        (await assertRejects(() =>
          activity.recordOccurrence(
            deps,
            businessRequest(f.member),
            task.id,
            "2026-10-04",
            occurrenceRecordCreate.parse({ body: "미래 수행은 기록할 수 없음" }),
          ), AppError)).code,
        "invalid_input",
      );
      const stopped = await activity.stopTask(deps, businessRequest(f.member), task.id, task.version);
      assertEquals(stopped.status, "stopped");
      assertEquals(
        (await assertRejects(() =>
          activity.recordOccurrence(
            deps,
            businessRequest(f.member),
            task.id,
            "2026-10-03",
            occurrenceRecordCreate.parse({ body: "중단 중 수행은 기록할 수 없음" }),
          ), AppError)).code,
        "invalid_input",
      );
      const resumed = await activity.resumeTask(deps, businessRequest(f.member), task.id, stopped.version);
      assertEquals(resumed.pauses, []);
      assertEquals((await activity.listOccurrences(deps, f.member, task.id, range)).items[1].record_ids, [result.id]);
      const request = businessRequest(f.member);
      await activity.stopTask(deps, request, task.id, resumed.version);
      await f.grant(f.member, []);
      assertEquals(
        (await assertRejects(() => activity.stopTask(deps, request, task.id, resumed.version), AppError)).code,
        "forbidden",
      );
    } finally {
      await f.cleanup();
    }
  },
);
