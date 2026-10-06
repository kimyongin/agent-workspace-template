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
      record = await tool(client, "create_record", { body: marker, entity_ids: ids });
      assert(record);
      const patch = { expected_version: record.version };
      const edited = await call(session, "PATCH", `/records/${record.id}`, patch);
      assertEquals(edited.status, 200);
      assertEquals((await tool(client, "update_record", { id: record.id, ...patch })).error.code, "conflict");
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

httpTest(
  "all selected task targets flow to completion and occurrences; explicit occurrence selections keep reference records separate",
  async () => {
    const session = await signIn("A"), client = await connectMcp(await mcpToken(session));
    const targets: { id: string; version: number }[] = [], tasks: string[] = [], records: string[] = [];
    try {
      for (const title of ["완료 대상", "회차 대상"]) {
        targets.push(await tool(client, "create_entity", { prop1: title + crypto.randomUUID().slice(0, 8) }));
      }
      const ids = targets.map((row) => row.id).sort();
      const once = await tool(client, "create_task", {
        kind: "once",
        title: "공동 실행",
        entity_ids: ids,
      });
      tasks.push(once.id);
      const completion = await call(session, "POST", `/tasks/${once.id}/complete`, {
        expected_version: once.version,
        title: "실행 결과",
      });
      assertEquals(completion.status, 200);
      records.push(completion.body.record.id);
      const completed = await tool(client, "get_record", { id: completion.body.record.id });
      assertEquals(completed.entity_ids, ids);
      assertEquals([completed.record_kind, completed.task_id, completed.occurrence_on], ["result", once.id, null]);
      assertEquals((await tool(client, "get_task", { id: once.id })).result_record_id, completed.id);
      const repeat = await tool(client, "create_task", {
        kind: "recurring",
        title: "공동 반복",
        entity_ids: ids,
        recurrence: { freq: "daily", starts_on: "2020-01-01" },
        timezone: "Asia/Seoul",
      });
      tasks.push(repeat.id);
      for (
        const [date, selection, expected] of [["2020-01-01", {}, ids], ["2020-01-02", { entity_ids: [ids[1]] }, [
          ids[1],
        ]], ["2020-01-03", { entity_ids: [] }, []]] as const
      ) {
        const row = await tool(client, "record_occurrence", {
          id: crypto.randomUUID(),
          task_id: repeat.id,
          date,

          body: "회차 결과",
          ...selection,
        });
        records.push(row.id);
        assertEquals(row.entity_ids, expected);
        const independent = await call(session, "GET", `/records/${row.id}`);
        assertEquals(independent.body.entity_ids, expected);
        assertEquals([independent.body.record_kind, independent.body.task_id, independent.body.occurrence_on], [
          "result",
          repeat.id,
          date,
        ]);
      }
      const reference = await tool(client, "create_record", { body: `/tasks/${repeat.id}`, entity_ids: ids });
      records.push(reference.id);
      assertEquals([reference.record_kind, reference.task_id, reference.occurrence_on], ["user", null, null]);
      const schedule = await tool(client, "list_occurrences", { id: repeat.id, from: "2020-01-01", to: "2020-01-03" });
      assertEquals(
        schedule.items.flatMap((item: { record_ids: string[] }) => item.record_ids).sort(),
        records.slice(1, 4).sort(),
      );
      assertEquals((await tool(client, "get_task", { id: repeat.id })).entity_ids, ids);
    } finally {
      for (const id of records) {
        const row = await tool(client, "get_record", { id });
        await tool(client, "delete_record", { id, expected_version: row.version });
      }
      for (const id of tasks) {
        const row = await tool(client, "get_task", { id });
        await tool(client, "delete_task", { id, expected_version: row.version });
      }
      for (const row of targets) await tool(client, "delete_entity", { id: row.id, expected_version: row.version });
      await client.close();
    }
  },
);
