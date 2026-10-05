// Dedicated #122 dependency fault proxy; upstream originals are never edited.
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
const [mode, portText, upstreamText] = process.argv.slice(2);
if (process.env.PLUGIN_ENV_HANDOFF !== 'exclusive-local' || !['semantic-failure', 'index-delay'].includes(mode) || portText !== '55684' || upstreamText !== 'http://127.0.0.1:55621/functions/v1/mcp') throw new Error('Only allocated #122 loopback fault proxy 55684/upstream55621 and documented modes');
const upstream = new URL(upstreamText); let forwarded = 0, injected = 0;
const server = createServer(async (request, response) => {
  try {
    if (request.url !== '/functions/v1/mcp') { response.writeHead(404).end(); return; }
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 1048576) { response.writeHead(413).end(); return; } chunks.push(chunk); }
    let body = Buffer.concat(chunks).toString(), rpc;
    if (body) { try { rpc = JSON.parse(body); } catch { response.writeHead(400).end(); return; } }
    const semantic = rpc?.method === 'tools/call' && rpc.params?.name === 'search' && rpc.params.arguments?.mode !== 'keyword';
    if (semantic && mode === 'semantic-failure') {
      injected++;
      const error = { code: 'unavailable', message: '이 실험의 의미 검색 연결이 일시적으로 응답하지 않습니다.', retryable: true };
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(error) }], structuredContent: error, isError: true } }));
      console.log(JSON.stringify({ mode, event: 'injected', dependency: 'semantic-search', count: injected })); return;
    }
    if (semantic && mode === 'index-delay') { rpc.params.arguments.mode = 'keyword'; body = JSON.stringify(rpc); }
    const headers = { ...request.headers }; delete headers.host; delete headers['content-length']; delete headers.connection; delete headers['transfer-encoding'];
    const actual = await fetch(upstream, { method: request.method, headers, ...(body ? { body } : {}), redirect: 'error', ...(request.method === 'GET' ? {} : { signal: AbortSignal.timeout(15000) }) });
    if (!semantic && actual.headers.get('content-type')?.includes('text/event-stream')) {
      const stream = Readable.fromWeb(actual.body); response.writeHead(actual.status, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' }); stream.pipe(response); response.on('close', () => stream.destroy()); stream.on('error', () => response.destroy()); forwarded++;
      console.log(JSON.stringify({ mode, event: 'stream-forwarded', method: rpc?.method ?? request.method, count: forwarded })); return;
    }
    let result = await actual.text(); forwarded++;
    if (semantic && mode === 'index-delay' && actual.headers.get('content-type')?.includes('application/json')) {
      const parsed = JSON.parse(result), data = parsed.result?.structuredContent;
      if (data?.items && !parsed.result.isError) { data.search_state = 'keyword_fallback'; data.semantic_coverage = { pending: Math.max(data.semantic_coverage?.pending ?? 0, 1), excluded: data.semantic_coverage?.excluded ?? 0 }; parsed.result.content = [{ type: 'text', text: JSON.stringify(data) }]; result = JSON.stringify(parsed); injected++; }
    }
    const outgoing = Object.fromEntries([...actual.headers].filter(([name]) => !['content-length', 'content-encoding', 'transfer-encoding', 'connection'].includes(name)));
    response.writeHead(actual.status, outgoing).end(result);
    console.log(JSON.stringify({ mode, event: 'forwarded', method: rpc?.method ?? request.method, tool: rpc?.params?.name, count: forwarded, injected }));
  } catch (error) { response.writeHead(502, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'allocated dependency unavailable' })); console.log(JSON.stringify({ mode, event: 'dependency-failed', method: request.method, errorType: error.name, errorCode: error.cause?.code })); }
});
server.listen(55684, '127.0.0.1', () => console.log(JSON.stringify({ mode, listening: '127.0.0.1:55684', rawAuthOrPayloadLogged: false })));
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
