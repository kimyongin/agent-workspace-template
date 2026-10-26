import { assertEquals } from "@std/assert";
import { createMcpApp } from "../../functions/_shared/adapters/mcp/app.ts";

const resource = "https://api.example/functions/v1/mcp";
const allowed = "https://workspace.example:8443";
function app(allowedOrigins = [allowed]) {
  const config = {
    resource,
    token: { audience: resource, issuer: "https://api.example/auth/v1" },
    allowedOrigins,
  };
  return createMcpApp({} as never, config, {} as never, {} as never);
}

Deno.test("MCP rejects untrusted and malformed Origins before auth on every HTTP method", async () => {
  const fetch = app();
  for (
    const origin of [
      "https://untrusted.example",
      "http://workspace.example:8443",
      "https://workspace.example",
      "https://workspace.example:8444",
      "https://workspace.example:8443.evil.example",
      "https://workspace.example:8443/path",
      "https://workspace.example:8443 https://untrusted.example",
      "null",
      "",
    ]
  ) {
    for (const method of ["POST", "GET", "DELETE", "OPTIONS"]) {
      const response = await fetch(new Request(resource, { method, headers: { origin } }));
      assertEquals(response.status, 403, `${method}: ${origin}`);
      await response.body?.cancel();
    }
  }
  const metadata = await fetch(
    new Request(`${resource}/oauth-protected-resource`, {
      headers: { origin: "https://untrusted.example" },
    }),
  );
  assertEquals(metadata.status, 403);
  await metadata.body?.cancel();
});

Deno.test("MCP preserves auth challenges for allowed and absent Origin; an empty allowlist denies present Origin", async () => {
  for (const headers of [new Headers({ origin: allowed }), new Headers()]) {
    const response = await app()(new Request(resource, { method: "POST", headers }));
    assertEquals(response.status, 401);
    assertEquals(response.headers.get("www-authenticate")?.includes("resource_metadata="), true);
    await response.body?.cancel();
  }
  const denied = await app([])(new Request(resource, { headers: { origin: allowed } }));
  assertEquals(denied.status, 403);
  await denied.body?.cancel();
});
