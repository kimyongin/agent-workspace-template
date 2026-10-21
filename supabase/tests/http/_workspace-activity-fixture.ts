import { assert, assertEquals } from "@std/assert";
import { recoverWorkspaceCreation, runWorkspaceCleanup } from "../../../scripts/workspace-fixture-cleanup.mjs";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { admin, API, call, signIn, SUPABASE_URL } from "./_client.ts";
import { claimsOf, MCP_URL, registerClient, tool } from "../mcp/_mcp.ts";

interface OwnedState {
  runId: string;
  sourceRevision: string;
  projectId: string;
  workspaces: { id?: string; name: string; creator: string; creationKey: string; memberIds: string[] }[];
  clients: Set<string>;
  tokens: string[];
  connections: Set<Client>;
}
/** Explicit scope for positive HTTP calls. A null key deliberately tests missing-key rejection. */
export async function scopedHttp(
  token: string | null,
  workspace: string,
  method: string,
  path: string,
  body?: unknown,
  key: string | null = crypto.randomUUID(),
) {
  const headers: Record<string, string> = {
    "X-Workspace-Id": workspace,
    "content-type": "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (key !== null && ["POST", "PATCH", "DELETE"].includes(method)) {
    headers["Idempotency-Key"] = key;
  }
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
    headers: response.headers,
  };
}
/** Caller supplies scope explicitly; raw shared tool remains available for missing-scope negatives. */
export function scopedTool(
  client: Client,
  workspace: string,
  name: string,
  input: Record<string, unknown>,
) {
  const keyed = name === "set_tag_connections" || name === "restore_task"
    ? { request_key: crypto.randomUUID(), ...input }
    : input;
  return tool(client, name, { workspace_id: workspace, ...keyed });
}
export async function completeHttpTask(
  token: string,
  workspace: string,
  body: string,
  occurred_at?: string,
) {
  const task = await scopedHttp(token, workspace, "POST", "/tasks", {
    kind: "once",
    title: "수행 결과 원문",
  });
  assertEquals(task.status, 201);
  const completed = await scopedHttp(
    token,
    workspace,
    "POST",
    `/tasks/${task.body.id}/complete`,
    {
      expected_version: task.body.version,
      body,
      ...(occurred_at ? { occurred_at } : {}),
    },
  );
  assertEquals(completed.status, 200);
  return completed.body.record;
}
export async function completeMcpTask(
  client: Client,
  workspace: string,
  body: string,
) {
  const task = await scopedTool(client, workspace, "create_task", {
    kind: "once",
    title: "수행 결과 원문",
  });
  assert(typeof task.id === "string");
  const completed = await scopedTool(client, workspace, "complete_task", {
    id: task.id,
    expected_version: task.version,
    body,
  });
  assert(typeof completed.record?.id === "string");
  return completed.record;
}
export interface ActivityWorkspaceFixture {
  A: string;
  B: string;
  workspaceA: string;
  workspaceB: string;
  schema: { entity_type_id: string; schema_version: number };
  clientA?: Client;
  clientB?: Client;
  mcpTokenA?: string;
  mcpTokenB?: string;
  registerMember(workspaceId: string, userId: string): void;
}
async function cleanup(owned: OwnedState) {
  const failures: unknown[] = [];
  for (const client of owned.connections) {
    try {
      await client.close();
    } catch (error) {
      failures.push(error);
    }
  }
  for (const workspace of owned.workspaces) {
    try {
      const target = new URL(Deno.env.get("LOCAL_DB_URL")!);
      const environment = {
        name: owned.projectId,
        host: target.hostname,
        port: Number(target.port),
        database: decodeURIComponent(target.pathname.slice(1)),
      };
      if (!workspace.id) {
        const recovered = await recoverWorkspaceCreation(admin, {
          environment,
          actor_id: workspace.creator,
          request_key: workspace.creationKey,
          name: workspace.name,
        });
        assert(recovered, "workspace creation remains unresolved; retain the exact fixture intent");
        workspace.id = recovered.id;
      }
      const manifest = {
        run_id: owned.runId,
        source_revision: owned.sourceRevision,
        project_id: owned.projectId,
        environment,
        workspace: { id: workspace.id, name: workspace.name, created_by: workspace.creator },
        member_ids: workspace.memberIds,
        disposable_effect_ids: [],
      };
      const approval = await runWorkspaceCleanup(admin, manifest);
      console.info(JSON.stringify({ fixture_cleanup: { phase: "planned", manifest, approval } }));
      assertEquals(approval.blockers, []);
      console.info(
        JSON.stringify({
          fixture_cleanup: {
            phase: "applying",
            run_id: owned.runId,
            workspace_id: workspace.id,
            digest: approval.digest,
          },
        }),
      );
      const result = await runWorkspaceCleanup(admin, manifest, approval);
      assertEquals(result.residual_rows, 0);
      console.info(
        JSON.stringify({ fixture_cleanup: { phase: "done", run_id: owned.runId, workspace_id: workspace.id, result } }),
      );
    } catch (error) {
      failures.push(error);
    }
  }
  for (const id of owned.clients) {
    try {
      const secret = Deno.env.get("LOCAL_SUPABASE_SECRET_KEY");
      assert(secret);
      const removed = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/oauth/clients/${encodeURIComponent(id)}`,
        {
          method: "DELETE",
          headers: { apikey: secret, authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      await removed.body?.cancel();
      assert(removed.ok || removed.status === 404);
    } catch (error) {
      failures.push(error);
    }
  }
  try {
    const sessions = [
      ...new Set(
        owned.tokens.map((token) => claimsOf(token).session_id).filter((
          id,
        ): id is string => typeof id === "string"),
      ),
    ];
    if (sessions.length) {
      await admin`delete from auth.sessions where id=any(${sessions}::uuid[])`;
    }
  } catch (error) {
    failures.push(error);
  }
  if (failures.length) {
    throw new AggregateError(failures, "owned activity fixture cleanup failed");
  }
}
export async function withActivityWorkspace(
  run: (fixture: ActivityWorkspaceFixture) => Promise<void>,
  options: { mcp?: boolean; typed?: boolean } = {},
) {
  const sourceRevision = Deno.env.get("WORKSPACE_CLEANUP_SOURCE_REVISION"),
    projectId = Deno.env.get("WORKSPACE_CLEANUP_PROJECT_ID");
  assert(sourceRevision && /^[a-f0-9]{40}$/.test(sourceRevision), "explicit fixture source revision required");
  assert(projectId && projectId.trim(), "explicit isolated fixture project required");
  const owned: OwnedState = {
    runId: crypto.randomUUID(),
    sourceRevision,
    projectId,
    workspaces: [],
    clients: new Set(),
    tokens: [],
    connections: new Set(),
  };
  const failures: unknown[] = [];
  try {
    const A = await signIn("A");
    owned.tokens.push(A);
    const B = await signIn("B");
    owned.tokens.push(B);
    const scopes: string[] = [];
    for (const [label, session] of [["A", A], ["B", B]]) {
      const creator = String(claimsOf(session).sub),
        name = `activity515-owned-${label}-${crypto.randomUUID()}`;
      // Persist the exact unique creation intent before dispatch, including response-loss cleanup.
      const intent: OwnedState["workspaces"][number] = {
        name,
        creator,
        creationKey: crypto.randomUUID(),
        memberIds: [creator],
      };
      owned.workspaces.push(intent);
      console.info(
        JSON.stringify({
          fixture_creation: {
            phase: "pending",
            run_id: owned.runId,
            source_revision: owned.sourceRevision,
            project_id: owned.projectId,
            ...intent,
          },
        }),
      );
      const response = await call(session, "POST", "/workspaces", { name }, intent.creationKey);
      if (typeof response.body?.workspace?.id === "string") {
        intent.id = response.body.workspace.id;
      }
      assertEquals(response.status, 201);
      const workspace = response.body.workspace.id as string;
      scopes.push(workspace);
      assertEquals(
        (await call(
          session,
          "PATCH",
          `/workspaces/${workspace}/members/${creator}`,
          {
            expected_version: 1,
            grants: [
              { target_kind: "settings", target_id: "*", access: "write" },
              { target_kind: "tasks", target_id: "*", access: "write" },
            ],
          },
        )).status,
        200,
      );
    }
    const [workspaceA, workspaceB] = scopes;
    const kind = await scopedHttp(A, workspaceA, "POST", "/entity-types", {
      label: "소유 범위 검증 자료",
    });
    assertEquals(kind.status, 201);
    assertEquals(
      (await call(
        A,
        "PATCH",
        `/workspaces/${workspaceA}/members/${claimsOf(A).sub}`,
        {
          expected_version: 2,
          grants: [
            { target_kind: "settings", target_id: "*", access: "write" },
            { target_kind: "tasks", target_id: "*", access: "write" },
            {
              target_kind: "entity_type",
              target_id: kind.body.id,
              access: "write",
            },
          ],
        },
      )).status,
      200,
    );
    let schemaVersion = 1;
    if (options.typed) {
      const exported = await scopedHttp(
        A,
        workspaceA,
        "GET",
        "/data-model/export",
      );
      assertEquals(exported.status, 200);
      const document = exported.body;
      const type = document.entity_types.find((
        value: { schema: Record<string, unknown> },
      ) => value.schema["x-type-id"] === kind.body.id);
      assert(type);
      const identityKey = type.schema["x-identity-property"];
      const identityField = type.schema.properties[identityKey];
      type.schema.properties.prop_5 = { ...identityField, "x-order": 50 };
      type.schema["x-identity-property"] = "prop_5";
      type.schema.required = [...type.schema.required.filter((key: string) => key !== identityKey), "prop_5"];
      Object.assign(type.schema.properties, {
        prop_2: {
          type: ["integer", "null"],
          title: "속성 2",
          minimum: 0,
          maximum: 1000000,
          default: null,
          "x-order": 20,
        },
        prop_3: {
          type: ["string", "null"],
          title: "속성 3",
          format: "date",
          default: null,
          "x-order": 30,
        },
        prop_4: {
          type: "string",
          title: "속성 4",
          oneOf: [{ const: "a" }, { const: "b" }, { const: "c" }],
          default: "a",
          "x-order": 40,
        },
      });
      const input = { mode: "update", document: JSON.stringify(document) };
      const review = await scopedHttp(
        A,
        workspaceA,
        "POST",
        "/data-model/preview",
        input,
      );
      assertEquals(review.status, 200);
      const change = await scopedHttp(
        A,
        workspaceA,
        "POST",
        "/data-model/changes",
        { ...input, preview_fingerprint: review.body.fingerprint },
      );
      assertEquals(change.status, 201);
      const applied = await scopedHttp(
        A,
        workspaceA,
        "POST",
        `/data-model/changes/${change.body.id}/apply`,
        { expected_version: change.body.version },
      );
      assertEquals(applied.body.status, "applied");
      schemaVersion = 2;
    }
    const fixture: ActivityWorkspaceFixture = {
      A,
      B,
      workspaceA,
      workspaceB,
      schema: { entity_type_id: kind.body.id, schema_version: schemaVersion },
      registerMember: (workspaceId, userId) => {
        const ownedWorkspace = owned.workspaces.find((value) => value.id === workspaceId);
        assert(ownedWorkspace, "member registration requires this run's exact owned workspace");
        assert(
          /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(userId),
          "explicit fixture member identity required",
        );
        if (!ownedWorkspace.memberIds.includes(userId)) ownedWorkspace.memberIds.push(userId);
        console.info(
          JSON.stringify({ fixture_member: { run_id: owned.runId, workspace_id: workspaceId, user_id: userId } }),
        );
      },
    };
    if (options.mcp) {
      for (const [key, session] of [["clientA", A], ["clientB", B]] as const) {
        const grant = await trackedMcpGrant(session, owned);
        const client = new Client({
          name: "workspace-owned-activity-fixture",
          version: "0.0.0",
        });
        owned.connections.add(client);
        await client.connect(
          new StreamableHTTPClientTransport(new URL(MCP_URL), {
            requestInit: {
              headers: { authorization: `Bearer ${grant.access_token}` },
            },
          }),
        );
        fixture[key] = client;
        fixture[key === "clientA" ? "mcpTokenA" : "mcpTokenB"] = grant.access_token;
      }
    }
    await run(fixture);
  } catch (error) {
    failures.push(error);
  } finally {
    try {
      await cleanup(owned);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      "activity fixture execution or cleanup failed",
    );
  }
}
export function activityWorkspaceSuite(
  name: string,
  run: (
    fixture: ActivityWorkspaceFixture,
    context: Deno.TestContext,
  ) => Promise<void>,
  options: { mcp?: boolean; typed?: boolean } = {},
) {
  Deno.test({
    name,
    sanitizeOps: false,
    sanitizeResources: false,
    fn: (context) => withActivityWorkspace((fixture) => run(fixture, context), options),
  });
}

async function trackedMcpGrant(
  session: string,
  owned: OwnedState,
): Promise<{ access_token: string; refresh_token: string; client_id: string }> {
  let clientId: string | undefined;
  const registered = await registerClient();
  if (typeof registered.body.client_id === "string") {
    clientId = registered.body.client_id;
    owned.clients.add(clientId);
  }
  assertEquals(registered.status, 201);
  assert(clientId);
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
      client_id: clientId,
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
      client_id: clientId,
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
  assert(typeof token.refresh_token === "string");
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token,
    client_id: clientId,
  };
}
