import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readPreparationState } from './preparation.mjs';
test('independent proof reads original bodies and detects edits hidden by unchanged previews', async () => {
  let body = 'original';
  const call = async (name) => {
    if (name === 'get_current_principle') return { current: null };
    if (name === 'list_records') return { items: [{ id: 'source', summary: 'same preview' }], next_cursor: null };
    if (name === 'get_record') return { id: 'source', summary: 'same preview', body };
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
