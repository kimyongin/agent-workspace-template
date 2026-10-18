import { assert, assertEquals } from "@std/assert";
import { call } from "../http/_client.ts";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
activityWorkspaceSuite(
  "relation definitions HTTP/MCP parity: ordered roles, replay, conflict, archive and workspace isolation",
  async ({ A: a, B: b, workspaceA: w, workspaceB: otherW, clientA: client, schema }) => {
    assert(client);
    const typeId = schema.entity_type_id;
    const ends = [{ type_id: typeId, label: "상위", cardinality: "one" }, {
      type_id: typeId,
      label: "하위",
      cardinality: "many",
    }];
    const key = crypto.randomUUID(),
      created = await scopedHttp(a, w, "POST", "/entity-relation-definitions", { ends }, key);
    assertEquals(created.status, 201);
    const definitionId = created.body.id;
    assertEquals(
      await scopedTool(client, w, "create_entity_relation_definition", { ends, request_key: key }),
      created.body,
    );
    assertEquals(await scopedTool(client, w, "get_entity_relation_definition", { id: definitionId }), created.body);
    assertEquals((await scopedHttp(b, otherW, "GET", `/entity-relation-definitions/${definitionId}`)).status, 404);
    const updated = await scopedTool(client, w, "update_entity_relation_definition", {
      id: definitionId,
      expected_version: 1,
      archived: true,
    });
    assertEquals(updated.archived, true);
    const stale = await scopedHttp(a, w, "PATCH", `/entity-relation-definitions/${definitionId}`, {
      expected_version: 1,
      archived: false,
    });
    assertEquals(stale.status, 409);
    assertEquals(stale.body.code, "settings_changed");
    const filtered = await scopedTool(client, w, "list_entity_relation_definitions", {
      type_id: typeId,
      archived: "archived",
    });
    assertEquals(filtered.items.map((x: { id: string }) => x.id), [definitionId]);
    const deleted = await scopedTool(client, w, "delete_entity_relation_definition", {
      id: definitionId,
      expected_version: 2,
    });
    assertEquals(deleted, { deleted: true });
    assertEquals((await call(null, "GET", "/entity-relation-definitions")).status, 401);
  },
  { mcp: true },
);
