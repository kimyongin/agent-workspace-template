import test from 'node:test';
import assert from 'node:assert/strict';
import { removeOwnedContainer } from './local-runtime-cli.mjs';

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
