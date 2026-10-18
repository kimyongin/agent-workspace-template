// Public network seam: real HTTP bearer session and OAuth MCP token + official SDK.
// Each retry explicitly repeats the logical UUID; JSON-RPC IDs/SDK reconnects are not request keys.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { Client } from "@modelcontextprotocol/client";
import { activityWorkspaceSuite, scopedHttp, scopedTool } from "../http/_workspace-activity-fixture.ts";
import { connectMcp } from "./_mcp.ts";

// deno-lint-ignore no-explicit-any
async function write(
  client: Client,
  workspace: string,
  name: string,
  arguments_: Record<string, unknown>,
): Promise<any> {
  const result = await client.callTool({ name, arguments: { workspace_id: workspace, ...arguments_ } });
  assertEquals(result.isError ?? false, false);
  assert(result.structuredContent);
  return result.structuredContent;
}

activityWorkspaceSuite(
  "HTTP→OAuth MCP creation replay preserves the explicit key across independent SDK connections",
  async ({ A: session, workspaceA: w, clientA: firstClient, mcpTokenA: token }) => {
    assert(firstClient);
    assert(token);
    let secondClient: Client | undefined;
    const key = crypto.randomUUID();
    const input = { kind: "once", title: `protocol-create-${crypto.randomUUID()}` };
    const created = await scopedHttp(session, w, "POST", "/tasks", input, key);
    assertEquals(created.status, 201);
    try {
      const arguments_ = { ...input, request_key: key };
      assertEquals(await write(firstClient, w, "create_task", arguments_), created.body);
      await firstClient.close();
      secondClient = await connectMcp(token);
      assertEquals(await write(secondClient, w, "create_task", arguments_), created.body);
      const replay = await scopedHttp(session, w, "POST", "/tasks", input, key);
      assertEquals(replay.status, 201);
      assertEquals(replay.body, created.body);
      assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
      assert(replay.headers.get("Idempotency-Completed-At"));
      const listed = await scopedHttp(session, w, "GET", `/tasks?keyword=${encodeURIComponent(input.title)}&limit=100`);
      assertEquals(listed.body.items.map((item: { id: string }) => item.id), [created.body.id]);
    } finally {
      await secondClient?.close();
      await firstClient.close();
    }
  },
  { mcp: true },
);

activityWorkspaceSuite(
  "OAuth MCP→HTTP stale expected_version replay returns its past result while current state stays newer",
  async ({ A: session, workspaceA: w, clientA: client }) => {
    assert(client);
    const created = await scopedHttp(session, w, "POST", "/tasks", { kind: "once", title: crypto.randomUUID() });
    let version = created.body.version;
    const key = crypto.randomUUID();
    const input = { expected_version: version, title: "first committed title", change_note: "first change" };
    const saved = await write(client, w, "update_task", { id: created.body.id, ...input, request_key: key });
    version = saved.version;
    const later = await scopedHttp(session, w, "PATCH", `/tasks/${created.body.id}`, {
      expected_version: version,
      title: "later committed title",
      change_note: "later change",
    });
    assertEquals(later.status, 200);
    version = later.body.version;
    const replay = await scopedHttp(session, w, "PATCH", `/tasks/${created.body.id}`, input, key);
    assertEquals(replay.status, 200);
    assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
    assertEquals(replay.body, saved);
    assertEquals(await write(client, w, "update_task", { id: created.body.id, ...input, request_key: key }), saved);
    const current = await scopedHttp(session, w, "GET", `/tasks/${created.body.id}`);
    assertEquals(current.body.title, "later committed title");
    assertEquals(current.body.version, version);
    const freshKey = await scopedHttp(session, w, "PATCH", `/tasks/${created.body.id}`, input);
    assertEquals(freshKey.status, 409);
    assertEquals(freshKey.body.code, "conflict");
  },
  { mcp: true },
);

