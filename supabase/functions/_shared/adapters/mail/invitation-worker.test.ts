import { assertEquals } from "@std/assert";
import { invitationMailWorker } from "./invitation-worker.ts";
Deno.test("invitation mail worker rejects user tokens before connecting or sending", async () => {
  const handler = invitationMailWorker((name) => name === "PROCESSING_TOKEN" ? "x".repeat(43) : undefined, () => {
    throw new Error("must not connect");
  });
  const response = await handler(
    new Request("http://localhost/worker", {
      method: "POST",
      headers: { Authorization: "Bearer user-token" },
      body: "{}",
    }),
  );
  assertEquals(response.status, 401);
  assertEquals(await response.json(), { error: "unauthorized" });
});
Deno.test("configuration preflight reports missing delivery config without opening DB", async () => {
  const environment: Record<string, string> = { PROCESSING_TOKEN: "x".repeat(43), WORKER_DB_URL: "unused" };
  const handler = invitationMailWorker((name) => environment[name], () => {
    throw new Error("must not connect");
  });
  const response = await handler(
    new Request("http://localhost/worker", {
      method: "POST",
      headers: { Authorization: `Bearer ${environment.PROCESSING_TOKEN}` },
      body: JSON.stringify({ check_configuration: true }),
    }),
  );
  assertEquals(response.status, 200);
  assertEquals(await response.json(), { configuration_checked: true, delivery_configured: false });
});
Deno.test("worker rejects unknown fields and oversized request bodies before DB", async () => {
  const environment: Record<string, string> = { PROCESSING_TOKEN: "x".repeat(43), WORKER_DB_URL: "unused" };
  const handler = invitationMailWorker((name) => environment[name], () => {
    throw new Error("must not connect");
  });
  for (
    const body of [
      JSON.stringify({ owner_id: "forged" }),
      JSON.stringify({ limit: 2 }),
      JSON.stringify({ value: "x".repeat(2048) }),
    ]
  ) {
    const response = await handler(
      new Request("http://localhost/worker", {
        method: "POST",
        headers: { Authorization: `Bearer ${environment.PROCESSING_TOKEN}` },
        body,
      }),
    );
    assertEquals(response.status, 400);
    assertEquals(await response.json(), { error: "invalid_input" });
  }
});
