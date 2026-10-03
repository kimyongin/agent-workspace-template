// 유료 공급자 호출을 명시적으로 실행한다. 일반 test:db/http/mcp/e2e와 CI는 이 파일을 실행하지 않는다.
import { assert, assertEquals } from "@std/assert";
import { admin, call, signIn, SUPABASE_URL } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "../mcp/_mcp.ts";
const session = await signIn("A"), mcp = await connectMcp(await mcpToken(session));
const user = (await admin`select id from auth.users where email=${Deno.env.get("DEV_USER_A_EMAIL")!}`)[0].id as string;
const tag = await tool(mcp, "create_tag", { name: crypto.randomUUID().slice(0, 30) });
const fixtures = [
  {
    kind: "principle",
    title: "긴 책 읽기 원칙",
    summary: "300쪽을 넘는 책은 평일에 시작하지 않고 휴가 때 읽는다. 집중할 시간이 확보된 경우에만 긴 책을 고른다.",
    body: "여름 휴가 목록의 관리 코드는 오로라-731이다.",
    query: "두꺼운 책은 언제 읽기로 했지?",
  },
  {
    kind: "task",
    title: "백업 복원 연습",
    summary:
      "백업이 생성됐다는 표시만 믿지 않고 격리 환경에서 복원해 확인한다. 복구한 데이터의 최신성과 누락 여부를 대조한다.",
    body: "시험 기록",
    query: "복구가 실제로 되는지 확인하는 절차",
  },
  {
    kind: "record",
    title: "운동 회차 기록",
    summary: "오늘 아침 30분 걷기를 마쳤다. 비가 오면 실내 운동으로 바꾸고 통증이 있으면 쉬기로 했다.",
    body: "시험 기록",
    query: "오늘 수행한 산책의 결과를 확인해줘",
  },
];
const items: { kind: string; id: string; version: number }[] = [];
try {
  await admin`delete from private.search_embedding_budget where owner_id=${user}`;
  for (const fixture of fixtures) {
    const { kind, query: _query, ...content } = fixture;
    const item = await tool(mcp, `create_${kind}`, {
      ...content,
      tag_ids: [tag.id],
      ...(kind === "task" ? { kind: "once" } : {}),
    });
    items.push({ kind, id: item.id, version: item.version });
    const response = await fetch(`${SUPABASE_URL}/functions/v1/index-worker`, {
      method: "POST",
      headers: { authorization: `Bearer ${Deno.env.get("INDEX_WORKER_TOKEN")}`, "content-type": "application/json" },
      body: JSON.stringify({ limit: 1, owner_id: user, kind, id: item.id }),
    });
    assertEquals(response.status, 200);
    assertEquals((await response.json()).indexed, 1);
  }
  for (const [n, fixture] of fixtures.entries()) {
    const q = { query: fixture.query, tag_id: tag.id };
    const web = await call(session, "POST", "/search", q), agent = await tool(mcp, "search", q);
    assertEquals(web.status, 200);
    assertEquals(web.body, agent);
    assertEquals(agent.search_state, "ok");
    assertEquals(agent.items[0].id, items[n].id);
    assertEquals(agent.items[0].match, "semantic");
    assertEquals(agent.semantic_coverage, { pending: 0, excluded: 0 });
    assertEquals("body" in agent.items[0], false);
    console.log(`${fixture.kind}: 한국어 관련 질문의 HTTP/MCP 의미 검색·원문 분리 통과`);
  }
  const unrelated = await tool(mcp, "search", {
    query: "토성의 고리에서 얼음 입자의 크기는 얼마인가?",
    tag_id: tag.id,
  });
  assertEquals(unrelated.search_state, "ok");
  assertEquals(unrelated.items, []);
  const detail = await tool(mcp, "search", { query: "오로라-731", tag_id: tag.id });
  assertEquals(detail.items[0].id, items[0].id);
  assertEquals(detail.items[0].match, "keyword");
  assert((await tool(mcp, "get_principle", { id: items[0].id })).body.includes("오로라-731"));
  console.log("무관 질문 0건·본문 전용 표식 키워드 보완·원문 조회 통과");
} finally {
  for (const item of items) await tool(mcp, `delete_${item.kind}`, { id: item.id, expected_version: item.version });
  await tool(mcp, "delete_tag", { id: tag.id, expected_version: 1 });
  await mcp.close();
  await admin.end();
}
