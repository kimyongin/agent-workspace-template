import { assert, assertEquals } from "@std/assert";
import { claimsOf } from "../mcp/_mcp.ts";
import { admin, call } from "./_client.ts";
import { activityWorkspaceSuite, completeHttpTask, scopedHttp, scopedTool } from "./_workspace-activity-fixture.ts";

activityWorkspaceSuite(
  "workspace status: actual HTTP and OAuth MCP use current scoped readable originals",
  async (fixture) => {
    const { A, workspaceA: workspace, workspaceB: foreign, clientA } = fixture;
    assert(clientA);
    const created = await scopedHttp(A, workspace, "POST", "/entities", {
      entity_type_id: fixture.schema.entity_type_id,
      schema_version: fixture.schema.schema_version,
      source: "app",
      external_id: crypto.randomUUID(),
      properties: { prop_1: "현재 공개 범위 자료" },
    });
    assertEquals(created.status, 201);
    await completeHttpTask(A, workspace, "현재 공개 범위 수행 결과");
    const fingerprint = async () => {
      const [row] = await admin`select
      (select count(*)::int from private.workspace_request_results where workspace_id=${workspace}) as receipts,
      (select coalesce(jsonb_agg(to_jsonb(q) order by msg_id),'[]'::jsonb) from pgmq.q_search_index q
        where message->>'workspace_id'=${workspace}) as queue,
      (select coalesce(jsonb_agg(to_jsonb(s) order by kind,id),'[]'::jsonb) from app.search_index_state s
        where workspace_id=${workspace}) as index_state`;
      return row;
    };
    let membershipVersion = 3;
    const setGrants = async (tasks: "none" | "read", entity: "none" | "read") => {
      const grants = [
        { target_kind: "settings", target_id: "*", access: "write" },
        ...(tasks === "none" ? [] : [{ target_kind: "tasks", target_id: "*", access: tasks }]),
        ...(entity === "none"
          ? []
          : [{ target_kind: "entity_type", target_id: fixture.schema.entity_type_id, access: entity }]),
      ];
      const changed = await call(A, "PATCH", `/workspaces/${workspace}/members/${claimsOf(A).sub}`, {
        expected_version: membershipVersion++,
        grants,
      });
      assertEquals(changed.status, 200);
    };
    for (
      const [tasks, entity, expected] of [
        ["read", "read", { tasks: 1, entities: 1, result: 1, change: 2 }],
        ["read", "none", { tasks: 1, entities: 0, result: 1, change: 1 }],
        ["none", "read", { tasks: 0, entities: 1, result: 0, change: 1 }],
        ["none", "none", { tasks: 0, entities: 0, result: 0, change: 0 }],
      ] as const
    ) {
      await setGrants(tasks, entity);
      const before = await fingerprint();
      const http = await scopedHttp(A, workspace, "GET", "/status?timezone=UTC");
      assertEquals(http.status, 200);
      assertEquals(http.body.timezone, "UTC");
      assertEquals(http.body.daily.length, 30);
      assertEquals(http.body.entities.total, expected.entities);
      assertEquals(http.body.tasks.total, expected.tasks);
      assertEquals(http.body.records.result, expected.result);
      assertEquals(http.body.records.change, expected.change);
      assertEquals(http.body.indexing.total, expected.result + expected.change);
      const mcp = await scopedTool(clientA, workspace, "get_status", { timezone: "UTC" });
      for (const field of ["entities", "tasks", "records", "indexing", "daily"]) {
        assertEquals(mcp[field], http.body[field]);
      }
      const issues = await scopedHttp(A, workspace, "GET", "/status/indexing/issues");
      assertEquals(issues.status, 200);
      assertEquals(await scopedTool(clientA, workspace, "list_indexing_issues", {}), issues.body);
      assertEquals(await fingerprint(), before);
    }
    assertEquals((await scopedHttp(A, foreign, "GET", "/status")).status, 403);
    assertEquals((await scopedTool(clientA, foreign, "get_status", {})).error.code, "forbidden");
  },
  { mcp: true },
);

activityWorkspaceSuite(
  "workspace search: keyword HTTP and OAuth MCP agree with original READ and revoked grants",
  async (fixture) => {
    const { A, workspaceA: workspace, workspaceB: foreign, clientA } = fixture;
    assert(clientA);
    const marker = `검색권한${crypto.randomUUID()}`;
    const record = await completeHttpTask(A, workspace, marker);
    const input = { query: marker, kinds: ["record"], mode: "keyword" };
    const http = await scopedHttp(A, workspace, "POST", "/search", input);
    assertEquals(http.status, 200);
    assertEquals(http.body.items.map((item: { id: string }) => item.id), [record.id]);
    assertEquals(await scopedTool(clientA, workspace, "search", input), http.body);
    assertEquals((await scopedHttp(A, workspace, "GET", `/records/${record.id}`)).status, 200);
    assertEquals((await scopedHttp(A, foreign, "POST", "/search", input)).status, 403);
    assertEquals(
      (await call(A, "PATCH", `/workspaces/${workspace}/members/${claimsOf(A).sub}`, {
        expected_version: 3,
        grants: [{ target_kind: "settings", target_id: "*", access: "write" }],
      })).status,
      200,
    );
    const revoked = await scopedHttp(A, workspace, "POST", "/search", input);
    assertEquals(revoked.status, 200);
    assertEquals(revoked.body.items, []);
    assertEquals(revoked.body.semantic_coverage, { pending: 0, excluded: 0 });
    assertEquals(await scopedTool(clientA, workspace, "search", input), revoked.body);
    assertEquals((await scopedHttp(A, workspace, "GET", `/records/${record.id}`)).status, 404);
  },
  { mcp: true },
);
