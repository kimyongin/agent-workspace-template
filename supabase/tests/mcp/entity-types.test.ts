import { assertEquals } from "@std/assert";
import { admin, call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";
httpTest("type HTTP/MCP parity: create replay, icons, schema history and owner errors", async () => {
  const a = await signIn("A"), b = await signIn("B"), client = await connectMcp(await mcpToken(a));
  let createdId: string | undefined;
  try {
    assertEquals((await call(null, "GET", "/entity-types")).status, 401);
    assertEquals(await tool(client, "list_entity_type_icons", {}), (await call(a, "GET", "/entity-type-icons")).body);
    const key = crypto.randomUUID(),
      input = { label: "隔離 test " + key, icon_id: "leaf", representative_label: "名前" };
    const created = await call(a, "POST", "/entity-types", input, key);
    assertEquals(created.status, 201);
    const type = created.body;
    createdId = type.id;
    assertEquals(await tool(client, "create_entity_type", { ...input, request_key: key }), type);
    assertEquals(await tool(client, "get_entity_type", { type_id: type.id }), type);
    assertEquals(
      await tool(client, "get_entity_schema", { type_id: type.id }),
      (await call(a, "GET", `/entity-types/${type.id}/schema`)).body,
    );
    assertEquals(
      await tool(client, "list_entity_schema_versions", { type_id: type.id }),
      (await call(a, "GET", `/entity-types/${type.id}/schemas`)).body,
    );
    assertEquals((await call(b, "GET", `/entity-types/${type.id}/schema`)).status, 404);
    const mutation = {
      expected_schema_version: type.schema_version,
      label: "変更",
      icon_id: "book",
      archived: true,
    };
    const updated = await tool(client, "update_entity_type", { type_id: type.id, ...mutation });
    assertEquals(updated.schema_version, 2);
    const definition = (await call(a, "GET", `/entity-types/${type.id}/schema`)).body;
    assertEquals(definition.schema["x-type-id"], type.id);
    assertEquals(definition.schema["x-version"], 2);
    assertEquals(definition.schema.title, "変更");
    assertEquals(definition.schema["x-icon"], "book");
    assertEquals(definition.schema.deprecated, true);
    assertEquals(Object.hasOwn(definition, "display"), false);
    const stale = await call(a, "PATCH", `/entity-types/${type.id}`, mutation);
    assertEquals(stale.status, 409);
    assertEquals(stale.body.code, "schema_changed");
    assertEquals(stale.body.current.schema_version, 2);
    const restored = await tool(client, "update_entity_type", {
      type_id: type.id,
      expected_schema_version: 2,
      archived: false,
    });
    assertEquals(restored.schema_version, 3);
    assertEquals(restored.archived, false);
    const original = (await call(a, "GET", `/entity-types/${type.id}/schema?schema_version=1`)).body;
    assertEquals(original.schema.title, input.label);
    assertEquals(original.schema["x-version"], 1);
    const noChange = await call(a, "PATCH", `/entity-types/${type.id}`, {
      expected_schema_version: 3,
      label: "変更",
      icon_id: "book",
      archived: false,
    });
    assertEquals(noChange.status, 200);
    assertEquals(noChange.body.schema_version, 3);
    assertEquals((await call(a, "POST", "/entity-types", { label: "invalid", icon_id: "url" })).status, 400);
  } finally {
    if (createdId) await admin`delete from app.entity_types where id=${createdId}`;
    await client.close();
  }
});
