// Supabase and worktree code consumer. Child stdout with keys is never logged.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, readdir, lstat, rm, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse, stringify } from "smol-toml";
import postgres from "postgres";
import { randomBytes, randomUUID } from "node:crypto";
import { readEnv, writeEnv } from "./local-env.mjs";
import { digest, safePath, atomicJson, optionalJson, portFree, assertOwner } from "./environment-state.mjs";

const exec = promisify(execFile);
const exclusions = "studio,imgproxy,vector,logflare,mailpit,realtime,storage-api";
export async function terminateChild(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode) return;
  if (process.platform === "win32") await exec("taskkill", ["/pid", String(child.pid), "/T", "/F"]).catch(() => {});
  else {
    try { process.kill(-child.pid, "SIGTERM"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
}
export async function cli(manifest, args, signal) {
  signal?.throwIfAborted();
  let abortWork;
  const operation = exec(process.execPath, [join(manifest.checkout, "node_modules/supabase/dist/supabase.js"), ...args, "--workdir", manifest.dir],
    { cwd: manifest.checkout, maxBuffer: 8 * 1024 * 1024, env: cleanEnv(), detached: true, windowsHide: true });
  const abort = () => { abortWork = terminateChild(operation.child); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    const output = (await operation).stdout;
    signal?.throwIfAborted();
    return output;
  } catch { throw Error(`Local Supabase ${args[0]} failed. Inspect this environment's container health; CLI secret output was suppressed.`); }
  finally { signal?.removeEventListener("abort", abort); await abortWork; }
}
export function cleanEnv() {
  // Original provider credentials and Supabase remote credentials must not reach the CLI.
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(SUPABASE_|PINECONE_|APP_|WORKER_|INDEX_WORKER_|LOCAL_|VITE_)/.test(key)));
}
export async function docker(args) { return (await exec("docker", args, { maxBuffer: 8 * 1024 * 1024 })).stdout.trim(); }
export async function inventory(manifest) {
  const resources = {};
  for (const type of ["container", "network", "volume"]) {
    const listArgs = [type === "container" ? "ps" : type, ...(type === "container" ? ["-a"] : ["ls"])];
    const labeled = (await docker([...listArgs, "-q", "--filter", `label=com.supabase.cli.project=${manifest.project}`])).split(/\s+/).filter(Boolean);
    // Inspect namespace matches too: changing/removing a label must not hide a resource from ownership checks.
    const names = (await docker([...listArgs, "--format", type === "volume" ? "{{.Name}}\t{{.Name}}" : type === "network" ? "{{.ID}}\t{{.Name}}" : "{{.ID}}\t{{.Names}}"]))
      .split("\n").map((line) => line.split("\t")).filter(([, name]) => name?.endsWith(`_${manifest.project}`)).map(([id]) => id);
    const ids = [...new Set([...labeled, ...names])];
    const seen = new Set();
    resources[type] = [];
    for (const id of ids) {
      const [info] = JSON.parse(await docker([...(type === "container" ? [] : [type]), "inspect", id]));
      const fullId = info.Id ?? info.Name;
      if (seen.has(fullId)) continue;
      seen.add(fullId);
      const labels = type === "container" ? info.Config.Labels : info.Labels;
      if (labels?.["com.supabase.cli.project"] !== manifest.project || labels?.["com.docker.compose.project"] !== manifest.project) throw Error("Docker project ownership mismatch");
      if (!info.Name.endsWith(`_${manifest.project}`)) throw Error("Docker resource namespace mismatch");
      if (type === "container" && resolve(labels["com.supabase.cli.workdir"] ?? "") !== manifest.dir) throw Error("Docker workdir ownership mismatch");
      const networks = type === "container" ? Object.entries(info.NetworkSettings.Networks) : [];
      if (type === "container" && (networks.length > 1 || (networks.length && networks[0][0] !== `supabase_network_${manifest.project}`) || (!networks.length && info.State.Running))) throw Error("Container network boundary mismatch");
      resources[type].push({ id: info.Id ?? info.Name, name: info.Name, createdAt: info.CreatedAt ?? info.Created, labels: Object.fromEntries(Object.entries(labels).filter(([key]) => ["com.supabase.cli.project", "com.docker.compose.project", "com.supabase.cli.workdir"].includes(key))), ...(type === "container" ? { networkId: networks[0]?.[1].NetworkID ?? null } : {}) });
    }
  }
  if (resources.container.some((entry) => entry.networkId && (resources.network.length !== 1 || entry.networkId !== resources.network[0].id))) throw Error("Owned network ID mismatch");
  return resources;
}
export async function verifyResources(manifest, allowNew = false, inspect = inventory) {
  const found = await inspect(manifest);
  const saved = await optionalJson(join(manifest.dir, "resources.json"));
  if (saved) await safePath(manifest.dir, join(manifest.dir, "resources.json"));
  if (!saved && Object.values(found).some((entries) => entries.length) && !allowNew) throw Error("Unrecorded Docker resources; recovery must inspect ownership");
  if (saved && !allowNew) {
    for (const type of ["container", "network", "volume"]) {
      if (found[type].some((entry) => !saved[type].some((known) => known.id === entry.id && (!known.createdAt || known.createdAt === entry.createdAt)))) throw Error(`Unrecorded ${type} identity; refusing operation`);
    }
  }
  return found;
}
export async function recordResources(manifest) { await atomicJson(join(manifest.dir, "resources.json"), await inventory(manifest)); }

