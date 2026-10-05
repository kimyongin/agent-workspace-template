// Uses normal CLI-owned native OAuth storage; never reads or copies its token.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { resolve, dirname } from 'node:path';
import { outsideDirectory } from './files.mjs';

const [plugin, evidenceFile] = process.argv.slice(2);
if (!plugin || !evidenceFile || process.env.PLUGIN_ENV_HANDOFF !== 'exclusive-local') throw new Error('Exclusive local handoff required');
await outsideDirectory(plugin);
await outsideDirectory(dirname(resolve(evidenceFile)));
let manifest, mcp;
try {
  manifest = JSON.parse(await readFile(resolve(plugin, '.claude-plugin/plugin.json'), 'utf8'));
  mcp = JSON.parse(await readFile(resolve(plugin, '.mcp.json'), 'utf8'));
} catch { throw new Error('Experiment plugin configuration invalid; raw values omitted'); }
const servers = Object.entries(mcp.mcpServers ?? {});
if (!/^workspace-native-check-[a-f0-9]+$/.test(manifest.name) || servers.length !== 1 || !/^oauth-check-[a-f0-9]+$/.test(servers[0][0])) throw new Error('Only a unique experiment plugin/server is allowed');
const [serverKey, config] = servers[0];
let endpoint;
try { endpoint = new URL(config.url); }
catch { throw new Error('Only loopback native OAuth without injected headers is allowed'); }
if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(endpoint.hostname) || config.headers) throw new Error('Only loopback native OAuth without injected headers is allowed');
const model = 'claude-opus-5-5';
const effort = 'medium';
const tool = `mcp__plugin_${manifest.name}_${serverKey}__list_tags`;
const evidence = { requested: { model, effort }, personalTokenReadOrCopied: false, suppliedAuthorizationHeader: false, events: [] };
const child = spawn('claude', ['--print', '--setting-sources', 'project,local', '--plugin-dir', plugin, '--model', model, '--effort', effort, '--tools', '', '--allowedTools', tool, '--permission-mode', 'dontAsk', '--no-session-persistence', '--output-format', 'stream-json', '--verbose', `Call only this session's ${serverKey} MCP list_tags once for a harmless native-authenticated read. Do not write any data, read local files, or use other services. Reply only NATIVE_READ_OK if the tool succeeds.`], { cwd: resolve(plugin, '..'), env: { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false', ENABLE_TOOL_SEARCH: 'false' }, stdio: ['ignore', 'pipe', 'pipe'] });
const timer = setTimeout(() => child.kill(), 120000);
child.stderr.resume();
createInterface({ input: child.stdout }).on('line', (line) => {
  let event;
  try { event = JSON.parse(line); } catch { return; }
  if (event.type === 'system' && event.subtype === 'init') evidence.init = { model: event.model, tools: event.tools, servers: event.mcp_servers?.map(({ name, status }) => ({ name, status })) };
  for (const block of event.message?.content ?? []) {
    if (block.type === 'tool_use') evidence.events.push({ tool: block.name });
    if (block.type === 'tool_result') evidence.events.push({ isError: Boolean(block.is_error) });
  }
  if (event.type === 'result') evidence.result = { isError: event.is_error, subtype: event.subtype, modelUsage: event.modelUsage, permissionDenials: event.permission_denials?.map(({ tool_name }) => tool_name) };
});
evidence.exitCode = await new Promise((resolveExit, reject) => { child.on('error', reject); child.on('close', resolveExit); });
clearTimeout(timer);
evidence.passed = evidence.exitCode === 0 && evidence.events.filter((event) => event.tool).length === 1 && evidence.events.some((event) => event.tool === tool) && evidence.events.some((event) => event.isError === false) && !evidence.result?.isError && !evidence.result?.permissionDenials?.length;
await writeFile(resolve(evidenceFile), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ exitCode: evidence.exitCode, passed: evidence.passed, tools: evidence.events.filter((event) => event.tool).map(({ tool }) => tool), init: evidence.init, permissionDenials: evidence.result?.permissionDenials }));
if (!evidence.passed) process.exitCode = 1;
