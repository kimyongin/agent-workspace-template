// Public content validation and allowed-role storage constraints share limits.
// Public projections deliberately omit private/legacy storage columns.
import { assertEquals } from "@std/assert";
import type { z } from "zod";
import {
  occurrenceRecordCreate,
  recordResult,
} from "../../functions/_shared/contracts/record.ts";
import {
  taskCreate,
  taskResult,
} from "../../functions/_shared/contracts/task.ts";
import * as activity from "../../functions/_shared/core/activity/application.ts";
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

const boundaries = (field: "title" | "body", max: number, min: number) => [
  { name: `${field} ${max}자`, value: "가".repeat(max) },
  { name: `${field} ${max + 1}자`, value: "가".repeat(max + 1) },
  ...(min > 0 ? [{ name: `${field} 빈 값`, value: "" }] : []),
];
const onceTask = { kind: "once", title: "제목", body: "" };
function accepts(schema: z.ZodType, input: unknown) {
  return schema.safeParse(input).success;
}

dbTest(
  "workspace task and parented result storage retain public content limits",
  async () => {
    const f = await businessWorkspaceFixture(admin, sql);
    try {
      await f.grant(f.member, authority.requirements);
      const task = await activity.createTask(
        deps,
        businessRequest(f.member),
        taskCreate.parse(onceTask),
      );
      const dbAccepts = (
        table: "tasks" | "records",
        row: Record<string, unknown>,
      ) =>
        runInWorkspace(sql, f.member, authority, async (tx) => {
          try {
            await tx.savepoint(async (savepoint) => {
              await savepoint`insert into ${savepoint(`app.${table}`)} ${
                savepoint({ workspace_id: f.workspaceId, ...row })
              }`;
              throw new Error("parity rollback");
            });
          } catch (error) {
            if ((error as Error).message === "parity rollback") return true;
            if (
              ["23514", "23502"].includes(
                (error as { code?: string }).code ?? "",
              )
            ) return false;
            throw error;
          }
          throw new Error("probe must roll back");
        });
      for (
        const [field, max, min] of [["title", 100, 1], [
          "body",
          22000,
          0,
        ]] as const
      ) {
        for (const boundary of boundaries(field, max, min)) {
          const input = { ...onceTask, [field]: boundary.value };
          assertEquals(
            await dbAccepts("tasks", { ...input, status: "open" }),
            accepts(taskCreate, input),
            boundary.name,
          );
          if (field === "body") {
            assertEquals(
              await dbAccepts("records", {
                task_id: task.id,
                record_kind: "result",
                body: boundary.value,
              }),
              accepts(occurrenceRecordCreate, { body: boundary.value }),
              boundary.name,
            );
          }
        }
      }
      assertEquals(accepts(occurrenceRecordCreate, { body: "" }), false);
      assertEquals(
        await dbAccepts("records", {
          task_id: task.id,
          record_kind: "result",
          body: "",
        }),
        true,
      );
      for (
        const input of [{ ...onceTask, kind: "someday" }, {
          ...onceTask,
          kind: "recurring",
        }]
      ) {
        assertEquals(
          await dbAccepts("tasks", {
            ...input,
            status: input.kind === "recurring" ? "active" : "open",
          }),
          accepts(taskCreate, input),
        );
      }
      const result = await activity.completeTask(
        deps,
        businessRequest(f.member),
        task.id,
        { expected_version: task.version, body: "유효한 소속의 결과" },
      );
      assertEquals(taskResult.safeParse(result.task).success, true);
      assertEquals(recordResult.safeParse(result.record).success, true);
      assertEquals(result.record.task_id, task.id);
      assertEquals(result.record.entity_id, null);
      assertEquals(result.record.created_by, f.member.userId);
      for (
        const key of [
          "workspace_id",
          "owner_id",
          "entity_ids",
          "entity_context",
          "change_metadata",
        ]
      ) assertEquals(key in result.record, false, key);
      assertEquals("workspace_id" in result.task, false);
      assertEquals("owner_id" in result.task, false);
    } finally {
      await f.cleanup();
    }
  },
);
