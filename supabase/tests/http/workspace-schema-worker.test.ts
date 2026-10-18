import { assert, assertEquals } from "@std/assert";
import { admin, API, call, httpTest, signIn, SUPABASE_URL } from "./_client.ts";
import {
  claimsOf,
  connectMcp,
  MCP_URL,
  registerClient,
  tool,
} from "../mcp/_mcp.ts";
import { connect, urls } from "../database/_db.ts";
import { runInWorkspace } from "../../functions/_shared/adapters/supabase/workspace-context.ts";
import type { DataModelDocument } from "../../functions/_shared/contracts/data-model.ts";

// Full-model transport seam only. Source seeding uses the real app_server → app_user
// boundary; it does not claim to verify the entity CRUD or invitation transports.
httpTest(
  "workspace durable analysis HTTP/MCP keeps current kind authority and scoped replay",
  async () => {
    let client: Awaited<ReturnType<typeof connectMcp>> | undefined;
    let sql: ReturnType<typeof connect> | undefined;
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
      requestKey = crypto.randomUUID(),
    ) => {
      const response = await fetch(`${API}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "X-Workspace-Id": workspace,
          "content-type": "application/json",
          "Idempotency-Key": requestKey,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
      return {
        status: response.status,
        body: await response.json(),
        headers: response.headers,
      };
    };
    try {
      const a = await signIn("A");
      auth.tokens.push(a);
      aId = String(claimsOf(a).sub);
      const b = await signIn("B");
      auth.tokens.push(b);
      bId = String(claimsOf(b).sub);
      const mcpToken = await trackedMcpToken(b, auth);
      client = await connectMcp(mcpToken);
      sql = connect(urls.direct, { max: 1, prepare: false });
      for (const label of ["shared", "other"]) {
        const name = `worker513-${label}-${crypto.randomUUID()}`;
        const created = await call(a, "POST", "/workspaces", { name });
        assertEquals(created.status, 201);
        owned.push({ id: created.body.workspace.id, name });
      }
      const [w, other] = owned;
      await admin`insert into private.workspace_members(workspace_id,user_id) values(${other.id},${bId})`;
      assertEquals(
        (await call(a, "PATCH", `/workspaces/${other.id}/members/${bId}`, {
          expected_version: 1,
          grants: [{
            target_kind: "settings",
            target_id: "*",
            access: "write",
          }],
        })).status,
        200,
      );
      const kinds: string[] = [];
      for (const label of ["first", "second"]) {
        const created = await scoped(a, w.id, "POST", "/entity-types", {
          label,
        });
        assertEquals(created.status, 201);
        kinds.push(created.body.id);
      }
      const grants = [
        { target_kind: "settings", target_id: "*", access: "write" },
        ...kinds.map((id) => ({
          target_kind: "entity_type",
          target_id: id,
          access: "write",
        })),
      ];
      assertEquals(
        (await call(a, "PATCH", `/workspaces/${w.id}/members/${aId}`, {
          expected_version: 1,
          grants,
        })).status,
        200,
      );
      // Only this fresh, exclusively owned workspace receives a seed membership.
      await admin`insert into private.workspace_members(workspace_id,user_id) values(${w.id},${bId})`;
      assertEquals(
        (await call(a, "PATCH", `/workspaces/${w.id}/members/${bId}`, {
          expected_version: 1,
          grants,
        })).status,
        200,
      );
      for (const kind of kinds) {
        const external = crypto.randomUUID();
        await runInWorkspace(
          sql,
          { userId: aId, workspaceId: w.id },
          {
            mode: "business",
            requirements: [{
              target_kind: "entity_type",
              target_id: kind,
              access: "write",
            }],
          },
          (tx) =>
            tx`insert into app.entities(workspace_id,id,source,external_id,entity_type_id,schema_version,properties)
        values(${w.id},${`app:${kind}:${external}`},'app',${external},${kind},1,'{"prop_1":"12"}')`,
        );
      }
      const document = await tool(client, "export_data_model", {
        workspace_id: w.id,
      }) as DataModelDocument;
      assertEquals(document.entity_types.length, 2);
      for (const kind of document.entity_types) {
        kind.schema.properties.prop_1.maxLength = 1;
      }
      const input = { mode: "update", document: JSON.stringify(document) };
      const preview = await tool(client, "preview_data_model", {
        workspace_id: w.id,
        ...input,
      });
      const prepared = await tool(client, "prepare_data_model", {
        workspace_id: w.id,
        ...input,
        preview_fingerprint: preview.fingerprint,
        request_key: crypto.randomUUID(),
      });
      assertEquals(prepared.status, "needs_conversion");
      const analyze = {
        expected_version: prepared.version,
        conversions: document.entity_types.map((kind) => ({
          type_ref: kind.ref,
          migration: { rules: [], overrides: [] },
        })),
      };
      const key = crypto.randomUUID();
      const accepted = await tool(client, "analyze_data_model", {
        workspace_id: w.id,
        id: prepared.id,
        ...analyze,
        request_key: key,
      });
      assertEquals(accepted.status, "analyzing");
      const replay = await scoped(
        b,
        w.id,
        "POST",
        `/data-model/changes/${prepared.id}/analyze`,
        analyze,
        key,
      );
      assertEquals(replay.status, 200);
      assertEquals(replay.headers.get("Idempotency-Replayed"), "true");
      assertEquals(replay.body, accepted);
      // A different real actor cannot receive B's accepted response with B's key.
      const actorReplay = await scoped(
        a,
        w.id,
        "POST",
        `/data-model/changes/${prepared.id}/analyze`,
        analyze,
        key,
      );
      assertEquals(actorReplay.headers.get("Idempotency-Replayed"), null);
      assertEquals(actorReplay.status, 409);
      const progress = await tool(client, "get_data_model_change", {
        workspace_id: w.id,
        id: prepared.id,
      });
      const httpProgress = await scoped(
        b,
        w.id,
        "GET",
        `/data-model/changes/${prepared.id}`,
      );
      assertEquals(httpProgress.status, 200);
      assertEquals(httpProgress.body, progress);
      assertEquals(progress.status, "analyzing");
      assertEquals(progress.group.total, 2);
      assertEquals(progress.group.processed, 0);
      assertEquals(progress.group.children.length, 2);
      // The same actor managing another workspace cannot substitute this model ID.
      assertEquals(
        (await scoped(a, other.id, "GET", `/data-model/changes/${prepared.id}`))
          .status,
        404,
      );
      assertEquals(
        (await scoped(
          a,
          other.id,
          "POST",
          `/data-model/changes/${prepared.id}/analyze`,
          analyze,
          key,
        )).status,
        404,
      );
      assertEquals(
        (await tool(client, "get_data_model_change", {
          workspace_id: other.id,
          id: prepared.id,
        })).error.code,
        "not_found",
      );
      const protectedChild = progress.group.children.find(
        (child: { change: { type_id: string } }) =>
          child.change.type_id === kinds[1],
      );
      assert(protectedChild);
      const rowArgs = {
        type_id: kinds[1],
        change_id: protectedChild.change.id,
        analysis_id: protectedChild.change.analysis.id,
      };
      const rowPath =
        `/entity-types/${rowArgs.type_id}/schema-changes/${rowArgs.change_id}/rows?analysis_id=${rowArgs.analysis_id}`;
      const beforeRows = await scoped(b, w.id, "GET", rowPath);
      assertEquals(beforeRows.status, 409);
      assertEquals(
        (await tool(client, "list_entity_schema_analysis_rows", {
          workspace_id: w.id,
          ...rowArgs,
        })).error.code,
        "conflict",
      );
      // Keep settings WRITE and one kind WRITE: the affected second kind still controls
      // both historical model bytes and exact successful-request replay.
      assertEquals(
        (await call(a, "PATCH", `/workspaces/${w.id}/members/${bId}`, {
          expected_version: 2,
          grants: grants.filter((g) => g.target_id !== kinds[1]),
        })).status,
        200,
      );
      assertEquals(
        (await scoped(b, w.id, "GET", `/data-model/changes/${prepared.id}`))
          .status,
        403,
      );
      assertEquals(
        (await tool(client, "get_data_model_change", {
          workspace_id: w.id,
          id: prepared.id,
        })).error.code,
        "forbidden",
      );
      assertEquals(
        (await scoped(
          b,
          w.id,
          "POST",
          `/data-model/changes/${prepared.id}/analyze`,
          analyze,
          key,
        )).status,
        403,
      );
      assertEquals(
        (await tool(client, "analyze_data_model", {
          workspace_id: w.id,
          id: prepared.id,
          ...analyze,
          request_key: key,
        })).error.code,
        "forbidden",
      );
      assertEquals((await scoped(b, w.id, "GET", rowPath)).status, 403);
      assertEquals(
        (await tool(client, "list_entity_schema_analysis_rows", {
          workspace_id: w.id,
          ...rowArgs,
        })).error.code,
        "forbidden",
      );
      // Current access, not the old analysis initiator, allows A to retain shared history.
      assertEquals(
        (await scoped(a, w.id, "GET", `/data-model/changes/${prepared.id}`))
          .body,
        progress,
      );
    } catch (error) {
      errors.push(error);
    } finally {
      try {
        await client?.close();
      } catch (error) {
        errors.push(error);
      }
      try {
        await sql?.end();
      } catch (error) {
        errors.push(error);
      }
      try {
        await admin.begin(async (tx) => {
          for (const workspace of owned) {
            const [root] =
              await tx`select name,created_by from app.workspaces where id=${workspace.id} for update`;
            assertEquals(root, { name: workspace.name, created_by: aId });
            const members =
              await tx`select user_id from private.workspace_members where workspace_id=${workspace.id}`;
            assert(
              members.every((m) => m.user_id === aId || m.user_id === bId),
              "refuse unknown members",
            );
            const [active] =
              await tx`select count(*)::int as n from app.entity_schema_migrations
            where workspace_id=${workspace.id} and status in ('queued','preparing','ready_to_commit','committing')`;
            assertEquals(
              active.n,
              0,
              "this analysis-only fixture never owns running conversion jobs",
            );
            await tx`delete from app.workspaces where id=${workspace.id}`;
            assertEquals(
              (await tx`select id from app.workspaces where id=${workspace.id}`)
                .length,
              0,
            );
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
            `${SUPABASE_URL}/auth/v1/admin/oauth/clients/${
              encodeURIComponent(auth.clientId)
            }`,
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
        const sessions = auth.tokens.map((token) => claimsOf(token).session_id)
          .filter((id): id is string => typeof id === "string");
        if (sessions.length) {
          await admin`delete from auth.sessions where id=any(${sessions}::uuid[])`;
        }
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length) {
      throw new AggregateError(
        errors,
        "workspace durable transport or owned cleanup failed",
      );
    }
  },
);

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
