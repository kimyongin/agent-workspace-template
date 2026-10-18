import { assert, assertEquals } from "@std/assert";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
activityWorkspaceSuite(
  "HTTP and MCP save body memo once and remove retired business preview interfaces",
  async ({ A: a, workspaceA: w, clientA: client, schema }) => {
    assert(client);
    const e = await scopedTool(client, w, "create_entity", {
      ...schema,
      properties: { prop_1: `memo-${crypto.randomUUID()}` },
    });

    assertEquals((await scopedHttp(a, w, "POST", "/entities/preview", {})).status, 404);
    const tools = await client.listTools();
    assertEquals(
      tools.tools.filter((t) => t.name.startsWith("preview_")).map((t) => t.name).sort(),
      ["preview_data_model"],
    );
    const memo = "  저장한 근거\n" + "가".repeat(1200);
    const saved = await scopedHttp(a, w, "PATCH", `/entities/${encodeURIComponent(e.id)}`, {
      expected_version: e.version,
      schema_version: schema.schema_version,
      properties: { prop_2: 20 },
      change_note: memo,
    });
    assertEquals(saved.status, 200);
    const events = await scopedTool(client, w, "list_records", { record_kind: "change", limit: 100 });
    const event = events.items.find((r: { change?: { target_id: string; action: string } }) =>
      r.change?.target_id === e.id && r.change?.action === "update"
    );
    assertEquals(event.body, memo);
    assertEquals(["title", "summary", "change_note"].some((k) => k in event), false);
    assertEquals(
      (await scopedTool(client, w, "update_entity", {
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
      (await scopedTool(client, w, "update_entity", {
        id: e.id,
        expected_version: saved.body.version,
        schema_version: schema.schema_version,
        properties: { prop_2: 30 },
        change_memo: { body: "old" },
      })).error.code,
      "invalid_input",
    );
  },
  { mcp: true, typed: true },
);
