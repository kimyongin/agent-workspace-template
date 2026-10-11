import { assert, assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "./_client.ts";
const A = await signIn("A"), B = await signIn("B");
httpTest("Entity HTTP: CRUD·권한·입력·버전·참조·삭제 보존 실제 진입점", async () => {
  assertEquals((await call(null, "GET", "/entities")).status, 401);
  assertEquals((await call(A, "POST", "/entities/prepare", { source: "app" })).status, 404);
  const settings = await call(A, "GET", "/settings/business?id=entity_identity");
  assertEquals(settings.status, 200);
  assertEquals(Object.keys(settings.body.settings), ["entity_identity"]);
  const settings_version = settings.body.versions.entity_identity;
  const input = {
    settings_version,
    source: "app",
    external_id: crypto.randomUUID(),
    prop1: "  실제 엔터티  ",
    prop2: 0,
    prop3: "2024-02-29",
  };
  assertEquals(
    (await call(A, "POST", "/entities", { ...input, settings_version: settings_version + 1 })).body.code,
    "settings_changed",
  );
  const created = await call(A, "POST", "/entities", input);
  assertEquals(created.status, 201);
  const e = created.body;
  assertEquals(e.prop1, "실제 엔터티");
  assertEquals((await call(A, "POST", "/entities", input)).status, 409);
  assertEquals((await call(B, "GET", `/entities/${encodeURIComponent(e.id)}`)).status, 404);
  assertEquals((await call(A, "GET", "/entities/not-id")).status, 404);
  for (const bad of [{ ...input, prop2: -1 }, { ...input, prop3: "2023-02-29" }, { ...input, version: 2 }]) {
    assertEquals((await call(A, "POST", "/entities", bad)).status, 400);
  }
  const task = (await call(A, "POST", "/tasks", { kind: "once", title: "HTTP 연결", entity_ids: [e.id] })).body;
  assertEquals(
    (await call(B, "POST", "/records", { body: "외부 연결", entity_ids: [e.id] })).body.code,
    "invalid_reference",
  );
  const detail = (await call(A, "GET", `/entities/${encodeURIComponent(e.id)}`)).body;
  assertEquals(detail.tasks.count, 1);
  assertEquals(detail.tasks.items[0].id, task.id);
  assert((await call(A, "GET", `/tasks?entity_id=${e.id}`)).body.items.some((t: { id: string }) => t.id === task.id));
  const search = { query: "HTTP 연결", entity_id: e.id, mode: "keyword", kinds: ["task"] };
  assertEquals((await call(A, "POST", "/search", search)).body.items.map((x: { id: string }) => x.id), [task.id]);
  assertEquals((await call(B, "POST", "/search", search)).body.items, []);
  assertEquals(
    (await call(A, "POST", "/search", { ...search, entity_id: `app:${crypto.randomUUID()}` })).body.items,
    [],
  );
  assertEquals((await call(A, "POST", "/search", { ...search, entity_id: "bad" })).body.code, "invalid_input");
  const updated = await call(A, "PATCH", `/entities/${encodeURIComponent(e.id)}`, {
    change_note: "테스트 변경 이유",
    expected_version: 1,
    prop2: null,
    prop4: "c",
  });
  assertEquals(updated.status, 200);
  assertEquals(updated.body.prop2, null);
  assertEquals(
    (await call(A, "POST", `/entities/${encodeURIComponent(e.id)}/delete`, { expected_version: 1 })).status,
    409,
  );
  assertEquals(
    (await call(A, "POST", `/entities/${encodeURIComponent(e.id)}/delete`, { expected_version: 2 })).status,
    204,
  );
  const current = (await call(A, "GET", `/tasks/${task.id}`)).body;
  assertEquals(current.entity_ids, [e.id]);
  assertEquals(current.version, 1);
  assertEquals((await call(A, "POST", "/search", search)).body.items.map((t: { id: string }) => t.id), [task.id]);
  assertEquals(
    (await call(A, "POST", "/search", { query: search.query, mode: "keyword", kinds: ["task"] })).body.items[0].id,
    task.id,
  );
  const retained = (await call(A, "GET", `/entities/${encodeURIComponent(e.id)}`)).body;
  assert(retained.deleted_at);
  assertEquals([retained.prop1, retained.prop2, retained.prop4, retained.version], ["실제 엔터티", null, "c", 3]);
  for (const expected_version of [undefined, 2]) {
    assertEquals(
      (await call(A, "POST", "/entities", { ...input, ...expected_version === undefined ? {} : { expected_version } }))
        .body.code,
      "conflict",
    );
  }
  const restored = await call(A, "POST", "/entities", {
    source: input.source,
    external_id: input.external_id,
    settings_version,
    expected_version: retained.version,
  });
  assertEquals(restored.status, 201);
  assertEquals([
    restored.body.id,
    restored.body.prop1,
    restored.body.prop2,
    restored.body.prop4,
    restored.body.version,
    restored.body.deleted_at,
  ], [e.id, "실제 엔터티", null, "c", 4, null]);
  await call(A, "POST", `/entities/${encodeURIComponent(e.id)}/delete`, { expected_version: 4 });
  await call(A, "POST", `/tasks/${task.id}/delete`, { expected_version: 1 });
});
