import { assert, assertEquals } from "@std/assert";
import { admin, call, httpTest, signIn, SUPABASE_URL } from "./_client.ts";
import { claimsOf, connectMcp, mcpGrant, tool } from "../mcp/_mcp.ts";

httpTest(
  "actual authenticated HTTP and MCP share workspace creation, replay and current management denial",
  async () => {
    const a = await signIn("A"), b = await signIn("B");
    const grant = await mcpGrant(a), client = await connectMcp(grant.access_token);
    const owned: string[] = [];
    try {
      const requestKey = crypto.randomUUID(), input = { name: `512 경계 ${crypto.randomUUID()}` };
      const created = await call(a, "POST", "/workspaces", input, requestKey);
      assertEquals(created.status, 201);
      owned.push(created.body.workspace.id);
      const workspace = created.body.workspace;
      const replay = await tool(client, "create_workspace", { ...input, request_key: requestKey });
      assertEquals(replay.workspace, workspace);
      const repeated = await call(a, "POST", "/workspaces", input, requestKey);
      assertEquals(repeated.headers.get("Idempotency-Replayed"), "true");
      assertEquals((await call(a, "GET", `/workspaces/${workspace.id}`)).body.can_manage, true);
      assertEquals((await call(b, "GET", `/workspaces/${workspace.id}`)).status, 403);
      const forbidden = await call(b, "POST", `/workspaces/${workspace.id}/invitations`, {
        email: "other@example.test",
        grants: [],
      });
      assertEquals(forbidden.status, 403);
      const same = await tool(client, "get_workspace", { workspace_id: workspace.id });
      assertEquals(same.workspace, workspace);
      assertEquals(same.grants, [{ target_kind: "settings", target_id: "*", access: "write" }]);
      const finalAdmin = await tool(client, "leave_workspace", {
        workspace_id: workspace.id,
        expected_version: same.membership_version,
        request_key: crypto.randomUUID(),
      });
      assertEquals(finalAdmin.error.code, "conflict");
      assertEquals((await call(a, "GET", "/tasks")).status, 400);
      const absent = await tool(client, "list_tasks", {});
      assertEquals(absent.error.code, "invalid_input");
      const lifecycle = await call(a, "GET", `/workspaces/${workspace.id}/lifecycle`);
      assertEquals(lifecycle.body.workspace.lifecycle_generation, 1);
      const deleteKey = crypto.randomUUID(), deleteInput = { expected_generation: 1 };
      const deletion = await call(a, "DELETE", `/workspaces/${workspace.id}`, deleteInput, deleteKey);
      assertEquals(deletion.status, 200);
      assertEquals(deletion.body.workspace.lifecycle_generation, 2);
      assertEquals(
        (await tool(client, "delete_workspace", { workspace_id: workspace.id, ...deleteInput, request_key: deleteKey }))
          .workspace,
        deletion.body.workspace,
      );
      assertEquals(
        (await call(a, "DELETE", `/workspaces/${workspace.id}`, deleteInput, deleteKey)).headers.get(
          "Idempotency-Replayed",
        ),
        "true",
      );
      assertEquals(
        (await call(b, "POST", `/workspaces/${workspace.id}/restore`, { expected_generation: 2 })).status,
        403,
      );
      const deletedList = await call(a, "GET", "/workspaces/deleted");
      assert(deletedList.body.items.some((item: { id: string }) => item.id === workspace.id));
      assert(
        !(await call(b, "GET", "/workspaces/deleted")).body.items.some((item: { id: string }) =>
          item.id === workspace.id
        ),
      );
      assertEquals((await tool(client, "list_deleted_workspaces", {})).items, deletedList.body.items);
      // Both transports refuse ordinary access while the current manager can recover the exact lifecycle request.
      assertEquals((await call(a, "GET", `/workspaces/${workspace.id}`)).status, 403);
      assertEquals((await call(a, "POST", "/workspaces", input, requestKey)).status, 403);
      assertEquals((await tool(client, "get_workspace", { workspace_id: workspace.id })).error.code, "forbidden");
      const restoreKey = crypto.randomUUID();
      const restored = await tool(client, "restore_workspace", {
        workspace_id: workspace.id,
        expected_generation: 2,
        request_key: restoreKey,
      });
      assertEquals(restored.workspace.lifecycle_generation, 3);
      assertEquals(
        (await call(a, "POST", `/workspaces/${workspace.id}/restore`, { expected_generation: 2 }, restoreKey)).body
          .workspace,
        restored.workspace,
      );
      assertEquals((await call(a, "GET", `/workspaces/${workspace.id}`)).body.can_manage, true);
      // A final manager exits only after deleting the space. Removing membership
      // does not delete the root or allow its old receipt to bypass membership.
      const removedAgain = await tool(client, "delete_workspace", {
        workspace_id: workspace.id,
        expected_generation: 3,
        request_key: crypto.randomUUID(),
      });
      assertEquals(removedAgain.workspace.lifecycle_generation, 4);
      const membership = await call(a, "GET", `/workspaces/${workspace.id}/membership`);
      assertEquals(membership.status, 200);
      const leaveKey = crypto.randomUUID(), leaveInput = { expected_version: membership.body.membership_version };
      assertEquals(
        await tool(client, "leave_workspace", { workspace_id: workspace.id, ...leaveInput, request_key: leaveKey }),
        { left: true },
      );
      assertEquals((await call(a, "POST", `/workspaces/${workspace.id}/leave`, leaveInput, leaveKey)).status, 403);
      assertEquals(
        (await call(a, "GET", "/workspaces/deleted")).body.items.some((item: { id: string }) =>
          item.id === workspace.id
        ),
        false,
      );
      const [preserved] =
        await admin`select deleted_at is not null as deleted from app.workspaces where id=${workspace.id}`;
      assertEquals(preserved, { deleted: true });
    } finally {
      await client.close();
      const secret = Deno.env.get("LOCAL_SUPABASE_SECRET_KEY");
      assert(secret, "owned local OAuth cleanup key is configured");
      const removed = await fetch(
        `${SUPABASE_URL}/auth/v1/admin/oauth/clients/${encodeURIComponent(grant.client_id)}`,
        {
          method: "DELETE",
          headers: { apikey: secret, authorization: `Bearer ${secret}` },
          signal: AbortSignal.timeout(15000),
        },
      );
      await removed.body?.cancel();
      assert(removed.ok || removed.status === 404, "run-owned OAuth client cleanup succeeds");
      const sessionIds = [claimsOf(a).session_id, claimsOf(b).session_id, claimsOf(grant.access_token).session_id]
        .filter((id): id is string => typeof id === "string");
      // Only sessions minted by this test's own login/grant are removed; baseline users survive.
      if (sessionIds.length) await admin`delete from auth.sessions where id=any(${sessionIds}::uuid[])`;
      for (const id of owned) await admin`delete from app.workspaces where id=${id}`;
    }
  },
);
