import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir, hostname } from "node:os";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { environment, reserve, verifyReservation, acquireLock, recoverLock, assertOwner, safePath, portFree, owner, atomicJson, unavailableAddress } from "./environment-state.mjs";
import { configuration, prepareFiles, syncCode, cleanEnv, verifyResources, cli, updateConfig, recoverConfig } from "./environment-runtime.mjs";
import { digest } from "./environment-state.mjs";

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "aw-env-test-"));
  t.after(async () => { assert.ok(root.startsWith(join(tmpdir(), "aw-env-test-"))); await rm(root, { recursive: true, force: true }); });
  return root;
}
test("stable checkout identity; sibling checkouts receive nonoverlapping reserved bundles", async (t) => {
  const root = await fixture(t); const registry = join(root, "registry");
  await mkdir(join(root, "a")); await mkdir(join(root, "b"));
  const a = await environment(join(root, "a")); const b = await environment(join(root, "b"));
  assert.equal((await environment(join(root, "a", "."))).id, a.id);
  assert.notEqual(a.id, b.id);
  a.ports = await reserve(a, registry, async () => true);
  b.ports = await reserve(b, registry, async () => true);
  assert.equal(new Set([...Object.values(a.ports), ...Object.values(b.ports)]).size, 20);
  assert.deepEqual(await reserve(a, registry, async () => { throw Error("must preserve reservation"); }), a.ports);
  await verifyReservation(a, registry);
  await assert.rejects(reserve({ ...a, owner: "another-owner" }, registry), /owner mismatch/);
  await assert.rejects(verifyReservation({ ...a, ports: { ...a.ports, api: a.ports.api + 1 } }, registry), /Port reservation mismatch/);
});
test("actual IPv4 listener prevents bundle allocation without stopping it", async (t) => {
  for (const code of ["EAFNOSUPPORT", "EADDRNOTAVAIL"]) {
    assert.equal(unavailableAddress("::1", code), true);
    assert.equal(unavailableAddress("127.0.0.1", code), false);
  }
  assert.equal(unavailableAddress("::1", "EADDRINUSE"), false);
  const root = await fixture(t);
  const server = createServer(); await new Promise((r) => server.listen(0, "127.0.0.1", r));
  t.after(() => server.close());
  assert.equal(await portFree(server.address().port), false);
  const env = await environment(root);
  const ports = await reserve(env, join(root, "registry"), async (p) => p !== 57000);
  assert.equal(ports.api, 57020); assert.equal(server.listening, true);
});
test("ownership rejects every identity field and canonical path/junction escape", async (t) => {
  const root = await fixture(t); const env = await environment(root); env.ports = await reserve(env, join(root, "registry"), async () => true);
  for (const key of ["schema", "kind", "id", "project", "owner", "checkout", "dir"]) assert.throws(() => assertOwner({ ...env, [key]: "wrong" }, env), /mismatch/);
  await assert.rejects(safePath(root, join(root, "..", "other"), true), /inside/);
  await mkdir(join(root, "outside")); await symlink(join(root, "outside"), join(env.dir, "escape"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(safePath(env.dir, join(env.dir, "escape", "nested"), true), /Symlink/);
});
test("same environment lock collides; live/PID-reused and wrong-token recovery is refused", async (t) => {
  const root = await fixture(t); const release = await acquireLock(root, "setup");
  await assert.rejects(acquireLock(root, "stop"), /Locked/);
  const record = JSON.parse(await readFile(join(root, "operation.lock/owner.json"), "utf8"));
  await assert.rejects(recoverLock(root, "wrong"), /mismatch/);
  await assert.rejects(recoverLock(root, record.token), /still exists/);
  await release();
  const child = spawn(process.execPath, ["-e", "process.exit(0)"]);
  await new Promise((done) => child.once("exit", done));
  await mkdir(join(root, "operation.lock"));
  await atomicJson(join(root, "operation.lock/owner.json"), { ...record, pid: child.pid, host: hostname(), owner });
  await recoverLock(root, record.token);
  const next = await acquireLock(root, "restart"); await next();
});
test("machine registry concurrency admits one allocator and preserves unique reservations", async (t) => {
  const root = await fixture(t); const registry = join(root, "registry"); await mkdir(registry);
  const release = await acquireLock(registry, "held by another checkout");
  const env = await environment(root);
  await assert.rejects(reserve(env, registry, async () => true), /Locked/);
  await release(); assert.equal((await reserve(env, registry, async () => true)).api, 57000);
});
test("managed code sync reflects edits/deletions and excludes original env; config has no remote/provider secrets", async (t) => {
  const root = await fixture(t);
  await mkdir(join(root, "supabase/functions/api"), { recursive: true }); await mkdir(join(root, "supabase/migrations"));
  const original = '[api]\nschemas=["public"]\nextra_search_path=["public"]\n[db]\nmajor_version=17\n[auth.hook]\n[auth.oauth_server]\nenabled=true\n[functions.api]\nverify_jwt=false\n[remotes.production]\nproject_id="production"\n';
  await writeFile(join(root, "supabase/config.toml"), original);
  await writeFile(join(root, "supabase/functions/.env"), "PINECONE_API_KEY=original-secret\n");
  const file = join(root, "supabase/functions/api/index.ts"); await writeFile(file, "first");
  const env = await environment(root); env.ports = await reserve(env, join(root, "registry"), async () => true);
  const config = await configuration(env); assert.ok(!config.includes("production")); assert.ok(!config.includes("PINECONE"));
  await syncCode(env); assert.equal(await readFile(join(env.dir, "supabase/functions/api/index.ts"), "utf8"), "first");
  await assert.rejects(readFile(join(env.dir, "supabase/functions/.env")), { code: "ENOENT" });
  await writeFile(file, "second"); await syncCode(env); assert.equal(await readFile(join(env.dir, "supabase/functions/api/index.ts"), "utf8"), "second");
  await rm(file); await syncCode(env); await assert.rejects(readFile(join(env.dir, "supabase/functions/api/index.ts")), { code: "ENOENT" });
  await writeFile(join(env.dir, "supabase/config.toml"), "tampered"); env.configHash = "wrong";
  await assert.rejects(prepareFiles(env), /fingerprint/);
  assert.equal(await readFile(join(root, "supabase/config.toml"), "utf8"), original);
});
test("inherited address/provider credentials are removed before CLI/web startup", () => {
  const names = ["VITE_API_URL", "SUPABASE_ACCESS_TOKEN", "APP_DB_URL", "LOCAL_DB_URL", "PINECONE_API_KEY", "INDEX_WORKER_TOKEN"];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try { for (const name of names) process.env[name] = "foreign"; const result = cleanEnv(); for (const name of names) assert.equal(result[name], undefined); }
  finally { for (const name of names) { if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]; } }
});
test("unrecorded/replaced Docker resource IDs fail closed; partial start records remain usable", async (t) => {
  const root = await fixture(t); const env = await environment(root);
  const resources = { container: [{ id: "owned-container" }], network: [{ id: "owned-network" }], volume: [{ id: "owned-volume" }] };
  await assert.rejects(verifyResources(env, false, async () => resources), /Unrecorded Docker/);
  await atomicJson(join(env.dir, "resources.json"), resources);
  await verifyResources(env, false, async () => resources);
  await assert.rejects(verifyResources(env, false, async () => ({ ...resources, container: [{ id: "replacement" }] })), /Unrecorded container identity/);
  await atomicJson(join(env.dir, "resources.json"), { ...resources, volume: [{ id: "owned-volume", createdAt: "original" }] });
  await assert.rejects(verifyResources(env, false, async () => ({ ...resources, volume: [{ id: "owned-volume", createdAt: "recreated" }] })), /Unrecorded volume identity/);
  await atomicJson(join(env.dir, "resources.json"), resources);
  await verifyResources(env, false, async () => ({ ...resources, container: [] }));
  await writeFile(join(env.dir, "evidence.txt"), "failure evidence");
  const release = await acquireLock(env.dir, "retry"); await release();
  assert.equal(await readFile(join(env.dir, "evidence.txt"), "utf8"), "failure evidence");
});
test("cancelling preparation terminates only its CLI child tree and suppresses secret output", async (t) => {
  const root = await fixture(t); const bin = join(root, "node_modules/supabase/dist"); await mkdir(bin, { recursive: true });
  const ready = join(root, "ready.json");
  await writeFile(join(bin, "supabase.js"), `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(ready)},JSON.stringify({pid:process.pid,child:child.pid}));console.log('hidden-secret');setInterval(()=>{},1000);`);
  const controller = new AbortController();
  const operation = cli({ checkout: root, dir: root }, ["start"], controller.signal);
  const checked = assert.rejects(operation, (error) => error.message.includes("secret output was suppressed") && !error.message.includes("hidden-secret"));
  let pids;
  for (let i = 0; i < 100; i++) {
    pids = await readFile(ready, "utf8").then(JSON.parse, () => null);
    if (pids) break;
    await new Promise((done) => setTimeout(done, 20));
  }
  assert.ok(pids); controller.abort(); await checked;
  for (const pid of [pids.pid, pids.child]) {
    let live = true;
    for (let i = 0; i < 100; i++) {
      try { process.kill(pid, 0); } catch (error) { if (error.code === "ESRCH") live = false; else throw error; }
      if (!live) break;
      await new Promise((done) => setTimeout(done, 20));
    }
    assert.equal(live, false, "Only the owned CLI process tree must terminate");
  }
});
test("source config update requires stopped services and interrupted old/new journal recovery preserves unrelated files", async (t) => {
  const root = await fixture(t); const env = await environment(root); env.ports = await reserve(env, join(root, "registry"), async () => true);
  await mkdir(join(env.dir, "supabase"));
  const old = `project_id = "${env.project}"\n[api]\nmax_rows = 1000\n`;
  const next = old.replace("1000", "2000");
  env.configHash = digest(old); await writeFile(join(env.dir, "supabase/config.toml"), old);
  await writeFile(join(env.dir, "supabase/signing_keys.json"), "preserved key");
  const stopped = async () => ({ container: [], network: [], volume: [] });
  await assert.rejects(updateConfig(env, next, async () => ({ container: [{ id: "running" }] })), /stop.*env:stop/);
  assert.equal(await readFile(join(env.dir, "supabase/config.toml"), "utf8"), old);
  const journal = { identity: { ...env }, previousHash: digest(old), nextHash: digest(next), content: next };
  await atomicJson(join(env.dir, "config-update.json"), journal);
  await writeFile(join(env.dir, "supabase/config.toml"), next); // crash between config and owner manifest writes
  await recoverConfig(env, stopped); assert.equal(env.configHash, digest(next));
  assert.equal(await readFile(join(env.dir, "supabase/signing_keys.json"), "utf8"), "preserved key");
  await atomicJson(join(env.dir, "config-update.json"), { ...journal, identity: { ...journal.identity, owner: "foreign" } });
  await assert.rejects(recoverConfig(env, stopped), /owner mismatch/);
  await atomicJson(join(env.dir, "config-update.json"), journal);
  await writeFile(join(env.dir, "supabase/config.toml"), "manual tampering");
  await assert.rejects(recoverConfig(env, stopped), /fingerprint mismatch/);
  await rm(join(env.dir, "config-update.json"));
  const versioned = next + "[db]\nmajor_version = 17\n";
  await writeFile(join(env.dir, "supabase/config.toml"), versioned); env.configHash = digest(versioned);
  await assert.rejects(updateConfig(env, versioned.replace("17", "18"), stopped), /major version change/);
});
