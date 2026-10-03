// Explicit local experiment controls. Never emits CLI key output or targets the original projects.
import { execFileSync, spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { resolve, join } from "node:path";
import { parse } from "smol-toml";
import { safePath } from "../../scripts/environment-state.mjs";
import { cli, inventory, recordResources, verifyResources, cleanEnv } from "../../scripts/environment-runtime.mjs";
const [action, name] = process.argv.slice(2);
if (!["a", "b"].includes(name) || !["start", "serve", "record", "stop"].includes(action)) throw Error("Use start|serve|record|stop a|b");
const checkout = await realpath(process.cwd());
const dir = await safePath(checkout, join(checkout, ".local/experiments", `isolation-${name}`));
const project = `t08-probe-${name}`;
if (parse(readFileSync(join(dir, "supabase/config.toml"), "utf8")).project_id !== project) throw Error("Experiment project mismatch");
const manifest = { checkout, dir, project };
if (action === "record") await recordResources(manifest);
else if (action === "start") {
  if (existsSync(join(dir, "resources.json"))) await verifyResources(manifest);
  else if (Object.values(await inventory(manifest)).some((r) => r.length)) throw Error("Existing unrecorded resources refused");
  try { await cli(manifest, ["start", "-x", "studio,imgproxy,vector,logflare,mailpit,realtime,storage-api"]); }
  finally { await recordResources(manifest); }
} else if (action === "stop") {
  await verifyResources(manifest);
  await cli(manifest, ["stop", "--project-id", project, "--no-backup"]);
  await recordResources(manifest);
} else {
  await verifyResources(manifest);
  const child = spawn(process.execPath, [join(checkout, "node_modules/supabase/dist/supabase.js"), "functions", "serve", "--workdir", dir], { cwd: checkout, env: cleanEnv(), stdio: "ignore" });
  const stop = () => child.kill("SIGTERM");
  process.once("SIGINT", stop); process.once("SIGTERM", stop);
  const timer = setInterval(() => recordResources(manifest).catch(() => stop()), 2000);
  await new Promise((done) => child.once("exit", done)); clearInterval(timer);
  await recordResources(manifest);
}
console.log(`Experiment ${action} completed: ${project}`);
