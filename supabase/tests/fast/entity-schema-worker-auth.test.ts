import { assertEquals } from "@std/assert";
import { entitySchemaWorker } from "../../functions/_shared/adapters/http/entity-schema-worker.ts";
Deno.test("schema worker HTTP rejects user/missing tokens before DB and preflight never claims", async () => {
  const token = "s".repeat(48);
  const handler = entitySchemaWorker((name) =>
    name === "ENTITY_SCHEMA_WORKER_TOKEN" ? token : name === "WORKER_DB_URL" ? "not-a-db-url" : undefined
  );
  for (const auth of [undefined, "Bearer user-jwt", "Bearer wrong"]) {
    const response = await handler(
      new Request("http://worker", {
        method: "POST",
        headers: auth ? { Authorization: auth } : {},
        body: JSON.stringify({ limit: 1 }),
      }),
    );
    assertEquals(response.status, 401);
  }
  const ready = await handler(
    new Request("http://worker", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ check_configuration: true }),
    }),
  );
  assertEquals(ready.status, 200);
  assertEquals(await ready.json(), { configuration_checked: true });
  const oversized = await handler(
    new Request("http://worker", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: "x".repeat(2049),
    }),
  );
  assertEquals(oversized.status, 400);
});
