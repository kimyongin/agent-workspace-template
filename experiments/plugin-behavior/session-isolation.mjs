// Supported read-only status metadata; never read config/auth or retain tool payloads.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
export async function configuredMcpNames(binary) {
  const child = spawn(binary, ['app-server', '--stdio', '--disable', 'plugins', '--disable', 'apps'], { stdio: ['pipe', 'pipe', 'pipe'] }); child.stderr.resume();
  const names = new Set(); let requestId = 2, completed = false;
  const send = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  const timer = setTimeout(() => child.kill(), 30000);
  await new Promise((done, fail) => {
    createInterface({ input: child.stdout }).on('line', line => {
      let rpc; try { rpc = JSON.parse(line); } catch { return; }
      if (rpc.error) { child.kill(); fail(new Error('Supported MCP status unavailable; do not run unisolated')); return; }
      if (rpc.id === 1) send(requestId++, 'mcpServerStatus/list', { limit: 100 });
      if (rpc.id >= 2) {
        for (const row of rpc.result.data ?? []) names.add(row.name);
        if (rpc.result.nextCursor) send(requestId++, 'mcpServerStatus/list', { limit: 100, cursor: rpc.result.nextCursor });
        else { completed = true; done(); child.kill(); }
      }
    }); child.on('error', fail); child.on('close', () => { if (!completed) fail(new Error('MCP status did not complete; do not run unisolated')); });
    send(1, 'initialize', { clientInfo: { name: 'workspace-session-isolation', version: '0.1.0' } });
  }); clearTimeout(timer);
  return [...names];
}
