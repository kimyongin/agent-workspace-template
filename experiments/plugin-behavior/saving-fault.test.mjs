import test from 'node:test';
import assert from 'node:assert/strict';
import { savingFaultAdapter } from './saving-fault.mjs';
const create = (request_id = 'same-request') => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_record', arguments: { request_id, title: 'review', body: 'owned' } } });
const success = { jsonrpc: '2.0', id: 1, result: { structuredContent: { id: 'record', version: 1 }, content: [] } };
test('an invalid public request may be corrected before a successful write locks the lost-response input', async () => {
  const adapter = savingFaultAdapter('save-response-loss');
  const invalid = { ...create(), params: { ...create().params, arguments: { ...create().params.arguments, title: '' } } };
  const rejected = { jsonrpc: '2.0', id: 1, result: { isError: true, structuredContent: { code: 'invalid_input', message: 'Title is required', retryable: false }, content: [] } };
  assert.equal(await adapter.call(invalid, async () => rejected), rejected);
  assert.equal(adapter.evidence().requestIdHash, null);
  let forwarded = 0;
  const forward = async () => { forwarded++; return success; };
  assert.equal((await adapter.call(create('corrected-request'), forward)).result.isError, true);
  assert.equal(forwarded, 1);
  assert.equal(adapter.evidence().injected, 1);
  assert.equal(adapter.evidence().inputChanged, false);
  assert.equal((await adapter.call(create('new-after-commit'), forward)).result.isError, true);
  assert.equal(forwarded, 1);
  assert.equal(adapter.evidence().inputChanged, true);
});
test('prewrite public failure never reaches upstream and remains fail-closed on retry', async () => {
  const adapter = savingFaultAdapter('save-failure'); let forwarded = 0;
  const forward = async () => { forwarded++; return success; };
  assert.equal((await adapter.call(create(), forward)).result.isError, true);
  assert.equal((await adapter.call(create(), forward)).result.isError, true);
  assert.equal(forwarded, 0);
  assert.equal(adapter.evidence().injected, 1);
  assert.equal(adapter.evidence().sameInputRetry, false, 'the initial request is not a replay');
  assert.equal(adapter.evidence().replayCalls, 0);
});
test('lost committed response requires original content or an identical keyed replay, never a different request', async () => {
  const adapter = savingFaultAdapter('save-response-loss'); let upstream = 0;
  const forward = async () => { upstream++; return success; };
  assert.equal((await adapter.call(create(), forward)).result.isError, true);
  assert.equal(adapter.evidence().injected, 1);
  const read = { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'get_record', arguments: { id: 'record' } } };
  await adapter.call(read, async () => success);
  assert.equal(adapter.evidence().originalConfirmation, false, 'an ID without the original body cannot confirm the write');
  await adapter.call(read, async () => ({ ...success, result: { structuredContent: { id: 'record', version: 1, body: 'owned' } } }));
  assert.equal(adapter.evidence().originalConfirmation, true);
  assert.equal((await adapter.call(create('changed-request'), forward)).result.isError, true);
  assert.equal(upstream, 1);
  assert.equal(adapter.evidence().sameInputRetry, false);
  assert.match(adapter.evidence().requestIdHash, /^[a-f0-9]{64}$/);
});

test('actual identical keyed replay is reported separately from read-only recovery', async () => {
  const adapter = savingFaultAdapter('save-response-loss');
  await adapter.call(create(), async () => success);
  await adapter.call(create(), async () => success);
  assert.equal(adapter.evidence().replayCalls, 1);
  assert.equal(adapter.evidence().sameInputRetry, true);
  assert.equal(adapter.evidence().originalReadConfirmation, false);
});
