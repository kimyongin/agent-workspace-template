import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireRuntimeLock, createLocalRuntimeAdapter, realHostBindSource, removeOwnedContainer, runLeasedLocalChecks } from './local-runtime-cli.mjs';
import { mkdtempSync, rmdirSync, readdirSync, writeFileSync, unlinkSync, realpathSync, chmodSync, rmSync, mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

test('CLI observation waits for a created container but fails an exited container', { skip: process.platform === 'win32' }, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-observe-test-'));
  const executable = join(directory, 'docker'), metadata = join(directory, 'state.json');
  const priorPath = process.env.PATH, priorNpm = process.env.npm_execpath, priorMetadata = process.env.TEST_RUNTIME_METADATA;
  const id = 'a'.repeat(64), projectId = 'created-observation-test';
  const server = createServer((_request, response) => { response.writeHead(503); response.end(); });
  try {
    writeFileSync(executable, `#!${process.execPath}\n` + `
      const fs = require('node:fs');
      const state = JSON.parse(fs.readFileSync(process.env.TEST_RUNTIME_METADATA, 'utf8'));
      const args = process.argv.slice(2);
      if (args[0] === 'ps') console.log(state.id + ' supabase_edge_runtime_created-observation-test');
      else if (args[0] === 'inspect' && args[2].includes('.Config.Env')) console.log('WORKSPACE_RUNTIME_OWNER=fixture');
      else if (args[0] === 'inspect') {
        const fields = [state.id, '2026-10-15T00:00:00Z', [{Type:'bind',Source:state.source}], state.running];
        if (args[2].includes('.State.Status')) fields.push(state.status);
        console.log(JSON.stringify(fields));
      } else process.exit(1);
    `);
    chmodSync(executable, 0o700);
    process.env.PATH = `${directory}:${priorPath}`;
    process.env.npm_execpath = process.execPath;
    process.env.TEST_RUNTIME_METADATA = metadata;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const adapter = createLocalRuntimeAdapter({ projectId, apiUrl: `http://127.0.0.1:${server.address().port}` });
    for (const [status, running, expected] of [
      ['created', false, 'starting'], ['running', true, 'starting'],
      ['restarting', false, 'starting'], ['exited', false, 'failed'], ['dead', false, 'failed'],
    ]) {
      writeFileSync(metadata, JSON.stringify({ id, status, running, source: realpathSync('supabase/functions') }));
      const observed = await adapter.observe();
      assert.equal(observed.state, expected, status);
      assert.equal(observed.container.id, id);
      assert.equal(observed.container.ownershipToken, 'fixture');
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [key, prior] of [['PATH', priorPath], ['npm_execpath', priorNpm], ['TEST_RUNTIME_METADATA', priorMetadata]]) {
      if (prior === undefined) delete process.env[key]; else process.env[key] = prior;
    }
    rmSync(directory, { recursive: true });
  }
});

test('native host bind sources resolve to the existing host directory', () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-bind-test-'));
  try { assert.equal(realHostBindSource(directory), realpathSync(directory)); }
  finally { rmdirSync(directory); }
});

test('Docker Desktop Windows bind bridge resolves the actual drive directory and rejects guessed traversal', { skip: process.platform !== 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-bind-test-'));
  const canonical = realpathSync(directory);
  const bridge = `/run/desktop/mnt/host/${canonical[0].toLowerCase()}/${canonical.slice(3).replaceAll('\\', '/')}`;
  try {
    assert.equal(realHostBindSource(bridge), canonical);
    assert.throws(() => realHostBindSource(`${bridge}/../${canonical.split('\\').at(-1)}`));
    assert.throws(() => realHostBindSource(bridge.replace('/host/', '/guessed/')));
  } finally { rmdirSync(directory); }
});

