import test from 'node:test';
import assert from 'node:assert/strict';
import { observeSearch, searchProofForTarget } from './search-proof.mjs';
test('completed keyword body reflection is distinct from semantic indexing and preserves no query or snippets', () => {
  const correction = '검토 메모 정정 01234567-89ab-cdef-0123-456789abcdef';
  const page = { items: [{ id: 'target', kind: 'record', match: 'keyword', index_state: 'pending', title: 'private', summary: 'private' }], search_state: 'keyword_fallback', semantic_coverage: { pending: 1, excluded: 0 } };
  const observed = observeSearch({ query: '01234567-89ab-cdef-0123-456789abcdef', mode: 'keyword' }, { structuredContent: page }, correction);
  const proof = searchProofForTarget(observed, 'target');
  assert.equal(proof.correctionQueried, true);
  assert.equal(proof.targetMatched, true);
  assert.deepEqual(proof.targetMatches, [{ match: 'keyword', index_state: 'pending' }]);
  assert.equal(proof.search_state, 'keyword_fallback');
  assert.equal(searchProofForTarget(observed, 'other').targetMatched, false);
  assert.equal(JSON.stringify(proof).includes('private'), false);
  assert.equal(JSON.stringify(proof).includes('01234567-89ab'), false);
  assert.equal(observeSearch({ query: 'x' }, { isError: true, structuredContent: page }, correction), null);
  assert.equal(observeSearch({ query: 'x' }, { structuredContent: { items: page.items } }, correction), null);
});
