// MCP 계약 테스트: 실제 OAuth 토큰과 공식 MCP 클라이언트로 도구를 호출하고, HTTP와 결과·오류 의미가 같은지 본다.
import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { businessMeta, mutationMeta } from "../../functions/_shared/contracts/change.ts";
import { isoDate } from "../../functions/_shared/contracts/common.ts";
import { recordCreate, recordListQuery, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import {
  principleCorrection,
  principleCreate,
  principleDelete,
  principleListQuery,
  principleSave,
  principleUpdate,
} from "../../functions/_shared/contracts/principle.ts";
import { tagCreate, tagListQuery, tagRename } from "../../functions/_shared/contracts/tag.ts";
import { searchInput, searchResult } from "../../functions/_shared/contracts/search.ts";
import {
  occurrenceRange,
  taskComplete,
  taskCreate,
  taskListQuery,
  taskUpdate,
} from "../../functions/_shared/contracts/task.ts";
import { admin, API, call, httpTest, seoulDate, signIn } from "../http/_client.ts";
import { claimsOf, connectMcp, MCP_URL, mcpToken, registerClient, tool } from "./_mcp.ts";

const sessionA = await signIn("A");
const sessionB = await signIn("B");
const tokenA = await mcpToken(sessionA);
const tokenB = await mcpToken(sessionB);
const mcpA = await connectMcp(tokenA);
const mcpB = await connectMcp(tokenB);

httpTest("기록 HTTP 편집·MCP 재시도는 추가 로그 없이 최신 메모·사건을 보존한다", async () => {
  const record = await tool(mcpA, "create_record", { title: crypto.randomUUID(), summary: "원본 메모" });
  const historyBefore = await tool(mcpA, "list_records", { record_kind: "change", limit: 100 });
  const event = historyBefore.items.find((r: { change?: { target_id: string } }) => r.change?.target_id === record.id);
  assert(event);
  for (const row of [record, event]) {
    const patch = { expected_version: row.version, summary: "정정한 최신 메모", request_id: crypto.randomUUID() };
    const web = await call(sessionA, "PATCH", `/records/${row.id}`, patch);
    assertEquals(web.status, 200);
    assertEquals(await tool(mcpA, "update_record", { id: row.id, ...patch }), web.body);
    assertEquals(
      (await call(sessionA, "GET", `/records/${row.id}`)).body,
      await tool(mcpA, "get_record", { id: row.id }),
    );
    assertEquals(web.body.change, row.change);
    assertEquals(web.body.occurred_at, row.occurred_at);
    assertEquals(
      (await call(sessionB, "PATCH", `/records/${row.id}`, { expected_version: 2, body: "타인 수정" })).status,
      404,
    );
    assertEquals(
      (await tool(mcpB, "update_record", { id: row.id, expected_version: 2, body: "타인 수정" })).error.code,
      "not_found",
    );
  }
  const historyAfter = await tool(mcpA, "list_records", { record_kind: "change", limit: 100 });
  assertEquals(
    historyAfter.items.map((r: { id: string }) => r.id),
    historyBefore.items.map((r: { id: string }) => r.id),
  );
  assertEquals(
    (await call(sessionA, "PATCH", `/records/${event.id}`, {
      expected_version: 2,
      occurred_at: "2020-01-01T00:00:00Z",
    })).status,
    400,
  );
  assertEquals(
    (await tool(mcpA, "update_record", { id: event.id, expected_version: 2, occurred_at: "2020-01-01T00:00:00Z" }))
      .error.code,
    "invalid_input",
  );
});

httpTest("검색: HTTP/MCP 본문 키워드·원문 최소 응답·대체 상태·잘못된 입력 동등성", async () => {
  const marker = crypto.randomUUID(),
    r = await tool(mcpA, "create_record", { title: "검색 원문", summary: "본문 확인", body: marker + " 근거" });
  const q = { query: marker, mode: "keyword" };
  const history = await tool(mcpA, "list_records", { record_kind: "change", limit: 100 });
  const createdEvent = history.items.find((item: { change?: { target_id: string; action: string } }) =>
    item.change?.target_id === r.id && item.change?.action === "create"
  );
  assert(createdEvent);
  assert((await tool(mcpA, "get_record", { id: createdEvent.id })).body.includes(marker));
  const found = searchResult.parse(await tool(mcpA, "search", q));
  assertEquals(found, (await call(sessionA, "POST", "/search", q)).body);
  assertEquals(found.items.map((x) => x.id).sort(), [r.id, createdEvent.id].sort());
  assertEquals("body" in found.items[0], false);
  assertEquals((await tool(mcpB, "search", q)).items, []);
  const auto = searchResult.parse(await tool(mcpA, "search", { query: marker }));
  assert(["ok", "keyword_fallback"].includes(auto.search_state));
  assert(auto.items.some((x) => x.id === r.id));
  for (
    const bad of [{ query: " " }, { query: "가".repeat(201) }, { query: marker, kinds: ["record", "record"] }, {
      query: marker,
      from: "2026-10-04T00:00:00Z",
      to: "2026-10-03T00:00:00Z",
    }, { query: marker, owner_id: crypto.randomUUID() }]
  ) {
    const web = await call(sessionA, "POST", "/search", bad), mcp = await tool(mcpA, "search", bad);
    assertEquals(web.status, 400);
    assertEquals(mcp.error, web.body);
  }
});

const EXPECTED_TOOLS = [
  "preview_entity_change",
  "preview_task_change",
  "create_entity",
  "delete_entity",
  "get_entity",
  "list_entities",
  "update_entity",
  "complete_task",
  "create_principle",
  "create_record",
  "create_tag",
  "create_task",
  "delete_principle",
  "delete_record",
  "delete_tag",
  "delete_task",
  "get_principle",
  "get_record",
  "get_task",
  "list_occurrences",
  "list_principles",
  "list_records",
  "list_tags",
  "list_tasks",
  "record_occurrence",
  "rename_tag",
  "resume_task",
  "search",
  "get_current_principle",
  "save_current_principle",
  "preview_principle_change",
  "correct_principle",
  "stop_task",
  "update_principle",
  "update_record",
  "update_task",
].sort();

httpTest("적용 원칙: 완료·회차·직접 작성의 HTTP/MCP 동등성과 잘못된 참조 롤백", async () => {
  const current = (await tool(mcpA, "get_current_principle", {})).current;
  const p = await tool(mcpA, "save_current_principle", {
    title: "실행 기준",
    summary: "판단 근거",
    ...(current ? { expected_version: current.version, change_note: "실행 기준 저장" } : {}),
  });
  const once = await tool(mcpA, "create_task", { kind: "once", title: "한 번", summary: "실행" });
  const denied = await tool(mcpA, "complete_task", {
    change_note: "테스트 변경 이유",
    id: once.id,
    expected_version: 1,
    title: "결과",
    summary: "거부",
    applied_principle_ids: [crypto.randomUUID()],
  });
  assertEquals(denied.error.code, "invalid_reference");
  assertEquals((await tool(mcpA, "get_task", { id: once.id })).status, "open");
  const done = await tool(mcpA, "complete_task", {
    change_note: "테스트 변경 이유",
    id: once.id,
    expected_version: 1,
    title: "결과",
    summary: "완료",
    applied_principle_ids: [p.id],
  });
  assertEquals(done.record.applied_principle_ids, [p.id]);
  const recurring = await tool(mcpA, "create_task", {
    kind: "recurring",
    title: "매일",
    summary: "실행",
    recurrence: { freq: "daily", starts_on: "2020-01-01" },
    timezone: "Asia/Seoul",
  });
  const r = await call(sessionA, "POST", `/tasks/${recurring.id}/occurrences/2020-01-01/records`, {
    title: "회차",
    summary: "실행",
    applied_principle_ids: [p.id],
  });
  assertEquals(r.status, 201);
  const captured = await tool(mcpA, "get_record", { id: r.body.id });
  assertEquals(captured.applied_principle_ids, [p.id]);
  assertEquals(captured.applied_principle_snapshots[0].captured_at, "application");
  assertEquals(captured.applied_principles[0].updated_at.endsWith("Z"), true);
  const direct = await call(sessionA, "POST", "/records", {
    title: "직접",
    summary: "실행",
    applied_principle_ids: [p.id],
  });
  const updated = await tool(mcpA, "update_record", {
    change_note: "테스트 변경 이유",
    id: direct.body.id,
    expected_version: 1,
    applied_principle_ids: [],
  });
  assertEquals(updated.applied_principle_ids, []);
});

httpTest("MCP 토큰: aud가 MCP URL이고 client_id가 있다", () => {
  const c = claimsOf(tokenA);
  assertEquals(c.aud, MCP_URL);
  assert(typeof c.client_id === "string" && c.client_id.length > 0);
  return Promise.resolve();
});

httpTest("태그: HTTP/MCP 왕복·중복 이름·버전 충돌·소유자 격리", async () => {
  const name = "Tag" + crypto.randomUUID().slice(0, 20);
  const p = await call(sessionA, "POST", "/tags", { name });
  assertEquals(p.status, 201);
  const duplicate = await tool(mcpA, "create_tag", { name: name.toLowerCase() });
  assertEquals(duplicate.error.code, "conflict");
  const renamed = await tool(mcpA, "rename_tag", {
    id: p.body.id,
    name: "정정" + crypto.randomUUID().slice(0, 20),
    expected_version: 1,
  });
  assertEquals(renamed.version, 2);
  assertEquals(
    (await tool(mcpB, "rename_tag", {
      id: p.body.id,
      name: "다른 사용자",
      expected_version: 2,
    })).error.code,
    "not_found",
  );
  const httpConflict = await call(sessionA, "PATCH", `/tags/${p.body.id}`, {
    name,
    expected_version: 1,
  });
  assertEquals(httpConflict.status, 409);
  assertEquals(
    (await tool(mcpA, "delete_tag", { id: p.body.id, expected_version: 2 })).deleted,
    p.body.id,
  );
});

httpTest("활동 다중 태그 OR는 HTTP/MCP에서 페이지 전에 적용되고 다른 소유자에게 숨겨진다", async () => {
  const tags = await Promise.all(
    [0, 1].map(() => tool(mcpA, "create_tag", { name: crypto.randomUUID().slice(0, 30) })),
  );
  for (
    const [kind, listTool, createTool] of [["tasks", "list_tasks", "create_task"], [
      "records",
      "list_records",
      "create_record",
    ]]
  ) {
    const rows = [];
    for (const tag of tags) {
      rows.push(
        await tool(mcpA, createTool, {
          ...(kind === "tasks" ? { kind: "once" } : {}),
          title: "다중 분류",
          summary: "OR 페이지",
          tag_ids: [tag.id],
        }),
      );
    }
    const filter = { tag_ids: tags.map((tag) => tag.id), limit: 1 };
    const http = await call(sessionA, "GET", `/${kind}?tag_ids=${filter.tag_ids.join(",")}&limit=1`);
    const mcp = await tool(mcpA, listTool, filter);
    assertEquals(http.body, mcp);
    const second = await tool(mcpA, listTool, { ...filter, cursor: mcp.next_cursor });
    assertEquals(
      new Set([...mcp.items, ...second.items].map((row: { id: string }) => row.id)),
      new Set(rows.map((row) => row.id)),
    );
    assertEquals((await tool(mcpB, listTool, filter)).items, []);
    assertEquals((await tool(mcpA, listTool, { tag_id: tags[0].id })).items.length, 1);
  }
});

httpTest("기록·원칙·완료·회차의 태그 HTTP/MCP 동등성", async () => {
  const tag = await tool(mcpA, "create_tag", { name: crypto.randomUUID().slice(0, 30) });
  const refs = { title: "분류", summary: "검증", tag_ids: [tag.id] };
  assertEquals(
    (await tool(mcpA, "create_principle", refs)).error,
    (await call(sessionA, "POST", "/principles", refs)).body,
  );
  const r = await call(sessionA, "POST", "/records", refs);
  assertEquals((await tool(mcpA, "get_record", { id: r.body.id })).tag_ids, [tag.id]);
  const once = await tool(mcpA, "create_task", { kind: "once", title: "실행", summary: "검증" });
  const done = await call(sessionA, "POST", `/tasks/${once.id}/complete`, {
    change_note: "테스트 변경 이유",
    ...refs,
    expected_version: 1,
  });
  assertEquals(done.body.record.tag_ids, [tag.id]);
  const repeat = await tool(mcpA, "create_task", {
    kind: "recurring",
    title: "반복",
    summary: "검증",
    recurrence: { freq: "daily", starts_on: "2020-01-01" },
    timezone: "Asia/Seoul",
  });
  const occurrence = await tool(mcpA, "record_occurrence", { ...refs, id: repeat.id, date: "2020-01-01" });
  assertEquals(occurrence.tag_ids, [tag.id]);
  const foreign = await tool(mcpB, "create_tag", { name: crypto.randomUUID().slice(0, 30) });
  assertEquals(
    (await tool(mcpA, "update_record", {
      change_note: "테스트 변경 이유",
      id: r.body.id,
      expected_version: 1,
      tag_ids: [foreign.id],
    })).error.code,
    "invalid_reference",
  );
  assertEquals(
    (await call(sessionA, "POST", "/principles/current", {
      change_note: "테스트 변경 이유",
      expected_version: 1,
      tag_ids: [foreign.id],
    })).status,
    400,
  );
});

httpTest("원칙: HTTP/MCP 현재 수정·과거 호환 정정·재시도·삭제·재생성·오류·페이지 동등성", async () => {
  const baseline = (await tool(mcpA, "get_current_principle", {})).current;
  assertEquals(
    await tool(mcpA, "get_current_principle", {}),
    (await call(sessionA, "GET", "/principles/current")).body,
  );
  const fixtureIds: string[] = [];
  try {
    if (baseline) await admin`update app.principles set is_current=false where id=${baseline.id}`;
    const input = {
      title: "독서 원칙",
      summary: "긴 책 읽기",
      body: "# 근거",
      request_id: crypto.randomUUID(),
    };
    const created = await call(sessionA, "POST", "/principles/current", input);
    assertEquals(created.status, 201);
    fixtureIds.push(created.body.id);
    const retried = await tool(mcpA, "save_current_principle", input);
    assertEquals(retried, created.body);
    const second = await tool(mcpA, "update_principle", {
      id: retried.id,
      expected_version: retried.version,
      title: "새 방향",
      change_note: "목표 변경",
    });
    assertEquals(second.id, retried.id);
    assertEquals(second.version, retried.version + 1);
    assertEquals((await tool(mcpA, "get_principle", { id: retried.id })).is_current, true);
    // Only explicit pre-transition fixtures are historical documents after current saves become updates.
    const [owner] = await admin`select owner_id from app.principles where id=${second.id}`;
    const [legacy] = await admin`insert into app.principles(owner_id,title,summary,body,is_current,origin,saved_at)
    values(${owner.owner_id},'옛 독서 원칙','과거 근거','# 과거 본문',false,'legacy','2020-01-01T00:00:00Z') returning id`;
    fixtureIds.push(legacy.id);
    const old = await tool(mcpA, "get_principle", { id: legacy.id });
    const corrected = await tool(mcpA, "correct_principle", {
      id: old.id,
      expected_version: old.version,
      title: "과거 오타 수정",
      change_note: "오타",
    });
    assertEquals(corrected.saved_at, old.saved_at);
    assertEquals(corrected.body, old.body);
    assertEquals(corrected, (await call(sessionA, "GET", `/principles/${old.id}`)).body);
    const bad = {
      expected_version: second.version,
      title: "틀린 참조",
      entity_id: crypto.randomUUID(),
      change_note: "수정",
    };
    assertEquals(
      (await tool(mcpA, "update_principle", { id: second.id, ...bad })).error,
      (await call(sessionA, "PATCH", `/principles/${second.id}`, bad)).body,
    );
    assertEquals(
      (await tool(mcpB, "get_principle", { id: second.id })).error,
      (await call(sessionB, "GET", `/principles/${second.id}`)).body,
    );
    assertEquals(
      (await tool(mcpA, "get_principle", { id: "bad" })).error,
      (await call(sessionA, "GET", "/principles/bad")).body,
    );
    const first = await tool(mcpA, "list_principles", { view: "all", limit: 1 });
    assert(first.next_cursor);
    assertEquals(first, (await call(sessionA, "GET", "/principles?view=all&limit=1")).body);
    const next = await tool(mcpA, "list_principles", { view: "all", limit: 1, cursor: first.next_cursor });
    assert(next.items[0].id !== first.items[0].id);
    assertEquals(
      (await tool(mcpB, "list_principles", { view: "all", cursor: first.next_cursor })).error.code,
      "invalid_input",
    );
    assertEquals(
      (await tool(mcpA, "list_principles", { view: "history", cursor: first.next_cursor })).error.code,
      "invalid_input",
    );
    assertEquals(
      (await call(sessionA, "POST", `/principles/${second.id}/deactivate`, { expected_version: second.version }))
        .status,
      404,
    );
    assertEquals(
      (await tool(mcpA, "delete_principle", { id: second.id, expected_version: second.version })).deleted,
      second.id,
    );
    assertEquals((await tool(mcpA, "get_current_principle", {})).current, null);
    assertEquals(
      (await call(sessionA, "DELETE", `/principles/${old.id}?expected_version=${corrected.version}`)).status,
      409,
    );
    assertEquals(
      (await tool(mcpA, "save_current_principle", {
        ...input,
        request_id: crypto.randomUUID(),
        expected_version: second.version,
      })).error.code,
      "conflict",
    );
    const recreated = await tool(mcpA, "save_current_principle", {
      title: "재생성한 원칙",
      summary: "새 현재 문서",
      body: "재생성 본문",
    });
    fixtureIds.push(recreated.id);
    assert(recreated.id !== second.id);
    assert(recreated.version > second.version);
    assertEquals(
      (await tool(mcpA, "delete_principle", { id: recreated.id, expected_version: recreated.version })).deleted,
      recreated.id,
    );
    assertEquals((await tool(mcpA, "get_current_principle", {})).current, null);
  } finally {
    for (const id of fixtureIds) await admin`delete from app.principles where id=${id}`;
    if (baseline) await admin`update app.principles set is_current=true where id=${baseline.id}`;
  }
  assertEquals((await tool(mcpA, "get_current_principle", {})).current, baseline);
});

httpTest("토큰 교차 사용: 웹 세션 토큰은 MCP에서, MCP 토큰은 HTTP API에서 401", async () => {
  const web = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${sessionA}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assertEquals(web.status, 401);
  assertEquals((await web.json()).code, "unauthenticated");
  assertEquals((await call(tokenA, "GET", "/tasks")).status, 401);
  assertEquals(API.endsWith("/api"), true);
});

httpTest("동적 등록: loopback이 아닌 HTTP redirect는 거부", async () => {
  const bad = await registerClient("http://attacker.example/callback");
  assert(bad.status >= 400, String(bad.status));
});

httpTest("tools/list: 계약의 도구 이름과 contracts JSON Schema", async () => {
  const { tools } = await mcpA.listTools();
  assertEquals(tools.find((t) => t.name === "delete_principle")?.annotations?.destructiveHint, true);
  assertEquals(tools.map((t) => t.name).sort(), EXPECTED_TOOLS);
  const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
  // 목록·기록 입력은 contracts schema를 그대로 노출한다.
  assertEquals(
    byName.list_tasks.inputSchema as unknown,
    z.toJSONSchema(taskListQuery, { target: "draft-2020-12", io: "input" }),
  );
  assertEquals(
    byName.create_record.inputSchema as unknown,
    z.toJSONSchema(recordCreate, { target: "draft-2020-12", io: "input" }),
  );
  for (const t of tools) assertEquals(t.inputSchema.type, "object", t.name);
  assertEquals(byName.get_task.annotations?.readOnlyHint, true);
  assertEquals(byName.delete_task.annotations?.destructiveHint, true);
});

// deno-lint-ignore no-explicit-any
type JsonSchema = Record<string, any>;
const json = (schema: z.ZodType) => z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" }) as JsonSchema;

httpTest(
  "tools/list: 대상 도구는 contracts 속성에 id(회차 기록은 date)만 더하고, 할 일 생성은 두 종류 입력의 합집합",
  async () => {
    const { tools } = await mcpA.listTools();
    const byName = Object.fromEntries(tools.map((t) => [t.name, t.inputSchema as JsonSchema]));
    const idOnly = { id: json(z.uuid()) };
    const mutationVersion =
      json(z.strictObject({ expected_version: z.number().int().min(1), ...mutationMeta })).properties;
    const businessVersion =
      json(z.strictObject({ expected_version: z.number().int().min(1), ...businessMeta })).properties;
    const expected: Record<string, Record<string, unknown>> = {
      list_tasks: json(taskListQuery).properties,
      list_records: json(recordListQuery).properties,
      create_principle: json(principleCreate).properties,
      save_current_principle: json(principleSave).properties,
      get_current_principle: {},
      update_principle: { ...idOnly, ...json(principleUpdate).properties },
      correct_principle: { ...idOnly, ...json(principleCorrection).properties },
      delete_principle: { ...idOnly, ...json(principleDelete).properties },
      create_tag: json(tagCreate).properties,
      list_tags: json(tagListQuery).properties,
      search: json(searchInput).properties,
      rename_tag: { ...idOnly, ...json(tagRename).properties },
      delete_tag: { ...idOnly, ...mutationVersion },
      list_principles: json(principleListQuery).properties,
      get_principle: idOnly,
      create_record: json(recordCreate).properties,
      get_task: idOnly,
      get_record: idOnly,
      update_task: { ...idOnly, ...json(taskUpdate).properties },
      update_record: { ...idOnly, ...json(recordUpdate).properties },
      complete_task: { ...idOnly, ...json(taskComplete).properties },
      list_occurrences: { ...idOnly, ...json(occurrenceRange).properties },
      stop_task: { ...idOnly, ...businessVersion },
      resume_task: { ...idOnly, ...businessVersion },
      delete_task: { ...idOnly, ...businessVersion },
      delete_record: { ...idOnly, ...businessVersion },
      // 회차 기록: 기록 생성 입력 + id + date
      record_occurrence: {
        ...idOnly,
        date: json(z.object({ date: isoDate })).properties.date,
        ...json(recordCreate).properties,
      },
    };
    for (const [name, props] of Object.entries(expected)) {
      assertEquals(Object.keys(byName[name].properties).sort(), Object.keys(props).sort(), `${name} 속성 이름`);
      for (const [key, schema] of Object.entries(props)) {
        if (key === "id") continue; // id는 어댑터가 더한 UUID(date는 contracts의 isoDate와 비교)
        assertEquals(byName[name].properties[key], schema, `${name}.${key}`);
      }
      assertEquals(byName[name].additionalProperties, false, `${name}는 허용 필드만`);
    }
    // 할 일 생성: MCP는 최상위 object로 펼쳐 알리므로 두 종류(once·recurring) 입력 필드의 합집합과 같아야 한다.
    const branches = (json(taskCreate).oneOf ?? json(taskCreate).anyOf) as JsonSchema[];
    const union = new Set(branches.flatMap((b) => Object.keys(b.properties)));
    assertEquals(Object.keys(byName.create_task.properties).sort(), [...union].sort());
    const requiredEverywhere = branches.map((b) => new Set(b.required as string[]))
      .reduce((a, b) => new Set([...a].filter((k) => b.has(k))));
    assertEquals([...(byName.create_task.required as string[])].sort(), [...requiredEverywhere].sort());
  },
);

httpTest("웹(HTTP)에서 만든 할 일을 MCP로 조회·완료하고 웹에서 결과를 확인한다", async () => {
  const created = await call(sessionA, "POST", "/tasks", {
    kind: "once",
    title: "웹에서 만든 할 일",
    summary: "에이전트가 완료할 일",
  });
  assertEquals(created.status, 201);
  const viaMcp = await tool(mcpA, "get_task", { id: created.body.id });
  assertEquals(viaMcp.title, "웹에서 만든 할 일");
  const listed = await tool(mcpA, "list_tasks", { status: "open", limit: 100 });
  assert(listed.items.some((t: { id: string }) => t.id === created.body.id));

  const done = await tool(mcpA, "complete_task", {
    change_note: "테스트 변경 이유",
    id: created.body.id,
    expected_version: 1,
    title: "에이전트가 완료",
    summary: "MCP로 결과 저장",
    request_id: crypto.randomUUID(),
  });
  assertEquals(done.task.status, "done");
  const web = await call(sessionA, "GET", `/tasks/${created.body.id}`);
  assertEquals(web.body.status, "done");
  assertEquals(web.body.result_record.title, "에이전트가 완료");
});

httpTest("MCP에서 만든 기록과 반복 회차를 HTTP가 같게 본다", async () => {
  const rec = await tool(mcpA, "create_record", { title: "MCP 기록", summary: "직접 작성" });
  assertEquals((await call(sessionA, "GET", `/records/${rec.id}`)).body, rec);

  const t = await tool(mcpA, "create_task", {
    kind: "recurring",
    title: "스트레칭",
    summary: "매일 5분",
    recurrence: { freq: "daily", starts_on: seoulDate(-2) },
    timezone: "Asia/Seoul",
  });
  assertEquals(t.status, "active");
  await tool(mcpA, "record_occurrence", { id: t.id, date: seoulDate(-1), title: "함", summary: "5분" });
  const range = { from: seoulDate(-2), to: seoulDate(1) };
  const viaMcp = await tool(mcpA, "list_occurrences", { id: t.id, ...range });
  const viaHttp = await call(sessionA, "GET", `/tasks/${t.id}/occurrences?from=${range.from}&to=${range.to}`);
  assertEquals(viaMcp, viaHttp.body);
  assertEquals(viaMcp.items.map((o: { status: string }) => o.status), ["missed", "done", "due", "upcoming"]);
});

httpTest("오류 의미가 HTTP와 같다(code·retryable·fields)", async () => {
  const t = await tool(mcpA, "create_task", { kind: "once", title: "오류 시험", summary: "s" });

  const bad = await tool(mcpA, "create_task", { kind: "once", title: "가".repeat(101), summary: "s" });
  const badHttp = await call(sessionA, "POST", "/tasks", { kind: "once", title: "가".repeat(101), summary: "s" });
  assertEquals(bad.error.code, "invalid_input");
  assertEquals(bad.error, badHttp.body);

  const extra = await tool(mcpA, "update_task", {
    change_note: "테스트 변경 이유",
    id: t.id,
    expected_version: 1,
    status: "done",
  });
  assertEquals(extra.error.code, "invalid_input");
  assert(extra.error.fields.some((f: { path: string }) => f.path === "status"));
  assertEquals(
    extra.error,
    (await call(sessionA, "PATCH", `/tasks/${t.id}`, {
      change_note: "테스트 변경 이유",
      expected_version: 1,
      status: "done",
    })).body,
  );

  const stale = await tool(mcpA, "update_task", {
    change_note: "테스트 변경 이유",
    id: t.id,
    expected_version: 9,
    title: "x",
  });
  assertEquals(
    stale.error,
    (await call(sessionA, "PATCH", `/tasks/${t.id}`, {
      change_note: "테스트 변경 이유",
      expected_version: 9,
      title: "x",
    })).body,
  );
  assertEquals(stale.error.code, "conflict");

  const future = await tool(mcpA, "record_occurrence", { id: t.id, date: seoulDate(), title: "a", summary: "b" });
  assertEquals(future.error.code, "conflict"); // 일회성 할 일에는 회차가 없다

  // 다른 사용자의 항목은 존재 여부를 드러내지 않는다.
  const other = await tool(mcpB, "get_task", { id: t.id });
  assertEquals(other.error.code, "not_found");
  assertEquals(other.error, (await call(sessionB, "GET", `/tasks/${t.id}`)).body);
  const notUuid = await tool(mcpA, "get_task", { id: "nope" });
  assertEquals(notUuid.error, (await call(sessionA, "GET", "/tasks/nope")).body);
  assertEquals(notUuid.error.code, "not_found");
});

httpTest("같은 request_id는 HTTP와 MCP에서 각자 한 번만 실행된다", async () => {
  const t = await tool(mcpA, "create_task", { kind: "once", title: "재시도", summary: "s" });
  const rid = crypto.randomUUID();
  const args = {
    change_note: "테스트 변경 이유",
    id: t.id,
    expected_version: 1,
    title: "완료",
    summary: "결과",
    request_id: rid,
  };
  const [x, y] = await Promise.all([tool(mcpA, "complete_task", args), tool(mcpA, "complete_task", args)]);
  assertEquals(x.record.id, y.record.id);
});

httpTest("제품 스킬이 안내하는 도구 이름이 모두 tools/list에 있다", async () => {
  const skill = await Deno.readTextFile(
    new URL("../../../plugins/workspace/skills/workspace/SKILL.md", import.meta.url),
  );
  const table = skill.split("| 하려는 일 | 도구 |\n")[1]?.split("\n\n")[0];
  assert(table, "스킬의 도구 안내 표가 없음");
  const toolColumns = table.split("\n").map((line) => line.split("|")[2] ?? "").join("\n");
  const mentioned = [...toolColumns.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);
  const { tools } = await mcpA.listTools();
  const names = new Set(tools.map((t) => t.name));
  for (const n of new Set(mentioned)) assert(names.has(n), `스킬의 ${n}이 서버에 없음`);
  for (const n of EXPECTED_TOOLS) assert(mentioned.includes(n), `서버 도구 ${n}을 스킬이 안내하지 않음`);
});
