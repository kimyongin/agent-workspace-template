import { assert, assertEquals } from "@std/assert";
import { admin, call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";
import { httpEntityFixture } from "../http/_entity.ts";
httpTest("Entity MCP: 실제 SDK/OAuth CRUD·태그 scope·웹 parity·참조 거부·삭제 보존", async () => {
  const token = await signIn("A"), foreignToken = await signIn("B"), client = await connectMcp(await mcpToken(token));
  try {
    const schema = await httpEntityFixture(token);
    const listed = await client.listTools();
    for (const name of ["list_entities", "get_entity", "create_entity", "update_entity", "delete_entity"]) {
      assert(listed.tools.some((t) => t.name === name));
    }
    const tag = await tool(client, "create_tag", {
      name: "entity" + crypto.randomUUID().slice(0, 20),
      scope: "entity",
    });
    const activityTag = await tool(client, "create_tag", {
      name: "record" + crypto.randomUUID().slice(0, 20),
      scope: "record",
    });
    const e = await tool(client, "create_entity", {
      ...schema,
      properties: { prop_1: "MCP 엔터티", prop_2: 1, prop_4: "b" },
      tag_ids: [tag.id],
    });
    assertEquals(
      (await call(token, "GET", `/entities/${encodeURIComponent(e.id)}`)).body.properties.prop_1,
      e.properties.prop_1,
    );
    assertEquals(e.tag_ids, [tag.id]);
    const [createdHistory] =
      await admin`select id,change_metadata from app.records where record_kind='change' and change_metadata->>'target_id'=${e.id}`;
    assertEquals(createdHistory.change_metadata.source, "mcp");
    assertEquals(createdHistory.change_metadata.action, "create");
    const edit = await call(token, "PATCH", `/records/${createdHistory.id}`, {
      expected_version: 1,
      body: "自動記録の説明を補う",
    });
    assertEquals(edit.status, 200);
    assertEquals(edit.body.body, "自動記録の説明を補う");
    assertEquals(edit.body.change, createdHistory.change_metadata);
    const readEdited = await tool(client, "get_record", { id: createdHistory.id });
    assertEquals(readEdited.change, createdHistory.change_metadata);
    assertEquals(readEdited.body, "自動記録の説明を補う");
    assertEquals(
      (await admin`select count(*)::int n from app.records where change_metadata->>'target_id'=${createdHistory.id}`)[0]
        .n,
      0,
    );
    assertEquals(
      (await tool(client, "create_entity", { ...schema, properties: { prop_1: "거부" }, tag_ids: [activityTag.id] }))
        .error.code,
      "invalid_reference",
    );
    assertEquals((await tool(client, "get_entity", { id: "bad-id" })).error.code, "not_found");
    const marker = crypto.randomUUID();
    const r = await tool(client, "create_record", { body: marker, entity_ids: [e.id] });
    const detail = await tool(client, "get_entity", { id: e.id });
    assertEquals("principles" in detail, false);
    assertEquals(detail.records.items.some((record: { id: string }) => record.id === r.id), true);
    const relatedRecord = detail.records.items.find((record: { id: string }) => record.id === r.id);
    assertEquals(relatedRecord.record_kind, "user");
    assertEquals(relatedRecord.body, marker);
    assertEquals(relatedRecord.occurred_at, r.occurred_at);
    assertEquals(detail, (await call(token, "GET", `/entities/${encodeURIComponent(e.id)}`)).body);
    assert(detail.records.items.some((record: { record_kind: string }) => record.record_kind === "change"));
    assertEquals(
      (await tool(client, "create_principle", { title: "연결 원칙", entity_id: e.id })).error.code,
      "invalid_input",
    );
    const search = { query: marker, entity_id: e.id, mode: "keyword", record_kind: "user" };
    const found = await tool(client, "search", search);
    assertEquals(found.items.map((x: { id: string }) => x.id), [r.id]);
    assertEquals(found, (await call(token, "POST", "/search", search)).body);
    assertEquals(
      (await tool(client, "search", {
        ...search,
        entity_id: `app:00000000-0000-4000-8000-000000000001:${crypto.randomUUID()}`,
      })).items,
      [],
    );
    assertEquals((await tool(client, "search", { ...search, entity_id: "bad" })).error.code, "invalid_input");
    assertEquals(
      (await tool(client, "update_entity", {
        id: e.id,
        schema_version: schema.schema_version,
        expected_version: 2,
        properties: { prop_1: "경쟁" },
        change_note: "수정",
      })).error
        .code,
      "conflict",
    );
    const withoutReason = await tool(client, "update_entity", {
      id: e.id,
      expected_version: 1,
      schema_version: schema.schema_version,
      properties: { prop_1: "이유 없이 수정" },
    });
    assertEquals(withoutReason.version, 2);
    assertEquals(withoutReason.properties.prop_1, "이유 없이 수정");
    assertEquals(
      (await call(token, "GET", `/entities/${encodeURIComponent(e.id)}`)).body.properties.prop_1,
      withoutReason.properties.prop_1,
    );
    const changed = await tool(client, "update_entity", {
      id: e.id,
      expected_version: 2,
      schema_version: schema.schema_version,
      properties: { prop_3: "2026-10-04" },
      change_note: "일자 정정",
    });
    assertEquals(changed.version, 3);
    assertEquals(
      (await call(token, "DELETE", `/tags/${tag.id}?expected_version=1`)).status,
      204,
    );
    assertEquals(
      (await tool(client, "delete_tag", { id: tag.id, expected_version: 1 })).error.code,
      "not_found",
    );
    const unlinked = await tool(client, "get_entity", { id: e.id });
    assertEquals(unlinked.version, 4);
    assertEquals(unlinked.tag_ids, []);
    const updates =
      await admin`select id,change_metadata from app.records where change_metadata->>'target_id'=${e.id} and change_metadata->>'action'='update'`;
    assertEquals(updates.length, 3);
    const unlinkRow = updates.find((r) => r.change_metadata.source === "http")!;
    const unlink = await tool(client, "get_record", { id: unlinkRow.id });
    assertEquals(unlink.change, unlinkRow.change_metadata);
    assertEquals([unlink.change.before, unlink.change.after], [null, null]);
    assertEquals([
      unlink.change.target_kind,
      unlink.change.target_id,
      unlink.change.target_title,
      unlink.change.action,
      unlink.change.path,
    ], ["entity", e.id, "이유 없이 수정", "update", `/entities/${encodeURIComponent(e.id)}`]);
    assertEquals(unlink.body, "이유 없이 수정 수정 (태그)");
    assertEquals((await call(token, "GET", `/records/${unlinkRow.id}`)).body, unlink);
    assertEquals(
      (await tool(client, "list_tags", { scope: "entity" })).items.some((row: { id: string }) => row.id === tag.id),
      false,
    );
    const task = await tool(client, "create_task", {
      kind: "once",
      title: "엔터티 삭제 관계 검증",
      entity_ids: [e.id],
    });
    await tool(client, "delete_entity", { id: e.id, expected_version: 4 });
    const liveTask = await tool(client, "get_task", { id: task.id });
    assertEquals("entity_id" in liveTask, false);
    assertEquals(liveTask.entity_ids, [e.id]);
    assertEquals((await tool(client, "list_tasks", { entity_id: e.id })).items.map((t: { id: string }) => t.id), [
      task.id,
    ]);
    const retained = await tool(client, "get_record", { id: r.id });
    assertEquals("entity_id" in retained, false);
    assertEquals(retained.entity_ids, [e.id]);
    assertEquals(retained.entity_context, r.entity_context);
    assertEquals(
      retained.entity_context.map((context: { id: string; title: string; source: string }) => ({
        id: context.id,
        title: context.title,
        source: context.source,
      })),
      [
        { id: e.id, title: e.title, source: "selection" },
      ],
    );
    assertEquals(retained.body, marker);
    const preservedSearch = await tool(client, "search", search);
    assertEquals(preservedSearch.items.map((row: { id: string }) => row.id), [r.id]);
    assertEquals(preservedSearch, (await call(token, "POST", "/search", search)).body);
    assertEquals((await call(foreignToken, "GET", `/records/${r.id}`)).status, 404);
    assertEquals((await call(foreignToken, "POST", "/search", search)).body.items, []);
    await tool(client, "delete_task", { id: task.id, expected_version: liveTask.version });
  } finally {
    await client.close();
  }
});
httpTest(
  "Entity typed list MCP/HTTP: AND numeric/date filters, unset, property cursor parity and strict errors",
  async () => {
    const token = await signIn("A"),
      client = await connectMcp(await mcpToken(token)),
      marker = crypto.randomUUID(),
      ids: string[] = [];
    try {
      const schema = await httpEntityFixture(token);
      for (const [n, value, date] of [["空", null, null], ["零", 0, "2024-02-29"], ["二", 2, "2025-01-01"]] as const) {
        const row = await tool(client, "create_entity", {
          ...schema,
          properties: { prop_1: marker + n, prop_2: value, prop_3: date, prop_4: "b" },
        });
        ids.push(row.id);
      }
      const query = {
        entity_type_id: schema.entity_type_id,
        keyword: marker,
        filters: [{ key: "prop_2", operator: "gte", value: 0 }, {
          key: "prop_3",
          operator: "lte",
          value: "2024-02-29",
        }],
        sort: { key: "prop_2", direction: "asc" },
      };
      const listed = await tool(client, "list_entities", query);
      assertEquals(listed.items.map((row: { id: string }) => row.id), [ids[1]]);
      const url = new URLSearchParams({
        entity_type_id: query.entity_type_id,
        keyword: marker,
        filters: JSON.stringify(query.filters),
        sort: JSON.stringify(query.sort),
      });
      assertEquals((await call(token, "GET", `/entities?${url}`)).body, listed);
      const first = await tool(client, "list_entities", {
        entity_type_id: schema.entity_type_id,
        keyword: marker,
        sort: query.sort,
        limit: 1,
      });
      assertEquals(first.items[0].id, ids[0]);
      assert(first.next_cursor);
      const second = await tool(client, "list_entities", {
        entity_type_id: schema.entity_type_id,
        keyword: marker,
        sort: query.sort,
        limit: 1,
        cursor: first.next_cursor,
      });
      assertEquals(second.items[0].id, ids[1]);
      const unset = await tool(client, "list_entities", {
        entity_type_id: schema.entity_type_id,
        keyword: marker,
        filters: [{ key: "prop_2", operator: "unset" }],
      });
      assertEquals(unset.items.map((row: { id: string }) => row.id), [ids[0]]);
      for (
        const filters of [[{ key: "prop_2", operator: "gte", value: "0" }], [{
          key: "prop_2",
          operator: "gt",
          value: 5,
        }, { key: "prop_2", operator: "lte", value: 5 }], [{ key: "prop_2", operator: "eq", value: null }]]
      ) {
        assertEquals(
          (await tool(client, "list_entities", { entity_type_id: schema.entity_type_id, filters })).error.code,
          "invalid_input",
        );
        const invalid = new URLSearchParams({
          entity_type_id: schema.entity_type_id,
          filters: JSON.stringify(filters),
        });
        assertEquals((await call(token, "GET", `/entities?${invalid}`)).body.code, "invalid_input");
      }
    } finally {
      for (const id of ids) {
        const current = await tool(client, "get_entity", { id });
        await tool(client, "delete_entity", { id, expected_version: current.version });
      }
      await client.close();
    }
  },
);
