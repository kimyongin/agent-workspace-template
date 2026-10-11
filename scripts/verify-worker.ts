// Supplied env is deployment preparation, not evidence of remote secret delivery.
import { invalidWorkerSettings } from "../supabase/functions/_shared/adapters/worker-configuration.ts";

const settings = Object.fromEntries(
  ["INDEX_WORKER_TOKEN", "PINECONE_API_KEY", "WORKER_DB_URL", "PINECONE_ACCOUNT_SCOPE"].map((
    name,
  ) => [name, Deno.env.get(name)]),
);
const invalid = invalidWorkerSettings(settings);
if (invalid.length) {
  console.error(JSON.stringify({ event: "worker_not_configured", invalid_settings: invalid }));
  Deno.exit(1);
}
console.log("Worker deployment input: required settings valid (values withheld).");
if (Deno.args.includes("--probe")) {
  try {
    const url = new URL(Deno.env.get("INDEX_WORKER_URL") ?? "");
    if (
      url.username || url.password || url.search || url.hash || url.pathname !== "/functions/v1/index-worker" ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname)))
    ) {
      throw Error();
    }
    const response = await fetch(url, {
      method: "POST",
      headers: { authorization: `Bearer ${settings.INDEX_WORKER_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ check_configuration: true }),
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) {
      await response.body?.cancel();
      console.error(`Worker probe failed: HTTP ${response.status} (response body withheld).`);
      Deno.exit(1);
    }
    const result = await response.json();
    if (result.configuration_checked !== true) throw Error();
    console.log(
      "Worker probe: HTTP 200, configuration checked. No DB/queue/provider call; embedding success is untested.",
    );
  } catch {
    console.error("Worker probe failed: check the target URL and administrator logs (values withheld).");
    Deno.exit(1);
  }
}
