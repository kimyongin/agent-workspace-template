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

httpTest(
  "workspace authenticated activity workflow preserves content parents tags and current authority across transports",
  async () => {
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
      const taskGrant = { target_kind: "tasks", target_id: "*", access: "write" };
      for (const label of ["shared", "other"]) {
        const name = `activity515-${label}-${crypto.randomUUID()}`;
        const created = await call(a, "POST", "/workspaces", { name });
        assertEquals(created.status, 201);
        const workspace = { id: created.body.workspace.id as string, name };
        owned.push(workspace);
        await admin`insert into private.workspace_members(workspace_id,user_id) values(${workspace.id},${bId})`;
        assertEquals(
          (await call(a, "PATCH", `/workspaces/${workspace.id}/members/${bId}`, {
            expected_version: 1,
            grants: [taskGrant],
          })).status,
          200,
        );
      }
      const [w, other] = owned;
      let bVersion = 2;
      const grant = async (grants: { target_kind: string; target_id: string; access: string }[]) => {
        const response = await call(a, "PATCH", `/workspaces/${w.id}/members/${bId}`, {
          expected_version: bVersion,
          grants,
        });
        assertEquals(response.status, 200);
        bVersion++;
      };
      const type = await scoped(a, w.id, "POST", "/entity-types", { label: "읽기 권한으로 연결할 자료" });
      assertEquals(type.status, 201);
      const kindWrite = { target_kind: "entity_type", target_id: type.body.id, access: "write" };
      assertEquals(
        (await call(a, "PATCH", `/workspaces/${w.id}/members/${aId}`, {
          expected_version: 1,
          grants: [{ target_kind: "settings", target_id: "*", access: "write" }, kindWrite],
        })).status,
        200,
      );
      const entity = await scoped(a, w.id, "POST", "/entities", {
        entity_type_id: type.body.id,
        schema_version: 1,
        properties: { prop_1: "권한 회수 뒤 숨길 연결 이름" },
      });
      assertEquals(entity.status, 201);
      await grant([taskGrant, { ...kindWrite, access: "read" }]);
      const input = {
        kind: "once",
        title: "실제 공동 업무",
        body: "직접 작성한 공유 본문",
        entity_ids: [entity.body.id],
      };
      assertEquals((await call(b, "POST", "/tasks", input)).status, 400);
      assertEquals(
        (await tool(client, "create_task", { ...input, request_key: crypto.randomUUID() })).error.code,
        "invalid_input",
      );
      for (const tag_ids of [[], ["retired-tag"]]) {
        assertEquals((await scoped(b, w.id, "POST", "/tasks", { ...input, tag_ids })).status, 400);
        assertEquals(
          (await tool(client, "create_task", { workspace_id: w.id, ...input, tag_ids })).error.code,
          "invalid_input",
        );
      }
      const prepared = await tool(client, "prepare_record_memo", {
        workspace_id: w.id,
        model: "task",
        action: "create",
        input,
      });
      assert(!prepared.error, "task-only business preparation succeeds without settings READ");
      const creation = {
        ...prepared.prepared_input,
        change_note: prepared.change_note,
        change_tag_ids: prepared.change_tag_ids,
      };
      const createKey = crypto.randomUUID();
      const created = await scoped(b, w.id, "POST", "/tasks", creation, createKey);
      assertEquals(created.status, 201);
      const task = created.body;
      const path = `/tasks/${task.id}`;
      assertEquals(
        await tool(client, "create_task", { workspace_id: w.id, ...creation, request_key: createKey }),
        task,
      );
      assertEquals(task.entity_context.map((item: { title: string }) => item.title), ["권한 회수 뒤 숨길 연결 이름"]);
      assertEquals((await scoped(b, other.id, "GET", path)).status, 404);
      assertEquals((await tool(client, "get_task", { workspace_id: other.id, id: task.id })).error.code, "not_found");
      await grant([taskGrant]);
      assertEquals((await scoped(b, w.id, "GET", path)).body.entity_context, []);
      assertEquals((await tool(client, "get_task", { workspace_id: w.id, id: task.id })).entity_ids, []);
      assertEquals((await scoped(b, w.id, "POST", "/tasks", creation, createKey)).status, 403);
      const taskTag = await tool(client, "create_tag", { workspace_id: w.id, scope: "task", name: "공동 계획 분류" });
      assert(taskTag.id);
      const resultTag = await tool(client, "create_tag", {
        workspace_id: w.id,
        scope: "record",
        name: "공동 결과 분류",
      });
      assert(resultTag.id);
      const tagPreparation = {
        intent: "tag-connections",
        model: "task",
        action: "update",
        target_id: task.id,
        expected_version: task.version,
        input: { tag_ids: [taskTag.id] },
      };
      const tagMemo = await tool(client, "prepare_record_memo", { workspace_id: w.id, ...tagPreparation });
      assert(!tagMemo.error, "task classification preparation does not read concealed material captures");
      assertEquals((await scoped(b, w.id, "POST", "/records/prepare", tagPreparation)).body, tagMemo);
      const connection = {
        target_kind: "task",
        target_id: task.id,
        ...tagMemo.prepared_input,
        change_note: tagMemo.change_note,
        change_tag_ids: tagMemo.change_tag_ids,
      };
      const connectKey = crypto.randomUUID();
      const linked = await tool(client, "set_tag_connections", {
        workspace_id: w.id,
        ...connection,
        request_key: connectKey,
      });
      assert(!linked.error);
      assertEquals((await scoped(b, w.id, "POST", "/tag-connections", connection, connectKey)).body, linked);
      const edited = await scoped(b, w.id, "PATCH", path, {
        expected_version: linked.version,
        body: "태그와 숨겨진 연결을 보존하는 본문",
      });
      assertEquals(edited.status, 200);
      assertEquals(edited.body.tag_ids, [taskTag.id]);
      assertEquals(edited.body.entity_context, []);
      for (const tag_ids of [[], [resultTag.id]]) {
        assertEquals(
          (await scoped(b, w.id, "POST", `${path}/complete`, {
            expected_version: edited.body.version,
            body: "수행",
            tag_ids,
          })).status,
          400,
        );
        assertEquals(
          (await tool(client, "complete_task", {
            workspace_id: w.id,
            id: task.id,
            expected_version: edited.body.version,
            body: "수행",
            tag_ids,
          })).error.code,
          "invalid_input",
        );
      }
      const completeInput = { expected_version: edited.body.version, body: "직접 작성한 공동 수행 결과" };
      const completeKey = crypto.randomUUID();
      const completed = await tool(client, "complete_task", {
        workspace_id: w.id,
        id: task.id,
        ...completeInput,
        request_key: completeKey,
      });
      assert(!completed.error);
      assertEquals((await scoped(b, w.id, "POST", `${path}/complete`, completeInput, completeKey)).body, completed);
      const record = completed.record;
      const recordPath = `/records/${record.id}`;
      assertEquals([record.task_id, record.entity_id, "entity_ids" in record, "entity_context" in record], [
        task.id,
        null,
        false,
        false,
      ]);
      const linkedResult = await scoped(b, w.id, "POST", "/tag-connections", {
        target_kind: "record",
        target_id: record.id,
        expected_version: record.version,
        tag_ids: [resultTag.id],
      });
      assertEquals(linkedResult.status, 200);
      const recordsBefore = (await scoped(b, w.id, "GET", `/records?task_id=${task.id}`)).body.items.length;
      for (
        const forbidden of [{ tag_ids: [] }, { task_id: task.id }, { entity_ids: [] }, { entity_id: entity.body.id }]
      ) {
        assertEquals(
          (await scoped(b, w.id, "PATCH", recordPath, {
            expected_version: linkedResult.body.version,
            body: "거부할 입력",
            ...forbidden,
          })).status,
          400,
        );
        assertEquals(
          (await tool(client, "update_record", {
            workspace_id: w.id,
            id: record.id,
            expected_version: linkedResult.body.version,
            body: "거부할 입력",
            ...forbidden,
          })).error.code,
          "invalid_input",
        );
      }
      const memo = await tool(client, "update_record", {
        workspace_id: w.id,
        id: record.id,
        expected_version: linkedResult.body.version,
        body: "태그를 보존하는 결과 정정",
      });
      assert(!memo.error);
      assertEquals(memo.tag_ids, [resultTag.id]);
      assertEquals((await scoped(b, w.id, "GET", `/records?task_id=${task.id}`)).body.items.length, recordsBefore);
      const deleteInput = {
        expected_version: completed.task.version,
        change_note: "결과를 보존하며 삭제",
        change_tag_ids: [resultTag.id],
      };
      assertEquals((await scoped(b, w.id, "POST", `${path}/delete`, deleteInput)).status, 204);
      const removed = (await scoped(b, w.id, "GET", path)).body;
      assert(removed.deleted_at);
      assertEquals((await tool(client, "get_record", { workspace_id: w.id, id: record.id })).task_id, task.id);
      assert(!(await scoped(b, w.id, "GET", "/tasks")).body.items.some((item: { id: string }) => item.id === task.id));
      const restorePreparation = {
        model: "task",
        action: "restore",
        target_id: task.id,
        expected_version: removed.version,
        input: {},
      };
      const restoreMemo = await tool(client, "prepare_record_memo", { workspace_id: w.id, ...restorePreparation });
      assert(!restoreMemo.error, "deleted task preparation supports restoration without settings or material READ");
      assertEquals((await scoped(b, w.id, "POST", "/records/prepare", restorePreparation)).body, restoreMemo);
      const restoreInput = {
        ...restoreMemo.prepared_input,
        change_note: restoreMemo.change_note,
        change_tag_ids: restoreMemo.change_tag_ids,
      };
      const restoreKey = crypto.randomUUID();
      const restored = await tool(client, "restore_task", {
        workspace_id: w.id,
        id: task.id,
        ...restoreInput,
        request_key: restoreKey,
      });
      assert(!restored.error);
      assertEquals((await scoped(b, w.id, "POST", `${path}/restore`, restoreInput, restoreKey)).body, restored);
      assertEquals([restored.deleted_at, restored.result_record_id], [null, record.id]);
      await grant([{ ...taskGrant, access: "read" }]);
      assertEquals((await scoped(b, w.id, "GET", recordPath)).status, 200);
      assertEquals(
        (await tool(client, "update_record", {
          workspace_id: w.id,
          id: record.id,
          expected_version: memo.version,
          body: "권한 회수 뒤 수정",
        })).error.code,
        "forbidden",
      );
      assertEquals((await scoped(b, w.id, "POST", `${path}/complete`, completeInput, completeKey)).status, 403);
      await grant([]);
      assertEquals((await scoped(b, w.id, "GET", path)).status, 404);
      assertEquals((await tool(client, "get_record", { workspace_id: w.id, id: record.id })).error.code, "not_found");
      await grant([taskGrant, { ...kindWrite, access: "read" }]);
      assertEquals(
        (await scoped(b, w.id, "GET", path)).body.entity_context.map((item: { title: string }) => item.title),
        ["권한 회수 뒤 숨길 연결 이름"],
      );
      assertEquals((await scoped(b, w.id, "POST", "/records", { body: "구 일반 기록" })).status, 404);
      assert(!(await client.listTools()).tools.some((entry) => entry.name === "create_record"));
      const today = new Date().toISOString().slice(0, 10);
      const recurring = await tool(client, "create_task", {
        workspace_id: w.id,
        kind: "recurring",
        title: "실제 반복 수행",
        timezone: "UTC",
        recurrence: { freq: "daily", starts_on: today },
      });
      assert(!recurring.error);
      const occurrenceKey = crypto.randomUUID(), occurrenceInput = { body: "실제 반복 회차 결과" };
      const occurrence = await tool(client, "record_occurrence", {
        workspace_id: w.id,
        task_id: recurring.id,
        date: today,
        ...occurrenceInput,
        request_key: occurrenceKey,
      });
      assert(!occurrence.error);
      assertEquals(
        (await scoped(
          b,
          w.id,
          "POST",
          `/tasks/${recurring.id}/occurrences/${today}/records`,
          occurrenceInput,
          occurrenceKey,
        )).body,
        occurrence,
      );
      const stopped = await scoped(b, w.id, "POST", `/tasks/${recurring.id}/stop`, {
        expected_version: recurring.version,
      });
      assertEquals(stopped.status, 200);
      const resumed = await tool(client, "resume_task", {
        workspace_id: w.id,
        id: recurring.id,
        expected_version: stopped.body.version,
      });
      assert(!resumed.error);
      const occurrences = await tool(client, "list_occurrences", {
        workspace_id: w.id,
        id: recurring.id,
        from: today,
        to: today,
      });
      assertEquals(occurrences.items[0].record_ids, [occurrence.id]);
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
          }
        });
      } catch (error) {
        errors.push(error);
      }
      try {
        if (auth.clientId) {
          const secret = Deno.env.get("LOCAL_SUPABASE_SECRET_KEY");
          assert(secret);
          const response = await fetch(
            `${SUPABASE_URL}/auth/v1/admin/oauth/clients/${encodeURIComponent(auth.clientId)}`,
            {
              method: "DELETE",
              headers: { apikey: secret, authorization: `Bearer ${secret}` },
              signal: AbortSignal.timeout(15000),
            },
          );
          await response.body?.cancel();
          assert(response.ok || response.status === 404);
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
    if (errors.length) throw new AggregateError(errors, "activity workflow or exact owned cleanup failed");
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
