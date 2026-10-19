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

Deno.test("Mailpit only injects into an explicit loopback sink and never follows redirects", async () => {
  const config = {
    mode: "mailpit",
    from: "workspace@example.test",
    webOrigin: "http://127.0.0.1:5173",
    mailpitOrigin: "http://127.0.0.1:8025",
  };
  let request: unknown;
  const mailer = createInvitationMailer(config, (url, init) => {
    request = {
      endpoint: String(url),
      method: init?.method,
      body: JSON.parse(String(init?.body)),
      redirect: init?.redirect,
      authorization: new Headers(init?.headers).get("authorization"),
    };
    return Promise.resolve(Response.json({ ID: "local-message" }));
  })!;
  assertEquals(await mailer.send(mailer.prepare(message)), "sent");
  assertEquals(request, {
    endpoint: "http://127.0.0.1:8025/api/v1/send",
    method: "POST",
    body: {
      From: { Email: "workspace@example.test" },
      To: [{ Email: "member@example.test" }],
      Subject: "워크스페이스 초대",
      Text:
        "공간 워크스페이스에 초대되었습니다.\nGoogle 계정으로 로그인한 뒤 초대를 수락하세요.\nhttp://127.0.0.1:5173/invitations/8e0de134-3a9d-405e-af28-fc1055d88a01",
    },
    redirect: "error",
    authorization: null,
  });
});

Deno.test("invalid mail configuration cannot route local email to a remote or credential-bearing endpoint", () => {
  const base = { mode: "mailpit", from: "workspace@example.test", webOrigin: "http://127.0.0.1:5173" };
  for (
    const mailpitOrigin of [
      "https://remote.example.test",
      "http://127.0.0.1:8025/relay",
      "http://user:password@127.0.0.1:8025",
      "http://127.0.0.1:8025/?url=evil",
    ]
  ) {
    assertEquals(createInvitationMailer({ ...base, mailpitOrigin }), undefined);
  }
  assertEquals(
    createInvitationMailer({
      mode: "resend",
      from: "workspace@example.test",
      webOrigin: "https://workspace.example.test",
    }),
    undefined,
  );
  assertEquals(
    createInvitationMailer({
      mode: "resend",
      apiKey: "test-only",
      from: "workspace@example.test",
      webOrigin: "https://workspace.example.test/elsewhere",
    }),
    undefined,
  );
});
Deno.test("unknown provider outcomes are never mislabeled as guaranteed delivery failures", async () => {
  const base = {
    mode: "resend",
    apiKey: "test-only",
    from: "workspace@example.test",
    webOrigin: "https://workspace.example.test",
  };
  for (const status of [408, 409, 429, 500, 503]) {
    const mailer = createInvitationMailer(base, () => Promise.resolve(new Response("unavailable", { status })))!;
    assertEquals(await mailer.send(mailer.prepare(message)), "unknown");
  }
  const timeout = createInvitationMailer(base, () => Promise.reject(new Error("lost response")))!;
  assertEquals(await timeout.send(timeout.prepare(message)), "unknown");
  const rejected = createInvitationMailer(base, () => Promise.resolve(new Response("invalid", { status: 422 })))!;
  assertEquals(await rejected.send(rejected.prepare(message)), "failed");
  const malformed = createInvitationMailer(base, () => Promise.resolve(Response.json({})))!;
  assertEquals(await malformed.send(malformed.prepare(message)), "unknown");
});

Deno.test("Edge Docker local sink accepts only explicit Mailpit Docker host alias, never as a web origin or Resend endpoint", async () => {
  let destination = "";
  const mailer = createInvitationMailer({
    mode: "mailpit",
    from: "workspace@example.test",
    webOrigin: "http://127.0.0.1:5173",
    mailpitOrigin: "http://host.docker.internal:61924",
  }, (url) => {
    destination = String(url);
    return Promise.resolve(Response.json({ ID: "edge-local" }));
  });
  assertEquals(!!mailer, true);
  assertEquals(await mailer!.send(mailer!.prepare(message)), "sent");
  assertEquals(destination, "http://host.docker.internal:61924/api/v1/send");
  assertEquals(
    createInvitationMailer({
      mode: "mailpit",
      from: "workspace@example.test",
      webOrigin: "http://host.docker.internal:5173",
      mailpitOrigin: "http://host.docker.internal:61924",
    }),
    undefined,
  );
  assertEquals(
    createInvitationMailer({
      mode: "mailpit",
      from: "workspace@example.test",
      webOrigin: "http://127.0.0.1:5173",
      mailpitOrigin: "http://evil.host.docker.internal:61924",
    }),
    undefined,
  );
});
