import { assertEquals } from "@std/assert";
import { admin, API, call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";
httpTest(
  "typed relation HTTP/MCP parity: roles, candidates, exact replay, conflict and explicit replacement",
  async () => {
    const a = await signIn("A"), b = await signIn("B"), client = await connectMcp(await mcpToken(a));
    let typeId: string | undefined, definitionId: string | undefined;
    const owner = JSON.parse(atob(a.split(".")[1].replaceAll("-", "+").replaceAll("_", "/"))).sub as string;
    const keys: string[] = [], failures: unknown[] = [];
    const nextKey = () => {
      const key = crypto.randomUUID();
      keys.push(key);
      return key;
    };
    try {
      const type = await call(a, "POST", "/entity-types", { label: `관계 업무 ${crypto.randomUUID()}` }, nextKey());
      assertEquals(type.status, 201);
      typeId = type.body.id;
      const def = await tool(client, "create_entity_relation_definition", {
        request_key: nextKey(),
        ends: [{ type_id: typeId, label: "소속", cardinality: "one" }, {
          type_id: typeId,
          label: "구성",
          cardinality: "many",
        }],
      });
      definitionId = def.id;
      const values = [];
      for (const title of ["원점", "상대", "새 상대"]) {
        values.push(
          (await call(a, "POST", "/entities", {
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
      const key = nextKey(), linked = await call(a, "POST", `${base}/connect`, input, key);
      assertEquals(linked.status, 200);
      assertEquals(
        await tool(client, "connect_entity_relation", { ...location, ...input, request_key: key }),
        linked.body,
      );
      assertEquals(
        (await tool(client, "list_entity_relation_links", location)).items.map((e: { id: string }) => e.id),
        [values[1].id],
      );
      assertEquals((await call(b, "GET", `${base}/links`)).status, 404);
      const candidates = await tool(client, "list_entity_relation_candidates", { ...location, q: "새 상대" });
      assertEquals(candidates.items.map((e: { id: string }) => e.id), [values[2].id]);
      const replaced = await tool(client, "replace_entity_relation", {
        request_key: nextKey(),
        ...location,
        ...input,
        other_id: values[2].id,
        expected_version: 2,
        previous_other_id: values[1].id,
        expected_previous_version: 2,
      });
      assertEquals(replaced.changed, true);
      const stale = await call(a, "POST", `${base}/connect`, input, nextKey());
      assertEquals(stale.status, 409);
      const removed = await tool(client, "unlink_entity_relation", {
        request_key: nextKey(),
        ...location,
        ...input,
        other_id: values[2].id,
        expected_version: 3,
        expected_other_version: 2,
      });
      assertEquals(removed.changed, true);
      assertEquals((await call(a, "GET", `${base}/links`)).body.items, []);
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        await admin.begin(async (tx) => {
          const rows = typeId
            ? await tx`select id from app.entities where owner_id=${owner} and entity_type_id=${typeId}::uuid`
            : [];
          const ids = rows.map((row) => String(row.id));
          const records =
            await tx`select id from app.records where owner_id=${owner} and change_metadata->>'target_kind'='entity' and change_metadata->>'target_id'=any(${ids}::text[])`;
          const recordIds = records.map((row) => String(row.id));
          await tx`delete from private.request_results where owner_id=${owner} and request_key=any(${keys}::uuid[])`;
          await tx`delete from pgmq.q_search_index where message->>'owner_id'=${owner} and message->>'kind'='record' and message->>'id'=any(${recordIds}::text[])`;
          await tx`delete from pgmq.a_search_index where message->>'owner_id'=${owner} and message->>'kind'='record' and message->>'id'=any(${recordIds}::text[])`;
          await tx`delete from private.passage_effects where owner_id=${owner} and record_id=any(${recordIds}::text[])`;
          await tx`delete from app.search_chunks where owner_id=${owner} and record_id=any(${recordIds}::text[])`;
          await tx`delete from app.search_index_state where owner_id=${owner} and kind='record' and id=any(${recordIds}::text[])`;
          await tx`delete from app.records where owner_id=${owner} and id=any(${recordIds}::text[])`;
          if (definitionId) {
            await tx`delete from app.entity_relation_links where owner_id=${owner} and definition_id=${definitionId}::uuid`;
            await tx`delete from app.entity_relation_definitions where owner_id=${owner} and id=${definitionId}::uuid`;
          }
          if (typeId) {
            await tx`delete from app.entities where owner_id=${owner} and entity_type_id=${typeId}::uuid`;
            await tx`delete from app.entity_types where owner_id=${owner} and id=${typeId}::uuid`;
          }
        });
      } catch (error) {
        failures.push(error);
      }
      try {
        await client.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "typed relation workflow or owned fixture cleanup failed");
  },
);

httpTest("workspace relation real HTTP MCP share business metadata keyed writes and create replace", async () => {
  const token = await signIn("A"), client = await connectMcp(await mcpToken(token));
  const actor = JSON.parse(atob(token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/"))).sub as string;
  const owned: string[] = [];
  const request = async (
    workspace: string,
    method: string,
    path: string,
    body?: unknown,
    key = crypto.randomUUID(),
  ) => {
    const response = await fetch(API + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "X-Workspace-Id": workspace,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  try {
    const made = await call(token, "POST", "/workspaces", { name: `관계 transport ${crypto.randomUUID()}` });
    assertEquals(made.status, 201);
    const workspace = made.body.workspace.id as string;
    owned.push(workspace);
    const kind = await request(workspace, "POST", "/entity-types", { label: `전송 자료 ${crypto.randomUUID()}` });
    assertEquals(kind.status, 201);
    const typeId = kind.body.id as string;
    const permission = await call(token, "PATCH", `/workspaces/${workspace}/members/${actor}`, {
      expected_version: 1,
      grants: [{ target_kind: "settings", target_id: "*", access: "write" }, {
        target_kind: "entity_type",
        target_id: typeId,
        access: "write",
      }],
    });
    assertEquals(permission.status, 200);
    const scope = { workspace_id: workspace };
    const def = await tool(client, "create_entity_relation_definition", {
      ...scope,
      ends: [{ type_id: typeId, label: "설정 원점", cardinality: "one" }, {
        type_id: typeId,
        label: "설정 상대",
        cardinality: "one",
      }],
    });
    assertEquals(typeof def.id, "string");
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
    const foreign = await call(token, "POST", "/workspaces", { name: `다른 transport ${crypto.randomUUID()}` });
    assertEquals(foreign.status, 201);
    owned.push(foreign.body.workspace.id);
    assertEquals((await request(foreign.body.workspace.id, "GET", `${base}/links`)).status, 404);
  } finally {
    try {
      await client.close();
    } finally {
      for (const workspace of owned) {
        await admin`delete from pgmq.q_search_index where message->>'workspace_id'=${workspace}`;
        await admin`delete from app.workspaces where id=${workspace}`;
      }
    }
  }
});