activityWorkspaceSuite(
  "HTTP/OAuth MCP reject a reused key for changed payload, target or operation without changing current state",
  async ({ A: session, workspaceA: w, clientA: client }) => {
    assert(client);
    const first = await scopedHttp(session, w, "POST", "/tasks", { kind: "once", title: crypto.randomUUID() });
    const second = await scopedHttp(session, w, "POST", "/tasks", { kind: "once", title: crypto.randomUUID() });
    let firstVersion = first.body.version;
    const key = crypto.randomUUID();
    const input = { expected_version: firstVersion, title: "accepted title", change_note: "accepted change" };
    const saved = await scopedHttp(session, w, "PATCH", `/tasks/${first.body.id}`, input, key);
    assertEquals(saved.status, 200);
    firstVersion = saved.body.version;
    for (
      const args of [
        { id: first.body.id, ...input, title: "changed payload", request_key: key },
        { id: first.body.id, ...input, expected_version: firstVersion, request_key: key },
        { id: second.body.id, ...input, request_key: key },
      ]
    ) {
      assertEquals((await scopedTool(client, w, "update_task", args)).error.code, "idempotency_key_reused");
    }
    assertEquals(
      (await scopedTool(client, w, "delete_task", {
        id: first.body.id,
        expected_version: firstVersion,
        request_key: key,
      })).error.code,
      "idempotency_key_reused",
    );
    const changed = await scopedHttp(
      session,
      w,
      "PATCH",
      `/tasks/${first.body.id}`,
      { ...input, title: "changed payload" },
      key,
    );
    assertEquals(changed.status, 409);
    assertEquals(changed.body.code, "idempotency_key_reused");
    assertEquals((await scopedHttp(session, w, "GET", `/tasks/${first.body.id}`)).body.title, "accepted title");
    assertEquals((await scopedHttp(session, w, "GET", `/tasks/${second.body.id}`)).body.title, second.body.title);
  },
  { mcp: true },
);

activityWorkspaceSuite(
  "same UUID is isolated by authenticated executor and workspace across HTTP/OAuth MCP",
  async ({ A: sessionA, B: sessionB, workspaceA: w, workspaceB: otherW, clientB }) => {
    assert(clientB);
    const key = crypto.randomUUID();
    const input = { kind: "once", title: `protocol-owner-${crypto.randomUUID()}` };
    const a = await scopedHttp(sessionA, w, "POST", "/tasks", input, key);
    assertEquals(a.status, 201);
    let b: { id: string; version: number } | undefined;
    b = await write(clientB, otherW, "create_task", { ...input, request_key: key });
    assert(b);
    assertNotEquals(b.id, a.body.id);
    const replayB = await scopedHttp(sessionB, otherW, "POST", "/tasks", input, key);
    assertEquals(replayB.status, 201);
    assertEquals(replayB.body, b);
    assertEquals(replayB.headers.get("Idempotency-Replayed"), "true");
    const ownerKey = crypto.randomUUID();
    const patch = { expected_version: a.body.version, title: "owner A saved", change_note: "owner A change" };
    const saved = await scopedHttp(sessionA, w, "PATCH", `/tasks/${a.body.id}`, patch, ownerKey);
    assertEquals(saved.status, 200);
    a.body = saved.body;
    assertEquals(
      (await scopedTool(clientB, otherW, "update_task", { id: a.body.id, ...patch, request_key: ownerKey })).error.code,
      "not_found",
    );
    assertEquals((await scopedHttp(sessionB, otherW, "PATCH", `/tasks/${a.body.id}`, patch, ownerKey)).status, 404);
    assertEquals((await scopedHttp(sessionB, otherW, "GET", `/tasks/${a.body.id}`)).status, 404);
    assertEquals((await scopedHttp(sessionA, w, "GET", `/tasks/${b.id}`)).status, 404);
  },
  { mcp: true },
);

activityWorkspaceSuite(
  "OAuth MCP soft deletion replays HTTP 204 while the retained original and current conflict remain visible",
  async ({ A: session, workspaceA: w, clientA: client }) => {
    assert(client);
    const created = await scopedHttp(session, w, "POST", "/tasks", { kind: "once", title: crypto.randomUUID() });
    const key = crypto.randomUUID();
    const input = { expected_version: created.body.version, change_note: "delete exactly once" };
    const args = { id: created.body.id, ...input, request_key: key };
    assertEquals(await write(client, w, "delete_task", args), { deleted: created.body.id });
    const replay = await scopedHttp(session, w, "POST", `/tasks/${created.body.id}/delete`, input, key);
    assertEquals(replay.status, 204);
    assertEquals(replay.body, null);
    assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
    assert(replay.headers.get("Idempotency-Completed-At"));
    const repeated = await scopedHttp(session, w, "POST", `/tasks/${created.body.id}/delete`, input, key);
    assertEquals(repeated.status, 204);
    assertEquals(repeated.body, null);
    assertEquals(repeated.headers.get("Idempotency-Replayed"), "true");
    assertEquals(repeated.headers.get("Idempotency-Completed-At"), replay.headers.get("Idempotency-Completed-At"));
    assertEquals(await write(client, w, "delete_task", args), { deleted: created.body.id });
    const retained = await scopedHttp(session, w, "GET", `/tasks/${created.body.id}`);
    assertEquals(retained.status, 200);
    assert(retained.body.deleted_at);
    assertEquals((await scopedHttp(session, w, "POST", `/tasks/${created.body.id}/delete`, input)).status, 409);
  },
  { mcp: true },
);
