import { assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "./_client.ts";

httpTest("writes require request keys and reject client IDs and retired metadata/current upsert", async () => {
  const token = await signIn("A");
  for (
    const [path, content] of [
      ["/entities", { prop1: "입력 거부" }],
      ["/tasks", { kind: "once", title: "입력 거부" }],
      ["/records", { body: "입력 거부" }],
      ["/principles", { title: "입력 거부" }],
      ["/tags", { name: "입력 거부" }],
    ] as const
  ) {
    assertEquals((await call(token, "POST", path, content, null)).status, 400);
    assertEquals(
      (await call(token, "POST", path, {
        id: crypto.randomUUID(),
        ...content,
        request_id: crypto.randomUUID(),
      })).status,
      400,
    );
  }
  assertEquals((await call(token, "POST", "/principles/current", { title: "과거 경로" })).status, 404);
});

httpTest("retired HTTP paths return 404 and preserve their target values", async () => {
  const token = await signIn("A");
  const task = (await call(token, "POST", "/tasks", { kind: "once", title: "retired-route-proof" })).body;
  const record = (await call(token, "POST", "/records", { body: "retired-route-proof" })).body;
  const entity = (await call(token, "POST", "/entities", {
    source: "app",
    external_id: crypto.randomUUID(),
    prop1: "retired-route-proof",
  })).body;
  const baseline = (await call(token, "GET", "/principles/current")).body.current;
  const principle = baseline ?? (await call(token, "POST", "/principles", { title: "retired-route-proof" })).body;
  const taskBefore = (await call(token, "GET", `/tasks/${task.id}`)).body;
  const recordBefore = (await call(token, "GET", `/records/${record.id}`)).body;
  try {
    for (
      const [method, path] of [
        ["DELETE", `/tasks/${task.id}?expected_version=${task.version}`],
        ["DELETE", `/entities/${encodeURIComponent(entity.id)}?expected_version=${entity.version}`],
        ["DELETE", `/principles/${principle.id}?expected_version=${principle.version}`],
        ["POST", `/entities/${encodeURIComponent(entity.id)}/identity`],
        ["GET", `/records/${record.id}/index-effects`],
      ]
    ) {
      const response = await call(
        token,
        method,
        path,
        method === "POST"
          ? { source: "app", external_id: "unexpected-rekey", expected_version: entity.version }
          : undefined,
      );
      assertEquals(response.status, 404);
    }
    assertEquals((await call(token, "GET", `/tasks/${task.id}`)).body, taskBefore);
    assertEquals((await call(token, "GET", `/records/${record.id}`)).body, recordBefore);
    assertEquals((await call(token, "GET", `/principles/${principle.id}`)).body, principle);
    const retained = (await call(token, "GET", `/entities/${encodeURIComponent(entity.id)}`)).body;
    assertEquals([retained.id, retained.version, retained.deleted_at], [entity.id, entity.version, null]);
  } finally {
    if (!baseline) {
      await call(token, "POST", `/principles/${principle.id}/delete`, { expected_version: principle.version });
    }
    await call(token, "POST", `/tasks/${task.id}/delete`, { expected_version: task.version });
    await call(token, "DELETE", `/records/${record.id}?expected_version=${record.version}`);
    await call(token, "POST", `/entities/${encodeURIComponent(entity.id)}/delete`, {
      expected_version: entity.version,
    });
  }
});
