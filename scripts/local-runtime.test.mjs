import test from 'node:test';
import assert from 'node:assert/strict';
import { runLocalChecks } from './local-runtime.mjs';

function external(states = [{ state: 'ready' }]) {
  const events = [], child = { pid: 41, startedAt: 100 };
  return { events, child,
    now: () => 100,
    pause: async () => {},
    observe: async () => states.length > 1 ? states.shift() : states[0],
    prepare: async () => { events.push('prepare'); return { code: 0 }; },
    start: async () => { events.push('start'); return child; },
    childRunning: () => true,
    stopChild: async () => { events.push('stop-child'); },
    stopContainer: async id => { events.push(`stop-container:${id}`); },
    run: async label => { events.push(label); return { code: 0 }; },
  };
}

test('ready borrowed runtime is used without setup, spawning or cleanup', async () => {
  const adapter = external();
  const result = await runLocalChecks(adapter, { checks: ['core', 'DB'], source: '/owned/functions' });
  assert.equal(result.exitCode, 0);
  assert.equal(result.runtime, 'borrowed');
  assert.deepEqual(adapter.events, ['core', 'DB']);
});

test('starting borrowed runtime waits for readiness, and a failed preparation never spawns over it', async () => {
  const adapter = external([{ state: 'starting' }, { state: 'ready' }]);
  const success = await runLocalChecks(adapter, { checks: ['DB'], source: '/owned/functions' });
  assert.equal(success.exitCode, 0);
  assert.deepEqual(adapter.events, ['DB']);
  const failed = external([{ state: 'starting' }, { state: 'failed' }]);
  const result = await runLocalChecks(failed, { checks: ['DB'], source: '/owned/functions' });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(failed.events, []);
});

test('a new runtime is prepared, checked and cleaned by its exact creation identity', async () => {
  const own = { id: 'new-id', createdAt: 101, source: '/owned/functions' };
  const adapter = external([{ state: 'absent' }, { state: 'absent' }, { state: 'ready', container: own }, { state: 'ready', container: own }]);
  const result = await runLocalChecks(adapter, { checks: ['DB'], source: '/owned/functions' });
  assert.equal(result.exitCode, 0);
  assert.equal(result.runtime, 'owned');
  assert.deepEqual(adapter.events, ['prepare', 'start', 'DB', 'stop-child', 'stop-container:new-id']);
});

test('setup-created Edge runtime is replaced only by exact ID after completed environment preparation', async () => {
  const setup = { id: 'setup-id', createdAt: 101, source: '/owned/functions' };
  const serve = { id: 'serve-id', createdAt: 102, source: '/owned/functions' };
  const adapter = external([{ state: 'absent' }, { state: 'starting', container: setup }, { state: 'absent' }, { state: 'ready', container: serve }, { state: 'ready', container: serve }]);
  adapter.prepare = async () => { adapter.events.push('prepare'); return { code: 0, startedAt: 100, createdContainer: setup }; };
  const result = await runLocalChecks(adapter, { checks: ['DB'], source: '/owned/functions' });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(adapter.events, ['prepare', 'stop-container:setup-id', 'start', 'DB', 'stop-child', 'stop-container:serve-id']);
});

test('a runtime appearing independently during setup is borrowed rather than replaced', async () => {
  const adapter = external([{ state: 'absent' }, { state: 'ready', container: { id: 'other-id' } }]);
  const result = await runLocalChecks(adapter, { checks: ['DB'], source: '/owned/functions' });
  assert.equal(result.exitCode, 0);
  assert.equal(result.runtime, 'borrowed');
  assert.deepEqual(adapter.events, ['prepare', 'DB']);
});

test('failed setup stops before launch and leaves existing runtimes alone', async () => {
  const adapter = external([{ state: 'absent' }]);
  adapter.prepare = async () => ({ code: 7 });
  const result = await runLocalChecks(adapter, { checks: ['DB'], source: '/owned/functions' });
  assert.equal(result.exitCode, 1);
  assert.equal(result.results[0].code, 7);
  assert.deepEqual(adapter.events, []);
});

