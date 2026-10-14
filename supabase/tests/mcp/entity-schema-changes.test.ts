import { assertEquals } from "@std/assert";
import { admin, call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";
httpTest(
  "schema change HTTP/MCP parity: keyed drafts, restricted edits, owner reads and asynchronous analysis",
  async () => {
    const token = await signIn("A"), other = await signIn("B"), client = await connectMcp(await mcpToken(token));
    let id: string | undefined;
    try {
      const type = (await call(token, "POST", "/entity-types", { label: "schema parity " + crypto.randomUUID() })).body;
      id = type.id;
      const input = {
        expected_type_version: 1,
        expected_schema_version: 1,
        edits: [{
          op: "add_property",
          client_ref: "count",
          field: { type: "integer", title: "수량" },
          required: false,
        }],
      };
      const key = crypto.randomUUID();
      const created = await call(token, "POST", `/entity-types/${id}/schema-changes`, input, key);
      assertEquals(created.status, 201);
      const history = await call(token, "GET", `/entity-types/${id}/schema-changes`);
      assertEquals(history.status, 200);
      assertEquals(history.body.items[0].source_schema_version, 1);
      assertEquals(await tool(client, "list_entity_schema_changes", { type_id: id }), history.body);
      assertEquals(created.body.reservations, { count: "prop_2" });
      assertEquals(
        await tool(client, "create_entity_schema_change", { type_id: id, ...input, request_key: key }),
        created.body,
      );
      assertEquals(
        await tool(client, "get_entity_schema_change", { type_id: id, change_id: created.body.id }),
        created.body,
      );
      assertEquals((await call(other, "GET", `/entity-types/${id}/schema-changes/${created.body.id}`)).status, 404);
      assertEquals((await call(token, "POST", `/entity-types/${id}/schema-changes`, input, null)).status, 400);
      assertEquals(
        (await call(token, "POST", `/entity-types/${id}/schema-changes`, {
          ...input,
          edits: [{ op: "rename_key", key: "prop_1", to: "prop_9" }],
        })).status,
        400,
      );
      const analyzeKey = crypto.randomUUID();
      const accepted = await call(token, "POST", `/entity-types/${id}/schema-changes/${created.body.id}/analyze`, {
        expected_change_version: 1,
      }, analyzeKey);
      assertEquals(accepted.status, 202);
      assertEquals(accepted.body.status, "queued");
      assertEquals(Object.keys(accepted.body).sort(), [
        "analysis_id",
        "change_id",
        "change_version",
        "status",
        "type_id",
      ]);
      assertEquals(
        await tool(client, "analyze_entity_schema_change", {
          type_id: id,
          change_id: created.body.id,
          expected_change_version: 1,
          request_key: analyzeKey,
        }),
        accepted.body,
      );
      assertEquals((await call(token, "GET", `/entity-types/${id}/schema`)).body.schema_version, 1);
      const discardPath = `/entity-types/${id}/schema-changes/${created.body.id}/discard`;
      assertEquals((await call(other, "POST", discardPath, { expected_change_version: 1 })).status, 404);
      assertEquals((await call(token, "POST", discardPath, { expected_change_version: 2 })).status, 409);
      const discardKey = crypto.randomUUID();
      const discarded = await call(token, "POST", discardPath, { expected_change_version: 1 }, discardKey);
      assertEquals(discarded.status, 200);
      assertEquals(discarded.body.status, "cancelled");
      assertEquals(discarded.body.version, 2);
      assertEquals(
        await tool(client, "discard_entity_schema_change", {
          type_id: id,
          change_id: created.body.id,
          expected_change_version: 1,
          request_key: discardKey,
        }),
        discarded.body,
      );
      assertEquals(
        (await call(token, "GET", `/entity-types/${id}/schema-changes/${created.body.id}`)).body.status,
        "cancelled",
      );
      assertEquals((await call(token, "GET", `/entity-types/${id}/schema`)).body.schema_version, 1);
    } finally {
      if (id) await admin`delete from app.entity_types where id=${id}`;
      await client.close();
    }
  },
);
