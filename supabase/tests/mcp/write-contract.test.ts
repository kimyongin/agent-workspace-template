import { assertEquals } from "@std/assert";
import { httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest("OAuth MCP rejects missing object UUIDs and retired request metadata/upsert tool", async () => {
  const client = await connectMcp(await mcpToken(await signIn("A")));
  try {
    const { tools } = await client.listTools();
    assertEquals(tools.some((t) => t.name === "save_current_principle"), false);
    for (
      const [name, content] of [
        ["create_entity", { prop1: "입력 거부" }],
        ["create_task", { kind: "once", title: "입력 거부" }],
        ["create_record", { body: "입력 거부" }],
        ["create_principle", { title: "입력 거부" }],
        ["create_tag", { name: "입력 거부" }],
      ] as const
    ) {
      assertEquals((await tool(client, name, { id: undefined, ...content })).error.code, "invalid_input");
      assertEquals(
        (await tool(client, name, {
          id: crypto.randomUUID(),
          ...content,
          request_id: crypto.randomUUID(),
        })).error.code,
        "invalid_input",
      );
    }
  } finally {
    await client.close();
  }
});
