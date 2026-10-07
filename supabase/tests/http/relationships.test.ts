import { assert, assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "./_client.ts";

const A = await signIn("A"), B = await signIn("B");

httpTest("일반 기록은 할 일에 연결하되 업무 상태·회차·과거 엔터티를 바꾸지 않는다", async () => {
  const entity = (await call(A, "POST", "/entities", { prop1: crypto.randomUUID() })).body;
  const task = (await call(A, "POST", "/tasks", { kind: "once", title: "관계 업무", entity_ids: [entity.id] })).body;
  const created = await call(A, "POST", "/records", { body: "진행 중 상담 메모", task_id: task.id });
  assertEquals(created.status, 201);
  assertEquals(created.body.record_kind, "user");
  assertEquals(created.body.task_id, task.id);
  assertEquals(created.body.occurrence_on, null);
  assertEquals(created.body.entity_ids, [entity.id]);
  const unchanged = (await call(A, "GET", `/tasks/${task.id}`)).body;
  assertEquals(unchanged.status, "open");
  assertEquals(unchanged.version, task.version);
  assertEquals(unchanged.result_record_id, null);
  const detached = await call(A, "PATCH", `/tasks/${task.id}`, {
    expected_version: task.version,
    entity_ids: [],
    change_note: "상담 대상 연결 해제",
  });
  assertEquals(detached.status, 200);
  assertEquals(detached.body.entity_ids, []);
  assertEquals((await call(A, "GET", `/records/${created.body.id}`)).body.entity_ids, [entity.id]);
  assert(
    (await call(A, "GET", `/records?task_id=${task.id}`)).body.items.some((r: { id: string }) =>
      r.id === created.body.id
    ),
  );
  assertEquals((await call(B, "POST", "/records", { body: "금지", task_id: task.id })).status, 404);
  assertEquals((await call(A, "POST", "/records", { body: "없음", task_id: crypto.randomUUID() })).status, 404);
  assertEquals(
    (await call(A, "PATCH", `/tasks/${task.id}`, { expected_version: task.version, entity_ids: [entity.id] })).status,
    409,
  );
});

httpTest("할 일 제목 검색은 부분 일치와 문자 그대로의 %/_ 및 소유자·cursor 범위를 지킨다", async () => {
  const keyword = `${crypto.randomUUID()}%_`;
  const ids: string[] = [];
  for (const title of [`첫 ${keyword} 고객`, `둘 ${keyword.toUpperCase()} 상담`]) {
    ids.push((await call(A, "POST", "/tasks", { kind: "once", title })).body.id);
  }
  await call(A, "POST", "/tasks", { kind: "once", title: keyword.replace("%_", "ANY") });
  await call(B, "POST", "/tasks", { kind: "once", title: keyword });
  const path = `/tasks?keyword=${encodeURIComponent(keyword)}&limit=1`;
  const first = (await call(A, "GET", path)).body;
  assertEquals(first.items.length, 1);
  assert(first.next_cursor);
  const second = (await call(A, "GET", `${path}&cursor=${encodeURIComponent(first.next_cursor)}`)).body;
  assertEquals([...first.items, ...second.items].map((item) => item.id).sort(), ids.sort());
  assertEquals(second.next_cursor, null);
  assertEquals(
    (await call(A, "GET", `/tasks?keyword=다른검색&limit=1&cursor=${encodeURIComponent(first.next_cursor)}`)).status,
    400,
  );
});
