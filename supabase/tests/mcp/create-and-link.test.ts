import { assert, assertEquals } from "@std/assert";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
activityWorkspaceSuite(
  "create-and-link HTTP/MCP parity: final version, exact replay, workspace isolation and explicit replacement",
  async ({ A: a, B: b, workspaceA: w, workspaceB: otherW, clientA: client, schema }) => {
    assert(client);
    const typeId = schema.entity_type_id;
    const nextKey = () => crypto.randomUUID();
    const def = await scopedTool(client, w, "create_entity_relation_definition", {
      request_key: nextKey(),
      ends: [{ type_id: typeId, label: "소속", cardinality: "one" }, {
        type_id: typeId,
        label: "품목",
        cardinality: "many",
      }],
    });
    const origin = (await scopedHttp(a, w, "POST", "/entities", {
      entity_type_id: typeId,
      schema_version: 1,
      properties: { prop_1: "원점" },
    }, nextKey())).body;
    const location = { definition_id: def.id, side: 0, origin_id: origin.id },
      base = `/entity-relations/${def.id}/0/${encodeURIComponent(origin.id)}`;
    const input = {
      expected_definition_version: 1,
      expected_version: 1,
      previous_other_id: null,
      expected_previous_version: null,
      entity: { action: "create", entity_type_id: typeId, schema_version: 1, properties: { prop_1: "새 상대" } },
    };
    const key = nextKey(), created = await scopedHttp(a, w, "POST", `${base}/create-and-link`, input, key);
    assertEquals(created.status, 201, JSON.stringify(created.body));
    assertEquals(created.body.entity.version, 2);
    assertEquals(
      await scopedTool(client, w, "create_and_link_entity", { ...location, ...input, request_key: key }),
      created.body,
    );
    const links = await scopedTool(client, w, "list_entity_relation_links", location);
    assertEquals(links.items.map((e: { id: string }) => e.id), [created.body.entity.id]);
    assertEquals((await scopedHttp(b, otherW, "POST", `${base}/create-and-link`, input, nextKey())).status, 404);
    const replaced = await scopedTool(client, w, "create_and_link_entity", {
      ...location,
      ...input,
      request_key: nextKey(),
      expected_version: 2,
      previous_other_id: created.body.entity.id,
      expected_previous_version: 2,
      entity: { ...input.entity, properties: { prop_1: "교체 상대" } },
    });
    assertEquals(replaced.entity.version, 2);
    assertEquals(replaced.relation.endpoint_versions.find((e: { id: string }) => e.id === origin.id).version, 3);
    assertEquals((await scopedHttp(a, w, "GET", `${base}/links`)).body.items.map((e: { id: string }) => e.id), [
      replaced.entity.id,
    ]);
    const stale = await scopedHttp(a, w, "POST", `${base}/create-and-link`, input, nextKey());
    assertEquals(stale.status, 409);
  },
  { mcp: true },
);
