import { assert, assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";
httpTest("Entity MCP: 실제 SDK/OAuth CRUD·웹 parity·참조 거부·삭제 보존", async () => {
  const token = await signIn("A"), client = await connectMcp(await mcpToken(token));
  try {
    const listed = await client.listTools();
    for (const name of ["list_entities", "get_entity", "create_entity", "update_entity", "delete_entity"]) {
      assert(listed.tools.some((t) => t.name === name));
    }
    const e = await tool(client, "create_entity", {
      prop1: "MCP 엔터티",
      prop2: 1,
      prop4: "b",
      request_id: crypto.randomUUID(),
    });
    assertEquals((await call(token, "GET", `/entities/${e.id}`)).body.prop1, e.prop1);
    assertEquals((await tool(client, "get_entity", { id: "bad-id" })).error.code, "not_found");
    const p = await tool(client, "create_principle", { title: "연결 원칙", summary: "요약", entity_id: e.id });
    assertEquals((await tool(client, "get_entity", { id: e.id })).principles.count, 1);
    assertEquals((await tool(client, "list_principles", { entity_id: e.id })).items[0].id, p.id);
    assertEquals(
      (await tool(client, "update_entity", { id: e.id, expected_version: 2, prop1: "경쟁" })).error.code,
      "conflict",
    );
    const changed = await tool(client, "update_entity", { id: e.id, expected_version: 1, prop3: "2026-10-04" });
    assertEquals(changed.version, 2);
    await tool(client, "delete_entity", { id: e.id, expected_version: 2 });
    const current = await tool(client, "get_principle", { id: p.id });
    assertEquals(current.entity_id, null);
    assertEquals(current.version, 2);
    await tool(client, "delete_principle", { id: p.id, expected_version: 2 });
  } finally {
    await client.close();
  }
});
