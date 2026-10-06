import { spawn, spawnSync } from 'node:child_process';
import { existsSync, openSync, closeSync, realpathSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';

const interruptedCodes = new Set([130, 143, 3221225786, -1073741510]);
const scripts = { setup: 'setup:local', core: 'test:core', DB: 'test:db', HTTP: 'test:http', MCP: 'test:mcp', E2E: 'test:e2e' };

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
export function createLocalRuntimeAdapter(config) {
  const source = realpathSync('supabase/functions');
  const npm = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (!existsSync(npm)) throw new Error('Run through npm run test:all to resolve the npm CLI');
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
      try { process.kill(-child.pid, 'SIGTERM'); }
      catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    let timer;
    try { await Promise.race([child.finished, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Owned child did not exit')), 5000); })]); }
    finally { clearTimeout(timer); }
  }

  function launch(file, args, stdio) {
    const child = spawn(file, args, { shell: false, stdio, detached: process.platform !== 'win32' });
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
    const inspected = await command('docker', ['inspect', '--format', '[{{json .Id}},{{json .Created}},{{json .Mounts}},{{json .State.Running}}]', ids[0]]);
    if (inspected.code !== 0 || inspected.oversized) throw new Error('Cannot inspect local runtime identity');
    const [id, created, mounts, running] = JSON.parse(inspected.output);
    if (id !== ids[0] || !Number.isFinite(Date.parse(created)) || !Array.isArray(mounts) || typeof running !== 'boolean') throw new Error('Invalid local runtime metadata');
    // CLI bind destinations vary across hosts; compare the real host source, not a guessed destination.
    const functions = mounts.filter(m => {
      try { return m.Type === 'bind' && realpathSync(m.Source) === source; }
      catch { return false; }
    });
    return { id, createdAt: Date.parse(created), source: functions.length === 1 ? source : null, running };
  }

  async function observe(signal) {
    const existing = await container();
    let status;
    try { status = (await fetch(api, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(2000)]) : AbortSignal.timeout(2000) })).status; }
    catch { if (signal?.aborted) throw new Error('Local observation interrupted'); }
    if (status === 401) return { state: 'ready', container: existing };
    if (existing) return { state: existing.running ? 'starting' : 'failed', container: existing };
    if (status !== undefined && ![502, 503, 404].includes(status)) return { state: 'failed' };
    return { state: 'absent' };
  }

  async function run(label, signal) {
    console.log(`\n▶ ${label}`);
    const started = Date.now();
    const result = await command(process.execPath, [npm, 'run', '-s', scripts[label]], { signal, stdio: 'inherit', timeoutMs: 0 });
    return { code: result.code, signal: result.signal, interrupted: result.interrupted, stopFailed: result.stopFailed, seconds: Math.round((Date.now() - started) / 1000) };
  }

  return {
    source, log, now: Date.now, observe,
    pause: signal => pause(1000, undefined, { signal }),
    run,
    async prepare(signal) {
      const startedAt = Date.now();
      const result = await run('setup', signal);
      const created = await container();
      return { ...result, startedAt, createdContainer: created?.source === source && created.createdAt >= startedAt ? created : null };
    },
    async start() {
      const out = openSync(log, 'wx', 0o600);
      const startedAt = Date.now();
      let child;
      try { child = launch(process.execPath, [npm, 'run', '-s', 'serve:functions'], ['ignore', out, out]); }
      finally { closeSync(out); }
      child.startedAt = startedAt;
      console.log(`\n▶ Edge Functions 실행 (개인 로그: ${log})`);
      return child;
    },
    childRunning: child => Number.isInteger(child.pid) && !child.spawnFailed && child.exitCode === null && child.signalCode === null,
    stopChild,
    stopContainer: id => removeOwnedContainer(id, command),
  };
}
