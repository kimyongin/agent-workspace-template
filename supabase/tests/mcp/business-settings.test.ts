import { assert, assertEquals } from "@std/assert";
import { call } from "../http/_client.ts";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";

activityWorkspaceSuite(
  "업무 설정 HTTP/MCP: 인증·같은 준비 결과·전체 이전/병합 이후·명시 메모·오류 위치",
  async ({ A: a, B: b, workspaceA: w, workspaceB: otherW, clientA: client }) => {
    assert(client);
    const saved = (await scopedHttp(a, w, "GET", "/settings/business")).body;
    const other = (await scopedHttp(b, otherW, "GET", "/settings/business")).body;

    assertEquals((await call(null, "GET", "/settings/business")).status, 401);
    assertEquals((await call(null, "GET", "/settings/business?id=entity_identity")).status, 401);
    assertEquals(await scopedTool(client, w, "get_business_settings", {}), saved);
    for (const id of ["record_templates"] as const) {
      const selected = { settings: { [id]: saved.settings[id] }, versions: { [id]: saved.versions[id] } };
      assertEquals((await scopedHttp(a, w, "GET", `/settings/business?id=${id}`)).body, selected);
      assertEquals(await scopedTool(client, w, "get_business_settings", { id }), selected);
      assertEquals((await scopedHttp(b, otherW, "GET", `/settings/business?id=${id}`)).body, {
        settings: { [id]: other.settings[id] },
        versions: { [id]: other.versions[id] },
      });
    }
    assertEquals((await scopedHttp(a, w, "GET", "/settings/business?id=entity_identity")).status, 400);
    assertEquals(
      (await scopedTool(client, w, "get_business_settings", { id: "entity_identity" })).error.code,
      "invalid_input",
    );
    assertEquals((await scopedHttp(a, w, "GET", "/settings/business?id=unknown")).status, 400);
    assertEquals((await scopedTool(client, w, "get_business_settings", { id: "unknown" })).error.code, "invalid_input");
    const invalid = await scopedHttp(a, w, "PATCH", "/settings/business", {
      expected_version: saved.versions.record_templates,
      id: "record_templates",
      value: { task: { create: { memo: "앞 ${할일.이전.제목$}", tag_ids: [] } } },
    });
    assertEquals(invalid.status, 400);
    assertEquals(invalid.body.fields[0].message.startsWith("3번째 문자:"), true);
    const changed = await scopedTool(client, w, "update_business_settings", {
      expected_version: saved.versions.record_templates,
      id: "record_templates",
      value: {
        task: { update: { memo: "${할일.이전.제목$} → ${할일.이후.제목$} / ${할일.이후.본문$}", tag_ids: [] } },
      },
    });
    assertEquals(changed.versions.record_templates, saved.versions.record_templates + 1);
    assertEquals((await scopedHttp(b, otherW, "GET", "/settings/business")).body, other);
    const selectedTemplates = {
      versions: { record_templates: saved.versions.record_templates + 1 },
      settings: {
        record_templates: {
          task: { update: { memo: "${할일.이전.제목$} → ${할일.이후.제목$} / ${할일.이후.본문$}", tag_ids: [] } },
        },
      },
    };
    assertEquals((await scopedHttp(a, w, "GET", "/settings/business?id=record_templates")).body, selectedTemplates);
    assertEquals(await scopedTool(client, w, "get_business_settings", { id: "record_templates" }), selectedTemplates);
    assertEquals((await scopedHttp(b, otherW, "GET", "/settings/business?id=record_templates")).body, {
      settings: { record_templates: other.settings.record_templates },
      versions: { record_templates: other.versions.record_templates },
    });
    const task = await scopedTool(client, w, "create_task", { kind: "once", title: "이전 제목", body: "유지 본문" });
    const request = {
      model: "task",
      action: "update",
      target_id: task!.id,
      expected_version: task!.version,
      input: { title: "이후 제목" },
    };
    const prepared = await scopedTool(client, w, "prepare_record_memo", request);
    assertEquals(prepared.change_note, "이전 제목 → 이후 제목 / 유지 본문");
    assertEquals((await scopedHttp(a, w, "POST", "/records/prepare", request)).body, prepared);
    const explicit = await scopedTool(client, w, "prepare_record_memo", {
      ...request,
      change_note: "  내 메모\n",
      change_tag_ids: [],
    });
    assertEquals(explicit.change_note, "  내 메모\n");
    assertEquals(explicit.change_tag_ids, []);
    const stale = await scopedTool(client, w, "prepare_record_memo", { ...request, expected_version: 99 });
    assertEquals(stale.error.code, "conflict");
    const unavailable = await scopedHttp(b, otherW, "POST", "/records/prepare", request);
    assertEquals(unavailable.status, 404);
  },
  { mcp: true },
);
