import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPreparationState } from './preparation.mjs';
test('independent proof reads original bodies and detects edits hidden by unchanged previews', async () => {
  let body = 'original';
  const call = async (name) => {
    if (name === 'get_current_principle') return { current: null };
    if (name === 'list_records') return { items: [{ id: 'source' }], next_cursor: null };
    if (name === 'get_record') return { id: 'source', body };
    if (name.startsWith('list_')) return { items: [], next_cursor: null };
    throw new Error('Unexpected public read');
  };
  const before = await readPreparationState(call);
  assert.deepEqual(before, await readPreparationState(call));
  body = 'edited behind the same preview';
  assert.notEqual(before.digest, (await readPreparationState(call)).digest);
});
test('independent proof rejects repeated cursors instead of accepting partial inventory', async () => {
  const call = async name => name === 'get_current_principle' ? { current: null } : { items: [], next_cursor: 'repeated' };
  await assert.rejects(readPreparationState(call), /cursor repeated/);
});

test('current-only original proof never calls retired history inventory and detects current body edits', async () => {
  let body = 'current source'; const calls = [];
  const call = async name => {
    calls.push(name);
    if (name === 'get_current_principle') return { current: { id: 'current', body } };
    if (['list_entities', 'list_tasks', 'list_records', 'list_tags'].includes(name)) return { items: [], next_cursor: null };
    throw new Error('Retired or unexpected read');
  };
  const before = await readPreparationState(call);
  assert.equal(before.counts.principles, 1);
  body = 'edited source';
  assert.notEqual(before.digest, (await readPreparationState(call)).digest);
  assert.equal(calls.includes('list_principles'), false);
  assert.equal(calls.includes('get_principle'), false);
});
