import { assertEquals } from "@std/assert";
import { admin, call, httpTest, seoulDate, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest("HTTP/MCP business preview is read-only and final memo has identical saved meaning", async () => {
  const a = await signIn("A"),
    b = await signIn("B"),
    client = await connectMcp(await mcpToken(a)),
    foreign = await connectMcp(await mcpToken(b));
  const legacyId = crypto.randomUUID();
  try {
    const e = await tool(client, "create_entity", { prop1: `memo-${crypto.randomUUID()}`, prop2: 10 });
    const legacy = {
      event_id: crypto.randomUUID(),
      target_kind: "entity",
      target_id: e.id,
      target_title: "당시 고객",
      action: "update",
      source: "http",
      path: `/entities/${e.id}`,
      before: { prop1: "옛 이름", prop2: 10, tags: [{ name: "당시 태그" }] },
      after: { prop1: "새 이름", prop2: 20, body: "기존에 저장된 전체 원문" },
    };
    await admin`insert into app.records(id,owner_id,title,summary,body,record_kind,change_metadata)
      select ${legacyId},owner_id,'과거 캡처','이전 사건','당시 메모','change',${
      admin.json(legacy)
    } from app.entities where id=${e.id}`;
    assertEquals((await call(a, "GET", `/records/${legacyId}`)).body.change, legacy);
    assertEquals((await tool(client, "get_record", { id: legacyId })).change, legacy);
    assertEquals((await tool(foreign, "get_record", { id: legacyId })).error.code, "not_found");
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
    assertEquals([event.change.before, event.change.after], [null, null]);
    assertEquals((await tool(client, "get_record", { id: legacyId })).change, legacy);
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
    const record = await tool(client, "create_record", { title: "삭제 계약 확인", summary: "입력 거부" });
    const count = async () =>
      Number(
        (await admin`select count(*)::int n from app.records where change_metadata->>'target_id'=${record.id}`)[0].n,
      );
    const initialCount = await count();
    assertEquals(
      (await tool(client, "delete_record", { id: record.id, expected_version: record.version, change_memo: memo }))
        .error.code,
      "invalid_input",
    );
    assertEquals(
      (await call(a, "DELETE", `/records/${record.id}?expected_version=${record.version}&change_memo=unsupported`))
        .status,
      400,
    );
    assertEquals(await tool(client, "get_record", { id: record.id }), record);
    assertEquals(await count(), initialCount);
    assertEquals(await tool(client, "delete_record", { id: record.id, expected_version: record.version }), {
      deleted: record.id,
    });
    assertEquals((await call(a, "GET", `/records/${record.id}`)).status, 404);
    assertEquals(await count(), initialCount + 1);
  } finally {
    await admin`delete from app.records where id=${legacyId}`;
    await client.close();
    await foreign.close();
  }
});
