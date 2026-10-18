import { assert, assertEquals } from "@std/assert";
import { admin, call, signIn, SUPABASE_URL } from "./_client.ts";

interface SinkMessage {
  ID: string;
  To?: { Address?: string; Email?: string }[];
}
function localSink(): string {
  const url = new URL(Deno.env.get("INVITATION_MAILPIT_ORIGIN") ?? "");
  if (
    url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.username ||
    url.password || url.pathname !== "/" || url.search || url.hash
  ) {
    throw new Error("Actual invitation HTTP test requires a host loopback Mailpit origin");
  }
  return url.origin;
}
async function messages(sink: string, recipient: string): Promise<SinkMessage[]> {
  const response = await fetch(`${sink}/api/v1/search?query=${encodeURIComponent(`to:${recipient}`)}`, {
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
  assertEquals(response.status, 200);
  const result = await response.json();
  assert(Array.isArray(result.messages));
  return result.messages;
}

Deno.test({
  name:
    "actual HTTP invitation reaches local Mailpit through authenticated Edge worker and reports provider acceptance",
  ignore: !Deno.env.get("INVITATION_MAILPIT_ORIGIN"),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const sink = localSink();
    const webOrigin = Deno.env.get("INVITATION_WEB_ORIGIN");
    assert(webOrigin, "Set the expected invitation web origin to match the isolated Edge worker configuration");
    const internal = Deno.env.get("PROCESSING_TOKEN");
    assert(internal, "The isolated worker processing token is required");
    // The unscoped worker consumes one oldest item. Refuse to consume someone else's pending work.
    // This is a fixture precondition only; observable delivery assertions use public HTTP and Mailpit.
    const [queued] =
      await admin`select count(*)::int as count from private.workspace_invitation_deliveries where status='pending'`;
    assertEquals(queued.count, 0, "Run in the dedicated idle mail fixture with no other pending invitations");
    const recipient = `edge-invitation-${crypto.randomUUID()}@example.test`;
    let token: string | undefined, workspaceId: string | undefined, messageId: string | undefined;
    try {
      token = await signIn("A");
      const created = await call(token, "POST", "/workspaces", { name: `Edge 메일 검증 ${crypto.randomUUID()}` });
      assertEquals(created.status, 201);
      workspaceId = created.body.workspace.id;
      assert(workspaceId);
      const invited = await call(token, "POST", `/workspaces/${workspaceId}/invitations`, {
        email: recipient,
        grants: [],
      });
      assertEquals(invited.status, 201);
      assertEquals(invited.body.invitation.delivery.status, "pending");
      const invitationId = invited.body.invitation.id;
      const acceptancePath = `/invitations/${invitationId}`;
      assertEquals(invited.body.acceptance_path, acceptancePath);
      const workerUrl = `${SUPABASE_URL}/functions/v1/invitation-mail-worker`;
      for (const authorization of [undefined, `Bearer ${token}`]) {
        const rejected = await fetch(workerUrl, {
          method: "POST",
          headers: authorization
            ? { authorization, "Content-Type": "application/json" }
            : { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 1 }),
          signal: AbortSignal.timeout(30000),
        });
        assertEquals(rejected.status, 401);
        assertEquals(await rejected.json(), { error: "unauthorized" });
      }
      const pending = await call(token, "GET", `/workspaces/${workspaceId}/invitations`);
      assertEquals(pending.status, 200);
      assertEquals(pending.body.items.find((i: { id: string }) => i.id === invitationId).delivery.status, "pending");
      const sent = await fetch(workerUrl, {
        method: "POST",
        headers: { authorization: `Bearer ${internal}`, "Content-Type": "application/json" },
        body: JSON.stringify({ limit: 1 }),
        signal: AbortSignal.timeout(30000),
      });
      assertEquals(sent.status, 200);
      assertEquals(await sent.json(), { processed: 1, status: "sent" });
      const listed = await call(token, "GET", `/workspaces/${workspaceId}/invitations`);
      assertEquals(listed.status, 200);
      assertEquals(listed.body.items.find((i: { id: string }) => i.id === invitationId).delivery.status, "sent");
      const found = await messages(sink, recipient);
      assertEquals(found.length, 1);
      messageId = found[0].ID;
      assert(typeof messageId === "string" && messageId.length > 0);
      const contentResponse = await fetch(`${sink}/api/v1/message/${encodeURIComponent(messageId)}`, {
        redirect: "error",
        signal: AbortSignal.timeout(10000),
      });
      assertEquals(contentResponse.status, 200);
      const content = await contentResponse.json();
      assertEquals(content.To.map((to: { Address: string }) => to.Address), [recipient]);
      assert(String(content.Text).includes("Google 계정으로 로그인"));
      assert(String(content.Text).includes(`${new URL(webOrigin).origin}${acceptancePath}`));
      assertEquals(content.Subject, "워크스페이스 초대");
    } finally {
      try {
        // Even when an assertion fails after delivery, recover only this run's unique recipient.
        if (!messageId) {
          const owned = await messages(sink, recipient);
          if (owned.length === 1) messageId = owned[0].ID;
        }
        if (messageId) {
          const deleted = await fetch(`${sink}/api/v1/messages`, {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ IDs: [messageId] }),
            redirect: "error",
            signal: AbortSignal.timeout(10000),
          });
          await deleted.body?.cancel();
          assertEquals(deleted.status, 200);
        }
      } finally {
        try {
          if (workspaceId) await admin`delete from app.workspaces where id=${workspaceId}`;
        } finally {
          // Revoke only the fresh session created by this test, never every session of fixture A.
          if (token) {
            const logout = await fetch(`${SUPABASE_URL}/auth/v1/logout?scope=local`, {
              method: "POST",
              headers: { authorization: `Bearer ${token}`, apikey: Deno.env.get("VITE_SUPABASE_PUBLISHABLE_KEY")! },
              signal: AbortSignal.timeout(10000),
            });
            await logout.body?.cancel();
            assertEquals(logout.status, 204);
          }
        }
      }
    }
  },
});
