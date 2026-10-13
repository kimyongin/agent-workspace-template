import { assertEquals } from "@std/assert";
import { admin, call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest("資料 defaults HTTP/MCP: nullable memo, fixed preview, common-key rejection and owner isolation", async () => {
  const a = await signIn("A"), b = await signIn("B"), client = await connectMcp(await mcpToken(a));
  const saved = (await call(a, "GET", "/settings/business?id=record_templates")).body;
  const other = (await call(b, "GET", "/settings/business?id=record_templates")).body;
  let typeId: string | undefined;
  try {
    const created = await call(a, "POST", "/entity-types", {
      label: "Null defaults " + crypto.randomUUID(),
      icon_id: "leaf",
      representative_label: "이름",
    });
    assertEquals(created.status, 201);
    typeId = created.body.id;
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
    const stored = await call(a, "PATCH", "/settings/business", input, key);
    assertEquals(stored.status, 200);
    assertEquals(await tool(client, "update_business_settings", { ...input, request_key: key }), stored.body);
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
    const preview = await call(a, "POST", "/records/prepare", prepare);
    assertEquals(preview.status, 200);
    assertEquals(preview.body.change_note, "재료 예시 등록");
    assertEquals(await tool(client, "prepare_record_memo", prepare), preview.body);
    const rejected = {
      id: "record_templates",
      expected_version: stored.body.versions.record_templates,
      value: { entity: { create: { memo: "old common", tag_ids: [] } } },
    };
    assertEquals((await call(a, "PATCH", "/settings/business", rejected)).status, 400);
    assertEquals((await tool(client, "update_business_settings", rejected)).error.code, "invalid_input");
    assertEquals((await call(b, "GET", "/settings/business?id=record_templates")).body, other);
  } finally {
    const current = (await call(a, "GET", "/settings/business?id=record_templates")).body;
    assertEquals(
      (await call(a, "PATCH", "/settings/business", {
        id: "record_templates",
        expected_version: current.versions.record_templates,
        value: saved.settings.record_templates ?? {},
      })).status,
      200,
    );
    if (typeId) await admin`delete from app.entity_types where id=${typeId}`;
    await client.close();
  }
});
