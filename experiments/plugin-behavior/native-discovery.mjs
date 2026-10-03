// Reads only credentials generated in this experiment's isolated MCP-native home.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { outsideDirectory } from './files.mjs';

const home = resolve(process.argv[2] ?? '');
if (!process.argv[2] || process.env.PLUGIN_ENV_HANDOFF !== 'exclusive-local') throw new Error('Exclusive local handoff required. Usage: native-discovery.mjs <experiment-native-home>');
await outsideDirectory(home);
const ownership = JSON.parse(await readFile(resolve(home, '.plugin-behavior-native.json'), 'utf8'));
if (ownership.experiment !== 'plugin-behavior' || resolve(ownership.home) !== home) throw new Error('Only an experiment-created native home may be read');
const entries = Object.values(JSON.parse(await readFile(resolve(home, '.credentials.json'), 'utf8')));
if (entries.length !== 1 || entries[0].server_name !== 'workspace') throw new Error('Expected only experiment workspace credentials');
const credentials = entries[0];
if (ownership.endpoint !== credentials.server_url) throw new Error('Native credentials must match the experiment endpoint');
const endpoint = new URL(credentials.server_url);
if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname)) throw new Error('Only local experiment credentials allowed');
const inventory = await new Promise((resolveResult, reject) => {
  const child = spawn('codex', ['app-server', '--stdio'], { cwd: home, env: { ...process.env, CODEX_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
  const timer = setTimeout(() => { child.kill(); reject(new Error('Native discovery timed out')); }, 30000);
  child.stderr.resume();
  const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
  createInterface({ input: child.stdout }).on('line', (line) => {
    let response;
    try { response = JSON.parse(line); } catch { return; }
    if (response.id === 1) {
      send({ jsonrpc: '2.0', method: 'initialized', params: {} });
      send({ jsonrpc: '2.0', id: 2, method: 'mcpServerStatus/list', params: { limit: 100, detail: 'toolsAndAuthOnly' } });
    } else if (response.id === 2) {
      clearTimeout(timer);
      child.kill();
      if (response.error) reject(new Error('Native inventory failed'));
      else resolveResult(response.result.data.map((server) => ({ name: server.name, authStatus: server.authStatus, toolNames: Object.keys(server.tools ?? {}).sort() })));
    }
  });
  child.on('error', (error) => { clearTimeout(timer); reject(error); });
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'plugin-native-discovery', version: '0.1.0' } } });
});
const client = new Client({ name: 'native-token-independent-read', version: '0.1.0' });
try {
  await client.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: `Bearer ${credentials.access_token}` } } }));
  const response = await client.callTool({ name: 'list_tags', arguments: {} });
  const evidence = { inventory, harmlessRead: { tool: 'list_tags', isError: Boolean(response.isError), structuredResultPresent: Boolean(response.structuredContent) }, tokenSource: 'own isolated native OAuth credentials in memory; no personal credential copied', noTokenOrDataLogged: true };
  await writeFile(resolve(home, '../native-discovery-and-read.json'), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify({ servers: inventory.map(({ name, authStatus, toolNames }) => ({ name, authStatus, toolCount: toolNames.length })), harmlessReadPassed: !response.isError }));
  if (response.isError) process.exitCode = 1;
} finally {
  await client.close();
}