test('Docker Desktop macOS Users bridge resolves the actual directory and rejects guessed traversal', { skip: process.platform !== 'darwin' }, () => {
  const canonical = realpathSync(homedir());
  assert.ok(canonical.startsWith('/Users/'), 'fixture must use a real macOS Users directory');
  const bridge = `/host_mnt${canonical}`;
  assert.equal(realHostBindSource(bridge), canonical);
  assert.throws(() => realHostBindSource(`${bridge}/../${canonical.split('/').at(-1)}`));
  assert.throws(() => realHostBindSource(bridge.replace('/host_mnt/', '/guessed/')));
  assert.throws(() => realHostBindSource(bridge.replace('/Users/', '/Users//')));
  assert.throws(() => realHostBindSource(`${bridge}/missing-runtime-bind-directory`));
});

test('Docker Desktop macOS private temporary bridge resolves only an actual directory', { skip: process.platform !== 'darwin' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-bind-test-'));
  try {
    const canonical = realpathSync(directory);
    assert.ok(canonical.startsWith('/private/'), 'fixture must use an actual macOS private temporary directory');
    const bridge = `/host_mnt${canonical}`;
    assert.equal(realHostBindSource(bridge), canonical);
    assert.throws(() => realHostBindSource(`${bridge}/../${canonical.split('/').at(-1)}`));
    assert.throws(() => realHostBindSource(bridge.replace('/private/', '/private//')));
    assert.throws(() => realHostBindSource(`${bridge}/missing-runtime-bind-directory`));
  } finally { rmdirSync(directory); }
});

test('concurrent same-project runners cannot acquire while unrelated projects and a later run can', () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-lock-test-'));
  const release = acquireRuntimeLock('same', directory);
  try {
    assert.throws(() => acquireRuntimeLock('same', directory), { code: 'EEXIST' });
    acquireRuntimeLock('other', directory)();
  } finally { release(); }
  acquireRuntimeLock('same', directory)();
  rmdirSync(directory);
});

test('a replaced lease is preserved rather than deleted by the previous holder', () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-lock-test-'));
  const release = acquireRuntimeLock('same', directory);
  const path = join(directory, readdirSync(directory)[0]);
  writeFileSync(path, 'another-owner');
  assert.throws(release, /identity changed/);
  assert.throws(() => acquireRuntimeLock('same', directory), { code: 'EEXIST' });
  unlinkSync(path); rmdirSync(directory);
});

test('CLI lifecycle releases its actual lease after setup failure or interruption, and contention never observes Docker', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-lock-test-'));
  const config = { projectId: 'project', apiUrl: 'http://127.0.0.1:12345' };
  for (const interrupted of [false, true]) {
    const controller = new AbortController();
    const adapter = { source: '/source', observe: async () => ({ state: 'absent' }), prepare: async () => {
      if (interrupted) controller.abort('SIGTERM');
      return { code: 7 };
    } };
    const result = await runLeasedLocalChecks(config, { checks: [], signal: controller.signal }, adapter, directory);
    assert.equal(result.exitCode, interrupted ? 143 : 1);
    assert.deepEqual(readdirSync(directory), []);
  }
  const release = acquireRuntimeLock(`${config.projectId}:${config.apiUrl}`, directory);
  try {
    await assert.rejects(runLeasedLocalChecks(config, { checks: [] }, {
      observe: () => { assert.fail('busy runner must not observe or mutate Docker'); },
    }, directory), { code: 'EEXIST' });
  } finally { release(); rmdirSync(directory); }
});

