import { assert, assertEquals } from "@std/assert";
import { admin, API, call, httpTest, signIn, SUPABASE_URL } from "../http/_client.ts";
import { claimsOf, connectMcp, MCP_URL, mcpToken, tool } from "./_mcp.ts";
httpTest(
  "typed relation HTTP/MCP parity: roles, candidates, exact replay, conflict and explicit replacement",
  async () => {
    const a = await signIn("A"), b = await signIn("B"), client = await connectMcp(await mcpToken(a));
    let typeId: string | undefined, definitionId: string | undefined;
    const owner = JSON.parse(atob(a.split(".")[1].replaceAll("-", "+").replaceAll("_", "/"))).sub as string;
    const keys: string[] = [], failures: unknown[] = [];
    const nextKey = () => {
      const key = crypto.randomUUID();
      keys.push(key);
      return key;
    };
    try {
      const type = await call(a, "POST", "/entity-types", { label: `관계 업무 ${crypto.randomUUID()}` }, nextKey());
      assertEquals(type.status, 201);
      typeId = type.body.id;
      const def = await tool(client, "create_entity_relation_definition", {
        request_key: nextKey(),
        ends: [{ type_id: typeId, label: "소속", cardinality: "one" }, {
          type_id: typeId,
          label: "구성",
          cardinality: "many",
        }],
      });
      definitionId = def.id;
      const values = [];
      for (const title of ["원점", "상대", "새 상대"]) {
        values.push(
          (await call(a, "POST", "/entities", {
            entity_type_id: typeId,
            schema_version: 1,
            properties: { prop_1: title },
          }, nextKey())).body,
        );
      }
      const location = { definition_id: def.id, side: 0, origin_id: values[0].id },
        base = `/entity-relations/${def.id}/0/${encodeURIComponent(values[0].id)}`;
      const input = {
        other_id: values[1].id,
        expected_definition_version: 1,
        expected_version: 1,
        expected_other_version: 1,
      };
      const key = nextKey(), linked = await call(a, "POST", `${base}/connect`, input, key);
      assertEquals(linked.status, 200);
      assertEquals(
        await tool(client, "connect_entity_relation", { ...location, ...input, request_key: key }),
        linked.body,
      );
      assertEquals(
        (await tool(client, "list_entity_relation_links", location)).items.map((e: { id: string }) => e.id),
        [values[1].id],
      );
      assertEquals((await call(b, "GET", `${base}/links`)).status, 404);
      const candidates = await tool(client, "list_entity_relation_candidates", { ...location, q: "새 상대" });
      assertEquals(candidates.items.map((e: { id: string }) => e.id), [values[2].id]);
      const replaced = await tool(client, "replace_entity_relation", {
        request_key: nextKey(),
        ...location,
        ...input,
        other_id: values[2].id,
        expected_version: 2,
        previous_other_id: values[1].id,
        expected_previous_version: 2,
      });
      assertEquals(replaced.changed, true);
      const stale = await call(a, "POST", `${base}/connect`, input, nextKey());
      assertEquals(stale.status, 409);
      const removed = await tool(client, "unlink_entity_relation", {
        request_key: nextKey(),
        ...location,
        ...input,
        other_id: values[2].id,
        expected_version: 3,
        expected_other_version: 2,
      });
      assertEquals(removed.changed, true);
      assertEquals((await call(a, "GET", `${base}/links`)).body.items, []);
    } catch (error) {
      failures.push(error);
    } finally {
      try {
        await admin.begin(async (tx) => {
          const rows = typeId
            ? await tx`select id from app.entities where owner_id=${owner} and entity_type_id=${typeId}::uuid`
            : [];
          const ids = rows.map((row) => String(row.id));
          const records =
            await tx`select id from app.records where owner_id=${owner} and change_metadata->>'target_kind'='entity' and change_metadata->>'target_id'=any(${ids}::text[])`;
          const recordIds = records.map((row) => String(row.id));
          await tx`delete from private.request_results where owner_id=${owner} and request_key=any(${keys}::uuid[])`;
          await tx`delete from pgmq.q_search_index where message->>'owner_id'=${owner} and message->>'kind'='record' and message->>'id'=any(${recordIds}::text[])`;
          await tx`delete from pgmq.a_search_index where message->>'owner_id'=${owner} and message->>'kind'='record' and message->>'id'=any(${recordIds}::text[])`;
          await tx`delete from private.passage_effects where owner_id=${owner} and record_id=any(${recordIds}::text[])`;
          await tx`delete from app.search_chunks where owner_id=${owner} and record_id=any(${recordIds}::text[])`;
          await tx`delete from app.search_index_state where owner_id=${owner} and kind='record' and id=any(${recordIds}::text[])`;
          await tx`delete from app.records where owner_id=${owner} and id=any(${recordIds}::text[])`;
          if (definitionId) {
            await tx`delete from app.entity_relation_links where owner_id=${owner} and definition_id=${definitionId}::uuid`;
            await tx`delete from app.entity_relation_definitions where owner_id=${owner} and id=${definitionId}::uuid`;
          }
          if (typeId) {
            await tx`delete from app.entities where owner_id=${owner} and entity_type_id=${typeId}::uuid`;
            await tx`delete from app.entity_types where owner_id=${owner} and id=${typeId}::uuid`;
          }
        });
      } catch (error) {
        failures.push(error);
      }
      try {
        await client.close();
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length) throw new AggregateError(failures, "typed relation workflow or owned fixture cleanup failed");
  },
);

httpTest("workspace relation real HTTP MCP share business metadata keyed writes and create replace", async () => {
  let token = "", actor: string | undefined;
  let client: Awaited<ReturnType<typeof connectMcp>> | undefined;
  const auth: { clientId?: string; tokens: string[] } = { tokens: [] };
  const owned: { id: string; name: string }[] = [], errors: unknown[] = [];
  const request = async (
    workspace: string,
    method: string,
    path: string,
    body?: unknown,
    key = crypto.randomUUID(),
  ) => {
    const response = await fetch(API + path, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        "X-Workspace-Id": workspace,
        "Content-Type": "application/json",
        "Idempotency-Key": key,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
    return { status: response.status, body: await response.json(), headers: response.headers };
  };
  try {
    token = await signIn("A");
    auth.tokens.push(token);
    actor = String(claimsOf(token).sub);
    client = await connectMcp(await trackedRelationMcpToken(token, auth));
    const name = `relation514-${crypto.randomUUID()}`;
    const made = await call(token, "POST", "/workspaces", { name });
    if (typeof made.body?.workspace?.id === "string") owned.push({ id: made.body.workspace.id, name });
    assertEquals(made.status, 201);
    const workspace = made.body.workspace.id as string;
    const kind = await request(workspace, "POST", "/entity-types", { label: `전송 자료 ${crypto.randomUUID()}` });
    assertEquals(kind.status, 201);
    const typeId = kind.body.id as string;
    const permission = await call(token, "PATCH", `/workspaces/${workspace}/members/${actor}`, {
      expected_version: 1,
      grants: [{ target_kind: "settings", target_id: "*", access: "write" }, {
        target_kind: "entity_type",
        target_id: typeId,
        access: "write",
      }],
    });
    assertEquals(permission.status, 200);
    const scope = { workspace_id: workspace };
    const def = await tool(client, "create_entity_relation_definition", {
      ...scope,
      ends: [{ type_id: typeId, label: "설정 원점", cardinality: "one" }, {
        type_id: typeId,
        label: "설정 상대",
        cardinality: "one",
      }],
    });
    assertEquals(typeof def.id, "string");
    assertEquals(
      (await tool(client, "list_entity_relation_definitions", { ...scope, purpose: "business", type_id: typeId })).items
        .map((item: { id: string }) => item.id),
      [def.id],
    );
    assertEquals(
      (await request(workspace, "GET", `/entity-relation-definitions/${def.id}?purpose=business`)).body,
      def,
    );
    const create = (title: string) =>
      request(workspace, "POST", "/entities", {
        entity_type_id: typeId,
        schema_version: 1,
        properties: { prop_1: title },
      });
    const origin = await create("전송 원점"), previous = await create("전송 이전 상대");
    assertEquals([origin.status, previous.status], [201, 201]);
    const location = { definition_id: def.id, side: 0, origin_id: origin.body.id },
      base = `/entity-relations/${def.id}/0/${encodeURIComponent(origin.body.id)}`;
    const candidates = await request(workspace, "GET", `${base}/candidates?q=${encodeURIComponent("전송 이전 상대")}`);
    assertEquals(candidates.status, 200);
    assertEquals(
      await tool(client, "list_entity_relation_candidates", { ...scope, ...location, q: "전송 이전 상대" }),
      candidates.body,
    );
    const input = {
      other_id: previous.body.id,
      expected_definition_version: 1,
      expected_version: 1,
      expected_other_version: 1,
    };
    const key = crypto.randomUUID(), connected = await request(workspace, "POST", `${base}/connect`, input, key);
    assertEquals(connected.status, 200);
    assertEquals(
      await tool(client, "connect_entity_relation", { ...scope, ...location, ...input, request_key: key }),
      connected.body,
    );
    const nextKey = crypto.randomUUID(),
      nextInput = {
        expected_definition_version: 1,
        expected_version: 2,
        previous_other_id: previous.body.id,
        expected_previous_version: 2,
        entity: { entity_type_id: typeId, schema_version: 1, properties: { prop_1: "전송 새 상대" } },
      };
    const replaced = await tool(client, "create_and_link_entity", {
      ...scope,
      ...location,
      ...nextInput,
      request_key: nextKey,
    });
    assertEquals(replaced.entity.version, 2);
    assertEquals((await request(workspace, "POST", `${base}/create-and-link`, nextInput, nextKey)).body, replaced);
    assertEquals(
      (await tool(client, "list_entity_relation_links", { ...scope, ...location })).items.map((item: { id: string }) =>
        item.id
      ),
      [replaced.entity.id],
    );
    const removed = await tool(client, "unlink_entity_relation", {
      ...scope,
      ...location,
      other_id: replaced.entity.id,
      expected_definition_version: 1,
      expected_version: 3,
      expected_other_version: 2,
      request_key: crypto.randomUUID(),
    });
    assertEquals(removed.changed, true);
    assertEquals((await request(workspace, "GET", `${base}/links`)).body.items, []);
    const foreignName = `relation514-other-${crypto.randomUUID()}`;
    const foreign = await call(token, "POST", "/workspaces", { name: foreignName });
    if (typeof foreign.body?.workspace?.id === "string") {
      owned.push({ id: foreign.body.workspace.id, name: foreignName });
    }
    assertEquals(foreign.status, 201);
    assertEquals((await request(foreign.body.workspace.id, "GET", `${base}/links`)).status, 404);
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
          assertEquals(root, { name: workspace.name, created_by: actor });
          const members = await tx`select user_id from private.workspace_members where workspace_id=${workspace.id}`;
          assert(members.every((member) => member.user_id === actor));
          await tx`delete from pgmq.q_search_index where message->>'workspace_id'=${workspace.id}`;
          await tx`delete from pgmq.a_search_index where message->>'workspace_id'=${workspace.id}`;
          await tx`delete from app.workspaces where id=${workspace.id}`;
          assertEquals((await tx`select id from app.workspaces where id=${workspace.id}`).length, 0);
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
      const sessions = auth.tokens.map((value) => claimsOf(value).session_id).filter((id): id is string =>
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
  if (errors.length) throw new AggregateError(errors, "workspace relation transport or exact fixture cleanup failed");
});

// Keep this fixture local until #518 owns a shared tracked OAuth bootstrap. The
// ordinary helper cannot expose a registered client if consent/exchange fails.
async function trackedRelationMcpToken(
  session: string,
  owned: { clientId?: string; tokens: string[] },
): Promise<string> {
  const registeredResponse = await fetch(`${SUPABASE_URL}/auth/v1/oauth/clients/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "workspace-relation-test",
      redirect_uris: ["http://127.0.0.1:55390/callback"],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
    signal: AbortSignal.timeout(15000),
  });
  const registered = { status: registeredResponse.status, body: await registeredResponse.json() };
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
