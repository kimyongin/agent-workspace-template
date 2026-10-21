import { assertEquals } from "@std/assert";
import { occurrenceRecordCreate, recordListQuery, recordUpdate } from "./record.ts";
import { taskComplete, taskCreate, taskListQuery, taskUpdate } from "./task.ts";
import { recordTemplates } from "./record-template.ts";
import { prepareRecordMemo } from "./record-preparation.ts";
import { searchInput } from "./search.ts";

const entity = "00000000-0000-4000-8000-000000000001:00000000-0000-4000-8000-000000000001:001";

Deno.test("task associations remain optional and multiple; record parents cannot be submitted or moved", () => {
  const task = { body: "대상 선택", title: "계획", kind: "once" };
  assertEquals(taskCreate.safeParse({ ...task, entity_id: entity }).success, false);
  assertEquals(taskCreate.safeParse({ ...task, entity_ids: [entity] }).success, true);
  assertEquals(taskUpdate.safeParse({ expected_version: 1, entity_ids: [] }).success, true);
  assertEquals(taskUpdate.safeParse({ expected_version: 1, entity_id: null }).success, false);
  for (
    const parent of [{ entity_id: entity }, { entity_ids: [entity] }, { entity_ids: [] }, {
      task_id: "20261016-ABCDEFGH",
    }, { entity_context: [] }]
  ) {
    assertEquals(occurrenceRecordCreate.safeParse({ body: "수행 결과", ...parent }).success, false);
    assertEquals(recordUpdate.safeParse({ expected_version: 1, body: "정정", ...parent }).success, false);
  }
  assertEquals(recordListQuery.parse({ entity_id: entity }).entity_id, entity);
  assertEquals(taskListQuery.parse({ entity_id: entity }).entity_id, entity);
});

Deno.test("검색은 할 일·기록을 대상으로 하며 제거된 원칙 조건을 거부한다", () => {
  assertEquals(searchInput.safeParse({ query: "기준", kinds: ["principle"] }).success, false);
  for (const value of ["current", "history", "all"]) {
    assertEquals(searchInput.safeParse({ query: "기준", principle_view: value }).success, false);
  }
  assertEquals(searchInput.safeParse({ query: "기준", status: "active" }).success, false);
  assertEquals(searchInput.safeParse({ query: "할 일", task_status: "open" }).success, true);
});

Deno.test("새 기록과 결과에는 적용 원칙 연관키를 받을 수 없다", () => {
  for (const schema of [occurrenceRecordCreate, taskComplete]) {
    const input = {
      body: "메모",
      ...(schema === taskComplete ? { expected_version: 1 } : {}),
    };
    assertEquals(schema.safeParse(input).success, true);
    assertEquals(schema.safeParse({ ...input, applied_principle_ids: [] }).success, false);
  }
  assertEquals(recordUpdate.safeParse({ expected_version: 1, applied_principle_ids: [] }).success, false);
});

Deno.test("removed principle templates and preparation models are rejected", () => {
  assertEquals(recordTemplates.safeParse({ principle: { create: { memo: "old" } } }).success, false);
  assertEquals(
    prepareRecordMemo.safeParse({ model: "principle", action: "create", input: { title: "old" } }).success,
    false,
  );
});
