import { assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest("HTTP and MCP task previews reject foreign, missing and deleted selections like final writes", async () => {
  const session = await signIn("A"), other = await signIn("B"), client = await connectMcp(await mcpToken(session));
  const own = (await call(session, "POST", "/entities", { prop1: "미리보기 소유 대상" })).body;
  const foreign = (await call(other, "POST", "/entities", { prop1: "미리보기 타인 대상" })).body;
  const deleted = (await call(session, "POST", "/entities", { prop1: "미리보기 삭제 대상" })).body;
  let taskId: string | undefined;
  try {
    assertEquals(
      (await call(session, "DELETE", `/entities/${deleted.id}?expected_version=${deleted.version}`)).status,
      204,
    );
    const created = await call(session, "POST", "/tasks", {
      kind: "once",
      title: "미리보기 회귀" + crypto.randomUUID(),
      summary: "저장하지 않는 조회",
    });
    assertEquals(created.status, 201);
    const task = created.body;
    taskId = task.id;
    const before = await tool(client, "get_task", { id: task.id });
    for (const target of [foreign.id, crypto.randomUUID(), deleted.id]) {
      const create = { kind: "once", title: "거부 업무", summary: "대상 검증", entity_ids: [own.id, target] };
      const patch = { expected_version: task.version, title: "거부 수정", entity_ids: [own.id, target] };
      for (const preview of [{ action: "create", input: create }, { action: "update", id: task.id, input: patch }]) {
        const http = await call(session, "POST", "/tasks/preview", preview);
        assertEquals(http.status, 400);
        assertEquals(http.body.code, "invalid_reference");
        assertEquals((await tool(client, "preview_task_change", preview)).error.code, "invalid_reference");
      }
      assertEquals((await call(session, "POST", "/tasks", create)).body.code, "invalid_reference");
      assertEquals((await tool(client, "update_task", { id: task.id, ...patch })).error.code, "invalid_reference");
    }
    for (const selection of [{}, { entity_ids: [] }, { entity_ids: [own.id] }, { entity_id: own.id }]) {
      const preview = {
        action: "update",
        id: task.id,
        input: { expected_version: task.version, title: "읽기 전용 수정 미리보기", ...selection },
      };
      const http = await call(session, "POST", "/tasks/preview", preview);
      assertEquals(http.status, 200);
      assertEquals(http.body, await tool(client, "preview_task_change", preview));
    }
    assertEquals(await tool(client, "get_task", { id: task.id }), before);
  } finally {
    if (taskId) {
      const latest = await tool(client, "get_task", { id: taskId });
      await tool(client, "delete_task", { id: taskId, expected_version: latest.version });
    }
    for (const [token, target] of [[session, own], [other, foreign]] as const) {
      await call(token, "DELETE", `/entities/${target.id}?expected_version=${target.version}`);
    }
    await client.close();
  }
});