test('readiness timeout never starts over or stops a borrowed runtime', async () => {
  const adapter = external([{ state: 'starting', container: { id: 'borrowed' } }]);
  let clock = 0;
  adapter.now = () => clock;
  adapter.pause = async () => { clock += 10; };
  const result = await runLocalChecks(adapter, { checks: ['DB'], timeoutMs: 20 });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(adapter.events, []);
});

test('unproven source and changed identities cannot authorize container cleanup', async () => {
  for (const source of ['/another/functions', '/owned/functions']) {
    const initial = { id: 'one', createdAt: 101, source };
    const final = { id: 'replacement', createdAt: 102, source };
    const adapter = external([{ state: 'absent' }, { state: 'absent' }, { state: 'ready', container: initial }, { state: 'ready', container: final }]);
    const result = await runLocalChecks(adapter, { checks: ['DB'], source: '/owned/functions' });
    assert.equal(result.exitCode, 1);
    assert(adapter.events.includes('stop-child'));
    assert(!adapter.events.some(e => e.startsWith('stop-container:')));
  }
});

test('stage and cleanup failures survive together, and later independent checks still run', async () => {
  const own = { id: 'new', createdAt: 101, source: '/owned/functions' };
  const adapter = external([{ state: 'absent' }, { state: 'absent' }, { state: 'ready', container: own }, { state: 'ready', container: own }]);
  adapter.run = async label => ({ code: label === 'DB' ? 9 : 0 });
  const original = new Error('cleanup unavailable');
  adapter.stopContainer = async () => { throw original; };
  const result = await runLocalChecks(adapter, { checks: ['DB', 'HTTP'], source: '/owned/functions' });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(result.results.map(r => [r.label, r.code]), [['setup', 0], ['DB', 9], ['HTTP', 0]]);
  assert.equal(result.errors[0].error, original);
});

test('SIGINT and SIGTERM skip subsequent checks and never clean borrowed servers', async () => {
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const controller = new AbortController(), adapter = external();
    adapter.run = async label => { adapter.events.push(label); controller.abort(signal); return { code: 9 }; };
    const result = await runLocalChecks(adapter, { checks: ['DB', 'HTTP'], signal: controller.signal });
    assert.equal(result.exitCode, signal === 'SIGINT' ? 130 : 143);
    assert.equal(result.results[0].code, 9);
    assert.deepEqual(adapter.events, ['DB']);
  }
});

test('interrupted owned execution cleans only its child/container and retains cleanup failures', async () => {
  const own = { id: 'owned', createdAt: 101, source: '/owned/functions' };
  const adapter = external([{ state: 'absent' }, { state: 'absent' }, { state: 'ready', container: own }, { state: 'ready', container: own }]);
  const controller = new AbortController();
  adapter.run = async () => { controller.abort('SIGINT'); return { code: 130, interrupted: true }; };
  adapter.stopChild = async () => { throw new Error('Owned child cleanup failed'); };
  const result = await runLocalChecks(adapter, { checks: ['DB', 'HTTP'], source: '/owned/functions', signal: controller.signal });
  assert.equal(result.exitCode, 130);
  assert.equal(result.results.at(-1).code, 130);
  assert.equal(result.errors[0].phase, 'child-cleanup');
  assert(adapter.events.includes('stop-container:owned'));
});

test('failed setup still removes its proven new runtime, while a failed child never respawns', async () => {
  const own = { id: 'prepared', createdAt: 101, source: '/owned/functions' };
  const prepared = external([{ state: 'absent' }, { state: 'starting', container: own }]);
  prepared.prepare = async () => ({ code: 7, startedAt: 100, createdContainer: own });
  const failed = await runLocalChecks(prepared, { checks: ['DB'], source: '/owned/functions' });
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.results[0].code, 7);
  assert.deepEqual(prepared.events, ['stop-container:prepared']);
  const child = external([{ state: 'absent' }]);
  child.childRunning = () => false;
  const exit = await runLocalChecks(child, { checks: ['DB'], source: '/owned/functions' });
  assert.equal(exit.exitCode, 1);
  assert.deepEqual(child.events, ['prepare', 'start', 'stop-child']);
});
