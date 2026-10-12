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

Deno.test("schema worker uses the index token only when its dedicated token is absent", async () => {
  const indexToken = "i".repeat(48), dedicatedToken = "s".repeat(48);
  for (
    const [dedicated, supplied, expected] of [
      [undefined, indexToken, 200],
      [undefined, "user-jwt", 401],
      [undefined, "wrong", 401],
      [dedicatedToken, indexToken, 401],
      [dedicatedToken, dedicatedToken, 200],
      ["", indexToken, 503],
      ["short", indexToken, 503],
    ] as const
  ) {
    const handler = entitySchemaWorker((name) =>
      name === "ENTITY_SCHEMA_WORKER_TOKEN"
        ? dedicated
        : name === "INDEX_WORKER_TOKEN"
        ? indexToken
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
  for (const indexToken of [undefined, "", "short"]) {
    const handler = entitySchemaWorker((name) => name === "INDEX_WORKER_TOKEN" ? indexToken : undefined);
    const response = await handler(new Request("http://worker", { method: "POST" }));
    assertEquals(response.status, 503);
  }
});
