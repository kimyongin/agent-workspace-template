import { assert, assertEquals } from "@std/assert";
import { indexingIssuesPage } from "../../functions/_shared/contracts/status.ts";
import { call } from "../http/_client.ts";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";

activityWorkspaceSuite(
  "status: actual authenticated HTTP/OAuth MCP readonly parity, strict input and retired tools",
  async ({ A: token, workspaceA: workspace, clientA: client }) => {
    assert(client);
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
    const http = await scopedHttp(token, workspace, "GET", "/status/indexing/issues");
    assertEquals(http.status, 200);
    indexingIssuesPage.parse(http.body);
    assertEquals(await scopedTool(client, workspace, "list_indexing_issues", {}), http.body);
    assertEquals((await call(null, "GET", "/status/indexing/issues")).status, 401);
    assertEquals((await scopedHttp(token, workspace, "GET", "/status/indexing/issues?limit=6")).status, 400);
    assertEquals(
      (await scopedTool(client, workspace, "list_indexing_issues", { owner_id: "other" })).error.code,
      "invalid_input",
    );
    const overview = await scopedHttp(token, workspace, "GET", "/status");
    const mcpOverview = await scopedTool(client, workspace, "get_status", {});
    assertEquals(mcpOverview.entities, overview.body.entities);
    assertEquals(mcpOverview.tasks, overview.body.tasks);
    assertEquals(mcpOverview.records, overview.body.records);
    assertEquals(mcpOverview.daily.length, 30);
  },
  { mcp: true },
);
