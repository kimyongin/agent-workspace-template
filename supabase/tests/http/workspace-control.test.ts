import { assertEquals } from "@std/assert";
import { admin, call, httpTest, signIn } from "./_client.ts";
import { connectMcp, mcpToken, tool } from "../mcp/_mcp.ts";

httpTest(
  "actual authenticated HTTP and MCP share workspace creation, replay and current management denial",
  async () => {
    const a = await signIn("A"), b = await signIn("B");
    const client = await connectMcp(await mcpToken(a));
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
      // Actual issued token remains valid, but current workspace state blocks both transports and saved creation body.
      await admin`update app.workspaces set deleted_at=clock_timestamp() where id=${workspace.id}`;
      assertEquals((await call(a, "GET", `/workspaces/${workspace.id}`)).status, 403);
      assertEquals((await call(a, "POST", "/workspaces", input, requestKey)).status, 403);
      assertEquals((await tool(client, "get_workspace", { workspace_id: workspace.id })).error.code, "forbidden");
    } finally {
      await client.close();
      for (const id of owned) await admin`delete from app.workspaces where id=${id}`;
    }
  },
);
