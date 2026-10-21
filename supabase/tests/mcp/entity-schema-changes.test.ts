import { assert, assertEquals } from "@std/assert";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
activityWorkspaceSuite(
  "schema change HTTP/MCP parity: keyed drafts, restricted edits, workspace reads and asynchronous analysis",
  async ({ A: token, B: other, workspaceA: w, workspaceB: otherW, clientA: client, schema }) => {
    assert(client);
    const id = schema.entity_type_id;
    const input = {
      expected_schema_version: 1,
      edits: [{
        op: "add_property",
        client_ref: "count",
        field: { type: "integer", title: "수량", "x-order": 20 },
        required: false,
      }],
    };
    const key = crypto.randomUUID();
    const created = await scopedHttp(token, w, "POST", `/entity-types/${id}/schema-changes`, input, key);
    assertEquals(created.status, 201);
    const history = await scopedHttp(token, w, "GET", `/entity-types/${id}/schema-changes`);
    assertEquals(history.status, 200);
    assertEquals(history.body.items[0].source_schema_version, 1);
    assertEquals(await scopedTool(client, w, "list_entity_schema_changes", { type_id: id }), history.body);
    assertEquals(created.body.reservations, { count: "prop_2" });
    assertEquals(
      await scopedTool(client, w, "create_entity_schema_change", { type_id: id, ...input, request_key: key }),
      created.body,
    );
    assertEquals(
      await scopedTool(client, w, "get_entity_schema_change", { type_id: id, change_id: created.body.id }),
      created.body,
    );
    assertEquals(
      (await scopedHttp(other, otherW, "GET", `/entity-types/${id}/schema-changes/${created.body.id}`)).status,
      404,
    );
    assertEquals((await scopedHttp(token, w, "POST", `/entity-types/${id}/schema-changes`, input, null)).status, 400);
    assertEquals(
      (await scopedHttp(token, w, "POST", `/entity-types/${id}/schema-changes`, {
        ...input,
        edits: [{ op: "rename_key", key: "prop_1", to: "prop_9" }],
      })).status,
      400,
    );
    const analyzeKey = crypto.randomUUID();
    const accepted = await scopedHttp(
      token,
      w,
      "POST",
      `/entity-types/${id}/schema-changes/${created.body.id}/analyze`,
      {
        expected_change_version: 1,
      },
      analyzeKey,
    );
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
      await scopedTool(client, w, "analyze_entity_schema_change", {
        type_id: id,
        change_id: created.body.id,
        expected_change_version: 1,
        request_key: analyzeKey,
      }),
      accepted.body,
    );
    assertEquals((await scopedHttp(token, w, "GET", `/entity-types/${id}/schema`)).body.schema_version, 1);
    const discardPath = `/entity-types/${id}/schema-changes/${created.body.id}/discard`;
    assertEquals((await scopedHttp(other, otherW, "POST", discardPath, { expected_change_version: 1 })).status, 404);
    assertEquals((await scopedHttp(token, w, "POST", discardPath, { expected_change_version: 2 })).status, 409);
    const discardKey = crypto.randomUUID();
    const discarded = await scopedHttp(token, w, "POST", discardPath, { expected_change_version: 1 }, discardKey);
    assertEquals(discarded.status, 200);
    assertEquals(discarded.body.status, "cancelled");
    assertEquals(discarded.body.version, 2);
    assertEquals(
      await scopedTool(client, w, "discard_entity_schema_change", {
        type_id: id,
        change_id: created.body.id,
        expected_change_version: 1,
        request_key: discardKey,
      }),
      discarded.body,
    );
    assertEquals(
      (await scopedHttp(token, w, "GET", `/entity-types/${id}/schema-changes/${created.body.id}`)).body.status,
      "cancelled",
    );
    assertEquals((await scopedHttp(token, w, "GET", `/entity-types/${id}/schema`)).body.schema_version, 1);
  },
  { mcp: true },
);
