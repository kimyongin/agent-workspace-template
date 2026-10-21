import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync, closeSync, realpathSync, mkdtempSync, readFileSync, writeFileSync, unlinkSync, rmdirSync, chmodSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import { runLocalChecks } from './local-runtime.mjs';

const interruptedCodes = new Set([130, 143, 3221225786, -1073741510]);
const scripts = { setup: 'setup:local', core: 'test:core', DB: 'test:db', HTTP: 'test:http', MCP: 'test:mcp', E2E: 'test:e2e' };

export function realHostBindSource(source) {
  // Docker Desktop reports this host-drive bridge rather than a Windows path.
  // Translate only that exact prefix; still require the resulting host path to exist.
  if (process.platform === 'win32' && source.startsWith('/run/desktop/mnt/host/')) {
    const bridge = /^\/run\/desktop\/mnt\/host\/([a-zA-Z])\/(.+)$/.exec(source);
    if (!bridge || bridge[2].split('/').some(part => !part || part === '.' || part === '..' || /[\\:]/.test(part))) {
      throw new Error('Invalid Docker Desktop host bind path');
    }
    source = `${bridge[1].toUpperCase()}:\\${bridge[2].replaceAll('/', '\\')}`;
  }
  // macOS Docker Desktop exposes only this exact Users bridge for these checkouts.
  // Reject traversal/ambiguous components before resolving the real host directory.
  if (process.platform === 'darwin' && source.startsWith('/host_mnt/Users/')) {
    const hostSource = source.slice('/host_mnt'.length);
    if (hostSource.slice(1).split('/').some(part => !part || part === '.' || part === '..' || /[\\:\0]/.test(part))) {
      throw new Error('Invalid Docker Desktop host bind path');
    }
    source = hostSource;
  }
  return realpathSync(source);
}

// Cooperating runners serialize acquisition; this is never container ownership evidence.
export function acquireRuntimeLock(projectId, directory = tmpdir()) {
  const name = createHash('sha256').update(projectId).digest('hex');
  const path = join(directory, `workspace-runtime-${name}.lock`);
  const handle = openSync(path, 'wx', 0o600);
  const token = randomUUID();
  try { writeFileSync(handle, token); }
  catch (error) { closeSync(handle); throw error; }
  return () => {
    closeSync(handle);
    if (readFileSync(path, 'utf8') !== token) throw new Error('Runtime lease identity changed; left untouched');
    unlinkSync(path);
  };
}

export async function runLeasedLocalChecks(config, options, adapter = createLocalRuntimeAdapter(config), directory) {
  const release = acquireRuntimeLock(`${config.projectId}:${config.apiUrl}`, directory);
  let result, failure, failed = false;
  try { result = await runLocalChecks(adapter, { ...options, source: adapter.source }); }
  catch (error) { failed = true; failure = error; }
  finally {
    try { release(); }
    catch (error) {
      if (result) {
        result.errors.push({ phase: 'lease-cleanup', error });
        if (![130, 143].includes(result.exitCode)) result.exitCode = 1;
      } else {
        failure = failed ? new AggregateError([failure, error], 'Local execution and lease cleanup failed') : error;
        failed = true;
      }
    }
  }
  if (failed) throw failure;
  return result;
}

// Stop does not remove a Docker container. Remove only this proven runtime ID, never volumes/data.
export async function removeOwnedContainer(id, command) {
  const present = await command('docker', ['ps', '-a', '--no-trunc', '--filter', `id=${id}`, '--format', '{{.ID}}']);
  if (present.code !== 0 || present.oversized) throw new Error('Cannot verify cleanup identity');
  if (!present.output.trim()) return;
  if (present.output.trim() !== id) throw new Error('Cleanup identity mismatch');
  if ((await command('docker', ['stop', id])).code !== 0) throw new Error('Owned container cleanup failed');
  if ((await command('docker', ['rm', id])).code !== 0) {
    const remaining = await command('docker', ['ps', '-a', '--no-trunc', '--filter', `id=${id}`, '--format', '{{.ID}}']);
    if (remaining.code !== 0 || remaining.oversized || remaining.output.trim()) throw new Error('Owned container removal failed');
  }
}

