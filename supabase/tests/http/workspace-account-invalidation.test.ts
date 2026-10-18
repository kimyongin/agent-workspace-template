import { assert, assertEquals } from "@std/assert";
import { admin, call, httpTest, SUPABASE_URL } from "./_client.ts";

httpTest(
  "local Auth admin API obeys the final manager guard and issued tokens lose workspace access after account deletion",
  async () => {
    const secret = Deno.env.get("LOCAL_SUPABASE_SECRET_KEY"),
      publishable = Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY");
    assert(secret && publishable, "owned local Auth credentials are configured");
    const headers = { apikey: secret, authorization: `Bearer ${secret}`, "content-type": "application/json" };
    const userId = crypto.randomUUID(),
      email = `workspace517-provider-${userId}@example.test`,
      password = `Local-${crypto.randomUUID()}!`;
    let created = false, workspaceId: string | undefined;
    const auth = async (method: string, path: string, body?: unknown) =>
      await fetch(`${SUPABASE_URL}/auth/v1/admin${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      });
    try {
      const registered = await auth("POST", "/users", { id: userId, email, password, email_confirm: true });
      await registered.body?.cancel();
      assert(registered.ok, "test-owned local Auth account is created");
      created = true;
      const login = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: { apikey: publishable, "content-type": "application/json" },
        body: JSON.stringify({ email, password }),
        signal: AbortSignal.timeout(15000),
      });
      assert(login.ok, "fresh local account signs in");
      const { access_token: token } = await login.json();
      const workspace = await call(token, "POST", "/workspaces", { name: "Auth 삭제 보호" });
      assertEquals(workspace.status, 201);
      workspaceId = workspace.body.workspace.id;
      for (const [method, body] of [["PUT", { ban_duration: "24h" }], ["DELETE", undefined]] as const) {
        const denied = await auth(method, `/users/${userId}`, body);
        await denied.body?.cancel();
        // GoTrue can report a trigger rejection as a provider 500, not our app's
        // public conflict envelope. The atomic preserved state is the assertion.
        assert(!denied.ok, "Auth provider must not remove the final active manager");
        const [account] = await admin`select deleted_at,banned_until from auth.users where id=${userId}`;
        assertEquals(account, { deleted_at: null, banned_until: null });
        assertEquals((await call(token, "GET", `/workspaces/${workspaceId}`)).body.can_manage, true);
      }
      assertEquals((await call(token, "DELETE", `/workspaces/${workspaceId}`, { expected_generation: 1 })).status, 200);
      const removed = await auth("DELETE", `/users/${userId}`);
      await removed.body?.cancel();
      assert(removed.ok, "manager can delete its account after soft deleting its workspace");
      assertEquals((await call(token, "GET", "/workspaces")).status, 401);
      const [preserved] =
        await admin`select deleted_at is not null as deleted,created_by from app.workspaces where id=${workspaceId!}`;
      assertEquals(preserved, { deleted: true, created_by: null });
    } finally {
      if (workspaceId) await admin`delete from app.workspaces where id=${workspaceId!}`;
      if (created) {
        const cleanup = await auth("DELETE", `/users/${userId}`);
        await cleanup.body?.cancel();
        assert(cleanup.ok || cleanup.status === 404, "only the fresh test-owned Auth account is cleaned");
      }
    }
  },
);
