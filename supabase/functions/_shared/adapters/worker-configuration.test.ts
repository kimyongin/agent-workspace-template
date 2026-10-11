import { assertEquals } from "@std/assert";
import { invalidWorkerSettings } from "./worker-configuration.ts";

Deno.test("worker configuration diagnostics identify missing/invalid names without exposing values", () => {
  const configured = {
    INDEX_WORKER_TOKEN: "internal-secret-".padEnd(43, "x"),
    PINECONE_API_KEY: "provider-secret",
    WORKER_DB_URL: "postgresql://private-credentials",
    PINECONE_ACCOUNT_SCOPE: "stable-provider-project",
  };
  assertEquals(invalidWorkerSettings(configured), []);
  for (const name of Object.keys(configured)) {
    assertEquals(invalidWorkerSettings({ ...configured, [name]: undefined }), [name]);
  }
  assertEquals(invalidWorkerSettings({ ...configured, INDEX_WORKER_TOKEN: "short-secret" }), ["INDEX_WORKER_TOKEN"]);
  for (const scope of [" ", "x".repeat(121)]) {
    assertEquals(invalidWorkerSettings({ ...configured, PINECONE_ACCOUNT_SCOPE: scope }), ["PINECONE_ACCOUNT_SCOPE"]);
  }
  assertEquals(invalidWorkerSettings({ ...configured, PINECONE_ACCOUNT_SCOPE: "x".repeat(120) }), []);
  assertEquals(invalidWorkerSettings({}), Object.keys(configured));
});
