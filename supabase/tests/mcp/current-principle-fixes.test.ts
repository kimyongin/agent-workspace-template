import { assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "../http/_client.ts";
import { currentPrincipleFixes } from "../http/_current-principle-fixes.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest(
  "OAuth MCP review fixes and tools/list: retired writers absent, current-only search and readonly snapshots",
  async () => {
    const session = await signIn("A");
    const client = await connectMcp(await mcpToken(session));
    try {
      const listed = await client.listTools();
      assertEquals(listed.tools.some((t) => ["correct_principle", "list_principles"].includes(t.name)), false);
      const schema = listed.tools.find((t) => t.name === "create_record")!.inputSchema;
      assertEquals("entity_id" in schema.properties!, false);
      assertEquals("applied_principle_ids" in schema.properties!, false);
      const tools: Record<string, string> = {
        current: "get_current_principle",
        create: "create_principle",
        update: "update_principle",
        retry_record: "update_record",
        get: "get_principle",
        delete: "delete_principle",
        search: "search",
        create_record: "create_record",
        update_record: "update_record",
        get_record: "get_record",
        delete_record: "delete_record",
      };
      await currentPrincipleFixes(async (operation, input) => {
        const result = await tool(client, tools[operation], input);
        if (operation === "retry_record") return result.error;
        assertEquals(result.error, undefined);
        if (operation === "search") {
          const http = await call(session, "POST", "/search", input);
          assertEquals(http.status, 200);
          assertEquals(result, http.body);
        }
        return result;
      });
    } finally {
      await client.close();
    }
  },
);
