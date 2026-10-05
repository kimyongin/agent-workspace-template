import { assert, assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest(
  "selected targets: HTTP/MCP memo retry, owner checks, exact filtered search and immutable event context",
  async () => {
    const session = await signIn("A"),
      foreignSession = await signIn("B"),
      client = await connectMcp(await mcpToken(session));
    const targets: { id: string; version: number }[] = [];
    let record: { id: string; version: number } | null = null;
    try {
      for (const name of ["첫 대상", "둘째 대상"]) {
        targets.push(
          await tool(client, "create_entity", { prop1: name + crypto.randomUUID().slice(0, 8) }),
        );
      }
      const ids = targets.map((target) => target.id).sort(), marker = "연결" + crypto.randomUUID();
      record = await tool(client, "create_record", { title: marker, summary: "공동 자료", entity_ids: ids });
      assert(record);
      const patch = { expected_version: record.version, summary: "최신 공동 자료", request_id: crypto.randomUUID() };
      const edited = await call(session, "PATCH", `/records/${record.id}`, patch);
      assertEquals(edited.status, 200);
      assertEquals(await tool(client, "update_record", { id: record.id, ...patch }), edited.body);
      const read = await tool(client, "get_record", { id: record.id });
      assertEquals(read.entity_ids, ids);
      assertEquals((await call(session, "GET", `/records/${record.id}`)).body, read);
      assertEquals(read.record_kind, "user");
      assertEquals([read.task_id, read.occurrence_on], [null, null]);
      for (const id of ids) {
        const related = await tool(client, "get_entity", { id });
        assert(related.records.items.some((row: { id: string }) => row.id === record!.id));
        const filtered = await tool(client, "list_records", { entity_id: id, record_kind: "user", limit: 1 });
        assertEquals(filtered.items.map((row: { id: string }) => row.id), [record.id]);
        const search = await tool(client, "search", {
          query: marker,
          kinds: ["record"],
          mode: "keyword",
          entity_id: id,
          record_kind: "user",
          limit: 1,
        });
        assertEquals(search.items.map((row: { id: string }) => row.id), [record.id]);
      }
      assertEquals(
        (await call(foreignSession, "PATCH", `/records/${record.id}`, {
          expected_version: read.version,
          entity_ids: [],
        })).status,
        404,
      );
      assertEquals(
        (await tool(client, "update_record", { id: record.id, expected_version: read.version, entity_context: [] }))
          .error.code,
        "invalid_input",
      );
      const history = await tool(client, "list_records", { record_kind: "change", limit: 100 });
      const event = history.items.find((row: { change?: { target_id: string } }) =>
        row.change?.target_id === record!.id
      );
      assert(event);
      assertEquals(
        (await tool(client, "update_record", { id: event.id, expected_version: event.version, entity_ids: [] })).error
          .code,
        "invalid_input",
      );
      const eventAfter = await tool(client, "get_record", { id: event.id });
      assertEquals(eventAfter.entity_context, event.entity_context);
      assertEquals(eventAfter.change, event.change);
    } finally {
      if (record) {
        const latest = await tool(client, "get_record", { id: record.id });
        await tool(client, "delete_record", { id: record.id, expected_version: latest.version });
      }
      for (const target of targets) {
        await tool(client, "delete_entity", {
          id: target.id,
          expected_version: target.version,
        });
      }
      await client.close();
    }
  },
);
