// Explicit paid-provider smoke; excluded from ordinary DB/HTTP/MCP/E2E and CI.
import { assert, assertEquals } from "@std/assert";
import { admin, call, signIn, SUPABASE_URL } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "../mcp/_mcp.ts";
const session = await signIn("A"), mcp = await connectMcp(await mcpToken(session));
const user = (await admin`select id from auth.users where email=${Deno.env.get("DEV_USER_A_EMAIL")!}`)[0].id as string;
const tag = await tool(mcp, "create_tag", { name: crypto.randomUUID().slice(0, 30) });
const fixtures = [
  {
    body:
      "300쪽을 넘는 책은 평일에 시작하지 않고 휴가 때 읽는다. 집중할 시간이 확보된 경우에만 긴 책을 고른다. 관리 코드는 오로라-731이다.",
    query: "두꺼운 책은 언제 읽기로 했지?",
  },
  {
    body:
      "백업이 생성됐다는 표시만 믿지 않고 격리 환경에서 복원해 확인한다. 복구한 데이터의 최신성과 누락 여부를 대조한다.",
    query: "복구가 실제로 되는지 확인하는 절차",
  },
  {
    body: "# 운동 회차\n\n" + "실험 자료의 중립적인 배경 설명. ".repeat(100) +
      "\n\n오늘 아침 30분 걷기를 마쳤다. 비가 오면 실내 운동으로 바꾸고 통증이 있으면 쉬기로 했다.",
    query: "오늘 수행한 산책의 결과를 확인해줘",
  },
];
const items: { id: string; version: number }[] = [];
try {
  for (const fixture of fixtures) {
    const item = await tool(mcp, "create_record", { body: fixture.body, tag_ids: [tag.id] });
    items.push(item);
    const response = await fetch(`${SUPABASE_URL}/functions/v1/index-worker`, {
      method: "POST",
      headers: { authorization: `Bearer ${Deno.env.get("PROCESSING_TOKEN")}`, "content-type": "application/json" },
      body: JSON.stringify({ limit: 1, owner_id: user, kind: "record", id: item.id }),
    });
    assertEquals(response.status, 200);
    assertEquals((await response.json()).indexed, 1);
  }
  for (const [n, fixture] of fixtures.entries()) {
    const q = { query: fixture.query, tag_id: tag.id, kinds: ["record"] };
    const web = await call(session, "POST", "/search", q), agent = await tool(mcp, "search", q);
    assertEquals(web.status, 200);
    assertEquals(web.body, agent);
    assertEquals(agent.search_state, "ok");
    assertEquals(agent.items[0].id, items[n].id);
    assertEquals(agent.items[0].match, "semantic");
    assertEquals(agent.semantic_coverage, { pending: 0, excluded: 0 });
    const match = agent.items[0];
    assertEquals([...fixture.body].slice(match.snippet_start, match.snippet_end).join(""), match.snippet);
    assertEquals((await tool(mcp, "get_record", { id: items[n].id })).body, fixture.body);
    console.log("record: Korean semantic retrieval and complete body read passed");
  }
  const detail = await tool(mcp, "search", { query: "오로라-731", tag_id: tag.id, mode: "keyword" });
  assertEquals(detail.items[0].id, items[0].id);
  assertEquals(detail.items[0].match, "keyword");
  assert((await tool(mcp, "get_record", { id: items[0].id })).body.includes("오로라-731"));
} finally {
  for (const item of items) await tool(mcp, "delete_record", { id: item.id, expected_version: item.version });
  await tool(mcp, "delete_tag", { id: tag.id, expected_version: 1 });
  await mcp.close();
  await admin.end();
}
