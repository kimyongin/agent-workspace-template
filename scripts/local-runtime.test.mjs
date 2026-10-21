import test from 'node:test';
import assert from 'node:assert/strict';
import { runLocalChecks } from './local-runtime.mjs';

function external(states = [{ state: 'ready' }]) {
  const events = [], child = { pid: 41, startedAt: 100, ownershipToken: 'own' };
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

test('same-source runtime created during setup is foreign despite matching creation time', async () => {
  const foreign = { id: 'foreign', source: '/owned/functions', createdAt: 101, ownershipToken: 'foreign' };
  const adapter = external([{ state: 'absent' }, { state: 'ready', container: foreign }]);
  adapter.prepare = async () => { adapter.events.push('prepare'); return { code: 0, startedAt: 100, createdContainer: foreign }; };
  const result = await runLocalChecks(adapter, { checks: ['DB'], source: '/owned/functions' });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(adapter.events, ['prepare', 'DB']);
});

test('same-source runtime created during serve with a foreign nonce is never cleaned', async () => {
  const foreign = { id: 'foreign', source: '/owned/functions', createdAt: 101, ownershipToken: 'foreign' };
  const adapter = external([{ state: 'absent' }, { state: 'absent' }, { state: 'ready', container: foreign }]);
  adapter.child.ownershipToken = 'own';
  const result = await runLocalChecks(adapter, { checks: ['DB'], source: '/owned/functions' });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(adapter.events, ['prepare', 'start', 'stop-child']);
});

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
  const own = { id: 'new-id', createdAt: 101, source: '/owned/functions', ownershipToken: 'own' };
  const adapter = external([{ state: 'absent' }, { state: 'absent' }, { state: 'ready', container: own }, { state: 'ready', container: own }]);
  const result = await runLocalChecks(adapter, { checks: ['DB'], source: '/owned/functions' });
  assert.equal(result.exitCode, 0);
  assert.equal(result.runtime, 'owned');
  assert.deepEqual(adapter.events, ['prepare', 'start', 'DB', 'stop-child', 'stop-container:new-id']);
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
    const initial = { id: 'one', createdAt: 101, source, ownershipToken: 'own' };
    const final = { id: 'replacement', createdAt: 102, source, ownershipToken: 'own' };
    const adapter = external([{ state: 'absent' }, { state: 'absent' }, { state: 'ready', container: initial }, { state: 'ready', container: final }]);
    const result = await runLocalChecks(adapter, { checks: ['DB'], source: '/owned/functions' });
    assert.equal(result.exitCode, 1);
    assert(adapter.events.includes('stop-child'));
    assert(!adapter.events.some(e => e.startsWith('stop-container:')));
  }
});

