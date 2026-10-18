import { assert, assertEquals } from "@std/assert";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";

activityWorkspaceSuite(
  "資料 defaults HTTP/MCP: nullable memo, fixed preview, common-key rejection and workspace isolation",
  async ({ A: a, B: b, workspaceA: w, workspaceB: otherW, clientA: client, schema }) => {
    assert(client);
    const saved = (await scopedHttp(a, w, "GET", "/settings/business?id=record_templates")).body;
    const other = (await scopedHttp(b, otherW, "GET", "/settings/business?id=record_templates")).body;
    const typeId = schema.entity_type_id;
    const input = {
      id: "record_templates",
      expected_version: saved.versions.record_templates,
      value: {
        ...saved.settings.record_templates,
        entity_types: {
          ...saved.settings.record_templates?.entity_types,
          [typeId!]: { create: { memo: null, tag_ids: [] } },
        },
      },
    };
    const key = crypto.randomUUID();
    const stored = await scopedHttp(a, w, "PATCH", "/settings/business", input, key);
    assertEquals(stored.status, 200);
    assertEquals(await scopedTool(client, w, "update_business_settings", { ...input, request_key: key }), stored.body);
    assertEquals(stored.body.settings.record_templates.entity_types[typeId!].create.memo, null);
    const prepare = {
      model: "entity",
      action: "create",
      input: {
        entity_type_id: typeId,
        schema_version: 1,
        properties: { prop_1: "재료 예시" },
      },
    };
    const preview = await scopedHttp(a, w, "POST", "/records/prepare", prepare);
    assertEquals(preview.status, 200);
    assertEquals(preview.body.change_note, "재료 예시 등록");
    assertEquals(await scopedTool(client, w, "prepare_record_memo", prepare), preview.body);
    const rejected = {
      id: "record_templates",
      expected_version: stored.body.versions.record_templates,
      value: { entity: { create: { memo: "old common", tag_ids: [] } } },
    };
    assertEquals((await scopedHttp(a, w, "PATCH", "/settings/business", rejected)).status, 400);
    assertEquals((await scopedTool(client, w, "update_business_settings", rejected)).error.code, "invalid_input");
    assertEquals((await scopedHttp(b, otherW, "GET", "/settings/business?id=record_templates")).body, other);
  },
  { mcp: true },
);
