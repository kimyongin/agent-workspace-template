import { assertEquals } from "@std/assert";
import { admin, call, httpTest, signIn } from "../http/_client.ts";
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
