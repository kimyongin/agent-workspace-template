import test from 'node:test';
import assert from 'node:assert/strict';
import { summarize } from './implementation.mjs';
const record = (id, revision, extra = {}) => ({ id, revision, ownerId: 'alice', updatedAt: '2026-01-01T00:00:00Z', deleted: false, ...extra });
test('scope owner before deduplication, hide foreign records', () => {
  const input = [record('a', 1), record('a', 9, { ownerId: 'bob' }), record('b', 1, { ownerId: 'bob' })];
  assert.deepEqual(summarize(input, 'alice'), [input[0]]);
});
test('maximum revision independent of input order and tombstone prevents resurrection', () => {
  const input = [record('a', 3), record('a', 1), record('b', 4, { deleted: true }), record('b', 2)];
  assert.deepEqual(summarize(input, 'alice'), [input[0]]);
  assert.deepEqual(summarize(input.toReversed(), 'alice'), [input[0]]);
});
test('stable updatedAt descending then id ascending; input not mutated', () => {
  const input = [record('z', 1), record('b', 1, { updatedAt: '2026-02-01T00:00:00Z' }), record('a', 1)];
  const before = structuredClone(input);
  assert.deepEqual(summarize(input, 'alice').map(x => x.id), ['b', 'a', 'z']);
  assert.deepEqual(input, before);
});
test('empty owner scope and empty input', () => {
  assert.deepEqual(summarize([record('a', 1)], 'bob'), []);
  assert.deepEqual(summarize([], 'alice'), []);
});
