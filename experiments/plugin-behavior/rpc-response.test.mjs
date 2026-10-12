import test from 'node:test';
import assert from 'node:assert/strict';
import { readRpcReply } from './rpc-response.mjs';
import { savingFaultAdapter } from './saving-fault.mjs';
const reply = { jsonrpc: '2.0', id: 7, result: { structuredContent: { id: 'owned-record', version: 1, body: 'owned' }, content: [] } };
const json = () => new Response(JSON.stringify(reply), { headers: { 'content-type': 'application/json' } });
const sse = () => new Response(': keepalive\r\nevent: message\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\r\n\r\nevent: message\r\ndata: ' + JSON.stringify(reply) + '\r\n\r\n', { headers: { 'content-type': 'text/event-stream' } });
test('JSON and SSE yield the same correlated public reply before fault injection', async () => {
  assert.deepEqual(await readRpcReply(json(), 7), reply);
  assert.deepEqual(await readRpcReply(sse(), 7), reply);
  const frame = new TextEncoder().encode('event: message\r\ndata: {"jsonrpc":"2.0",\r\ndata: "id":7,"result":{"structuredContent":{"body":"소유"}}}\r\n\r\n');
  const chunked = new Response(new ReadableStream({ start(controller) { for (let i = 0; i < frame.length; i += 7) controller.enqueue(frame.slice(i, i + 7)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
  assert.equal((await readRpcReply(chunked, 7)).result.structuredContent.body, '소유');
  for (const response of [json, sse]) {
    const adapter = savingFaultAdapter('save-response-loss');
    const rpc = { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'create_record', arguments: { body: 'owned', request_key: '00000000-0000-4000-8000-000000000001' } } };
    assert.equal((await adapter.call(rpc, () => readRpcReply(response(), rpc.id))).result.isError, true);
    assert.equal(adapter.evidence().injected, 1);
    assert.equal(adapter.evidence().upstreamMutations, 1);
  }
});
test('malformed, unmatched, oversized or stalled SSE cannot stand in for a tool reply', async () => {
  await assert.rejects(readRpcReply(sse(), 99));
  await assert.rejects(readRpcReply(new Response('data: not-json\n\n', { headers: { 'content-type': 'text/event-stream' } }), 7));
  await assert.rejects(readRpcReply(sse(), 7, { maxBytes: 10 }));
  let canceled = false;
  const stalled = new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  await assert.rejects(readRpcReply(stalled, 7, { timeoutMs: 20 }));
  assert.equal(canceled, true);
  const control = new AbortController();
  const external = new Response(new ReadableStream({ cancel() { canceled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  canceled = false; control.abort();
  await assert.rejects(readRpcReply(external, 7, { signal: control.signal }));
  assert.equal(canceled, true);
});

test('valid large entity pages survive JSON and SSE text plus structured MCP envelopes', async () => {
  // Five valid 4096-character Korean fields fit the 64 KiB properties contract.
  const properties = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`prop_${i + 1}`, '한'.repeat(4096)]));
  const page = { items: Array.from({ length: 100 }, (_, i) => ({ id: `app:${i}`, display_properties: properties })), next_cursor: 'remaining-page' };
  const large = { jsonrpc: '2.0', id: 7, result: { content: [{ type: 'text', text: JSON.stringify(page) }], structuredContent: page } };
  assert.ok(Buffer.byteLength(JSON.stringify(large)) > 1048576);
  for (const [type, body] of [['application/json', JSON.stringify(large)], ['text/event-stream', `event: message\ndata: ${JSON.stringify(large)}\n\n`]]) {
    const actual = await readRpcReply(new Response(body, { headers: { 'content-type': type } }), 7);
    assert.equal(actual.result.structuredContent.items.length, 100);
    assert.equal(actual.result.structuredContent.items[99].display_properties.prop_5, '한'.repeat(4096));
    assert.equal(actual.result.structuredContent.next_cursor, 'remaining-page');
    assert.deepEqual(JSON.parse(actual.result.content[0].text), page);
  }
});
