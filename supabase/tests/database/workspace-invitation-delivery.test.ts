import { assert, assertEquals, assertRejects } from "@std/assert";
import * as workspaces from "../../functions/_shared/core/workspaces/application.ts";
import { SqlWorkspaceUnitOfWork } from "../../functions/_shared/adapters/supabase/workspace-store.ts";
import { SqlWorkspaceInvitationDeliveryStore } from "../../functions/_shared/adapters/supabase/workspace-delivery-store.ts";
import { createInvitationMailer } from "../../functions/_shared/adapters/mail/invitation-mailer.ts";
import { deliverWorkspaceInvitation } from "../../functions/_shared/core/workspaces/delivery.ts";
import { AppError } from "../../functions/_shared/core/shared/errors.ts";
import { connect, dbTest, urls } from "./_db.ts";
const admin = connect(urls.admin, { max: 1 });
const sql = connect(urls.direct, { prepare: false, max: 3 });
const workerUrl = new URL(urls.admin);
workerUrl.username = "app_worker";
workerUrl.password = encodeURIComponent(Deno.env.get("APP_WORKER_PASSWORD")!);
const worker = connect(workerUrl.toString(), { prepare: false, max: 3 });
const store = new SqlWorkspaceInvitationDeliveryStore(worker);
const deps = { uow: new SqlWorkspaceUnitOfWork(sql) };
const keyed = (userId: string) => ({ userId, request: { key: crypto.randomUUID() } });
async function fixture() {
  const userId = crypto.randomUUID(), email = `invitation-mail-${userId}@example.test`;
  await admin`insert into auth.users(id,email) values(${userId},${email})`;
  const { workspace } = await workspaces.createWorkspace(deps, keyed(userId), { name: "메일 검증 공간" });
  const invite = async () =>
    await workspaces.inviteWorkspaceMember(deps, keyed(userId), workspace.id, {
      email: `recipient-${crypto.randomUUID()}@example.test`,
      grants: [],
    });
  const status = async (id: string) =>
    (await workspaces.listWorkspaceInvitations(deps, { userId }, workspace.id)).items.find((i) => i.id === id)!
      .delivery!
      .status;
  return {
    userId,
    workspace,
    invite,
    status,
    cleanup: async () => {
      await admin`delete from app.workspaces where id=${workspace.id}`;
      await admin`delete from auth.users where id=${userId}`;
    },
  };
}
const resendConfig = {
  mode: "resend",
  apiKey: "test-only-not-a-real-credential",
  from: "workspace@example.test",
  webOrigin: "https://workspace.example.test",
};

dbTest("workspace deletion fences claimed invitations and restoration never restarts their old delivery", async () => {
  const f = await fixture();
  try {
    const { invitation } = await f.invite();
    const claim = await store.claim(invitation.id);
    assert(claim);
    const mailer = createInvitationMailer(resendConfig)!;
    assert(await store.prepare(invitation.id, claim.fence, mailer.prepare(claim)));
    await workspaces.deleteWorkspace(deps, keyed(f.userId), f.workspace.id, { expected_generation: 1 });
    assertEquals(await store.startSend(invitation.id, claim.fence), false);
    assertEquals(await store.finish(invitation.id, claim.fence, "sent"), false);
    await workspaces.restoreWorkspace(deps, keyed(f.userId), f.workspace.id, { expected_generation: 2 });
    assertEquals(await store.claim(invitation.id), null);
    assertEquals(
      (await workspaces.retryWorkspaceInvitationDelivery(deps, keyed(f.userId), f.workspace.id, invitation.id, {
        expected_version: invitation.version,
      })).delivery.status,
      "failed",
    );
    assertEquals(await store.claim(invitation.id), null);
    const fresh = await f.invite();
    assert(await store.claim(fresh.invitation.id));
  } finally {
    await f.cleanup();
  }
});

