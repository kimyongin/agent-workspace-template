import { assert, assertEquals } from "@std/assert";
import { admin, call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";
httpTest("Entity MCP: 실제 SDK/OAuth CRUD·태그 scope·웹 parity·참조 거부·삭제 보존", async () => {
  const token = await signIn("A"), foreignToken = await signIn("B"), client = await connectMcp(await mcpToken(token));
  try {
    const listed = await client.listTools();
    for (const name of ["list_entities", "get_entity", "create_entity", "update_entity", "delete_entity"]) {
      assert(listed.tools.some((t) => t.name === name));
    }
    const tag = await tool(client, "create_tag", {
      name: "entity" + crypto.randomUUID().slice(0, 20),
      scope: "entity",
    });
    const activityTag = await tool(client, "create_tag", {
      name: "activity" + crypto.randomUUID().slice(0, 20),
      scope: "activity",
    });
    const e = await tool(client, "create_entity", {
      prop1: "MCP 엔터티",
      prop2: 1,
      prop4: "b",
      tag_ids: [tag.id],
    });
    assertEquals((await call(token, "GET", `/entities/${e.id}`)).body.prop1, e.prop1);
    assertEquals(e.tag_ids, [tag.id]);
    const [createdHistory] =
      await admin`select id,change_metadata from app.records where record_kind='change' and change_metadata->>'target_id'=${e.id}`;
    assertEquals(createdHistory.change_metadata.source, "mcp");
    assertEquals(createdHistory.change_metadata.action, "create");
    const edit = await call(token, "PATCH", `/records/${createdHistory.id}`, {
      expected_version: 1,
      change_note: "自動記録の説明を補う",
    });
    assertEquals(edit.status, 200);
    assertEquals(edit.body.change_note, "自動記録の説明を補う");
    assertEquals(edit.body.change, createdHistory.change_metadata);
    const readEdited = await tool(client, "get_record", { id: createdHistory.id });
    assertEquals(readEdited.change, createdHistory.change_metadata);
    assertEquals(readEdited.change_note, "自動記録の説明を補う");
    assertEquals(
      (await admin`select count(*)::int n from app.records where change_metadata->>'target_id'=${createdHistory.id}`)[0]
        .n,
      0,
    );
    assertEquals(
      (await tool(client, "create_entity", { prop1: "거부", tag_ids: [activityTag.id] })).error.code,
      "invalid_reference",
    );
    assertEquals((await tool(client, "get_entity", { id: "bad-id" })).error.code, "not_found");
    const marker = crypto.randomUUID();
    const r = await tool(client, "create_record", { title: "연결 기록", summary: marker, entity_ids: [e.id] });
    const detail = await tool(client, "get_entity", { id: e.id });
    assertEquals("principles" in detail, false);
    assertEquals(detail.records.items.some((record: { id: string }) => record.id === r.id), true);
    assertEquals(
      (await tool(client, "create_principle", { title: "연결 원칙", summary: "요약", entity_id: e.id })).error.code,
      "invalid_input",
    );
    const search = { query: marker, entity_id: e.id, mode: "keyword", record_kind: "user" };
    const found = await tool(client, "search", search);
    assertEquals(found.items.map((x: { id: string }) => x.id), [r.id]);
    assertEquals(found, (await call(token, "POST", "/search", search)).body);
    assertEquals((await tool(client, "search", { ...search, entity_id: crypto.randomUUID() })).items, []);
    assertEquals((await tool(client, "search", { ...search, entity_id: "bad" })).error.code, "invalid_input");
    assertEquals(
      (await tool(client, "update_entity", { id: e.id, expected_version: 2, prop1: "경쟁", change_note: "수정" })).error
        .code,
      "conflict",
    );
    const withoutReason = await tool(client, "update_entity", {
      id: e.id,
      expected_version: 1,
      prop1: "이유 없이 수정",
    });
    assertEquals(withoutReason.version, 2);
    assertEquals(withoutReason.prop1, "이유 없이 수정");
    assertEquals((await call(token, "GET", `/entities/${e.id}`)).body.prop1, withoutReason.prop1);
    const changed = await tool(client, "update_entity", {
      id: e.id,
      expected_version: 2,
      prop3: "2026-10-04",
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
    ], ["entity", e.id, "이유 없이 수정", "update", `/entities/${e.id}`]);
    assertEquals(unlink.body, `태그: ["${tag.id}"] → []`);
    assertEquals((await call(token, "GET", `/records/${unlinkRow.id}`)).body, unlink);
    assertEquals(
      (await tool(client, "list_tags", { scope: "entity" })).items.some((row: { id: string }) => row.id === tag.id),
      false,
    );
    const task = await tool(client, "create_task", {
      kind: "once",
      title: "엔터티 삭제 관계 검증",
      summary: marker,
      entity_ids: [e.id],
    });
    await tool(client, "delete_entity", { id: e.id, expected_version: 4 });
    const liveTask = await tool(client, "get_task", { id: task.id });
    assertEquals("entity_id" in liveTask, false);
    assertEquals(liveTask.entity_ids, []);
    assertEquals((await tool(client, "list_tasks", { entity_id: e.id })).items, []);
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
        { id: e.id, title: e.prop1, source: "selection" },
      ],
    );
    assertEquals(retained.summary, marker);
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
