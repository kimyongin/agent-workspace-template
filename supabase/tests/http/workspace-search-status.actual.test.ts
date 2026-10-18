import { assert, assertEquals } from "@std/assert";
import { claimsOf } from "../mcp/_mcp.ts";
import { admin, call } from "./_client.ts";
import { connect, urls } from "../database/_db.ts";
import { SqlExternalEffectLedger } from "../../functions/_shared/adapters/supabase/external-effect.ts";
import { SqlIndexQueue } from "../../functions/_shared/adapters/supabase/index-queue.ts";
import { indexBatch } from "../../functions/_shared/core/search/index-worker.ts";
import { DurablePassageEmbedder } from "../../functions/_shared/core/search/passage-embedder.ts";
import { activityWorkspaceSuite, completeHttpTask, scopedHttp, scopedTool } from "./_workspace-activity-fixture.ts";

const workerUrl = new URL(urls.pooler);
workerUrl.username = "app_worker.pooler-dev";
workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
const worker = connect(workerUrl.href, { max: 1, prepare: false });

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
    assertEquals(revoked.body.semantic_coverage, { pending: 0, excluded: 0, failed: 0 });
    assertEquals(await scopedTool(clientA, workspace, "search", input), revoked.body);
    assertEquals((await scopedHttp(A, workspace, "GET", `/records/${record.id}`)).status, 404);
  },
  { mcp: true },
);

activityWorkspaceSuite(
  "workspace status: bounded issue pages recheck grants and never expose effect internals",
  async (fixture) => {
    const { A, B, workspaceA: workspace, workspaceB: foreign, clientA, clientB } = fixture;
    assert(clientA && clientB);
    const records: string[] = [];
    const effects: string[] = [];
    try {
      let sends = 0;
      const embedder = new DurablePassageEmbedder(new SqlExternalEffectLedger(worker), {
        send() {
          sends++;
          return Promise.resolve({ state: "unknown", reason: "provider_unknown" });
        },
      }, "d".repeat(64));
      for (let index = 0; index < 6; index++) {
        const record = await completeHttpTask(A, workspace, `공유 색인 확인 ${index}`);
        records.push(record.id);
        const result = await indexBatch(new SqlIndexQueue(worker), embedder, {
          limit: 1,
          workspace_id: workspace,
          kind: "record",
          id: record.id,
        });
        assertEquals(result.retry, 1);
      }
      assertEquals(sends, 6);
      const owned = await admin`select id from private.passage_effects where workspace_id=${workspace}`;
      effects.push(...owned.map((row) => String(row.id)));
      assertEquals(effects.length, 6);
      const before = await admin`select msg_id,read_ct,vt from pgmq.q_search_index
        where message->>'workspace_id'=${workspace} order by msg_id`;
      const first = await scopedHttp(A, workspace, "GET", "/status/indexing/issues");
      assertEquals(first.status, 200);
      assertEquals(first.body.items.length, 5);
      assert(typeof first.body.next_cursor === "string");
      assertEquals(await scopedTool(clientA, workspace, "list_indexing_issues", {}), first.body);
      const second = await scopedHttp(
        A,
        workspace,
        "GET",
        `/status/indexing/issues?cursor=${encodeURIComponent(first.body.next_cursor)}`,
      );
      assertEquals(second.status, 200);
      assertEquals(second.body.items.length, 1);
      assertEquals(second.body.next_cursor, null);
      const items = [...first.body.items, ...second.body.items];
      assertEquals(new Set(items.map((item) => item.id)), new Set(records));
      for (const item of items) {
        assertEquals(item.reason, "provider_unknown");
        assertEquals(item.attempts, 1);
        assertEquals(item.chunks.unknown, 1);
      }
      const serialized = JSON.stringify([first.body, second.body]);
      for (const id of effects) assertEquals(serialized.includes(id), false);
      for (
        const key of [
          "provider_scope",
          "input_hash",
          "source_hash",
          "vector",
          "result",
          "effect_id",
          "fence",
          "lease_until",
        ]
      ) {
        assertEquals(serialized.includes(`"${key}":`), false);
      }
      assertEquals(
        await admin`select msg_id,read_ct,vt from pgmq.q_search_index
        where message->>'workspace_id'=${workspace} order by msg_id`,
        before,
      );
      assertEquals(sends, 6);
      // B can enter its own different workspace; reject A's foreign cursor.
      const foreignCursor = await scopedHttp(
        B,
        foreign,
        "GET",
        `/status/indexing/issues?cursor=${encodeURIComponent(first.body.next_cursor)}`,
      );
      assertEquals(foreignCursor.status, 400);
      assertEquals(
        (await scopedTool(clientB, foreign, "list_indexing_issues", { cursor: first.body.next_cursor })).error.code,
        "invalid_input",
      );
      assertEquals(
        (await call(A, "PATCH", `/workspaces/${workspace}/members/${claimsOf(A).sub}`, {
          expected_version: 3,
          grants: [{ target_kind: "settings", target_id: "*", access: "write" }],
        })).status,
        200,
      );
      const revoked = await scopedHttp(
        A,
        workspace,
        "GET",
        `/status/indexing/issues?cursor=${encodeURIComponent(first.body.next_cursor)}`,
      );
      assertEquals(revoked.status, 200);
      assertEquals(revoked.body.items, []);
      assertEquals(revoked.body.next_cursor, null);
    } finally {
      const owned = await admin`select id from private.passage_effects where workspace_id=${workspace}`;
      for (const row of owned) if (!effects.includes(String(row.id))) effects.push(String(row.id));
      for (const id of effects) await admin`delete from private.passage_effects where id=${id}`;
    }
  },
  { mcp: true },
);