dbTest(
  "invitation creation enqueues once, reports unconfigured, and explicitly retries exact provider payload after ambiguity",
  async () => {
    const f = await fixture();
    try {
      const actor = keyed(f.userId), input = { email: `recipient-${crypto.randomUUID()}@example.test`, grants: [] };
      const first = await workspaces.inviteWorkspaceMember(deps, actor, f.workspace.id, input);
      assertEquals(await workspaces.inviteWorkspaceMember(deps, actor, f.workspace.id, input), first);
      assertEquals(await deliverWorkspaceInvitation(store, undefined, first.invitation.id), {
        processed: 1,
        status: "unconfigured",
      });
      assertEquals(await f.status(first.invitation.id), "unconfigured");
      await workspaces.retryWorkspaceInvitationDelivery(deps, keyed(f.userId), f.workspace.id, first.invitation.id, {
        expected_version: first.invitation.version,
      });
      const requests: { body: string; key: string | null }[] = [];
      let outcome: "unknown" | "failed" | "sent" = "unknown";
      const mailer = createInvitationMailer(resendConfig, (_url, init) => {
        requests.push({ body: String(init?.body), key: new Headers(init?.headers).get("Idempotency-Key") });
        return Promise.resolve(
          outcome === "unknown"
            ? new Response("unavailable", { status: 503 })
            : outcome === "failed"
            ? new Response("rejected", { status: 422 })
            : Response.json({ id: "accepted" }),
        );
      })!;
      assertEquals(await deliverWorkspaceInvitation(store, mailer, first.invitation.id), {
        processed: 1,
        status: "unknown",
      });
      assertEquals(await f.status(first.invitation.id), "unknown");
      assertEquals(await deliverWorkspaceInvitation(store, mailer, first.invitation.id), { processed: 0 });
      const current = (await workspaces.listWorkspaceInvitations(deps, { userId: f.userId }, f.workspace.id)).items[0];
      await workspaces.retryWorkspaceInvitationDelivery(deps, keyed(f.userId), f.workspace.id, first.invitation.id, {
        expected_version: current.version,
      });
      outcome = "failed";
      assertEquals(await deliverWorkspaceInvitation(store, mailer, first.invitation.id), {
        processed: 1,
        status: "unknown",
      });
      assertEquals(await f.status(first.invitation.id), "unknown");
      await workspaces.retryWorkspaceInvitationDelivery(deps, keyed(f.userId), f.workspace.id, first.invitation.id, {
        expected_version: current.version,
      });
      outcome = "sent";
      assertEquals(await deliverWorkspaceInvitation(store, mailer, first.invitation.id), {
        processed: 1,
        status: "sent",
      });
      assertEquals(requests.length, 3);
      assertEquals(requests[1], requests[0]);
      assertEquals(requests[2], requests[0]);
      assertEquals(await f.status(first.invitation.id), "sent");
      assertEquals(await deliverWorkspaceInvitation(store, mailer, first.invitation.id), { processed: 0 });
    } finally {
      await f.cleanup();
    }
  },
);

dbTest("cancelled invitations are rejected after claim and before provider I/O or stale finish", async () => {
  const f = await fixture();
  try {
    const { invitation } = await f.invite();
    const claim = await store.claim(invitation.id);
    assert(claim);
    await workspaces.cancelWorkspaceInvitation(deps, keyed(f.userId), f.workspace.id, invitation.id, {
      expected_version: invitation.version,
    });
    const mailer = createInvitationMailer(resendConfig)!;
    assertEquals(await store.prepare(invitation.id, claim.fence, mailer.prepare(claim)), null);
    assertEquals(await store.startSend(invitation.id, claim.fence), false);
    assertEquals(await store.finish(invitation.id, claim.fence, "sent"), false);
    assertEquals(await f.status(invitation.id), "failed");
  } finally {
    await f.cleanup();
  }
});

dbTest("expired running lease becomes unknown and local ambiguous send cannot be retried", async () => {
  const f = await fixture();
  try {
    const { invitation } = await f.invite();
    const claim = await store.claim(invitation.id);
    assert(claim);
    const mailer = createInvitationMailer({
      mode: "mailpit",
      from: "workspace@example.test",
      webOrigin: "http://127.0.0.1:5173",
      mailpitOrigin: "http://127.0.0.1:8025",
    })!;
    assert(await store.prepare(invitation.id, claim.fence, mailer.prepare(claim)));
    assertEquals(await store.startSend(invitation.id, claim.fence), true);
    assertEquals(await store.startSend(invitation.id, claim.fence), false);
    // Simulate a crashed worker and elapsed lease, without waiting or sending any mail.
    await admin`update private.workspace_invitation_deliveries set lease_until=clock_timestamp()-interval '1 second' where invitation_id=${invitation.id}`;
    assertEquals(await store.claim(invitation.id), null);
    assertEquals(await f.status(invitation.id), "unknown");
    await assertRejects(
      () =>
        workspaces.retryWorkspaceInvitationDelivery(deps, keyed(f.userId), f.workspace.id, invitation.id, {
          expected_version: invitation.version,
        }),
      AppError,
    );
    assertEquals(await store.finish(invitation.id, claim.fence, "sent"), false);
  } finally {
    await f.cleanup();
  }
});

