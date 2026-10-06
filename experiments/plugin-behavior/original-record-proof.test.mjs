import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasOriginalRecord } from './original-record-proof.mjs';
const source = { id: 'owned-source', body: 'The full original body, not a preview.', version: 3 };
test('canonical get or list payload proves exact full body; search and partial previews do not', () => {
  assert.equal(hasOriginalRecord('get_record', { ...source }, source), true);
  assert.equal(hasOriginalRecord('list_records', [{ type: 'text', text: JSON.stringify({ items: [source] }) }], source), true);
  assert.equal(hasOriginalRecord('search', { items: [source] }, source), false);
  assert.equal(hasOriginalRecord('list_records', { items: [{ ...source, body: 'The full original' }] }, source), false);
  assert.equal(hasOriginalRecord('get_record', { ...source, id: 'other-source' }, source), false);
  assert.equal(hasOriginalRecord('get_record', { ...source, version: 2 }, source), false);
});
