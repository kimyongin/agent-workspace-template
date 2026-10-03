// Read-only client capability reconnaissance. No MCP service or fixture access.
import { spawn, execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';
import { outsideDirectory } from './files.mjs';

const output = resolve(process.argv[2] ?? '');
if (!process.argv[2]) throw new Error('Usage: node experiments/plugin-behavior/models.mjs <outside-repository-directory>');
await outsideDirectory(output);
const codexVersion = execFileSync('codex', ['--version'], { encoding: 'utf8' }).trim().replace('codex-cli ', '');
const claudeVersion = execFileSync('claude', ['--version'], { encoding: 'utf8' }).trim().split(' ')[0];

const listed = await new Promise((resolveList, reject) => {
  const child = spawn('codex', ['app-server', '--stdio'], { cwd: output, stdio: ['pipe', 'pipe', 'pipe'] });
  const timer = setTimeout(() => { child.kill(); reject(new Error('model/list timed out')); }, 30000);
  const all = [];
  let id = 2;
  const send = (value) => child.stdin.write(`${JSON.stringify(value)}\n`);
  const ask = (cursor) => send({ jsonrpc: '2.0', id: id++, method: 'model/list', params: { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) } });
  createInterface({ input: child.stdout }).on('line', (line) => {
    let value;
    try { value = JSON.parse(line); } catch { return; }
    if (value.id === 1) {
      if (value.error) { clearTimeout(timer); child.kill(); reject(new Error('app-server initialize failed')); return; }
      send({ jsonrpc: '2.0', method: 'initialized', params: {} });
      ask();
    } else if (value.id >= 2) {
      if (value.error) { clearTimeout(timer); child.kill(); reject(new Error('model/list failed')); return; }
      all.push(...value.result.data);
      if (value.result.nextCursor) ask(value.result.nextCursor);
      else { clearTimeout(timer); child.kill(); resolveList(all); }
    }
  });
  child.on('error', (error) => { clearTimeout(timer); reject(error); });
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'workspace-plugin-capabilities', version: '0.1.0' } } });
});
const codex = {
  client: 'codex-cli', version: codexVersion, context: 'owner-desktop-codex-cli',
  observedAt: new Date().toISOString(), timeZone: 'Asia/Seoul',
  models: listed.map((model) => ({ model: model.model, actualModel: model.model, efforts: model.supportedReasoningEfforts.map((effort) => effort.reasoningEffort), blocked: false })),
};
await writeFile(resolve(output, 'codex-cli-snapshot.json'), `${JSON.stringify(codex, null, 2)}\n`);

const claude = await new Promise((resolveResult, reject) => {
  const child = spawn('claude', ['--print', '--model', 'sonnet', '--effort', 'medium', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--tools', '', '--no-session-persistence', '--output-format', 'json', 'Reply READY only. Do not use tools.'], { cwd: output, stdio: ['ignore', 'pipe', 'pipe'] });
  const timer = setTimeout(() => { child.kill(); reject(new Error('Claude alias probe timed out')); }, 120000);
  let result = '';
  child.stdout.on('data', (chunk) => { result += chunk; });
  child.on('error', (error) => { clearTimeout(timer); reject(error); });
  child.on('close', (code) => {
    clearTimeout(timer);
    if (code) { reject(new Error(`Claude alias probe exit ${code}; no raw credential-bearing log retained`)); return; }
    try { resolveResult(JSON.parse(result)); } catch { reject(new Error('Claude alias probe output was not JSON')); }
  });
});
const actual = Object.keys(claude.modelUsage ?? {}).find((name) => name.startsWith('claude-sonnet-'));
if (!actual || claude.is_error) throw new Error('Claude sonnet resolution unavailable');
const snapshot = {
  client: 'claude-cli', version: claudeVersion, context: 'owner-desktop-claude',
  observedAt: new Date().toISOString(), timeZone: 'Asia/Seoul',
  models: [{ model: 'sonnet', actualModel: actual, efforts: ['medium'], blocked: false }],
  evidence: { explicitModel: 'sonnet', explicitEffort: 'medium', resultSubtype: claude.subtype, modelUsage: claude.modelUsage, backendEffort: 'unexposed' },
};
await writeFile(resolve(output, 'claude-cli-snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`);
console.log(JSON.stringify({ codex: { version: codexVersion, models: codex.models.length }, claude: { version: claudeVersion, actualModel: actual, explicitEffort: 'medium', backendEffort: 'unexposed' } }));