dbTest("unknown Resend delivery never retries beyond provider 24 hour retention", async () => {
  const f = await fixture();
  try {
    const { invitation } = await f.invite();
    const mailer = createInvitationMailer(resendConfig, () => Promise.resolve(new Response("lost", { status: 503 })))!;
    await deliverWorkspaceInvitation(store, mailer, invitation.id);
    await admin`update private.workspace_invitation_deliveries set first_send_at=clock_timestamp()-interval '25 hours' where invitation_id=${invitation.id}`;
    await assertRejects(
      () =>
        workspaces.retryWorkspaceInvitationDelivery(deps, keyed(f.userId), f.workspace.id, invitation.id, {
          expected_version: invitation.version,
        }),
      AppError,
    );
    assertEquals(await f.status(invitation.id), "unknown");
    assertEquals(await store.claim(invitation.id), null);
  } finally {
    await f.cleanup();
  }
});

dbTest("deleted space and revoked real initiator cannot start or finish invitation delivery", async () => {
  const f = await fixture();
  try {
    const { invitation } = await f.invite();
    const claim = await store.claim(invitation.id);
    assert(claim);
    const mailer = createInvitationMailer(resendConfig)!;
    assert(await store.prepare(invitation.id, claim.fence, mailer.prepare(claim)));
    // Lifecycle DB fixture transition; the worker must independently re-read current state.
    await admin`update app.workspaces set deleted_at=clock_timestamp() where id=${f.workspace.id}`;
    assertEquals(await store.startSend(invitation.id, claim.fence), false);
    assertEquals(await store.finish(invitation.id, claim.fence, "sent"), false);
    await admin`update app.workspaces set deleted_at=null where id=${f.workspace.id}`;
    const other = await f.invite();
    await admin`delete from private.workspace_grants where workspace_id=${f.workspace.id} and user_id=${f.userId} and target_kind='settings'`;
    assertEquals(await store.claim(other.invitation.id), null);
    assertEquals(await store.startSend(invitation.id, claim.fence), false);
  } finally {
    await f.cleanup();
  }
});

Deno.test({
  name: "configured local Mailpit receives an invitation from real DB worker without external delivery",
  ignore: !Deno.env.get("INVITATION_MAILPIT_ORIGIN"),
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const f = await fixture();
    const origin = Deno.env.get("INVITATION_MAILPIT_ORIGIN")!;
    let messageId: string | undefined;
    try {
      const created = await f.invite();
      const mailer = createInvitationMailer({
        mode: "mailpit",
        from: "workspace@example.test",
        webOrigin: "http://127.0.0.1:5173",
        mailpitOrigin: origin,
      });
      assert(mailer, "A loopback Mailpit origin must be explicitly configured");
      assertEquals(await deliverWorkspaceInvitation(store, mailer, created.invitation.id), {
        processed: 1,
        status: "sent",
      });
      assertEquals(await f.status(created.invitation.id), "sent");
      const found = await fetch(`${origin}/api/v1/search?query=${encodeURIComponent(`to:${created.invitation.email}`)}`)
        .then((r) => r.json());
      assertEquals(found.messages.length, 1);
      messageId = found.messages[0].ID;
      const content = await fetch(`${origin}/api/v1/message/${messageId}`).then((r) => r.json());
      assert(String(content.Text).includes(created.acceptance_path));
      assert(String(content.Text).includes("Google"));
    } finally {
      if (messageId) {
        await fetch(`${origin}/api/v1/messages`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ IDs: [messageId] }),
        }).then((r) => r.body?.cancel());
      }
      await f.cleanup();
    }
  },
});
