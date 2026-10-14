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
    assertEquals((await call(null, "GET", "/settings/business?id=entity_identity")).status, 401);
    assertEquals(await tool(client, "get_business_settings", {}), saved);
    for (const id of ["record_templates"] as const) {
      const selected = { settings: { [id]: saved.settings[id] }, versions: { [id]: saved.versions[id] } };
      assertEquals((await call(a, "GET", `/settings/business?id=${id}`)).body, selected);
      assertEquals(await tool(client, "get_business_settings", { id }), selected);
      assertEquals((await call(b, "GET", `/settings/business?id=${id}`)).body, {
        settings: { [id]: other.settings[id] },
        versions: { [id]: other.versions[id] },
      });
    }
    assertEquals((await call(a, "GET", "/settings/business?id=entity_identity")).status, 400);
    assertEquals((await tool(client, "get_business_settings", { id: "entity_identity" })).error.code, "invalid_input");
    assertEquals((await call(a, "GET", "/settings/business?id=unknown")).status, 400);
    assertEquals((await tool(client, "get_business_settings", { id: "unknown" })).error.code, "invalid_input");
    const invalid = await call(a, "PATCH", "/settings/business", {
      expected_version: saved.versions.record_templates,
      id: "record_templates",
      value: { task: { create: { memo: "앞 ${할일.이전.제목$}", tag_ids: [] } } },
    });
    assertEquals(invalid.status, 400);
    assertEquals(invalid.body.fields[0].message.startsWith("3번째 문자:"), true);
    const changed = await tool(client, "update_business_settings", {
      expected_version: saved.versions.record_templates,
      id: "record_templates",
      value: {
        task: { update: { memo: "${할일.이전.제목$} → ${할일.이후.제목$} / ${할일.이후.본문$}", tag_ids: [] } },
      },
    });
    assertEquals(changed.versions.record_templates, saved.versions.record_templates + 1);
    assertEquals((await call(b, "GET", "/settings/business")).body, other);
    const selectedTemplates = {
      versions: { record_templates: saved.versions.record_templates + 1 },
      settings: {
        record_templates: {
          task: { update: { memo: "${할일.이전.제목$} → ${할일.이후.제목$} / ${할일.이후.본문$}", tag_ids: [] } },
        },
      },
    };
    assertEquals((await call(a, "GET", "/settings/business?id=record_templates")).body, selectedTemplates);
    assertEquals(await tool(client, "get_business_settings", { id: "record_templates" }), selectedTemplates);
    assertEquals((await call(b, "GET", "/settings/business?id=record_templates")).body, {
      settings: { record_templates: other.settings.record_templates },
      versions: { record_templates: other.versions.record_templates },
    });
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
      expected_version: latest.versions.record_templates,
      id: "record_templates",
      value: saved.settings.record_templates ?? {},
    });
    await client.close();
  }
});
