import { assertEquals } from "@std/assert";
import { indexingIssuesPage } from "../../functions/_shared/contracts/status.ts";
import { call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest("status: actual authenticated HTTP/OAuth MCP readonly parity, strict input and retired tools", async () => {
  const token = await signIn("A"), client = await connectMcp(await mcpToken(token));
  try {
    const names = (await client.listTools()).tools.map((t) => t.name);
    assertEquals(new Set(names).size, names.length);
    for (
      const name of [
        "preview_data_model",
        "prepare_entity_schema_import",
        "delete_entity_issuer",
        "delete_entity_identifier_rule",
      ]
    ) {
      assertEquals(names.includes(name), true);
    }
    assertEquals(names.includes("rekey_entity"), false);
    assertEquals(names.includes("get_record_index_effects"), false);
    const http = await call(token, "GET", "/status/indexing/issues");
    assertEquals(http.status, 200);
    indexingIssuesPage.parse(http.body);
    assertEquals(await tool(client, "list_indexing_issues", {}), http.body);
    assertEquals((await call(null, "GET", "/status/indexing/issues")).status, 401);
    assertEquals((await call(token, "GET", "/status/indexing/issues?limit=6")).status, 400);
    assertEquals((await tool(client, "list_indexing_issues", { owner_id: "other" })).error.code, "invalid_input");
    const overview = await call(token, "GET", "/status");
    const mcpOverview = await tool(client, "get_status", {});
    assertEquals(mcpOverview.entities, overview.body.entities);
    assertEquals(mcpOverview.tasks, overview.body.tasks);
    assertEquals(mcpOverview.records, overview.body.records);
    assertEquals(mcpOverview.daily.length, 30);
  } finally {
    await client.close();
  }
});
