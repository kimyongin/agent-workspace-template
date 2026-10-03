// Additional isolated development commands; legacy package/CI commands remain until PR 2.
import { spawn } from "node:child_process";
import { readFile, appendFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { environment, acquireLock, recoverLock, reserve, verifyReservation, assertOwner, optionalJson, atomicJson, safePath, digest, portFree } from "./environment-state.mjs";
import { cli, verifyResources, recordResources, setup, cleanEnv, syncCode, terminateChild, recoverConfig, configuration } from "./environment-runtime.mjs";
import { readEnv } from "./local-env.mjs";

async function load(root, create) {
  const expected = await environment(root);
  const path = join(expected.dir, "manifest.json");
  let manifest = await optionalJson(path);
  if (manifest) { await safePath(expected.dir, path); assertOwner(manifest, expected); }
  else if (create) {
    manifest = { ...expected, ports: await reserve(expected), createdAt: new Date().toISOString() };
    await atomicJson(path, manifest);
  } else throw Error("Environment is not initialized; run env:setup in this checkout");
  await verifyReservation(manifest);
  if (create) await recoverConfig(manifest);
  if (manifest.configHash) {
    const config = await readFile(await safePath(manifest.dir, join(manifest.dir, "supabase/config.toml")), "utf8");
    if (digest(config) !== manifest.configHash) throw Error("Generated config fingerprint mismatch");
  }
  return manifest;
}
async function stop(manifest) {
  await verifyResources(manifest);
  // CLI stop is gated by exact recorded resource IDs and project/workdir labels. No --all/no-backup.
  await cli(manifest, ["stop", "--project-id", manifest.project]);
  await recordResources(manifest);
}
async function event(manifest, message) {
  const file = join(manifest.dir, "events.log");
  await safePath(manifest.dir, file).catch((error) => { if (error.code !== "ENOENT") throw error; });
  await appendFile(file, `${new Date().toISOString()} ${message}\n`, { mode: 0o600 });
}
async function development(manifest, abortSignal) {
  await setup(manifest, abortSignal);
  if (!await portFree(manifest.ports.web)) throw Error("Owned web port is occupied; refusing server reuse");
  const children = [];
  const args = [join(manifest.checkout, "node_modules/supabase/dist/supabase.js"), "functions", "serve", "--workdir", manifest.dir, "--env-file", join(manifest.dir, "functions.env")];
  const functions = spawn(process.execPath, args, { cwd: manifest.checkout, env: cleanEnv(), stdio: "ignore", detached: true, windowsHide: true });
  children.push(functions);
  const web = spawn(process.execPath, [join(manifest.checkout, "node_modules/vite/bin/vite.js"), "--port", String(manifest.ports.web), "--strictPort"],
    { cwd: manifest.checkout, env: { ...cleanEnv(), LOCAL_ENV_WEB_DIR: join(manifest.dir, "web") }, stdio: "ignore", detached: true, windowsHide: true });
  children.push(web);
  let syncing = Promise.resolve();
  let syncingBusy = false;
  let failed;
  let closing = false;
  const timer = setInterval(() => {
    if (syncingBusy) return;
    syncingBusy = true;
    syncing = configuration(manifest).then((content) => {
      if (digest(content) !== manifest.configHash) throw Error("Source Supabase config changed; restart env:dev / env:setup after owned services stop");
      return syncCode(manifest);
    }).then(() => recordResources(manifest)).catch((error) => { failed = error; finish(); }).finally(() => { syncingBusy = false; });
  }, 1000);
  let finish;
  const stopped = new Promise((done) => { finish = done; });
  const signal = () => { closing = true; finish(); };
  abortSignal.addEventListener("abort", signal, { once: true });
  if (abortSignal.aborted) signal();
  for (const child of children) {
    child.once("error", () => { failed = Error("Owned development process failed to start"); finish(); });
    child.once("exit", (code) => { if (!closing) failed = Error(`Owned development process exited (${code}); sibling will be stopped`); finish(); });
  }
  try {
    const local = readEnv(join(manifest.dir, "runtime.env"));
    let ready = false;
    for (let i = 0; i < 45 && !closing && !failed; i++) {
      try {
        const login = await fetch(`${local.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, { method: "POST", signal: AbortSignal.timeout(3000), headers: { apikey: local.VITE_SUPABASE_PUBLISHABLE_KEY, "Content-Type": "application/json" }, body: JSON.stringify({ email: local.DEV_USER_A_EMAIL, password: local.DEV_USER_A_PASSWORD }) });
        const auth = await login.json();
        const api = await fetch(`${local.VITE_API_URL}/tasks`, { signal: AbortSignal.timeout(3000), headers: { Authorization: `Bearer ${auth.access_token}` } });
        const web = await fetch(`http://127.0.0.1:${manifest.ports.web}/src/lib/supabase.ts`, { signal: AbortSignal.timeout(3000) });
        ready = login.ok && auth.user?.email === local.DEV_USER_A_EMAIL && api.ok && (await web.text()).includes(local.VITE_SUPABASE_URL);
      } catch { /* bounded owned endpoint readiness; no foreign server reuse */ }
      if (ready) break;
      await new Promise((done) => setTimeout(done, 1000));
    }
    if (!ready && !closing) throw Error("Owned authenticated API/web did not become ready");
    if (ready) console.log(`Isolated development ready: http://127.0.0.1:${manifest.ports.web} (Ctrl+C stops this environment; DB data is preserved)`);
    await stopped;
  }
  finally {
    closing = true;
    clearInterval(timer); await syncing;
    abortSignal.removeEventListener("abort", signal);
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode) continue;
      await terminateChild(child);
    }
    // functions serve intentionally recreates only its own edge-runtime container.
    await recordResources(manifest);
    await stop(manifest);
  }
  if (failed) throw failed;
}
export async function run(command, root = process.cwd(), token) {
  if (!["setup", "status", "stop", "dev", "unlock", "unlock-registry"].includes(command)) throw Error("Use setup | status | stop | dev | unlock <token> | unlock-registry <token>. Dev reset/test/delete commands are deliberately unavailable.");
  if (command === "unlock-registry") {
    const { registryPath } = await import("./environment-state.mjs");
    await recoverLock(registryPath, token); return;
  }
  const expected = await environment(root);
  if (command === "unlock") { await load(root, false); await recoverLock(expected.dir, token); return; }
  if (command === "status") {
    const manifest = await load(root, false);
    const resources = await verifyResources(manifest);
    console.log(JSON.stringify({ id: manifest.id, kind: manifest.kind, checkout: manifest.checkout, ports: manifest.ports, configHash: manifest.configHash, lock: await optionalJson(join(manifest.dir, "operation.lock/owner.json")), resources }, null, 2));
    return;
  }
  const release = await acquireLock(expected.dir, command);
  const controller = new AbortController();
  const interrupted = () => controller.abort();
  process.once("SIGINT", interrupted); process.once("SIGTERM", interrupted);
  let manifest;
  try {
    manifest = await load(root, command === "setup" || command === "dev");
    if (command === "setup") await setup(manifest, controller.signal);
    else if (command === "stop") await stop(manifest);
    else if (command === "dev") await development(manifest, controller.signal);
    await event(manifest, `${command} completed`);
    if (command !== "status") console.log(`${command} completed: ${manifest.id}`);
  } catch (error) {
    if (!controller.signal.aborted || !manifest) throw error;
    // Normal cancellation covers preparation too. SIGKILL remains a fail-closed manual recovery.
    await recordResources(manifest);
    await stop(manifest);
    await event(manifest, `${command} interrupted; owned services stopped; DB preserved`);
    console.log(`Interrupted ${command}: owned services stopped; development DB preserved`);
  } finally {
    process.removeListener("SIGINT", interrupted); process.removeListener("SIGTERM", interrupted);
    await release();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  run(process.argv[2], process.cwd(), process.argv[3]).catch((error) => { console.error(error.message); process.exitCode = 1; });
}