// External process/HTTP effects. No shell interpolation or project-name teardown.
export function createLocalRuntimeAdapter(config, { env = process.env } = {}) {
  const source = realpathSync('supabase/functions');
  const npm = env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!existsSync(npm)) throw new Error('Run through npm run test:integration:local to resolve the npm CLI');
  const api = `${config.apiUrl}/functions/v1/api/tasks`;
  const containerName = `supabase_edge_runtime_${config.projectId}`;
  const log = join(tmpdir(), `workspace-functions-${process.pid}-${Date.now()}.log`);

  async function stopChild(child) {
    if (!Number.isInteger(child.pid)) return;
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (process.platform === 'win32') {
      const killed = spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false, stdio: 'ignore', timeout: 5000 });
      if (killed.status !== 0 && child.exitCode === null && child.signalCode === null) throw new Error('Owned child termination failed');
    } else {
      // CLI graceful teardown may act on a project name after another runtime replaces it.
      // Kill our process group; the lifecycle module authorizes container cleanup by exact ID/nonce.
      try { process.kill(-child.pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    let timer;
    try { await Promise.race([child.finished, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned child did not exit')), 5000); })]); }
    finally { clearTimeout(timer); }
  }

  function launch(file, args, stdio) {
    const child = spawn(file, args, { shell: false, stdio, env, detached: process.platform !== 'win32' });
    child.finished = new Promise(resolve => {
      child.once('error', () => { child.spawnFailed = true; resolve({ code: null, interrupted: false, spawnFailed: true }); });
      child.once('close', (code, signal) => resolve({ code, signal, interrupted: Boolean(signal) || interruptedCodes.has(code) }));
    });
    return child;
  }

  async function command(file, args, { signal, stdio = ['ignore', 'pipe', 'pipe'], timeoutMs = 15_000 } = {}) {
    const child = launch(file, args, stdio);
    let output = '', oversized = false;
    child.stdout?.on('data', chunk => {
      if (oversized) return;
      output += chunk;
      if (output.length > 64_000) { oversized = true; output = ''; void stopChild(child).catch(() => {}); }
    });
    child.stderr?.resume();
    let finishAbort, timer;
    const aborted = new Promise(resolve => { finishAbort = resolve; });
    const abort = () => { void stopChild(child).then(() => finishAbort({ code: null, interrupted: Boolean(signal?.aborted), stopFailed: false }), () => finishAbort({ code: null, interrupted: Boolean(signal?.aborted), stopFailed: true })); };
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    if (timeoutMs) timer = setTimeout(abort, timeoutMs);
    try { return { ...await Promise.race([child.finished, aborted]), output, oversized }; }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }

  async function container() {
    const inventory = await command('docker', ['ps', '-a', '--no-trunc', '--filter', `name=${containerName}`, '--format', '{{.ID}} {{.Names}}']);
    if (inventory.code !== 0 || inventory.oversized) throw new Error('Cannot observe local Docker inventory');
    const ids = inventory.output.trim().split('\n').filter(line => line.trim().split(' ')[1] === containerName).map(line => line.trim().split(' ')[0]);
    if (!ids.length) return null;
    if (ids.length !== 1 || !/^[a-f0-9]{64}$/.test(ids[0])) throw new Error('Ambiguous local runtime identity');
    const inspected = await command('docker', ['inspect', '--format', '[{{json .Id}},{{json .Created}},{{json .Mounts}},{{json .State.Running}},{{json .State.Status}}]', ids[0]]);
    if (inspected.code !== 0 || inspected.oversized) throw new Error('Cannot inspect local runtime identity');
    const [id, created, mounts, running, status] = JSON.parse(inspected.output);
    if (id !== ids[0] || !Number.isFinite(Date.parse(created)) || !Array.isArray(mounts) || typeof running !== 'boolean' || typeof status !== 'string') throw new Error('Invalid local runtime metadata');
    // CLI bind destinations vary across hosts; compare the real host source, not a guessed destination.
    const functions = mounts.filter(m => {
      try { return m.Type === 'bind' && realHostBindSource(m.Source) === source; }
      catch { return false; }
    });
    // Emit only our non-secret marker; never inspect or log other environment values.
    const marker = await command('docker', ['inspect', '--format', '{{range .Config.Env}}{{if eq (index (split . "=") 0) "WORKSPACE_RUNTIME_OWNER"}}{{println .}}{{end}}{{end}}', id]);
    if (marker.code !== 0 || marker.oversized) throw new Error('Cannot inspect runtime ownership marker');
    const entries = marker.output.trim().split('\n').filter(Boolean);
    const ownershipToken = entries.length === 1 ? entries[0].trim().slice('WORKSPACE_RUNTIME_OWNER='.length) : null;
    return { id, source: functions.length === 1 ? source : null, running, status, ownershipToken };
  }

  async function observe(signal) {
    const existing = await container();
    let status;
    try { status = (await fetch(api, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(2000)]) : AbortSignal.timeout(2000) })).status; }
    catch { if (signal?.aborted) throw new Error('Local observation interrupted'); }
    if (status === 401) return { state: 'ready', container: existing };
    if (existing) return { state: existing.running || ['created', 'restarting'].includes(existing.status) ? 'starting' : 'failed', container: existing };
    if (status !== undefined && ![502, 503, 404].includes(status)) return { state: 'failed' };
    return { state: 'absent' };
  }

  async function run(check, signal, extra = []) {
    const label = typeof check === 'string' ? check : check.id;
    const args = typeof check === 'string' ? [npm, 'run', '-s', scripts[check], ...extra]
      : check.nodeArgs ?? (check.npmArgs ? [npm, ...check.npmArgs] : [npm, 'run', '-s', check.script, ...(check.args ?? [])]);
    console.log(`\n▶ ${label}`);
    const started = Date.now();
    const result = await command(process.execPath, args, { signal, stdio: 'inherit', timeoutMs: 0 });
    return { code: result.code, signal: result.signal, interrupted: result.interrupted, stopFailed: result.stopFailed, spawnFailed: result.spawnFailed, seconds: Math.round((Date.now() - started) / 1000) };
  }

  return {
    source, log, now: Date.now, observe,
    pause: signal => pause(1000, undefined, { signal }),
    run,
    async prepare(signal) {
      return run('setup', signal, ['--', '--skip-functions']);
    },
    async start() {
      if ((await observe()).state !== 'absent') throw new Error('Runtime appeared before owned launch; left untouched');
      const contents = readFileSync('supabase/functions/.env', 'utf8');
      const directory = mkdtempSync(join(tmpdir(), 'workspace-runtime-'));
      const envFile = join(directory, 'functions.env');
      const ownershipToken = randomUUID();
      const removeEnv = () => { if (existsSync(envFile)) unlinkSync(envFile); rmdirSync(directory); };
      let child, out;
      try {
        chmodSync(directory, 0o700);
        writeFileSync(envFile, `${contents}\nWORKSPACE_RUNTIME_OWNER=${ownershipToken}\n`, { mode: 0o600, flag: 'wx' });
        out = openSync(log, 'wx', 0o600);
        child = launch(process.execPath, [npm, 'exec', '--', 'supabase', 'functions', 'serve', '--env-file', envFile], ['ignore', out, out]);
      }
      catch (error) { removeEnv(); throw error; }
      finally { if (out !== undefined) closeSync(out); }
      child.ownershipToken = ownershipToken;
      child.removeEnv = removeEnv;
      console.log(`\n▶ Edge Functions 실행 (개인 로그: ${log})`);
      return child;
    },
    childRunning: child => Number.isInteger(child.pid) && !child.spawnFailed && child.exitCode === null && child.signalCode === null,
    async stopChild(child) { try { await stopChild(child); } finally { child.removeEnv?.(); } },
    stopContainer: id => removeOwnedContainer(id, command),
  };
}
