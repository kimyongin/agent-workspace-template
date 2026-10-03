// Machine-wide port reservations and fail-closed ownership. State contains no secrets.
import { mkdir, realpath, lstat, readFile, writeFile, rename, rm } from "node:fs/promises";
import { join, resolve, relative, isAbsolute } from "node:path";
import { hostname, userInfo } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";

export const digest = (value) => createHash("sha256").update(value).digest("hex");
export const owner = digest(`${hostname()}:${userInfo().username}`);
export const registryPath = process.platform === "win32"
  ? join(process.env.PUBLIC ?? "C:/Users/Public", "agent-workspace-environments")
  : "/var/tmp/agent-workspace-environments";
export const portNames = ["api", "db", "shadow", "pooler", "studio", "smtp", "analytics", "inspector", "web", "callback"];

export async function json(path) { return JSON.parse(await readFile(path, "utf8")); }
export async function atomicJson(path, value) {
  const temp = `${path}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await rename(temp, path);
}
export async function optionalJson(path) {
  try { return await json(path); } catch (error) { if (error.code === "ENOENT") return null; throw error; }
}
export async function safePath(base, target, create = false) {
  const root = await realpath(base);
  const path = resolve(target);
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw Error("Path must stay inside its dedicated root");
  let current = root;
  for (const segment of rel.split(/[\\/]/)) {
    current = join(current, segment);
    if (create) await mkdir(current).catch((e) => { if (e.code !== "EEXIST") throw e; });
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw Error("Symlink/junction state path refused");
    if (await realpath(current) !== current) throw Error("Noncanonical state path refused");
  }
  return path;
}
export async function environment(checkout) {
  const root = await realpath(checkout);
  const id = `aw-dev-${digest(root).slice(0, 16)}`;
  const dir = await safePath(root, join(root, ".local/environments", id), true);
  return { schema: 1, kind: "dev", id, project: id, owner, checkout: root, dir };
}
export function assertOwner(manifest, expected) {
  for (const key of ["schema", "kind", "id", "project", "owner", "checkout", "dir"]) {
    if (manifest[key] !== expected[key]) throw Error(`Environment ${key} mismatch; refusing operation`);
  }
  if (!manifest.ports || portNames.some((key) => !Number.isInteger(manifest.ports[key]))) throw Error("Invalid reserved ports");
}
export async function acquireLock(dir, purpose) {
  const path = join(dir, "operation.lock");
  try { await mkdir(path); } catch (error) {
    if (error.code === "EEXIST") throw Error(`Locked: ${path}. Inspect owner.json; recover only after the process has exited.`);
    throw error;
  }
  const record = { token: randomUUID(), pid: process.pid, host: hostname(), owner, purpose, acquiredAt: new Date().toISOString() };
  await atomicJson(join(path, "owner.json"), record);
  return async () => {
    if ((await json(join(path, "owner.json"))).token !== record.token) throw Error("Lock ownership changed");
    await safePath(dir, path);
    await rm(path, { recursive: true });
  };
}
export async function recoverLock(dir, token) {
  const path = await safePath(dir, join(dir, "operation.lock"));
  const record = await json(join(path, "owner.json"));
  if (record.token !== token || record.owner !== owner || record.host !== hostname()) throw Error("Lock recovery owner/token mismatch");
  try { process.kill(record.pid, 0); throw Error("Lock process still exists (or PID reused); recovery refused"); }
  catch (error) { if (error.code !== "ESRCH") throw error; }
  await rm(path, { recursive: true });
}
export function unavailableAddress(host, code) {
  return host.includes(":") && ["EAFNOSUPPORT", "EADDRNOTAVAIL"].includes(code);
}
export async function portFree(port) {
  // Dual stack wildcard catches listeners on IPv4 and IPv6, including localhost-only servers.
  for (const host of ["127.0.0.1", "::1", "0.0.0.0", "::"]) {
    const free = await new Promise((done) => {
      const server = createServer();
      server.once("error", (error) => done(unavailableAddress(host, error.code)));
      server.listen({ port, host, exclusive: true }, () => server.close(() => done(true)));
    });
    if (!free) return false;
  }
  return true;
}
export async function reserve(expected, registry = registryPath, probe = portFree) {
  await mkdir(registry, { recursive: true });
  if ((await lstat(registry)).isSymbolicLink() || await realpath(registry) !== resolve(registry)) throw Error("Registry path must be canonical");
  const release = await acquireLock(registry, "port allocation");
  try {
    const file = join(registry, "registry.json");
    const state = await optionalJson(file) ?? { schema: 1, reservations: {} };
    if (state.schema !== 1 || !state.reservations || typeof state.reservations !== "object") throw Error("Invalid registry");
    const previous = state.reservations[expected.id];
    if (previous) { assertOwner(previous, expected); return previous.ports; }
    const used = new Set(Object.values(state.reservations).flatMap((entry) => Object.values(entry.ports)));
    for (let base = 57000; base < 62000; base += 20) {
      const ports = Object.fromEntries(portNames.map((name, i) => [name, base + i]));
      if (Object.values(ports).some((p) => used.has(p))) continue;
      if (!(await Promise.all(Object.values(ports).map(probe))).every(Boolean)) continue;
      state.reservations[expected.id] = { ...expected, ports };
      await atomicJson(file, state);
      return ports;
    }
    throw Error("No free local port bundle; no existing process was stopped");
  } finally { await release(); }
}
export async function verifyReservation(manifest, registry = registryPath) {
  const registered = (await json(join(registry, "registry.json"))).reservations[manifest.id];
  if (!registered) throw Error("Environment reservation missing");
  assertOwner(registered, manifest);
  if (JSON.stringify(registered.ports) !== JSON.stringify(manifest.ports)) throw Error("Port reservation mismatch");
}
