import { assertEquals } from "@std/assert";
import { taskComplete, taskCreate, taskUpdate } from "../../functions/_shared/contracts/task.ts";
import { occurrenceRecordCreate, recordListQuery, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import { activityTools } from "../../functions/_shared/adapters/mcp/activity-tools.ts";

Deno.test("ordinary task content and result creation reject even empty initial tag selections", () => {
  assertEquals(taskCreate.safeParse({ kind: "once", title: "저장 후 분류", tag_ids: [] }).success, false);
  assertEquals(
    taskCreate.safeParse({
      kind: "recurring",
      title: "반복 저장 후 분류",
      timezone: "Asia/Seoul",
      recurrence: { freq: "daily", starts_on: "2026-10-01" },
      tag_ids: [],
    }).success,
    false,
  );
  assertEquals(taskUpdate.safeParse({ expected_version: 1, tag_ids: [] }).success, false);
  assertEquals(taskComplete.safeParse({ expected_version: 1, body: "수행 결과", tag_ids: [] }).success, false);
  assertEquals(occurrenceRecordCreate.safeParse({ body: "반복 수행 결과", tag_ids: [] }).success, false);
  assertEquals(
    taskCreate.safeParse({ kind: "once", title: "자동 사건 메타데이터 유지", change_tag_ids: [] }).success,
    true,
  );
});

Deno.test("result content rejects movable parents and ordinary tag partial updates", () => {
  assertEquals(occurrenceRecordCreate.safeParse({ body: "불변 할 일 소속", entity_ids: [] }).success, false);
  assertEquals(recordUpdate.safeParse({ expected_version: 1, entity_ids: [] }).success, false);
  assertEquals(recordUpdate.safeParse({ expected_version: 1, tag_ids: [] }).success, false);
  assertEquals(recordUpdate.safeParse({ expected_version: 1 }).success, false);
  assertEquals(recordListQuery.safeParse({ record_kind: "user" }).success, false);
});

Deno.test("public activity tools expose explicit completion occurrence and restore without general record creation", () => {
  const tools = activityTools({
    uow: {
      run: () => {
        throw new Error("tool catalog does not execute storage");
      },
    },
    clock: { now: () => new Date("2026-10-01T00:00:00Z") },
  });
  assertEquals(tools.some((tool) => tool.name === "create_record"), false);
  for (const name of ["complete_task", "record_occurrence", "restore_task"]) {
    assertEquals(tools.some((tool) => tool.name === name), true);
  }
});
