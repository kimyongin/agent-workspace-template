import { assertEquals } from "@std/assert";
import { admin, call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";
httpTest(
  "relation definitions HTTP/MCP parity: ordered roles, replay, conflict, archive and owner isolation",
  async () => {
    const a = await signIn("A"), b = await signIn("B"), client = await connectMcp(await mcpToken(a));
    let typeId: string | undefined, definitionId: string | undefined;
    try {
      const type = await call(a, "POST", "/entity-types", { label: `관계 검사 ${crypto.randomUUID()}` });
      typeId = type.body.id;
      assertEquals(type.status, 201);
      const ends = [{ type_id: typeId, label: "상위", cardinality: "one" }, {
        type_id: typeId,
        label: "하위",
        cardinality: "many",
      }];
      const key = crypto.randomUUID(), created = await call(a, "POST", "/entity-relation-definitions", { ends }, key);
      assertEquals(created.status, 201);
      definitionId = created.body.id;
      assertEquals(await tool(client, "create_entity_relation_definition", { ends, request_key: key }), created.body);
      assertEquals(await tool(client, "get_entity_relation_definition", { id: definitionId }), created.body);
      assertEquals((await call(b, "GET", `/entity-relation-definitions/${definitionId}`)).status, 404);
      const updated = await tool(client, "update_entity_relation_definition", {
        id: definitionId,
        expected_version: 1,
        archived: true,
      });
      assertEquals(updated.archived, true);
      const stale = await call(a, "PATCH", `/entity-relation-definitions/${definitionId}`, {
        expected_version: 1,
        archived: false,
      });
      assertEquals(stale.status, 409);
      assertEquals(stale.body.code, "settings_changed");
      const filtered = await tool(client, "list_entity_relation_definitions", {
        type_id: typeId,
        archived: "archived",
      });
      assertEquals(filtered.items.map((x: { id: string }) => x.id), [definitionId]);
      const deleted = await tool(client, "delete_entity_relation_definition", {
        id: definitionId,
        expected_version: 2,
      });
      assertEquals(deleted, { deleted: true });
      assertEquals((await call(null, "GET", "/entity-relation-definitions")).status, 401);
    } finally {
      if (definitionId) await admin`delete from app.entity_relation_definitions where id=${definitionId}::uuid`;
      if (typeId) await admin`delete from app.entity_types where id=${typeId}::uuid`;
      await client.close();
    }
  },
);
