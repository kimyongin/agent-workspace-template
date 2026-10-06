import test from 'node:test';
import assert from 'node:assert/strict';
import { acquireRuntimeLock, removeOwnedContainer, runLeasedLocalChecks } from './local-runtime-cli.mjs';
import { mkdtempSync, rmdirSync, readdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
