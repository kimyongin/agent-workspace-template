// Read-only native inventory, retaining only this experiment's product metadata.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { outsideDirectory } from './files.mjs';
const [market, output] = process.argv.slice(2);
if (!market || !output) throw new Error('discovery.mjs <outside-own-market> <outside-evidence>');
await outsideDirectory(market); await outsideDirectory(resolve(output, '..'));
const { name } = JSON.parse(await readFile(resolve(market, '.agents/plugins/marketplace.json'), 'utf8'));
if (!/^workspace-prepare122-[a-f0-9]{32}$/.test(name)) throw new Error('Only own unique experiment marketplace');
const config = [`marketplaces.${name}.source_type="local"`, `marketplaces.${name}.source=${JSON.stringify(resolve(market))}`, `plugins."workspace@${name}".enabled=true`, `plugins."workspace@${name}".mcp_servers.workspace.enabled=false`];
const child = spawn(process.env.CODEX_CLI_BINARY ?? 'codex', ['app-server', '--stdio', ...config.flatMap(value => ['-c', value])], { cwd: market, stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.resume();
const evidence = { marketplaceName: name, readOnlyInventory: true, plugins: [], skills: [] };
const send = (id, method, params) => child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
const timer = setTimeout(() => child.kill(), 30000);
await new Promise((done, fail) => {
  createInterface({ input: child.stdout }).on('line', line => {
    let rpc; try { rpc = JSON.parse(line); } catch { return; }
    if (rpc.error) { fail(new Error('Native inventory rejected; raw output omitted')); child.kill(); return; }
    if (rpc.id === 1) send(2, 'plugin/list', { cwds: [resolve(market)], marketplaceKinds: ['local'], forceRefetch: false });
    if (rpc.id === 2) {
      // Only names/paths belonging to this newly allocated market survive.
      const walk = value => { if (!value || typeof value !== 'object') return; if (value.name === 'workspace' && JSON.stringify(value).includes(name)) evidence.plugins.push({ name: value.name, enabled: value.enabled, installed: value.installed, keys: Object.keys(value) }); for (const item of Object.values(value)) if (typeof item === 'object') walk(item); };
      walk(rpc.result); send(3, 'skills/list', { cwds: [resolve(market)], forceReload: true });
    }
    if (rpc.id === 3) {
      for (const row of rpc.result.data ?? []) for (const skill of row.skills ?? []) if (skill.path?.includes(name) || skill.path?.startsWith(resolve(market))) evidence.skills.push({ name: skill.name, path: skill.path, enabled: skill.enabled, description: skill.description });
      done(); child.kill();
    }
  });
  child.on('error', fail); child.on('close', () => { if (!evidence.skills.length) done(); });
  send(1, 'initialize', { clientInfo: { name: 'workspace-preparation-discovery', version: '0.1.0' } });
});
clearTimeout(timer);
await writeFile(output, JSON.stringify(evidence, null, 2) + '\n');
console.log(JSON.stringify(evidence));