export async function configuration(manifest) {
  const template = parse(await readFile(join(manifest.checkout, "supabase/config.toml"), "utf8"));
  if (template.db.orioledb_version) throw Error("A database engine change needs an explicit data compatibility plan");
  const p = manifest.ports;
  return stringify({
    project_id: manifest.project,
    api: { enabled: true, port: p.api, schemas: template.api.schemas, extra_search_path: template.api.extra_search_path, max_rows: template.api.max_rows ?? 1000 },
    db: { port: p.db, shadow_port: p.shadow, major_version: template.db.major_version, pooler: { enabled: true, port: p.pooler, pool_mode: "transaction", default_pool_size: 20, max_client_conn: 100 }, seed: { enabled: false } },
    auth: { site_url: `http://127.0.0.1:${p.web}`, additional_redirect_urls: [`http://127.0.0.1:${p.web}`, `http://localhost:${p.web}`, `http://127.0.0.1:${p.callback}/callback`], signing_keys_path: "./signing_keys.json", enable_signup: true, email: { enable_signup: true, enable_confirmations: false }, hook: template.auth.hook, oauth_server: template.auth.oauth_server },
    studio: { enabled: false, port: p.studio }, local_smtp: { enabled: false, port: p.smtp }, analytics: { enabled: false, port: p.analytics }, realtime: { enabled: false }, storage: { enabled: false },
    edge_runtime: { enabled: true, policy: "per_worker", inspector_port: p.inspector, deno_version: 2 },
    functions: template.functions,
  });
}
export async function syncCode(manifest) {
  for (const [name, accepts] of [["functions", (n) => /\.(ts|json|lock)$/.test(n)], ["migrations", (n) => n.endsWith(".sql")]]) {
    const source = await safePath(manifest.checkout, join(manifest.checkout, "supabase", name));
    const target = await safePath(manifest.dir, join(manifest.dir, "supabase", name), true);
    const copied = new Set();
    async function walk(from, to) {
      for (const entry of await readdir(from, { withFileTypes: true })) {
        const src = join(from, entry.name);
        const dest = join(to, entry.name);
        if (entry.isSymbolicLink()) throw Error("Function/migration source symlink refused");
        if (entry.isDirectory()) { await safePath(target, dest, true); await walk(src, dest); }
        else if (entry.isFile() && accepts(entry.name)) {
          copied.add(dest);
          const bytes = await readFile(src);
          if (await optionalBytes(dest).then((old) => !old?.equals(bytes))) await writeFile(dest, bytes);
        }
      }
    }
    await walk(source, target);
    async function prune(path) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const dest = await safePath(target, join(path, entry.name));
        if (entry.isDirectory()) await prune(dest);
        else if (accepts(entry.name) && !copied.has(dest)) await rm(dest);
        else if (!accepts(entry.name)) throw Error("Unexpected generated code file; refusing overwrite");
      }
    }
    await prune(target);
  }
}
async function optionalBytes(path) {
  try { if ((await lstat(path)).isSymbolicLink()) throw Error("Generated file symlink refused"); return await readFile(path); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
export async function prepareFiles(manifest, signal) {
  signal?.throwIfAborted();
  const path = join(manifest.dir, "supabase/config.toml");
  await safePath(manifest.dir, join(manifest.dir, "supabase"), true);
  const content = await configuration(manifest);
  if (manifest.configHash) {
    const existing = await readFile(await safePath(manifest.dir, path), "utf8");
    if (digest(existing) !== manifest.configHash) throw Error("Generated config fingerprint mismatch");
    await updateConfig(manifest, content);
  } else {
    await writeFile(path, content, { flag: "wx" });
    manifest.configHash = digest(content);
    await atomicJson(join(manifest.dir, "manifest.json"), manifest);
  }
  await syncCode(manifest);
  const keyFile = join(manifest.dir, "supabase/signing_keys.json");
  if (!await optionalBytes(keyFile)) {
    await writeFile(keyFile, "[]\n", { mode: 0o600, flag: "wx" });
    await cli(manifest, ["gen", "signing-key", "--algorithm", "ES256", "--append"], signal);
  } else if (!JSON.parse(await readFile(keyFile, "utf8")).length) {
    // Resume a failure before key generation; never replace an existing populated key.
    await cli(manifest, ["gen", "signing-key", "--algorithm", "ES256", "--append"], signal);
  }
}
async function writeConfig(manifest, content) {
  const path = join(manifest.dir, "supabase/config.toml");
  await safePath(manifest.dir, join(manifest.dir, "supabase"));
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, content, { flag: "wx" });
  await rename(temp, path);
}
export async function recoverConfig(manifest, inspect = verifyResources) {
  const journalPath = join(manifest.dir, "config-update.json");
  const pending = await optionalJson(journalPath);
  if (!pending) return;
  await safePath(manifest.dir, journalPath);
  assertOwner(pending.identity, manifest);
  if (digest(pending.content) !== pending.nextHash || parse(pending.content).project_id !== manifest.project) throw Error("Invalid config update journal");
  const current = digest(await readFile(await safePath(manifest.dir, join(manifest.dir, "supabase/config.toml")), "utf8"));
  if (![pending.previousHash, pending.nextHash].includes(current) || ![pending.previousHash, pending.nextHash].includes(manifest.configHash)) throw Error("Config update old/new fingerprint mismatch");
  if ((await inspect(manifest)).container.length) throw Error("Config update requires stopped owned services; run env:stop first");
  if (current === pending.previousHash) await writeConfig(manifest, pending.content);
  manifest.configHash = pending.nextHash;
  await atomicJson(join(manifest.dir, "manifest.json"), manifest);
  await rm(journalPath);
}
export async function updateConfig(manifest, content, inspect = verifyResources) {
  const nextHash = digest(content);
  if (nextHash === manifest.configHash) return;
  const previous = await readFile(await safePath(manifest.dir, join(manifest.dir, "supabase/config.toml")), "utf8");
  if (digest(previous) !== manifest.configHash) throw Error("Generated config fingerprint mismatch");
  if (parse(previous).db?.major_version !== parse(content).db?.major_version) throw Error("A database major version change needs an explicit data compatibility plan");
  if ((await inspect(manifest)).container.length) throw Error("Source Supabase config changed; stop env:dev / run env:stop before env:setup");
  await atomicJson(join(manifest.dir, "config-update.json"), { identity: manifest, previousHash: manifest.configHash, nextHash, content });
  await recoverConfig(manifest, inspect);
}
export async function setup(manifest, signal) {
  await prepareFiles(manifest, signal);
  const existing = await verifyResources(manifest);
  if (!existing.container.length) {
    for (const port of Object.values(manifest.ports)) if (!await portFree(port)) throw Error(`Reserved port ${port} is occupied; no process was stopped`);
  }
  try { await cli(manifest, ["start", "-x", exclusions], signal); }
  finally { await recordResources(manifest); }
  await cli(manifest, ["migration", "up", "--local"], signal);
  const status = Object.fromEntries((await cli(manifest, ["status", "-o", "env"], signal)).split("\n").filter((line) => /^[A-Z_]+=/.test(line)).map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")]));
  const url = `http://127.0.0.1:${manifest.ports.api}`;
  if (status.API_URL !== url || !status.PUBLISHABLE_KEY || !status.SECRET_KEY || new URL(status.DB_URL).port !== String(manifest.ports.db)) throw Error("Supabase status does not match owned environment");
  const runtimeFile = join(manifest.dir, "runtime.env");
  if (await optionalBytes(runtimeFile)) await safePath(manifest.dir, runtimeFile);
  const previous = readEnv(runtimeFile);
  const secret = () => randomBytes(24).toString("base64url");
  const local = {
    VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: status.PUBLISHABLE_KEY, VITE_API_URL: `${url}/functions/v1/api`, VITE_DEV_LOGIN: "true",
    LOCAL_SUPABASE_SECRET_KEY: status.SECRET_KEY, LOCAL_DB_URL: status.DB_URL,
    APP_SERVER_PASSWORD: previous.APP_SERVER_PASSWORD ?? secret(), APP_WORKER_PASSWORD: previous.APP_WORKER_PASSWORD ?? secret(), INDEX_WORKER_TOKEN: previous.INDEX_WORKER_TOKEN ?? secret(),
    DEV_USER_A_EMAIL: `${manifest.id}-a@example.test`, DEV_USER_B_EMAIL: `${manifest.id}-b@example.test`, DEV_USER_A_PASSWORD: previous.DEV_USER_A_PASSWORD ?? secret(), DEV_USER_B_PASSWORD: previous.DEV_USER_B_PASSWORD ?? secret(),
  };
  writeEnv(runtimeFile, "Local environment credentials; never commit or log.", local);
  const db = postgres(status.DB_URL, { max: 1, connect_timeout: 5, onnotice: () => {} });
  try {
    // Supavisor metadata lives in a separate database.
    const metadataUrl = new URL(status.DB_URL); metadataUrl.pathname = "/_supabase";
    const metadata = postgres(metadataUrl.href, { max: 1, onnotice: () => {} });
    let tenants;
    try { tenants = await metadata`select external_id from _supavisor.tenants`; } finally { await metadata.end(); }
    if (tenants.length !== 1 || tenants[0].external_id !== "pooler-dev") throw Error("Unexpected Supavisor tenant identity");
    manifest.poolerTenant = tenants[0].external_id;
    for (const [role, password] of [["app_server", local.APP_SERVER_PASSWORD], ["app_worker", local.APP_WORKER_PASSWORD]]) {
      signal?.throwIfAborted();
      const directUrl = new URL(status.DB_URL); directUrl.username = role; directUrl.password = password;
      const probe = postgres(directUrl.href, { max: 1, connect_timeout: 3, onnotice: () => {} });
      let login;
      try { login = await probe`select 1`.then(() => true, () => false); } finally { await probe.end(); }
      if (!login) await db.unsafe(`alter role ${role} password '${password.replace(/'/g, "''")}'`);
      const poolerUrl = new URL(directUrl); poolerUrl.username = `${role}.${manifest.poolerTenant}`; poolerUrl.port = String(manifest.ports.pooler);
      let ready = false;
      for (let i = 0; i < 30; i++) {
        signal?.throwIfAborted();
        const probePooler = postgres(poolerUrl.href, { max: 1, prepare: false, connect_timeout: 2, onnotice: () => {} });
        try { ready = await probePooler`select 1`.then(() => true, () => false); } finally { await probePooler.end(); }
        if (ready) break;
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (!ready) throw Error(`${role} owned pooler did not become ready`);
    }
    await db`insert into private.auth_settings (key, value) values ('mcp_audience', ${`${url}/functions/v1/mcp`}) on conflict (key) do update set value = excluded.value`;
  } finally { await db.end(); }
  const webDir = await safePath(manifest.dir, join(manifest.dir, "web"), true);
  if (await optionalBytes(join(webDir, ".env.local"))) await safePath(manifest.dir, join(webDir, ".env.local"));
  writeEnv(join(webDir, ".env.local"), "Managed public web settings.", Object.fromEntries(Object.entries(local).filter(([name]) => name.startsWith("VITE_"))));
  const functionsEnv = join(manifest.dir, "functions.env");
  if (await optionalBytes(functionsEnv)) await safePath(manifest.dir, functionsEnv);
  writeEnv(functionsEnv, "Managed local-only server credentials.", {
    APP_DB_URL: `postgresql://app_server.${manifest.poolerTenant}:${local.APP_SERVER_PASSWORD}@pooler:6543/postgres`,
    WORKER_DB_URL: `postgresql://app_worker.${manifest.poolerTenant}:${local.APP_WORKER_PASSWORD}@pooler:6543/postgres`,
    INDEX_WORKER_TOKEN: local.INDEX_WORKER_TOKEN, AUTH_ISSUER: `${url}/auth/v1`, MCP_URL: `${url}/functions/v1/mcp`, WEB_ORIGINS: `http://127.0.0.1:${manifest.ports.web},http://localhost:${manifest.ports.web}`,
  });
  signal?.throwIfAborted();
  const admin = (path, init = {}) => fetch(`${url}/auth/v1/admin${path}`, { ...init, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000), headers: { apikey: status.SECRET_KEY, Authorization: `Bearer ${status.SECRET_KEY}`, "Content-Type": "application/json" } });
  const response = await admin("/users?per_page=1000");
  if (!response.ok) throw Error("Owned Auth admin user lookup failed");
  const { users } = await response.json();
  for (const who of ["A", "B"]) {
    if (users.some((user) => user.email === local[`DEV_USER_${who}_EMAIL`])) continue;
    const created = await admin("/users", { method: "POST", body: JSON.stringify({ email: local[`DEV_USER_${who}_EMAIL`], password: local[`DEV_USER_${who}_PASSWORD`], email_confirm: true }) });
    if (!created.ok) throw Error(`Owned development user ${who} creation failed (${created.status})`);
  }
  await atomicJson(join(manifest.dir, "manifest.json"), manifest);
  return manifest;
}
