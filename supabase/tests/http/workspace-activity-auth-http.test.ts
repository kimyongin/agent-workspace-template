import { assert, assertEquals } from "@std/assert";
import { admin, API, call, httpTest, signIn, SUPABASE_URL } from "./_client.ts";
import { claimsOf, connectMcp, MCP_URL, registerClient, tool } from "../mcp/_mcp.ts";

// Local real bearer/Auth/OAuth and official MCP SDK. No injected Actor.
// The fixture owns only the created workspace, OAuth client and minted sessions.
httpTest(
  "workspace authenticated task deletion shares confirmation metadata across HTTP and official MCP",
  async () => {
    let client: Awaited<ReturnType<typeof connectMcp>> | undefined;
    let aId: string | undefined, bId: string | undefined;
    const auth: { clientId?: string; tokens: string[] } = { tokens: [] };
    let owned: { id: string; name: string } | undefined;
    const errors: unknown[] = [];
    const scoped = async (
      token: string,
      workspace: string,
      method: string,
      path: string,
      body?: unknown,
      key = crypto.randomUUID(),
    ) => {
      const response = await fetch(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "X-Workspace-Id": workspace,
          "content-type": "application/json",
          "Idempotency-Key": key,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
    };
    try {
      const a = await signIn("A");
      auth.tokens.push(a);
      aId = String(claimsOf(a).sub);
      const b = await signIn("B");
      auth.tokens.push(b);
      bId = String(claimsOf(b).sub);
      client = await connectMcp(await trackedMcpToken(b, auth));
      const name = `activity515-auth-${crypto.randomUUID()}`;
      const created = await call(a, "POST", "/workspaces", { name });
      assertEquals(created.status, 201);
      owned = { id: created.body.workspace.id, name };
      // Membership seeding is fixture setup; the real management API sets grants.
      await admin`insert into private.workspace_members(workspace_id,user_id) values(${owned.id},${bId})`;
      assertEquals(
        (await call(a, "PATCH", `/workspaces/${owned.id}/members/${bId}`, {
          expected_version: 1,
          grants: [{ target_kind: "tasks", target_id: "*", access: "write" }],
        })).status,
        200,
      );
      const task = await scoped(b, owned.id, "POST", "/tasks", { kind: "once", title: "실제 인증 삭제 확인" });
      assertEquals(task.status, 201);
      const tag = await tool(client, "create_tag", { workspace_id: owned.id, scope: "record", name: "삭제 확인 분류" });
      assert(typeof tag.id === "string");
      const key = crypto.randomUUID();
      const input = {
        expected_version: task.body.version,
        change_note: "확인한 공동 업무 삭제 사유",
        change_tag_ids: [tag.id],
      };
      assertEquals(
        await tool(client, "delete_task", { workspace_id: owned.id, id: task.body.id, ...input, request_key: key }),
        { deleted: task.body.id },
      );
      const replay = await scoped(b, owned.id, "POST", `/tasks/${task.body.id}/delete`, input, key);
      assertEquals(replay.status, 204, "both transports fingerprint the same accepted confirmation metadata");
      assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
      const history = await scoped(b, owned.id, "GET", `/records?task_id=${task.body.id}`);
      assertEquals(history.status, 200);
      const event = history.body.items.find((item: { change?: { action: string } }) =>
        item.change?.action === "delete"
      );
      assert(event);
      assertEquals(event.body, input.change_note);
      assertEquals(event.tag_ids, [tag.id]);
      const detail = await tool(client, "get_task", { workspace_id: owned.id, id: task.body.id });
      assert(typeof detail.deleted_at === "string");
      assertEquals((await scoped(b, owned.id, "GET", "/tasks")).body.items, []);
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        await client?.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        if (owned) {
          await admin.begin(async (tx) => {
            const [root] = await tx`select name,created_by from app.workspaces where id=${owned!.id} for update`;
            assertEquals(root, { name: owned!.name, created_by: aId });
            const members = await tx`select user_id from private.workspace_members where workspace_id=${owned!.id}`;
            assert(members.every((m) => m.user_id === aId || m.user_id === bId));
            await tx`delete from pgmq.q_search_index where message->>'workspace_id'=${owned!.id}`;
            await tx`delete from pgmq.a_search_index where message->>'workspace_id'=${owned!.id}`;
            await tx`delete from app.workspaces where id=${owned!.id}`;
            assertEquals((await tx`select id from app.workspaces where id=${owned!.id}`).length, 0);
          });
        }
      } catch (error) {
        errors.push(error);
      }
      try {
        if (auth.clientId) {
          const secret = Deno.env.get("LOCAL_SUPABASE_SECRET_KEY");
          assert(secret);
          const removed = await fetch(
            `${SUPABASE_URL}/auth/v1/admin/oauth/clients/${encodeURIComponent(auth.clientId)}`,
            {
              method: "DELETE",
              headers: { apikey: secret, authorization: `Bearer ${secret}` },
              signal: AbortSignal.timeout(15000),
            },
          );
          await removed.body?.cancel();
          assert(removed.ok || removed.status === 404);
        }
      } catch (error) {
        errors.push(error);
      }
      try {
        const sessions = auth.tokens.map((token) => claimsOf(token).session_id).filter((id): id is string =>
          typeof id === "string"
        );
        if (sessions.length) await admin`delete from auth.sessions where id=any(${sessions}::uuid[])`;
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(
        errors,
        "activity authenticated transport or exact owned cleanup failed",
      );
    }
  },
);

// Same tracked local OAuth bootstrap as the existing owned entity transport
// fixture. #518 owns consolidation of the shared tracked Auth setup.
async function trackedMcpToken(
  session: string,
  owned: { clientId?: string; tokens: string[] },
): Promise<string> {
  const registered = await registerClient();
  if (typeof registered.body.client_id === "string") {
    owned.clientId = registered.body.client_id;
  }
  assertEquals(registered.status, 201);
  assert(owned.clientId);
  const encode = (bytes: Uint8Array) =>
    btoa(String.fromCharCode(...bytes))
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const state = encode(crypto.getRandomValues(new Uint8Array(16)));
  const redirect = "http://127.0.0.1:55390/callback";
  const authUrl = `${SUPABASE_URL}/auth/v1`;
  const authorize = new URL(`${authUrl}/oauth/authorize`);
  for (
    const [key, value] of Object.entries({
      response_type: "code",
      client_id: owned.clientId,
      redirect_uri: redirect,
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource: MCP_URL,
      scope: "openid email",
    })
  ) authorize.searchParams.set(key, value);
  const step = await fetch(authorize, {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  await step.body?.cancel();
  const authorization = new URL(
    step.headers.get("location") ?? "",
    SUPABASE_URL,
  ).searchParams.get("authorization_id");
  assert(authorization, "local OAuth consent authorization is present");
  const publishable = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");
  assert(publishable);
  const headers = {
    apikey: publishable,
    authorization: `Bearer ${session}`,
    "content-type": "application/json",
  };
  const details = await fetch(
    `${authUrl}/oauth/authorizations/${authorization}`,
    { headers, signal: AbortSignal.timeout(15000) },
  );
  const detail = await details.json();
  assert(details.ok, "local OAuth authorization details succeed");
  let callback = detail.redirect_url;
  if (!callback) {
    const consent = await fetch(
      `${authUrl}/oauth/authorizations/${authorization}/consent`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({ action: "approve" }),
        signal: AbortSignal.timeout(15000),
      },
    );
    const approved = await consent.json();
    assert(consent.ok, "local OAuth consent succeeds");
    callback = approved.redirect_url;
  }
  const result = new URL(callback);
  assertEquals(result.searchParams.get("state"), state);
  const exchange = await fetch(`${authUrl}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: result.searchParams.get("code") ?? "",
      redirect_uri: redirect,
      client_id: owned.clientId,
      code_verifier: verifier,
      resource: MCP_URL,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const token = await exchange.json();
  // Track any minted session before assertions or SDK connection can fail.
  if (typeof token.access_token === "string") {
    owned.tokens.push(token.access_token);
  }
  assert(exchange.ok, "local OAuth code exchange succeeds");
  assert(typeof token.access_token === "string");
  return token.access_token;
}
