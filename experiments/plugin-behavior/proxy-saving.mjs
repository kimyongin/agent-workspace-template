// Root-allocated local transport fault. Never start without exclusive handoff.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { savingFaultAdapter } from './saving-fault.mjs';
import { readRpcReply } from './rpc-response.mjs';
const [mode, port, upstreamText] = process.argv.slice(2);
if (process.env.PLUGIN_ENV_HANDOFF !== 'exclusive-local' || port !== '55685' || upstreamText !== 'http://127.0.0.1:55621/functions/v1/mcp') throw new Error('Only allocated #123 loopback55685/upstream55621');
const adapter = savingFaultAdapter(mode), upstream = new URL(upstreamText), instance = randomUUID();
const sourceSha256 = createHash('sha256').update(readFileSync(new URL(import.meta.url))).update(readFileSync(new URL('./saving-fault.mjs', import.meta.url))).update(readFileSync(new URL('./rpc-response.mjs', import.meta.url))).digest('hex');
const server = createServer(async (request, response) => {
  try {
    if (request.method === 'GET' && request.url === '/saving-evidence') { response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...adapter.evidence(), instance, sourceSha256 })); return; }
    if (request.url !== '/functions/v1/mcp') { response.writeHead(404).end(); return; }
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 1048576) { response.writeHead(413).end(); return; } chunks.push(chunk); }
    const body = Buffer.concat(chunks).toString(), rpc = body ? JSON.parse(body) : null;
    const headers = { ...request.headers }; for (const name of ['host', 'content-length', 'connection', 'transfer-encoding']) delete headers[name];
    const canceled = new AbortController(); response.on('close', () => canceled.abort());
    let outgoing = { 'content-type': 'application/json' };
    const forward = async value => {
      const signal = request.method === 'GET' ? canceled.signal : AbortSignal.any([canceled.signal, AbortSignal.timeout(15000)]);
      const actual = await fetch(upstream, { method: request.method, headers, ...(body ? { body: JSON.stringify(value) } : {}), redirect: 'error', signal });
      outgoing = Object.fromEntries([...actual.headers].filter(([name]) => !['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(name)));
      if (rpc?.method === 'tools/call') { outgoing['content-type'] = 'application/json'; return readRpcReply(actual, rpc.id, { signal }); }
      if (actual.headers.get('content-type')?.includes('text/event-stream')) {
        const stream = Readable.fromWeb(actual.body); response.writeHead(actual.status, outgoing); stream.pipe(response); response.on('close', () => stream.destroy()); stream.on('error', () => response.destroy()); return null;
      }
      const text = await actual.text();
      if ([202, 204].includes(actual.status) && !text) { response.writeHead(actual.status, outgoing).end(); return null; }
      if (!body || request.method !== 'POST') { response.writeHead(actual.status).end(text); return null; }
      if (!actual.ok || !actual.headers.get('content-type')?.includes('application/json')) throw new Error('Allocated upstream did not return JSON RPC');
      return JSON.parse(text);
    };
    const result = await adapter.call(rpc, forward);
    if (result) response.writeHead(200, outgoing).end(JSON.stringify(result));
  } catch { if (!response.headersSent) response.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'allocated saving dependency unavailable' })); else response.destroy(); }
});
server.listen(55685, '127.0.0.1', () => console.log(JSON.stringify({ mode, listening: '127.0.0.1:55685', rawAuthOrPayloadLogged: false })));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
