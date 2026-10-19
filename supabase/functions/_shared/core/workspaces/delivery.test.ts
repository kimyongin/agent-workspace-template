import { assertEquals } from "@std/assert";
import { deliverWorkspaceInvitation, type InvitationDeliveryStore } from "./delivery.ts";

Deno.test("invitation worker reports missing delivery configuration without claiming mail was sent", async () => {
  let status = "pending";
  const store = {
    claim: () =>
      Promise.resolve({
        invitation_id: "invitation",
        fence: "fence",
        email: "member@example.test",
        workspace_name: "공간",
        acceptance_path: "/invitations/invitation",
        prepared: null,
        ambiguous: false,
      }),
    finish: (_id: string, _fence: string, value: string) => {
      status = value;
      return Promise.resolve(true);
    },
  } as InvitationDeliveryStore;
  assertEquals(await deliverWorkspaceInvitation(store), { processed: 1, status: "unconfigured" });
  assertEquals(status, "unconfigured");
});

Deno.test("revoked invitation never reports delivery completion after its lease is invalidated", async () => {
  const store = {
    claim: () =>
      Promise.resolve({
        invitation_id: "invitation",
        fence: "old-fence",
        email: "member@example.test",
        workspace_name: "공간",
        acceptance_path: "/invitations/invitation",
        prepared: null,
        ambiguous: false,
      }),
    finish: () => Promise.resolve(false),
  } as unknown as InvitationDeliveryStore;
  assertEquals(await deliverWorkspaceInvitation(store), { processed: 0 });
});

Deno.test("a rejected retry cannot erase the unknown outcome of an earlier possible send", async () => {
  let status = "pending";
  const prepared = {
    provider: "resend" as const,
    endpoint: "https://api.resend.com/emails",
    body: "{}",
    idempotency_key: "key",
  };
  const store = {
    claim: () =>
      Promise.resolve({
        invitation_id: "invitation",
        fence: "fence",
        email: "member@example.test",
        workspace_name: "공간",
        acceptance_path: "/invitations/invitation",
        prepared,
        ambiguous: true,
      }),
    prepare: () => Promise.resolve(prepared),
    startSend: () => Promise.resolve(true),
    finish: (_id: string, _fence: string, value: string) => {
      status = value;
      return Promise.resolve(true);
    },
  };
  const mailer = { prepare: () => prepared, send: () => Promise.resolve("failed" as const) };
  assertEquals(await deliverWorkspaceInvitation(store, mailer), { processed: 1, status: "unknown" });
  assertEquals(status, "unknown");
});
