// MCP 계약 테스트: 실제 OAuth 토큰과 공식 MCP 클라이언트로 도구를 호출하고, HTTP와 결과·오류 의미가 같은지 본다.
import { assert, assertEquals } from "@std/assert";
import { z } from "zod";
import { isoDate } from "../../functions/_shared/contracts/common.ts";
import { recordCreate, recordListQuery, recordUpdate } from "../../functions/_shared/contracts/record.ts";
import {
  occurrenceRange,
  taskComplete,
  taskCreate,
  taskListQuery,
  taskUpdate,
} from "../../functions/_shared/contracts/task.ts";
import { API, call, httpTest, seoulDate, signIn } from "../http/_client.ts";
import { claimsOf, connectMcp, MCP_URL, mcpToken, registerClient, tool } from "./_mcp.ts";

const sessionA = await signIn("A");
const sessionB = await signIn("B");
const tokenA = await mcpToken(sessionA);
const tokenB = await mcpToken(sessionB);
const mcpA = await connectMcp(tokenA);
const mcpB = await connectMcp(tokenB);

const EXPECTED_TOOLS = [
  "complete_task",
  "create_record",
  "create_task",
  "delete_record",
  "delete_task",
  "get_record",
  "get_task",
  "list_occurrences",
  "list_records",
  "list_tasks",
  "record_occurrence",
  "resume_task",
  "stop_task",
  "update_record",
  "update_task",
];

httpTest("MCP 토큰: aud가 MCP URL이고 client_id가 있다", () => {
  const c = claimsOf(tokenA);
  assertEquals(c.aud, MCP_URL);
  assert(typeof c.client_id === "string" && c.client_id.length > 0);
  return Promise.resolve();
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
    const version = json(z.strictObject({ expected_version: z.number().int().min(1) })).properties;
    const expected: Record<string, Record<string, unknown>> = {
      list_tasks: json(taskListQuery).properties,
      list_records: json(recordListQuery).properties,
      create_record: json(recordCreate).properties,
      get_task: idOnly,
      get_record: idOnly,
      update_task: { ...idOnly, ...json(taskUpdate).properties },
      update_record: { ...idOnly, ...json(recordUpdate).properties },
      complete_task: { ...idOnly, ...json(taskComplete).properties },
      list_occurrences: { ...idOnly, ...json(occurrenceRange).properties },
      stop_task: { ...idOnly, ...version },
      resume_task: { ...idOnly, ...version },
      delete_task: { ...idOnly, ...version },
      delete_record: { ...idOnly, ...version },
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

  const extra = await tool(mcpA, "update_task", { id: t.id, expected_version: 1, status: "done" });
  assertEquals(extra.error.code, "invalid_input");
  assert(extra.error.fields.some((f: { path: string }) => f.path === "status"));
  assertEquals(
    extra.error,
    (await call(sessionA, "PATCH", `/tasks/${t.id}`, { expected_version: 1, status: "done" })).body,
  );

  const stale = await tool(mcpA, "update_task", { id: t.id, expected_version: 9, title: "x" });
  assertEquals(
    stale.error,
    (await call(sessionA, "PATCH", `/tasks/${t.id}`, { expected_version: 9, title: "x" })).body,
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
  const args = { id: t.id, expected_version: 1, title: "완료", summary: "결과", request_id: rid };
  const [x, y] = await Promise.all([tool(mcpA, "complete_task", args), tool(mcpA, "complete_task", args)]);
  assertEquals(x.record.id, y.record.id);
});

httpTest("제품 스킬이 안내하는 도구 이름이 모두 tools/list에 있다", async () => {
  const skill = await Deno.readTextFile(
    new URL("../../../plugins/workspace/skills/workspace/SKILL.md", import.meta.url),
  );
  const mentioned = [...skill.matchAll(/`([a-z]+_[a-z_]+)`/g)].map((m) => m[1])
    .filter((n) => !["expected_version", "request_id", "occurrence_on"].includes(n));
  const { tools } = await mcpA.listTools();
  const names = new Set(tools.map((t) => t.name));
  for (const n of new Set(mentioned)) assert(names.has(n), `스킬의 ${n}이 서버에 없음`);
  for (const n of EXPECTED_TOOLS) assert(mentioned.includes(n), `서버 도구 ${n}을 스킬이 안내하지 않음`);
});
