import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { readFile, stat, writeFile } from "node:fs/promises";
import postgres from "postgres";
import { digest, environment } from "../../scripts/environment-state.mjs";
import { readEnv } from "../../scripts/local-env.mjs";
const env = await environment(process.cwd());
const files = ["supabase/config.toml", "supabase/signing_keys.json", "runtime.env", "functions.env", "web/.env.local"];
async function fingerprint() {
  return Object.fromEntries(await Promise.all(files.map(async (file) => [file, { sha256: digest(await readFile(join(env.dir, file))), mtimeMs: (await stat(join(env.dir, file))).mtimeMs }])));
}
const before = await fingerprint();
await promisify(execFile)(process.execPath, ["scripts/environment.mjs", "setup"]);
const after = await fingerprint(); assert.deepEqual(after, before);
const config = readEnv(join(env.dir, "runtime.env"));
const db = postgres(config.LOCAL_DB_URL, { max: 1 });
let persisted;
try {
  const evidence = JSON.parse(await readFile(new URL("dev-smoke-windows-20261004.json", import.meta.url), "utf8"));
  persisted = (await db`select title from app.tasks where id = ${evidence.taskId}`)[0]?.title;
  assert.equal(persisted, `T08 lifecycle ${env.id}`);
  const users = await db`select id from auth.users where email = ${config.DEV_USER_A_EMAIL}`;
  assert.equal(users[0].id, evidence.userId);
} finally { await db.end(); }
await writeFile(new URL("repeat-windows-20261004.json", import.meta.url), JSON.stringify({ observedAt: new Date().toISOString(), id: env.id, generatedFilesByteAndMtimePreserved: true, files: after, developmentTaskAndUserSurvivedStopRestart: Boolean(persisted) }, null, 2) + "\n");
console.log("Repeated setup preserved generated file bytes/mtime and stopped/restarted development task/user.");
