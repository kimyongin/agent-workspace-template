import { assert, assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "./_client.ts";
const A = await signIn("A"), B = await signIn("B");
httpTest("Entity HTTP: CRUD·권한·입력·버전·참조·삭제 보존 실제 진입점", async () => {
  assertEquals((await call(null, "GET", "/entities")).status, 401);
  const request_id = crypto.randomUUID(),
    input = { prop1: "  실제 엔터티  ", prop2: 0, prop3: "2024-02-29", request_id };
  const created = await call(A, "POST", "/entities", input);
  assertEquals(created.status, 201);
  const e = created.body;
  assertEquals(e.prop1, "실제 엔터티");
  assertEquals((await call(A, "POST", "/entities", input)).body.id, e.id);
  assertEquals((await call(B, "GET", `/entities/${e.id}`)).status, 404);
  assertEquals((await call(A, "GET", "/entities/not-id")).status, 404);
  for (const bad of [{ ...input, prop2: -1 }, { ...input, prop3: "2023-02-29" }, { ...input, version: 2 }]) {
    assertEquals((await call(A, "POST", "/entities", bad)).status, 400);
  }
  const task =
    (await call(A, "POST", "/tasks", { kind: "once", title: "HTTP 연결", summary: "요약", entity_id: e.id })).body;
  assertEquals(
    (await call(B, "POST", "/records", { title: "외부 연결", summary: "요약", entity_id: e.id })).body.code,
    "invalid_reference",
  );
  const detail = (await call(A, "GET", `/entities/${e.id}`)).body;
  assertEquals(detail.tasks.count, 1);
  assertEquals(detail.tasks.items[0].id, task.id);
  assert((await call(A, "GET", `/tasks?entity_id=${e.id}`)).body.items.some((t: { id: string }) => t.id === task.id));
  const updated = await call(A, "PATCH", `/entities/${e.id}`, { expected_version: 1, prop2: null, prop4: "c" });
  assertEquals(updated.status, 200);
  assertEquals(updated.body.prop2, null);
  assertEquals((await call(A, "DELETE", `/entities/${e.id}?expected_version=1`)).status, 409);
  assertEquals((await call(A, "DELETE", `/entities/${e.id}?expected_version=2`)).status, 204);
  const current = (await call(A, "GET", `/tasks/${task.id}`)).body;
  assertEquals(current.entity_id, null);
  assertEquals(current.version, 2);
  await call(A, "DELETE", `/tasks/${task.id}?expected_version=2`);
});