test('stage and cleanup failures survive together, and later independent checks still run', async () => {
  const own = { id: 'new', createdAt: 101, source: '/owned/functions', ownershipToken: 'own' };
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
  const own = { id: 'owned', createdAt: 101, source: '/owned/functions', ownershipToken: 'own' };
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

test('failed setup preserves any appearing runtime, while a failed child never respawns', async () => {
  const own = { id: 'prepared', createdAt: 101, source: '/owned/functions', ownershipToken: 'own' };
  const prepared = external([{ state: 'absent' }, { state: 'starting', container: own }]);
  prepared.prepare = async () => ({ code: 7, startedAt: 100, createdContainer: own });
  const failed = await runLocalChecks(prepared, { checks: ['DB'], source: '/owned/functions' });
  assert.equal(failed.exitCode, 1);
  assert.equal(failed.results[0].code, 7);
  assert.deepEqual(prepared.events, []);
  const child = external([{ state: 'absent' }]);
  child.childRunning = () => false;
  const exit = await runLocalChecks(child, { checks: ['DB'], source: '/owned/functions' });
  assert.equal(exit.exitCode, 1);
  assert.deepEqual(child.events, ['prepare', 'start', 'stop-child']);
});

test('failed startup still cleans its nonce-proven container after its child has exited', async () => {
  const own = { id: 'startup', source: '/owned/functions', ownershipToken: 'own' };
  const adapter = external([{ state: 'absent' }, { state: 'absent' }, { state: 'ready', container: own }]);
  adapter.childRunning = () => false;
  const result = await runLocalChecks(adapter, { checks: ['DB'], source: '/owned/functions' });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(adapter.events, ['prepare', 'start', 'stop-child', 'stop-container:startup']);
});

test('owned startup waits for a fresh container proof when readiness races the first Docker observation', async () => {
  const own={id:'raced-start',source:'/owned/functions',ownershipToken:'own'};
  const adapter=external([{state:'absent'},{state:'absent'},{state:'ready',container:null},{state:'ready',container:own}]);
  adapter.pause=async()=>{assert(!adapter.events.includes('DB'));adapter.events.push('wait-proof');};
  const result=await runLocalChecks(adapter,{checks:['DB'],source:'/owned/functions'});
  assert.equal(result.exitCode,0);
  assert.deepEqual(adapter.events,['prepare','start','wait-proof','DB','stop-child','stop-container:raced-start']);
});
test('ready without owned container proof remains bounded and never runs checks or respawns', async () => {
  const adapter=external([{state:'absent'},{state:'absent'},{state:'ready',container:null}]);
  let clock=0;adapter.now=()=>clock;adapter.pause=async()=>{clock+=10;};
  const result=await runLocalChecks(adapter,{checks:['DB'],source:'/owned/functions',timeoutMs:20});
  assert.equal(result.exitCode,1);assert.equal(clock,20);
  assert.deepEqual(adapter.events,['prepare','start','stop-child']);
});
test('ready proof with foreign nonce, missing marker or wrong source is rejected without checks', async () => {
  for(const container of [{id:'foreign',source:'/owned/functions',ownershipToken:'foreign'},
    {id:'unmarked',source:'/owned/functions'},{id:'wrong-source',source:'/other/functions',ownershipToken:'own'}]) {
    const adapter=external([{state:'absent'},{state:'absent'},{state:'ready',container:null},{state:'ready',container}]);
    let waits=0;adapter.pause=async()=>{waits++;};
    const result=await runLocalChecks(adapter,{checks:['DB'],source:'/owned/functions'});
    assert.equal(result.exitCode,1);assert.equal(waits,1);
    assert.deepEqual(adapter.events,['prepare','start','stop-child']);
    assert.equal(result.errors[0].error.message,'New runtime ownership could not be confirmed');
  }
});

test('an earlier owned proof cannot authorize a ready snapshot with a replaced marker or source', async () => {
  const own={id:'same-id',source:'/owned/functions',ownershipToken:'own'};
  for(const changed of [{...own,ownershipToken:'foreign'},{...own,source:'/foreign/functions'}]) {
    const adapter=external([{state:'absent'},{state:'absent'},{state:'starting',container:own},{state:'ready',container:changed}]);
    const result=await runLocalChecks(adapter,{checks:['DB'],source:'/owned/functions'});
    assert.equal(result.exitCode,1);assert.deepEqual(adapter.events,['prepare','start','stop-child']);
  }
});

test('planned runtime stages retain identifiers and actual config at the external command boundary', async () => {
  const adapter = external();
  const stage = { id: 'actual', script: 'test:e2e', args: ['--', '--config', '/isolated/config.ts'] };
  const result = await runLocalChecks(adapter, { checks: [stage] });
  assert.deepEqual(adapter.events, [stage]);
  assert.equal(result.results[0].label, 'actual');
  assert.equal(result.results[0].code, 0);
});

test('a runtime lost after a test failure stops later checks while retaining the original failure', async () => {
  const adapter = external([{ state: 'ready' }, { state: 'failed' }]);
  adapter.run = async label => { adapter.events.push(label); return { code: 19 }; };
  const result = await runLocalChecks(adapter, { checks: ['DB', 'HTTP'] });
  assert.deepEqual(adapter.events, ['DB']);
  assert.equal(result.results[0].code, 19);
  assert.equal(result.exitCode, 1);
  assert.equal(result.errors[0].phase, 'execution');
});

test('setup child cleanup failure is not treated as permission to launch a runtime', async () => {
  const adapter = external([{ state: 'absent' }]);
  adapter.prepare = async () => ({ code: 0, stopFailed: true });
  adapter.start = async () => { adapter.events.push('start'); throw new Error('Unexpected runtime launch'); };
  const result = await runLocalChecks(adapter, { checks: ['DB'] });
  assert.equal(result.exitCode, 1);
  assert.equal(result.results[0].stopFailed, true);
  assert.deepEqual(adapter.events, []);
});

test('an explicit reuse-only runtime never prepares or launches when absent', async () => {
  const adapter = external([{ state: 'absent' }]);
  const result = await runLocalChecks(adapter, { checks: ['DB'], borrowedOnly: true });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(adapter.events, []);
  assert.match(result.errors[0].error.message, /already be running/);
});

test('runtime results separate preparation, checks and cleanup for success, failure and signals', async () => {
  for (const outcome of ['success', 'failed', 'SIGTERM']) {
    const controller = new AbortController(), adapter = external();
    adapter.run = async () => {
      if (outcome === 'SIGTERM') controller.abort('SIGTERM');
      return { code: outcome === 'failed' ? 19 : 0 };
    };
    const result = await runLocalChecks(adapter, { checks: ['DB'], signal: controller.signal });
    assert.equal(result.exitCode, outcome === 'SIGTERM' ? 143 : outcome === 'failed' ? 1 : 0);
    for (const phase of ['preparationMs', 'checksMs', 'cleanupMs', 'totalMs']) assert.ok(result.timings[phase] >= 0, phase);
    assert.equal(result.runtimeObservations[0].state, 'ready');
    assert.equal(result.results[0].code, outcome === 'failed' ? 19 : 0);
  }
});
