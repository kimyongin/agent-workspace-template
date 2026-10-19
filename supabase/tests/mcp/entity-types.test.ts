import { assert, assertEquals } from "@std/assert";
import { call } from "../http/_client.ts";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
activityWorkspaceSuite(
  "type HTTP/MCP parity: create replay, icons, schema history and workspace errors",
  async ({ A: a, B: b, workspaceA: w, workspaceB: otherW, clientA: client }) => {
    assert(client);

    assertEquals((await call(null, "GET", "/entity-types")).status, 401);
    assertEquals(
      await scopedTool(client, w, "list_entity_type_icons", {}),
      (await scopedHttp(a, w, "GET", "/entity-type-icons")).body,
    );
    const key = crypto.randomUUID(),
      input = { label: "隔離 test " + key, icon_id: "leaf", representative_label: "名前" };
    const created = await scopedHttp(a, w, "POST", "/entity-types", input, key);
    assertEquals(created.status, 201);
    const type = created.body;
    assertEquals(await scopedTool(client, w, "create_entity_type", { ...input, request_key: key }), type);
    assertEquals(await scopedTool(client, w, "get_entity_type", { type_id: type.id }), type);
    assertEquals(
      await scopedTool(client, w, "get_entity_schema", { type_id: type.id }),
      (await scopedHttp(a, w, "GET", `/entity-types/${type.id}/schema`)).body,
    );
    assertEquals(
      await scopedTool(client, w, "list_entity_schema_versions", { type_id: type.id }),
      (await scopedHttp(a, w, "GET", `/entity-types/${type.id}/schemas`)).body,
    );
    assertEquals((await scopedHttp(b, otherW, "GET", `/entity-types/${type.id}/schema`)).status, 404);
    const mutation = {
      expected_schema_version: type.schema_version,
      label: "変更",
      icon_id: "book",
      archived: true,
    };
    const updated = await scopedTool(client, w, "update_entity_type", { type_id: type.id, ...mutation });
    assertEquals(updated.schema_version, 2);
    const definition = (await scopedHttp(a, w, "GET", `/entity-types/${type.id}/schema`)).body;
    assertEquals(definition.schema["x-type-id"], type.id);
    assertEquals(definition.schema["x-version"], 2);
    assertEquals(definition.schema.title, "変更");
    assertEquals(definition.schema["x-icon"], "book");
    assertEquals(definition.schema.deprecated, true);
    assertEquals(Object.hasOwn(definition, "display"), false);
    const stale = await scopedHttp(a, w, "PATCH", `/entity-types/${type.id}`, mutation);
    assertEquals(stale.status, 409);
    assertEquals(stale.body.code, "schema_changed");
    assertEquals(stale.body.current.schema_version, 2);
    const restored = await scopedTool(client, w, "update_entity_type", {
      type_id: type.id,
      expected_schema_version: 2,
      archived: false,
    });
    assertEquals(restored.schema_version, 3);
    assertEquals(restored.archived, false);
    const original = (await scopedHttp(a, w, "GET", `/entity-types/${type.id}/schema?schema_version=1`)).body;
    assertEquals(original.schema.title, input.label);
    assertEquals(original.schema["x-version"], 1);
    const noChange = await scopedHttp(a, w, "PATCH", `/entity-types/${type.id}`, {
      expected_schema_version: 3,
      label: "変更",
      icon_id: "book",
      archived: false,
    });
    assertEquals(noChange.status, 200);
    assertEquals(noChange.body.schema_version, 3);
    assertEquals((await scopedHttp(a, w, "POST", "/entity-types", { label: "invalid", icon_id: "url" })).status, 400);
  },
  { mcp: true },
);
