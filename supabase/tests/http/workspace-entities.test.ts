import { assert, assertEquals } from "@std/assert";
import { admin, API, call, httpTest, signIn, SUPABASE_URL } from "./_client.ts";
import { claimsOf, connectMcp, MCP_URL, registerClient, tool } from "../mcp/_mcp.ts";

// Actual bearer/OAuth transports. SQL only seeds membership in fresh owned W,
// checks persisted single-parent/queue facts, and disposes of the exact fixture.
httpTest("workspace entity HTTP/MCP independent tags preserve content and enforce current kind authority", async () => {
  let client: Awaited<ReturnType<typeof connectMcp>> | undefined;
  let aId: string | undefined, bId: string | undefined;
  const auth: { clientId?: string; tokens: string[] } = { tokens: [] };
  const owned: { id: string; name: string }[] = [];
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
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  try {
    const a = await signIn("A");
    auth.tokens.push(a);
    aId = String(claimsOf(a).sub);
    const b = await signIn("B");
    auth.tokens.push(b);
    bId = String(claimsOf(b).sub);
    client = await connectMcp(await trackedMcpToken(b, auth));
    for (const label of ["shared", "other"]) {
      const name = `entity514-${label}-${crypto.randomUUID()}`;
      const created = await call(a, "POST", "/workspaces", { name });
      assertEquals(created.status, 201);
      owned.push({ id: created.body.workspace.id, name });
    }
    const [w, other] = owned;
    const kind = await scoped(a, w.id, "POST", "/entity-types", { label: "공유 자료" });
    assertEquals(kind.status, 201);
    const kindGrant = { target_kind: "entity_type", target_id: kind.body.id, access: "write" };
    // Retain the creator's sole settings manager grant.
    assertEquals(
      (await call(a, "PATCH", `/workspaces/${w.id}/members/${aId}`, {
        expected_version: 1,
        grants: [{ target_kind: "settings", target_id: "*", access: "write" }, kindGrant],
      })).status,
      200,
    );
    for (const workspace of owned) {
      await admin`insert into private.workspace_members(workspace_id,user_id) values(${workspace.id},${bId})`;
    }
    assertEquals(
      (await call(a, "PATCH", `/workspaces/${w.id}/members/${bId}`, { expected_version: 1, grants: [kindGrant] }))
        .status,
      200,
    );
    const input = {
      entity_type_id: kind.body.id,
      schema_version: 1,
      properties: { prop_1: "업무 쓰기만 있는 사용자의 자료" },
    };
    assertEquals((await call(b, "POST", "/entities", input)).status, 400, "workspace header is required");
    assertEquals(
      (await tool(client, "create_entity", { ...input, request_key: crypto.randomUUID() })).error.code,
      "invalid_input",
    );
    const createKey = crypto.randomUUID();
    const created = await scoped(b, w.id, "POST", "/entities", input, createKey);
    assertEquals(created.status, 201);
    const entity = created.body;
    assertEquals(await tool(client, "create_entity", { workspace_id: w.id, ...input, request_key: createKey }), entity);
    const path = `/entities/${encodeURIComponent(entity.id)}`;
    assertEquals((await scoped(a, w.id, "GET", path)).body.id, entity.id);
    assertEquals((await tool(client, "get_entity", { workspace_id: w.id, id: entity.id })).id, entity.id);
    assertEquals((await scoped(a, other.id, "GET", path)).status, 404);
    assertEquals((await tool(client, "get_entity", { workspace_id: other.id, id: entity.id })).error.code, "not_found");
    assertEquals(
      (await scoped(b, w.id, "GET", `/entities?entity_type_id=${kind.body.id}`)).body.items.map((row: { id: string }) =>
        row.id
      ),
      [entity.id],
    );
    assertEquals(
      (await tool(client, "list_entities", { workspace_id: w.id, entity_type_id: kind.body.id })).items.map((
        row: { id: string },
      ) => row.id),
      [entity.id],
    );
    const tag = await scoped(b, w.id, "POST", "/tags", { scope: "entity", name: "업무 분류" });
    assertEquals(tag.status, 201, "dictionary creation does not require settings WRITE");
    const recordTag = await tool(client, "create_tag", { workspace_id: w.id, scope: "record", name: "기록 전용" });
    assert(recordTag.id);
    const foreignTag = await scoped(a, other.id, "POST", "/tags", { scope: "entity", name: "외부 분류" });
    assertEquals(foreignTag.status, 201);
    const connection = { target_kind: "entity", target_id: entity.id, expected_version: 1, tag_ids: [tag.body.id] };
    for (const tag_ids of [[], [tag.body.id]]) {
      assertEquals((await scoped(b, w.id, "POST", "/entities", { ...input, tag_ids })).body.code, "invalid_input");
      assertEquals(
        (await tool(client, "create_entity", { workspace_id: w.id, ...input, tag_ids })).error.code,
        "invalid_input",
      );
      const edit = { schema_version: 1, expected_version: 1, properties: { prop_1: "거부되는 구 입력" }, tag_ids };
      assertEquals((await scoped(b, w.id, "PATCH", path, edit)).body.code, "invalid_input");
      assertEquals(
        (await tool(client, "update_entity", { workspace_id: w.id, id: entity.id, ...edit })).error.code,
        "invalid_input",
      );
    }
    for (const bad of [recordTag.id, foreignTag.body.id]) {
      const wrong = { ...connection, tag_ids: [bad] };
      assertEquals((await scoped(b, w.id, "POST", "/tag-connections", wrong)).body.code, "invalid_reference");
      assertEquals(
        (await tool(client, "set_tag_connections", { workspace_id: w.id, ...wrong, request_key: crypto.randomUUID() }))
          .error.code,
        "invalid_reference",
      );
    }
    assertEquals((await scoped(b, other.id, "POST", "/tag-connections", connection)).status, 404);
    assertEquals(
      (await tool(client, "set_tag_connections", {
        workspace_id: other.id,
        ...connection,
        request_key: crypto.randomUUID(),
      })).error.code,
      "not_found",
    );
    const preparation = {
      intent: "tag-connections",
      model: "entity",
      action: "update",
      target_id: entity.id,
      expected_version: 1,
      input: { tag_ids: [tag.body.id] },
    };
    const prepared = await tool(client, "prepare_record_memo", { workspace_id: w.id, ...preparation });
    assertEquals(prepared.prepared_input, { expected_version: 1, tag_ids: [tag.body.id] });
    assertEquals((await scoped(b, w.id, "POST", "/records/prepare", preparation)).body, prepared);
    const connectInput = { ...connection, change_note: prepared.change_note, change_tag_ids: prepared.change_tag_ids };
    const connectKey = crypto.randomUUID();
    const linked = await tool(client, "set_tag_connections", {
      workspace_id: w.id,
      ...connectInput,
      request_key: connectKey,
    });
    assertEquals([linked.tag_ids, linked.version], [[tag.body.id], 2]);
    assertEquals(Object.keys(linked).sort(), ["tag_ids", "updated_at", "version"]);
    const replay = await scoped(b, w.id, "POST", "/tag-connections", connectInput, connectKey);
    assertEquals(replay.status, 200);
    assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
    assertEquals(replay.body, linked);
    const edited = await scoped(b, w.id, "PATCH", path, {
      schema_version: 1,
      expected_version: 2,
      properties: { prop_1: "내용만 수정" },
    });
    assertEquals(edited.status, 200);
    assertEquals([edited.body.tag_ids, edited.body.version, edited.body.properties.prop_1], [
      [tag.body.id],
      3,
      "내용만 수정",
    ]);
    const unlinked = await scoped(b, w.id, "POST", "/tag-connections", {
      ...connection,
      expected_version: 3,
      tag_ids: [],
    });
    assertEquals(unlinked.status, 200);
    assertEquals([unlinked.body.tag_ids, unlinked.body.version], [[], 4]);
    const detail = await tool(client, "get_entity", { workspace_id: w.id, id: entity.id });
    assertEquals([detail.tag_ids, detail.version, detail.properties.prop_1, detail.records.count], [
      [],
      4,
      "내용만 수정",
      4,
    ]);
    // Administrative storage assertions are additional atomicity evidence, not
    // public transport authorization evidence. Runtime must be idle/serial.
    const records =
      await admin`select id,entity_id,task_id,owner_id from app.records where workspace_id=${w.id} and entity_id=${entity.id}`;
    assertEquals(records.length, 4);
    for (const record of records) {
      assertEquals([record.entity_id, record.task_id, record.owner_id], [entity.id, null, null]);
      assertEquals(
        Number(
          (await admin`select count(*) n from pgmq.q_search_index where message->>'workspace_id'=${w.id} and message->>'id'=${record.id}`)[
            0
          ].n,
        ),
        1,
      );
    }
    // READ keeps visibility but never permits ordinary mutation or retained WRITE replay.
    assertEquals(
      (await call(a, "PATCH", `/workspaces/${w.id}/members/${bId}`, {
        expected_version: 2,
        grants: [{ ...kindGrant, access: "read" }],
      })).status,
      200,
    );
    assertEquals((await scoped(b, w.id, "GET", path)).status, 200);
    const deniedEdit = { schema_version: 1, expected_version: 4, properties: { prop_1: "권한 회수 후 수정" } };
    assertEquals((await scoped(b, w.id, "PATCH", path, deniedEdit)).status, 403);
    assertEquals(
      (await tool(client, "update_entity", { workspace_id: w.id, id: entity.id, ...deniedEdit })).error.code,
      "forbidden",
    );

    assertEquals(
      (await scoped(b, w.id, "POST", "/tag-connections", { ...connection, expected_version: 4 })).status,
      403,
    );
    assertEquals(
      (await tool(client, "set_tag_connections", {
        workspace_id: w.id,
        ...connection,
        expected_version: 4,
        request_key: crypto.randomUUID(),
      })).error.code,
      "forbidden",
    );
    assertEquals((await scoped(b, w.id, "POST", "/tag-connections", connectInput, connectKey)).status, 403);
    assertEquals(
      (await tool(client, "set_tag_connections", { workspace_id: w.id, ...connectInput, request_key: connectKey }))
        .error.code,
      "forbidden",
    );
    assertEquals((await scoped(b, w.id, "POST", "/entities", input, createKey)).status, 403);
    assertEquals(
      (await tool(client, "create_entity", { workspace_id: w.id, ...input, request_key: createKey })).error.code,
      "forbidden",
    );
    assertEquals(
      (await call(a, "PATCH", `/workspaces/${w.id}/members/${bId}`, { expected_version: 3, grants: [] })).status,
      200,
    );
    assertEquals((await scoped(b, w.id, "GET", path)).status, 404);
    assertEquals((await tool(client, "get_entity", { workspace_id: w.id, id: entity.id })).error.code, "not_found");
    assertEquals((await scoped(a, w.id, "GET", path)).body, detail);
  } catch (error) {
    errors.push(error);
  } finally {
    try {
      await client?.close();
    } catch (error) {
      errors.push(error);
    }
    try {
      await admin.begin(async (tx) => {
        for (const workspace of owned) {
          const [root] = await tx`select name,created_by from app.workspaces where id=${workspace.id} for update`;
          assertEquals(root, { name: workspace.name, created_by: aId });
          const members = await tx`select user_id from private.workspace_members where workspace_id=${workspace.id}`;
          assert(members.every((m) => m.user_id === aId || m.user_id === bId));
          await tx`delete from pgmq.q_search_index where message->>'workspace_id'=${workspace.id}`;
          await tx`delete from pgmq.a_search_index where message->>'workspace_id'=${workspace.id}`;
          await tx`delete from app.workspaces where id=${workspace.id}`;
          assertEquals((await tx`select id from app.workspaces where id=${workspace.id}`).length, 0);
          assertEquals((await tx`select id from app.records where workspace_id=${workspace.id}`).length, 0);
        }
      });
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
      if (sessions.length) {
        await admin`delete from auth.sessions where id=any(${sessions}::uuid[])`;
        assertEquals(
          Number((await admin`select count(*) n from auth.sessions where id=any(${sessions}::uuid[])`)[0].n),
          0,
        );
      }
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length) throw new AggregateError(errors, "workspace entity transport or owned cleanup failed");
});

// Keep this fixture local until #518 owns a shared tracked OAuth bootstrap. The
// ordinary helper cannot expose a registered client if consent/exchange fails.
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
