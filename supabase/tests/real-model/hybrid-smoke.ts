// Explicit paid-provider smoke; excluded from ordinary DB/HTTP/MCP/E2E and CI.
import { assert, assertEquals } from "@std/assert";
import { admin, SUPABASE_URL } from "../http/_client.ts";
import { completeMcpTask, scopedHttp, scopedTool, withActivityWorkspace } from "../http/_workspace-activity-fixture.ts";
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
// Explicit paid-provider quality evidence; deterministic worker tests do not establish this result.
try {
  await withActivityWorkspace(async (f) => {
    const { A: session, workspaceA } = f;
    assert(f.clientA);
    const mcp = f.clientA;
    const tag = await scopedTool(mcp, workspaceA, "create_tag", {
      name: crypto.randomUUID().slice(0, 30),
      scope: "record",
    });
    const items: { id: string; version: number }[] = [];

    for (const fixture of fixtures) {
      const item = await completeMcpTask(mcp, workspaceA, fixture.body);
      const linked = await scopedTool(mcp, workspaceA, "set_tag_connections", {
        target_kind: "record",
        target_id: item.id,
        expected_version: item.version,
        tag_ids: [tag.id],
      });
      assertEquals(linked.tag_ids, [tag.id]);
      items.push({ ...item, version: linked.version });
      const response = await fetch(
        `${SUPABASE_URL}/functions/v1/index-worker`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${Deno.env.get("PROCESSING_TOKEN")}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ limit: 1, workspace_id: workspaceA, kind: "record", id: item.id }),
        },
      );
      assertEquals(response.status, 200);
      assertEquals((await response.json()).indexed, 1);
    }
    for (const [n, fixture] of fixtures.entries()) {
      const q = { query: fixture.query, tag_id: tag.id, kinds: ["record"] };
      const web = await scopedHttp(session, workspaceA, "POST", "/search", q),
        agent = await scopedTool(mcp, workspaceA, "search", q);
      assertEquals(web.status, 200);
      assertEquals(web.body, agent);
      assertEquals(agent.search_state, "ok");
      assertEquals(agent.items[0].id, items[n].id);
      assertEquals(agent.items[0].match, "semantic");
      assertEquals(agent.semantic_coverage, { pending: 0, excluded: 0, failed: 0 });
      const match = agent.items[0];
      assertEquals(
        [...fixture.body].slice(match.snippet_start, match.snippet_end).join(
          "",
        ),
        match.snippet,
      );
      assertEquals(
        (await scopedTool(mcp, workspaceA, "get_record", { id: items[n].id }))
          .body,
        fixture.body,
      );
      console.log(
        "record: Korean semantic retrieval and complete body read passed",
      );
    }
    const detail = await scopedTool(mcp, workspaceA, "search", {
      query: "오로라-731",
      tag_id: tag.id,
      mode: "keyword",
    });
    assertEquals(detail.items[0].id, items[0].id);
    assertEquals(detail.items[0].match, "keyword");
    assert(
      (await scopedTool(mcp, workspaceA, "get_record", { id: items[0].id }))
        .body.includes("오로라-731"),
    );
  }, { mcp: true });
} finally {
  await admin.end();
}
