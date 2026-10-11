// Public network seam: real HTTP bearer session and OAuth MCP token + official SDK.
// Each retry explicitly repeats the logical UUID; JSON-RPC IDs/SDK reconnects are not request keys.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { Client } from "@modelcontextprotocol/client";
import { call, httpTest, signIn } from "../http/_client.ts";
import { connectMcp, mcpToken, tool } from "./_mcp.ts";

// deno-lint-ignore no-explicit-any
async function write(client: Client, name: string, arguments_: Record<string, unknown>): Promise<any> {
  const result = await client.callTool({ name, arguments: arguments_ });
  assertEquals(result.isError ?? false, false);
  assert(result.structuredContent);
  return result.structuredContent;
}

httpTest("HTTP→OAuth MCP creation replay preserves the explicit key across independent SDK connections", async () => {
  const session = await signIn("A");
  const token = await mcpToken(session);
  const firstClient = await connectMcp(token);
  let secondClient: Client | undefined;
  const key = crypto.randomUUID();
  const input = { kind: "once", title: `protocol-create-${crypto.randomUUID()}` };
  const created = await call(session, "POST", "/tasks", input, key);
  assertEquals(created.status, 201);
  try {
    const arguments_ = { ...input, request_key: key };
    assertEquals(await write(firstClient, "create_task", arguments_), created.body);
    await firstClient.close();
    secondClient = await connectMcp(token);
    assertEquals(await write(secondClient, "create_task", arguments_), created.body);
    const replay = await call(session, "POST", "/tasks", input, key);
    assertEquals(replay.status, 201);
    assertEquals(replay.body, created.body);
    assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
    assert(replay.headers.get("Idempotency-Completed-At"));
    const listed = await call(session, "GET", `/tasks?keyword=${encodeURIComponent(input.title)}&limit=100`);
    assertEquals(listed.body.items.map((item: { id: string }) => item.id), [created.body.id]);
  } finally {
    await secondClient?.close();
    await firstClient.close();
    await call(session, "POST", `/tasks/${created.body.id}/delete`, { expected_version: created.body.version });
  }
});

httpTest(
  "OAuth MCP→HTTP stale expected_version replay returns its past result while current state stays newer",
  async () => {
    const session = await signIn("A");
    const client = await connectMcp(await mcpToken(session));
    const created = await call(session, "POST", "/tasks", { kind: "once", title: crypto.randomUUID() });
    let version = created.body.version;
    try {
      const key = crypto.randomUUID();
      const input = { expected_version: version, title: "first committed title", change_note: "first change" };
      const saved = await write(client, "update_task", { id: created.body.id, ...input, request_key: key });
      version = saved.version;
      const later = await call(session, "PATCH", `/tasks/${created.body.id}`, {
        expected_version: version,
        title: "later committed title",
        change_note: "later change",
      });
      assertEquals(later.status, 200);
      version = later.body.version;
      const replay = await call(session, "PATCH", `/tasks/${created.body.id}`, input, key);
      assertEquals(replay.status, 200);
      assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
      assertEquals(replay.body, saved);
      assertEquals(await write(client, "update_task", { id: created.body.id, ...input, request_key: key }), saved);
      const current = await call(session, "GET", `/tasks/${created.body.id}`);
      assertEquals(current.body.title, "later committed title");
      assertEquals(current.body.version, version);
      const freshKey = await call(session, "PATCH", `/tasks/${created.body.id}`, input);
      assertEquals(freshKey.status, 409);
      assertEquals(freshKey.body.code, "conflict");
    } finally {
      await client.close();
      await call(session, "POST", `/tasks/${created.body.id}/delete`, { expected_version: version });
    }
  },
);

httpTest(
  "HTTP/OAuth MCP reject a reused key for changed payload, target or operation without changing current state",
  async () => {
    const session = await signIn("A");
    const client = await connectMcp(await mcpToken(session));
    const first = await call(session, "POST", "/tasks", { kind: "once", title: crypto.randomUUID() });
    const second = await call(session, "POST", "/tasks", { kind: "once", title: crypto.randomUUID() });
    let firstVersion = first.body.version;
    try {
      const key = crypto.randomUUID();
      const input = { expected_version: firstVersion, title: "accepted title", change_note: "accepted change" };
      const saved = await call(session, "PATCH", `/tasks/${first.body.id}`, input, key);
      assertEquals(saved.status, 200);
      firstVersion = saved.body.version;
      for (
        const args of [
          { id: first.body.id, ...input, title: "changed payload", request_key: key },
          { id: first.body.id, ...input, expected_version: firstVersion, request_key: key },
          { id: second.body.id, ...input, request_key: key },
        ]
      ) {
        assertEquals((await tool(client, "update_task", args)).error.code, "idempotency_key_reused");
      }
      assertEquals(
        (await tool(client, "delete_task", {
          id: first.body.id,
          expected_version: firstVersion,
          request_key: key,
        })).error.code,
        "idempotency_key_reused",
      );
      const changed = await call(
        session,
        "PATCH",
        `/tasks/${first.body.id}`,
        { ...input, title: "changed payload" },
        key,
      );
      assertEquals(changed.status, 409);
      assertEquals(changed.body.code, "idempotency_key_reused");
      assertEquals((await call(session, "GET", `/tasks/${first.body.id}`)).body.title, "accepted title");
      assertEquals((await call(session, "GET", `/tasks/${second.body.id}`)).body.title, second.body.title);
    } finally {
      await client.close();
      await call(session, "POST", `/tasks/${first.body.id}/delete`, { expected_version: firstVersion });
      await call(session, "POST", `/tasks/${second.body.id}/delete`, { expected_version: second.body.version });
    }
  },
);

