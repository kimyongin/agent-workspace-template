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
      }),
    finish: () => Promise.resolve(false),
  } as unknown as InvitationDeliveryStore;
  assertEquals(await deliverWorkspaceInvitation(store), { processed: 0 });
});
