import { assertEquals } from "@std/assert";
import { createInvitationMailer } from "./invitation-mailer.ts";
const message = {
  invitation_id: "8e0de134-3a9d-405e-af28-fc1055d88a01",
  email: "member@example.test",
  workspace_name: "공간",
  acceptance_path: "/invitations/8e0de134-3a9d-405e-af28-fc1055d88a01",
};
Deno.test("Resend invitation uses fixed endpoint and exact prepared payload/key on retry", async () => {
  const requests: { url: string; body: unknown; key: string | null }[] = [];
  const mailer = createInvitationMailer({
    mode: "resend",
    apiKey: "test-only",
    from: "workspace@example.test",
    webOrigin: "https://workspace.example.test",
  }, (url, init) => {
    requests.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      key: new Headers(init?.headers).get("Idempotency-Key"),
    });
    return Promise.resolve(Response.json({ id: "provider-id" }));
  })!;
  const prepared = mailer.prepare(message);
  assertEquals(await mailer.send(prepared), "sent");
  assertEquals(await mailer.send(prepared), "sent");
  assertEquals(
    requests,
    [0, 1].map(() => ({
      url: "https://api.resend.com/emails",
      body: {
        from: "workspace@example.test",
        to: ["member@example.test"],
        subject: "워크스페이스 초대",
        text:
          "공간 워크스페이스에 초대되었습니다.\nGoogle 계정으로 로그인한 뒤 초대를 수락하세요.\nhttps://workspace.example.test/invitations/8e0de134-3a9d-405e-af28-fc1055d88a01",
      },
      key: "workspace-invitation/8e0de134-3a9d-405e-af28-fc1055d88a01",
    })),
  );
});
