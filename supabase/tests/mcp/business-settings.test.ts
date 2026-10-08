import { assertEquals } from "@std/assert";
import { call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

httpTest("업무 설정 HTTP/MCP: 인증·같은 준비 결과·전체 이전/병합 이후·명시 메모·오류 위치", async () => {
  const a = await signIn("A"), b = await signIn("B"), client = await connectMcp(await mcpToken(a));
  const saved = (await call(a, "GET", "/settings/business")).body;
  const other = (await call(b, "GET", "/settings/business")).body;
  let task: { id: string; version: number } | undefined;
  try {
    assertEquals((await call(null, "GET", "/settings/business")).status, 401);
    const invalid = await call(a, "PATCH", "/settings/business", {
      expected_version: saved.version,
      sections: { record_templates: { task: { create: { memo: "앞 ${할일.이전.제목$}", tag_ids: [] } } } },
    });
    assertEquals(invalid.status, 400);
    assertEquals(invalid.body.fields[0].message.startsWith("3번째 문자:"), true);
    const changed = await tool(client, "update_business_settings", {
      expected_version: saved.version,
      sections: {
        record_templates: {
          task: { update: { memo: "${할일.이전.제목$} → ${할일.이후.제목$} / ${할일.이후.본문$}", tag_ids: [] } },
        },
      },
    });
    assertEquals(changed.version, saved.version + 1);
    assertEquals((await call(b, "GET", "/settings/business")).body, other);
    task = await tool(client, "create_task", { kind: "once", title: "이전 제목", body: "유지 본문" });
    const request = {
      model: "task",
      action: "update",
      target_id: task!.id,
      expected_version: task!.version,
      input: { title: "이후 제목" },
    };
    const prepared = await tool(client, "prepare_record_memo", request);
    assertEquals(prepared.change_note, "이전 제목 → 이후 제목 / 유지 본문");
    assertEquals((await call(a, "POST", "/records/prepare", request)).body, prepared);
    const explicit = await tool(client, "prepare_record_memo", {
      ...request,
      change_note: "  내 메모\n",
      change_tag_ids: [],
    });
    assertEquals(explicit.change_note, "  내 메모\n");
    assertEquals(explicit.change_tag_ids, []);
    const stale = await tool(client, "prepare_record_memo", { ...request, expected_version: 99 });
    assertEquals(stale.error.code, "conflict");
    const unavailable = await call(b, "POST", "/records/prepare", request);
    assertEquals(unavailable.status, 404);
  } finally {
    if (task) await tool(client, "delete_task", { id: task.id, expected_version: task.version, change_tag_ids: [] });
    const latest = (await call(a, "GET", "/settings/business")).body;
    await call(a, "PATCH", "/settings/business", {
      expected_version: latest.version,
      sections: { record_templates: saved.settings.record_templates ?? {} },
    });
    await client.close();
  }
});
