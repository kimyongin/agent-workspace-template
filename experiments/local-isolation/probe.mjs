// Small local-only experiment. Each workdir is fresh; no original env/key is read.
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { stringify } from "smol-toml";

const root = resolve(process.argv[2] ?? ".local/experiments/isolation-a");
const project = process.argv[3] ?? "t08-probe-a";
const port = Number(process.argv[4] ?? 56100);
if (!root.startsWith(resolve(".local/experiments") + "/") && !root.startsWith(resolve(".local/experiments") + "\\")) throw Error("Dedicated experiment path required");
if (!/^t08-probe-[ab]$/.test(project) || !Number.isInteger(port)) throw Error("Invalid probe identity");
if (existsSync(root)) throw Error("Use a new workdir; do not replace existing state");
mkdirSync(resolve(root, "supabase/functions/probe"), { recursive: true });
writeFileSync(resolve(root, "supabase/config.toml"), stringify({
  project_id: project,
  api: { port }, db: { port: port + 1, shadow_port: port + 2, major_version: 17, pooler: { enabled: true, port: port + 3, pool_mode: "transaction" } },
  auth: { site_url: `http://127.0.0.1:${port + 4}`, enable_signup: true },
  studio: { enabled: false }, analytics: { enabled: false }, realtime: { enabled: false }, storage: { enabled: false },
  edge_runtime: { enabled: true, inspector_port: port + 5 },
  functions: { probe: { verify_jwt: false } },
}));
writeFileSync(resolve(root, "supabase/functions/probe/index.ts"), `import postgres from "npm:postgres@3.4.9";
const sql = postgres("postgresql://postgres.pooler-dev:postgres@pooler:6543/postgres", { prepare: false });
Deno.serve(async () => Response.json({ project: ${JSON.stringify(project)}, url: Deno.env.get("SUPABASE_URL"), marker: (await sql\`select value from isolation_marker\`)[0].value }));\n`);
console.log(JSON.stringify({ root, project, port }));