httpTest(
  "same UUID is isolated by authenticated owner across HTTP/OAuth MCP and never reveals another owner's result",
  async () => {
    const sessionA = await signIn("A");
    const sessionB = await signIn("B");
    const clientB = await connectMcp(await mcpToken(sessionB));
    const key = crypto.randomUUID();
    const input = { kind: "once", title: `protocol-owner-${crypto.randomUUID()}` };
    const a = await call(sessionA, "POST", "/tasks", input, key);
    assertEquals(a.status, 201);
    let b: { id: string; version: number } | undefined;
    try {
      b = await write(clientB, "create_task", { ...input, request_key: key });
      assert(b);
      assertNotEquals(b.id, a.body.id);
      const replayB = await call(sessionB, "POST", "/tasks", input, key);
      assertEquals(replayB.status, 201);
      assertEquals(replayB.body, b);
      assertEquals(replayB.headers.get("Idempotency-Replayed"), "true");
      const ownerKey = crypto.randomUUID();
      const patch = { expected_version: a.body.version, title: "owner A saved", change_note: "owner A change" };
      const saved = await call(sessionA, "PATCH", `/tasks/${a.body.id}`, patch, ownerKey);
      assertEquals(saved.status, 200);
      a.body = saved.body;
      assertEquals(
        (await tool(clientB, "update_task", { id: a.body.id, ...patch, request_key: ownerKey })).error.code,
        "not_found",
      );
      assertEquals((await call(sessionB, "PATCH", `/tasks/${a.body.id}`, patch, ownerKey)).status, 404);
      assertEquals((await call(sessionB, "GET", `/tasks/${a.body.id}`)).status, 404);
      assertEquals((await call(sessionA, "GET", `/tasks/${b.id}`)).status, 404);
    } finally {
      await clientB.close();
      await call(sessionA, "POST", `/tasks/${a.body.id}/delete`, { expected_version: a.body.version });
      if (b) await call(sessionB, "POST", `/tasks/${b.id}/delete`, { expected_version: b.version });
    }
  },
);

httpTest(
  "OAuth MCP deletion replays as HTTP 204 with marker through the canonical POST after target removal",
  async () => {
    const session = await signIn("A");
    const client = await connectMcp(await mcpToken(session));
    const created = await call(session, "POST", "/tasks", { kind: "once", title: crypto.randomUUID() });
    const key = crypto.randomUUID();
    const input = { expected_version: created.body.version, change_note: "delete exactly once" };
    try {
      const args = { id: created.body.id, ...input, request_key: key };
      assertEquals(await write(client, "delete_task", args), { deleted: created.body.id });
      const replay = await call(session, "POST", `/tasks/${created.body.id}/delete`, input, key);
      assertEquals(replay.status, 204);
      assertEquals(replay.body, null);
      assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
      assert(replay.headers.get("Idempotency-Completed-At"));
      const repeated = await call(session, "POST", `/tasks/${created.body.id}/delete`, input, key);
      assertEquals(repeated.status, 204);
      assertEquals(repeated.body, null);
      assertEquals(repeated.headers.get("Idempotency-Replayed"), "true");
      assertEquals(repeated.headers.get("Idempotency-Completed-At"), replay.headers.get("Idempotency-Completed-At"));
      assertEquals(await write(client, "delete_task", args), { deleted: created.body.id });
      assertEquals((await call(session, "GET", `/tasks/${created.body.id}`)).status, 404);
      assertEquals((await call(session, "POST", `/tasks/${created.body.id}/delete`, input)).status, 404);
    } finally {
      await client.close();
      await call(session, "POST", `/tasks/${created.body.id}/delete`, { expected_version: created.body.version });
    }
  },
);