test('lease cleanup failure retains stage and owned cleanup failures plus interrupt status', async () => {
  for (const signal of [undefined, 'SIGINT', 'SIGTERM']) {
    const directory = mkdtempSync(join(tmpdir(), 'runtime-lock-test-'));
    const controller = new AbortController();
    const cleanupFailure = new Error('owned cleanup failed');
    const own = { id: 'owned', source: '/source', ownershipToken: 'nonce' };
    const states = [{ state: 'absent' }, { state: 'absent' }, { state: 'ready', container: own }];
    const adapter = {
      source: '/source', now: () => 0, childRunning: () => true,
      observe: async () => states.length > 1 ? states.shift() : states[0],
      prepare: async () => ({ code: 0 }), start: async () => ({ ownershipToken: 'nonce' }),
      run: async () => {
        writeFileSync(join(directory, readdirSync(directory)[0]), 'foreign-owner');
        if (signal) controller.abort(signal);
        return { code: 9 };
      },
      stopChild: async () => { throw cleanupFailure; }, stopContainer: async () => {},
    };
    try {
      const result = await runLeasedLocalChecks({ projectId: 'project', apiUrl: 'http://127.0.0.1:12345' },
        { checks: ['DB'], signal: controller.signal }, adapter, directory);
      assert.deepEqual(result.results.map(stage => [stage.label, stage.code]), [['setup', 0], ['DB', 9]]);
      assert.equal(result.errors[0].error, cleanupFailure);
      assert.equal(result.errors.at(-1).phase, 'lease-cleanup');
      assert.equal(result.exitCode, signal === 'SIGINT' ? 130 : signal === 'SIGTERM' ? 143 : 1);
      assert.equal(readdirSync(directory).length, 1);
    } finally {
      for (const name of readdirSync(directory)) unlinkSync(join(directory, name));
      rmdirSync(directory);
    }
  }
});

test('otherwise successful checks fail when their lease cannot be released', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-lock-test-'));
  try {
    const result = await runLeasedLocalChecks({ projectId: 'project', apiUrl: 'http://127.0.0.1:12345' }, { checks: ['DB'] }, {
      now: () => 0, observe: async () => ({ state: 'ready' }), run: async () => {
        writeFileSync(join(directory, readdirSync(directory)[0]), 'foreign-owner');
        return { code: 0 };
      },
    }, directory);
    assert.equal(result.results[0].code, 0);
    assert.equal(result.exitCode, 1);
    assert.equal(result.errors[0].phase, 'lease-cleanup');
  } finally {
    for (const name of readdirSync(directory)) unlinkSync(join(directory, name));
    rmdirSync(directory);
  }
});

test('failure before a run result and failed lease cleanup preserve both errors without inventing stages', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'runtime-lock-test-'));
  const original = new Error('adapter configuration unavailable');
  try {
    await assert.rejects(runLeasedLocalChecks({ projectId: 'project', apiUrl: 'http://127.0.0.1:12345' }, { checks: [] }, {
      get source() {
        writeFileSync(join(directory, readdirSync(directory)[0]), 'foreign-owner');
        throw original;
      },
    }, directory), error => {
      assert(error instanceof AggregateError);
      assert.equal(error.errors[0], original);
      assert.match(error.errors[1].message, /lease identity changed/);
      return true;
    });
  } finally {
    for (const name of readdirSync(directory)) unlinkSync(join(directory, name));
    rmdirSync(directory);
  }
});

test('owned Docker stop retains the container, and exact-ID removal makes a subsequent acquisition possible', async () => {
  let exists = true, running = true;
  const calls = [];
  const docker = async (file, args) => {
    assert.equal(file, 'docker'); calls.push(args);
    if (args[0] === 'ps') return { code: 0, output: exists ? 'owned-id\n' : '' };
    if (args[0] === 'stop') { running = false; return { code: 0 }; }
    if (args[0] === 'rm') { assert.equal(running, false); exists = false; return { code: 0 }; }
    throw new Error('Unexpected Docker command');
  };
  await removeOwnedContainer('owned-id', docker);
  assert.equal(exists, false);
  assert.deepEqual(calls.filter(c => ['stop', 'rm'].includes(c[0])), [['stop', 'owned-id'], ['rm', 'owned-id']]);
});

test('mismatching inventory and failed stop never permit removal', async () => {
  for (const mismatch of [true, false]) {
    const calls = [];
    const docker = async (_, args) => {
      calls.push(args);
      return args[0] === 'ps' ? { code: 0, output: mismatch ? 'other-id' : 'owned-id' } : { code: 1 };
    };
    await assert.rejects(removeOwnedContainer('owned-id', docker));
    assert(!calls.some(args => args[0] === 'rm'));
  }
});

test('a container already removed by its owning CLI needs no further teardown', async () => {
  const calls = [];
  await removeOwnedContainer('owned-id', async (_, args) => { calls.push(args); return { code: 0, output: '' }; });
  assert.equal(calls.length, 1);
});

