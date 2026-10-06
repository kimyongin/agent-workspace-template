import { assertEquals } from "@std/assert";
import { recordCreate, recordListQuery, recordUpdate } from "./record.ts";
import { taskComplete, taskCreate, taskListQuery, taskUpdate } from "./task.ts";
import { searchInput } from "./search.ts";

const entity = "00000000-0000-4000-8000-000000000001";

Deno.test("단일 대상 쓰기 별칭은 거부하고 선택 배열과 목록 필터는 유지한다", () => {
  const content = { id: crypto.randomUUID(), title: "대상 선택", summary: "여러 대상 선택" };
  for (const schema of [recordCreate, taskCreate]) {
    const input = schema === taskCreate ? { ...content, kind: "once" } : content;
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

Deno.test("검색은 현재 원칙만 대상으로 하며 과거 선택과 상태 별칭은 거부한다", () => {
  assertEquals(searchInput.safeParse({ query: "기준", kinds: ["principle"] }).success, true);
  for (const value of ["current", "history", "all"]) {
    assertEquals(searchInput.safeParse({ query: "기준", principle_view: value }).success, false);
  }
  assertEquals(searchInput.safeParse({ query: "기준", status: "active" }).success, false);
  assertEquals(searchInput.safeParse({ query: "할 일", task_status: "open" }).success, true);
});

Deno.test("새 기록과 결과에는 적용 원칙 연관키를 받을 수 없다", () => {
  for (const schema of [recordCreate, taskComplete]) {
    const input = {
      title: "메모",
      summary: "원칙은 필요할 때 메모로 설명",
      ...(schema === taskComplete ? { expected_version: 1 } : { id: crypto.randomUUID() }),
    };
    assertEquals(schema.safeParse(input).success, true);
    assertEquals(schema.safeParse({ ...input, applied_principle_ids: [] }).success, false);
  }
  assertEquals(recordUpdate.safeParse({ expected_version: 1, applied_principle_ids: [] }).success, false);
});
