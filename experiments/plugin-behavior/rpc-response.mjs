// Installed MCP 2.2 transport accepts JSON or SSE message frames containing a
// JSON-RPC response. This allocated proxy needs only its correlated tool reply.
export async function readRpcReply(response, id, { maxBytes = 1048576, timeoutMs = 15000, signal } = {}) {
  if (!response.ok || !response.body) throw new Error('Allocated upstream reply unavailable');
  const sse = response.headers.get('content-type')?.includes('text/event-stream');
  if (!sse && !response.headers.get('content-type')?.includes('application/json')) throw new Error('Unsupported allocated reply type');
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = '', bytes = 0, timer, abort;
  const valid = value => value?.jsonrpc === '2.0' && value.id === id && (Object.hasOwn(value, 'result') !== Object.hasOwn(value, 'error'));
  const stopped = new Promise((_, reject) => {
    const cancel = () => { reject(new Error('Allocated reply timed out or canceled')); void reader.cancel().catch(() => {}); };
    timer = setTimeout(cancel, timeoutMs);
    abort = cancel;
    if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), stopped]);
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) throw new Error('Allocated reply exceeds limit');
      buffer += decoder.decode(chunk.value, { stream: true });
      if (sse) {
        buffer = buffer.replaceAll('\r\n', '\n');
        let end;
        while ((end = buffer.indexOf('\n\n')) !== -1) {
          const frame = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          const lines = frame.split('\n');
          const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
          const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
          if (!data || event && event !== 'message') continue;
          const message = JSON.parse(data);
          if (valid(message)) return message;
        }
      }
    }
    buffer += decoder.decode();
    if (!sse) { const value = JSON.parse(buffer); if (valid(value)) return value; }
    throw new Error('No correlated allocated RPC reply');
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
