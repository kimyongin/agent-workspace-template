import { assert, assertEquals } from "@std/assert";
import { call } from "../http/_client.ts";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
import { claimsOf, tool } from "./_mcp.ts";
activityWorkspaceSuite(
  "typed relation HTTP/MCP parity: roles, candidates, exact replay, conflict and explicit replacement",
  async ({ A: a, B: b, workspaceA: w, workspaceB: otherW, clientA: client, schema }) => {
    assert(client);
    const typeId = schema.entity_type_id;
    const nextKey = () => crypto.randomUUID();
    const def = await scopedTool(client, w, "create_entity_relation_definition", {
      request_key: nextKey(),
      ends: [{ type_id: typeId, label: "소속", cardinality: "one" }, {
        type_id: typeId,
        label: "구성",
        cardinality: "many",
      }],
    });
    const values = [];
    for (const title of ["원점", "상대", "새 상대"]) {
      values.push(
        (await scopedHttp(a, w, "POST", "/entities", {
          entity_type_id: typeId,
          schema_version: 1,
          properties: { prop_1: title },
        }, nextKey())).body,
      );
    }
    const location = { definition_id: def.id, side: 0, origin_id: values[0].id },
      base = `/entity-relations/${def.id}/0/${encodeURIComponent(values[0].id)}`;
    const input = {
      other_id: values[1].id,
      expected_definition_version: 1,
      expected_version: 1,
      expected_other_version: 1,
    };
    const key = nextKey(), linked = await scopedHttp(a, w, "POST", `${base}/connect`, input, key);
    assertEquals(linked.status, 200);
    assertEquals(
      await scopedTool(client, w, "connect_entity_relation", { ...location, ...input, request_key: key }),
      linked.body,
    );
    assertEquals(
      (await scopedTool(client, w, "list_entity_relation_links", location)).items.map((e: { id: string }) => e.id),
      [values[1].id],
    );
    assertEquals((await scopedHttp(b, otherW, "GET", `${base}/links`)).status, 404);
    const candidates = await scopedTool(client, w, "list_entity_relation_candidates", { ...location, q: "새 상대" });
    assertEquals(candidates.items.map((e: { id: string }) => e.id), [values[2].id]);
    const replaced = await scopedTool(client, w, "replace_entity_relation", {
      request_key: nextKey(),
      ...location,
      ...input,
      other_id: values[2].id,
      expected_version: 2,
      previous_other_id: values[1].id,
      expected_previous_version: 2,
    });
    assertEquals(replaced.changed, true);
    const stale = await scopedHttp(a, w, "POST", `${base}/connect`, input, nextKey());
    assertEquals(stale.status, 409);
    const removed = await scopedTool(client, w, "unlink_entity_relation", {
      request_key: nextKey(),
      ...location,
      ...input,
      other_id: values[2].id,
      expected_version: 3,
      expected_other_version: 2,
    });
    assertEquals(removed.changed, true);
    assertEquals((await scopedHttp(a, w, "GET", `${base}/links`)).body.items, []);
  },
  { mcp: true },
);

activityWorkspaceSuite(
  "workspace relation real HTTP MCP share business metadata keyed writes and create replace",
  async (
    { A: token, B: memberToken, workspaceA: workspace, workspaceB: foreignWorkspace, clientB: client, schema },
  ) => {
    assert(client);
    const typeId = schema.entity_type_id;
    const request = (
      selectedWorkspace: string,
      method: string,
      path: string,
      body?: unknown,
      key = crypto.randomUUID(),
    ) => scopedHttp(memberToken, selectedWorkspace, method, path, body, key);
    const createdDefinition = await scopedHttp(token, workspace, "POST", "/entity-relation-definitions", {
      ends: [{ type_id: typeId, label: "설정 원점", cardinality: "one" }, {
        type_id: typeId,
        label: "설정 상대",
        cardinality: "one",
      }],
    });
    assertEquals(createdDefinition.status, 201);
    const invitation = await call(token, "POST", `/workspaces/${workspace}/invitations`, {
      email: claimsOf(memberToken).email,
      grants: [{ target_kind: "entity_type", target_id: typeId, access: "write" }],
    });
    assertEquals(invitation.status, 201);
    assertEquals(
      (await call(memberToken, "POST", `/invitations/${invitation.body.invitation.id}/accept`, {})).status,
      200,
    );
    const scope = { workspace_id: workspace };
    const def = createdDefinition.body;
    assertEquals((await request(workspace, "GET", "/entity-relation-definitions")).status, 403);
    assertEquals(
      (await tool(client, "list_entity_relation_definitions", { ...scope, purpose: "business", type_id: typeId })).items
        .map((item: { id: string }) => item.id),
      [def.id],
    );
    assertEquals(
      (await request(workspace, "GET", `/entity-relation-definitions/${def.id}?purpose=business`)).body,
      def,
    );
    const create = (title: string) =>
      request(workspace, "POST", "/entities", {
        entity_type_id: typeId,
        schema_version: 1,
        properties: { prop_1: title },
      });
    const origin = await create("전송 원점"), previous = await create("전송 이전 상대");
    assertEquals([origin.status, previous.status], [201, 201]);
    const location = { definition_id: def.id, side: 0, origin_id: origin.body.id },
      base = `/entity-relations/${def.id}/0/${encodeURIComponent(origin.body.id)}`;
    const candidates = await request(workspace, "GET", `${base}/candidates?q=${encodeURIComponent("전송 이전 상대")}`);
    assertEquals(candidates.status, 200);
    assertEquals(
      await tool(client, "list_entity_relation_candidates", { ...scope, ...location, q: "전송 이전 상대" }),
      candidates.body,
    );
    const input = {
      other_id: previous.body.id,
      expected_definition_version: 1,
      expected_version: 1,
      expected_other_version: 1,
    };
    const key = crypto.randomUUID(), connected = await request(workspace, "POST", `${base}/connect`, input, key);
    assertEquals(connected.status, 200);
    assertEquals(
      await tool(client, "connect_entity_relation", { ...scope, ...location, ...input, request_key: key }),
      connected.body,
    );
    const nextKey = crypto.randomUUID(),
      nextInput = {
        expected_definition_version: 1,
        expected_version: 2,
        previous_other_id: previous.body.id,
        expected_previous_version: 2,
        entity: { entity_type_id: typeId, schema_version: 1, properties: { prop_1: "전송 새 상대" } },
      };
    const replaced = await tool(client, "create_and_link_entity", {
      ...scope,
      ...location,
      ...nextInput,
      request_key: nextKey,
    });
    assertEquals(replaced.entity.version, 2);
    assertEquals((await request(workspace, "POST", `${base}/create-and-link`, nextInput, nextKey)).body, replaced);
    assertEquals(
      (await tool(client, "list_entity_relation_links", { ...scope, ...location })).items.map((item: { id: string }) =>
        item.id
      ),
      [replaced.entity.id],
    );
    const removed = await tool(client, "unlink_entity_relation", {
      ...scope,
      ...location,
      other_id: replaced.entity.id,
      expected_definition_version: 1,
      expected_version: 3,
      expected_other_version: 2,
      request_key: crypto.randomUUID(),
    });
    assertEquals(removed.changed, true);
    assertEquals((await request(workspace, "GET", `${base}/links`)).body.items, []);
    assertEquals((await request(foreignWorkspace, "GET", `${base}/links`)).status, 404);
  },
  { mcp: true },
);