test('planned subprocess sends the exact actual config and retains its original exit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'planned-command-'));
  const npm = join(directory, 'npm.mjs'), output = join(directory, 'args.json');
  const priorNpm = process.env.npm_execpath;
  try {
    writeFileSync(npm, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify(process.argv.slice(2))); process.exitCode = 17;`);
    process.env.npm_execpath = npm;
    const adapter = createLocalRuntimeAdapter({ projectId: 'unused', apiUrl: 'http://127.0.0.1:1' });
    const result = await adapter.run({ id: 'actual', script: 'test:e2e', args: ['--', '--config', '/isolated/config.ts'] });
    assert.equal(result.code, 17);
    assert.deepEqual(JSON.parse((await import('node:fs')).readFileSync(output, 'utf8')), ['run', '-s', 'test:e2e', '--', '--config', '/isolated/config.ts']);
  } finally {
    if (priorNpm === undefined) delete process.env.npm_execpath; else process.env.npm_execpath = priorNpm;
    rmSync(directory, { recursive: true });
  }
});

test('explicit runtime command uses its single env file and scoped child environment', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'planned-env-'));
  const npm = join(directory, 'npm.mjs'), output = join(directory, 'args.json');
  try {
    writeFileSync(npm, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify({args:process.argv.slice(2),api:process.env.VITE_SUPABASE_URL}));`);
    const adapter = createLocalRuntimeAdapter({ projectId: 'unused', apiUrl: 'http://127.0.0.1:1' }, {
      env: { ...process.env, npm_execpath: npm, VITE_SUPABASE_URL: 'http://127.0.0.1:62121' },
    });
    const result = await adapter.run({ id: 'db', npmArgs: ['exec', '--', 'deno', 'test', '--env-file=/isolated/env', 'supabase/tests/database'] });
    assert.equal(result.code, 0);
    assert.deepEqual(JSON.parse((await import('node:fs')).readFileSync(output, 'utf8')), {
      args: ['exec', '--', 'deno', 'test', '--env-file=/isolated/env', 'supabase/tests/database'], api: 'http://127.0.0.1:62121',
    });
  } finally { rmSync(directory, { recursive: true }); }
});

test('stage resource measurement reports sampled process-tree RSS units and failures without inventing zero usage', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'stage-metrics-'));
  const npm = join(directory, 'npm.mjs');
  try {
    writeFileSync(npm, 'await new Promise(resolve => setTimeout(resolve, 150));');
    const adapter = createLocalRuntimeAdapter({ projectId: 'unused', apiUrl: 'http://127.0.0.1:1' }, { env: { ...process.env, npm_execpath: npm } });
    const result = await adapter.run({ id: 'core', script: 'test:core' });
    assert.equal(result.code, 0);
    assert.ok(result.elapsedMs >= 150);
    assert.equal(result.resources.unit, 'KiB');
    assert.equal(result.resources.intervalMs, 1000);
    assert.match(result.resources.target, /child process tree/);
    if (result.resources.samples.length) assert.ok(result.resources.maxSampledRssKiB > 0);
    else { assert.equal(result.resources.maxSampledRssKiB, null); assert.ok(result.resources.failures > 0); }
  } finally { rmSync(directory, { recursive: true }); }
});

