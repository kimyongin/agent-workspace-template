import { assert, assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "../http/_client.ts";
import { currentPrincipleFixes } from "../http/_current-principle-fixes.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest(
  "OAuth MCP review fixes and tools/list: memo-only/no-op, snapshot clear, view/status coverage-anchor-cursor parity",
  async () => {
    const session = await signIn("A");
    const client = await connectMcp(await mcpToken(session));
    try {
      const listed = await client.listTools();
      const schema = listed.tools.find((t) => t.name === "correct_principle")!.inputSchema;
      assert((schema.required as string[]).includes("change_note"));
      assertEquals((schema.required as string[]).includes("title"), false);
      const tools: Record<string, string> = {
        current: "get_current_principle",
        save: "save_current_principle",
        get: "get_principle",
        correct: "correct_principle",
        delete: "delete_principle",
        search: "search",
        create_record: "create_record",
        update_record: "update_record",
        get_record: "get_record",
        delete_record: "delete_record",
      };
      await currentPrincipleFixes(async (operation, input) => {
        const result = await tool(client, tools[operation], input);
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
