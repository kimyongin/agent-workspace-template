import { assertEquals } from "@std/assert";
import { call, httpTest, seoulDate, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest("HTTP/MCP business preview is read-only and final memo has identical saved meaning", async () => {
  const a = await signIn("A"),
    b = await signIn("B"),
    client = await connectMcp(await mcpToken(a)),
    foreign = await connectMcp(await mcpToken(b));
  try {
    const e = await tool(client, "create_entity", { prop1: `memo-${crypto.randomUUID()}`, prop2: 10 });
    const input = { action: "update", id: e.id, input: { expected_version: e.version, prop2: 20 } };
    const before = await tool(client, "list_records", { record_kind: "change", limit: 100 });
    const web = await call(a, "POST", "/entities/preview", input);
    assertEquals(web.status, 200);
    assertEquals(await tool(client, "preview_entity_change", input), web.body);
    assertEquals((await tool(client, "get_entity", { id: e.id })).prop2, 10);
    assertEquals(await tool(client, "list_records", { record_kind: "change", limit: 100 }), before);
    assertEquals((await call(b, "POST", "/entities/preview", input)).status, 404);
    assertEquals((await tool(foreign, "preview_entity_change", input)).error.code, "not_found");
    assertEquals(
      (await call(a, "POST", "/entities/preview", { ...input, input: { ...input.input, expected_version: 0 } })).status,
      400,
    );
    const memo = {
      ...web.body.memo,
      title: "상담 판단 정리",
      body: "현재 확인한 20으로 갱신. 고객의 설명을 함께 남긴다.",
    };
    const patch = { ...input.input, change_memo: memo, request_id: crypto.randomUUID() };
    const saved = await call(a, "PATCH", `/entities/${e.id}`, patch);
    assertEquals(saved.status, 200);
    assertEquals(await tool(client, "update_entity", { id: e.id, ...patch }), saved.body);
    const records = await tool(client, "list_records", { record_kind: "change", limit: 100 });
    const event = records.items.find((r: { change?: { target_id: string; action: string } }) =>
      r.change?.target_id === e.id && r.change?.action === "update"
    );
    assertEquals([event.title, event.summary, event.body], [memo.title, memo.summary, memo.body]);
    assertEquals([event.change.before.prop2, event.change.after.prop2], [10, 20]);
    const stale = { ...input, input: { ...input.input, expected_version: e.version } };
    assertEquals((await call(a, "POST", "/entities/preview", stale)).status, 409);
    assertEquals((await tool(client, "preview_entity_change", stale)).error.code, "conflict");
    const task = await tool(client, "create_task", { kind: "once", title: "후속 상담", summary: "확인" });
    const taskPreview = {
      action: "update",
      id: task.id,
      input: { expected_version: task.version, title: "다음 상담" },
    };
    assertEquals(
      await tool(client, "preview_task_change", taskPreview),
      (await call(a, "POST", "/tasks/preview", taskPreview)).body,
    );
    const taskPatch = { ...taskPreview.input, change_memo: memo, request_id: crypto.randomUUID() };
    const t = await tool(client, "update_task", { id: task.id, ...taskPatch });
    assertEquals((await call(a, "PATCH", `/tasks/${task.id}`, taskPatch)).body, t);
    const completionPreview = await tool(client, "preview_task_change", {
      action: "complete",
      id: task.id,
      input: { expected_version: t.version },
    });
    const resultMemo = {
      ...completionPreview.memo,
      title: "실제로 상담을 마침",
      summary: "고객과 확인한 결과",
      body: "결과 메모를 기본 초안에서 보충했다.",
    };
    const resultInput = { id: task.id, expected_version: t.version, ...resultMemo, request_id: crypto.randomUUID() };
    const completed = await tool(client, "complete_task", resultInput);
    assertEquals(await tool(client, "complete_task", resultInput), completed);
    assertEquals((await tool(client, "get_record", { id: completed.record.id })).body, resultMemo.body);
    assertEquals(completed.record.title, resultMemo.title);
    assertEquals((await tool(client, "list_records", { task_id: task.id, record_kind: "result" })).items.length, 1);
    const recurring = await tool(client, "create_task", {
      kind: "recurring",
      title: "매일 상담",
      summary: "업무",
      recurrence: { freq: "daily", starts_on: seoulDate() },
      timezone: "Asia/Seoul",
    });
    const occurrencePreview = await tool(client, "preview_task_change", {
      action: "occurrence",
      id: recurring.id,
      date: seoulDate(),
      input: { expected_version: recurring.version },
    });
    const occurrenceInput = {
      id: recurring.id,
      date: seoulDate(),
      ...occurrencePreview.memo,
      title: "오늘 상담 수행",
      body: "오늘 확인한 수행 결과",
      request_id: crypto.randomUUID(),
    };
    const occurrence = await tool(client, "record_occurrence", occurrenceInput);
    assertEquals(await tool(client, "record_occurrence", occurrenceInput), occurrence);
    assertEquals((await tool(client, "get_record", { id: occurrence.id })).body, "오늘 확인한 수행 결과");
    assertEquals(
      (await tool(client, "list_records", { task_id: recurring.id, record_kind: "result" })).items.length,
      1,
    );
    const deleted = await call(a, "POST", `/tasks/${task.id}/delete`, {
      expected_version: completed.task.version,
      change_memo: memo,
      request_id: crypto.randomUUID(),
    });
    assertEquals(deleted.status, 204);
    assertEquals((await tool(client, "get_task", { id: task.id })).error.code, "not_found");
  } finally {
    await client.close();
    await foreign.close();
  }
});
