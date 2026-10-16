import { assertEquals } from "@std/assert";
import { recordCreate, recordListQuery, recordUpdate } from "./record.ts";
import { taskComplete, taskCreate, taskListQuery, taskUpdate } from "./task.ts";
import { recordTemplates } from "./record-template.ts";
import { prepareRecordMemo } from "./record-preparation.ts";
import { searchInput } from "./search.ts";

const entity = "app:00000000-0000-4000-8000-000000000001:001";

Deno.test("단일 대상 쓰기 별칭은 거부하고 선택 배열과 목록 필터는 유지한다", () => {
  const content = { body: "여러 대상 선택" };
  for (const schema of [recordCreate, taskCreate]) {
    const input = schema === taskCreate ? { body: content.body, title: "대상 선택", kind: "once" } : content;
    assertEquals(schema.safeParse({ ...input, entity_id: entity }).success, false);
    assertEquals(schema.safeParse({ ...input, entity_ids: [entity] }).success, true);
  }
  for (const schema of [recordUpdate, taskUpdate]) {
    assertEquals(schema.safeParse({ expected_version: 1, entity_id: null }).success, false);
    assertEquals(schema.safeParse({ expected_version: 1, entity_ids: [] }).success, true);
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
  for (const schema of [recordCreate, taskComplete]) {
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
