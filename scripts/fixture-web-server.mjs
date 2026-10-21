import { createServer } from 'vite';

// The runner owns this exact child. Strict listen failure never adopts another server.
if (!process.send) throw new Error('Fixture web server requires its owning runner');
const server = await createServer({
  server: { host: '127.0.0.1', port: 56883, strictPort: true, open: false },
});
await server.listen();
const ready = await fetch('http://127.0.0.1:56883');
if (!ready.ok) throw new Error('Owned fixture web server readiness failed');
process.send({ ready: 'settings-model', pid: process.pid });
process.on('disconnect', () => { void server.close().finally(() => process.exit(0)); });
