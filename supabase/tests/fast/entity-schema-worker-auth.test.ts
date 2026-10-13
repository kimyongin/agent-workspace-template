import { assertEquals } from "@std/assert";
import { entitySchemaWorker } from "../../functions/_shared/adapters/http/entity-schema-worker.ts";
Deno.test("schema worker HTTP rejects user/missing tokens before DB and preflight never claims", async () => {
  const token = "s".repeat(48);
  const handler = entitySchemaWorker((name) =>
    name === "PROCESSING_TOKEN" ? token : name === "WORKER_DB_URL" ? "not-a-db-url" : undefined
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

Deno.test("schema worker accepts only the shared token without fallback to retired token names", async () => {
  const shared = "i".repeat(48), retired = "s".repeat(48);
  for (const retiredName of ["INDEX_WORKER_TOKEN", "ENTITY_SCHEMA_WORKER_TOKEN"]) {
    for (
      const [common, old, supplied, expected] of [
        [shared, undefined, shared, 200],
        [shared, retired, shared, 200],
        [shared, retired, retired, 401],
        [shared, "", shared, 200],
        [shared, "short", shared, 200],
        [undefined, retired, retired, 503],
        ["", retired, retired, 503],
        ["short", retired, retired, 503],
      ] as const
    ) {
      const handler = entitySchemaWorker((name) =>
        name === "PROCESSING_TOKEN"
          ? common
          : name === retiredName
          ? old
          : name === "WORKER_DB_URL"
          ? "not-a-db-url"
          : undefined
      );
      const response = await handler(
        new Request("http://worker", {
          method: "POST",
          headers: { Authorization: `Bearer ${supplied}` },
          body: JSON.stringify({ check_configuration: true }),
        }),
      );
      assertEquals(response.status, expected);
    }
  }
});