test('owned fixture handoff is scoped to checks, rejects a second owner and cleans the exact child', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fixture-handoff-'));
  const npm = join(directory, 'npm.mjs'), output = join(directory, 'handoff.json');
  const { readFileSync } = await import('node:fs');
  const previousDirectory = process.cwd();
  mkdirSync(join(directory, 'supabase/functions'), { recursive: true });
  mkdirSync(join(directory, 'scripts'));
  writeFileSync(join(directory, 'scripts/fixture-web-server.mjs'), `process.send({ready:'settings-model',pid:process.pid}); setInterval(() => {}, 1000);`);
  process.chdir(directory);
  let server;
  const adapter = createLocalRuntimeAdapter({ projectId: 'unused', apiUrl: 'http://127.0.0.1:1' }, {
    env: { ...process.env, npm_execpath: npm },
  });
  try {
    writeFileSync(npm, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(output)}, JSON.stringify({group:process.env.WORKSPACE_FIXTURE_WEB_SERVER_GROUP,pid:process.env.WORKSPACE_FIXTURE_WEB_SERVER_PID})); process.exitCode=19;`);
    server = await adapter.startFixtureWebServer();
    await assert.rejects(adapter.startFixtureWebServer(), { code: 'EEXIST' });
    const result = await adapter.run({ id: 'fixture', script: 'test:e2e' }, undefined, { fixtureServer: server });
    assert.equal(result.code, 19);
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), { group: 'settings-model', pid: String(server.child.pid) });
    const resources = await adapter.stopFixtureWebServer(server);
    assert.equal(adapter.childRunning(server.child), false);
    assert.equal(resources.unit, 'KiB');
    await assert.rejects(adapter.run({ id: 'fixture' }, undefined, { fixtureServer: server }), /exited before/);
    server = undefined;
    await adapter.run({ id: 'ordinary', script: 'test:core' });
    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), {});
    const controller = new AbortController(); controller.abort('SIGTERM');
    await assert.rejects(adapter.startFixtureWebServer(controller.signal), /interrupted/);
    server = await adapter.startFixtureWebServer();
  } finally {
    if (server) await adapter.stopFixtureWebServer(server);
    process.chdir(previousDirectory);
    rmSync(directory, { recursive: true });
  }
});

test('fixture startup rejection releases its lease and leaves an unrelated HTTP server untouched', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fixture-start-failure-'));
  const previousDirectory = process.cwd();
  const existing = createServer((_request, response) => response.end('existing owner'));
  mkdirSync(join(directory, 'supabase/functions'), { recursive: true });
  mkdirSync(join(directory, 'scripts'));
  writeFileSync(join(directory, 'scripts/fixture-web-server.mjs'), 'process.exit(7);');
  process.chdir(directory);
  const adapter = createLocalRuntimeAdapter({ projectId: 'unused', apiUrl: 'http://127.0.0.1:1' });
  await new Promise(resolve => existing.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(adapter.startFixtureWebServer(), error => /failed to start/.test(error.message) && error.code === 7);
    assert.equal(await (await fetch(`http://127.0.0.1:${existing.address().port}`)).text(), 'existing owner');
    await assert.rejects(adapter.startFixtureWebServer(), /failed to start/);
  } finally {
    await new Promise(resolve => existing.close(resolve));
    process.chdir(previousDirectory);
    rmSync(directory, { recursive: true });
  }
});

test('fixture preparation interruption stops its newly launched child and preserves a later clean acquisition', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'fixture-start-interruption-'));
  const previousDirectory = process.cwd();
  const marker = join(directory, 'child.pid');
  const { readFileSync, existsSync } = await import('node:fs');
  mkdirSync(join(directory, 'supabase/functions'), { recursive: true });
  mkdirSync(join(directory, 'scripts'));
  writeFileSync(join(directory, 'scripts/fixture-web-server.mjs'), `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, String(process.pid)); setInterval(() => {}, 1000);`);
  process.chdir(directory);
  const adapter = createLocalRuntimeAdapter({ projectId: 'unused', apiUrl: 'http://127.0.0.1:1' });
  const controller = new AbortController();
  try {
    const started = adapter.startFixtureWebServer(controller.signal);
    const rejected = assert.rejects(started, /interrupted/);
    for (let attempt = 0; attempt < 100 && !existsSync(marker); attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(existsSync(marker), 'fixture child must launch before interruption');
    const pid = Number(readFileSync(marker, 'utf8'));
    controller.abort('SIGINT');
    await rejected;
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    const release = acquireRuntimeLock('fixture-web:127.0.0.1:56883'); release();
  } finally {
    controller.abort('SIGINT');
    process.chdir(previousDirectory);
    rmSync(directory, { recursive: true });
  }
});
