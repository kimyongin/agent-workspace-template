import { assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";
import { httpEntityFixture } from "../http/_entity.ts";
httpTest("HTTP and MCP save body memo once and remove retired business preview interfaces", async () => {
  const a = await signIn("A"), client = await connectMcp(await mcpToken(a));
  const schema = await httpEntityFixture(a);
  const e = await tool(client, "create_entity", { ...schema, properties: { prop_1: `memo-${crypto.randomUUID()}` } });
  try {
    assertEquals((await call(a, "POST", "/entities/preview", {})).status, 404);
    const tools = await client.listTools();
    assertEquals(
      tools.tools.filter((t) => t.name.startsWith("preview_")).map((t) => t.name).sort(),
      ["preview_data_model"],
    );
    const memo = "  저장한 근거\n" + "가".repeat(1200);
    const saved = await call(a, "PATCH", `/entities/${encodeURIComponent(e.id)}`, {
      expected_version: e.version,
      schema_version: schema.schema_version,
      properties: { prop_2: 20 },
      change_note: memo,
    });
    assertEquals(saved.status, 200);
    const events = await tool(client, "list_records", { record_kind: "change", limit: 100 });
    const event = events.items.find((r: { change?: { target_id: string; action: string } }) =>
      r.change?.target_id === e.id && r.change?.action === "update"
    );
    assertEquals(event.body, memo);
    assertEquals(["title", "summary", "change_note"].some((k) => k in event), false);
    assertEquals(
      (await tool(client, "update_entity", {
        id: e.id,
        schema_version: schema.schema_version,
        expected_version: e.version,
        properties: { prop_2: 20 },
        change_note: memo,
      }))
        .error.code,
      "conflict",
    );
    assertEquals(
      (await tool(client, "update_entity", {
        id: e.id,
        expected_version: saved.body.version,
        schema_version: schema.schema_version,
        properties: { prop_2: 30 },
        change_memo: { body: "old" },
      })).error.code,
      "invalid_input",
    );
  } finally {
    await tool(client, "delete_entity", {
      id: e.id,
      expected_version: (await tool(client, "get_entity", { id: e.id })).version,
    });
    await client.close();
  }
});
