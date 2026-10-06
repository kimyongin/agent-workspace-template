// Offline packaging commands only: no LLM, MCP login, or service connections.
import { execFileSync } from 'node:child_process';
import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { outsideDirectory } from './files.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const candidateManifest = JSON.parse(await readFile(resolve(repo, 'plugins/workspace/plugin.json'), 'utf8'));
const claudeManifest = JSON.parse(await readFile(resolve(repo, 'plugins/workspace/.claude-plugin/plugin.json'), 'utf8'));
assert.match(candidateManifest.version, /^\d+\.\d+\.\d+$/);
assert.equal(claudeManifest.version, candidateManifest.version);
if (!process.argv[2]) throw new Error('Usage: install-update.mjs <new-outside-output>');
const output = await outsideDirectory(process.argv[2]);
const market = resolve(output, 'market');
await mkdir(market); // Existing output must not silently replace a previous run.
const baseline = 'a59d58cc8ca5e65f24c3d31c7504367db79d0a01';
const paths = execFileSync('git', ['ls-tree', '-r', '--name-only', baseline, 'plugins/workspace', '.agents/plugins', '.claude-plugin'], { cwd: repo, encoding: 'utf8' }).trim().split('\n');
for (const name of paths) {
  const destination = resolve(market, name);
  await mkdir(resolve(destination, '..'), { recursive: true });
  await writeFile(destination, execFileSync('git', ['show', `${baseline}:${name}`], { cwd: repo }));
}
const codexHome = await outsideDirectory(resolve(output, 'codex-home'));
const claudeHome = await outsideDirectory(resolve(output, 'claude-home'));
const evidence = { baselineRevision: baseline, candidateRevision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim(), steps: [], noAuthenticationOrMcpCommands: true };
evidence.candidateWorkingTreeDirty = Boolean(execFileSync('git', ['status', '--porcelain'], { cwd: repo, encoding: 'utf8' }).trim());
function run(client, args) {
  const env = { ...process.env, ENABLE_CLAUDEAI_MCP_SERVERS: 'false', ...(client === 'codex' ? { CODEX_HOME: codexHome } : { CLAUDE_CONFIG_DIR: claudeHome }) };
  const stdout = execFileSync(client, args, { cwd: market, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  evidence.steps.push({ client, args, exitCode: 0 });
  return stdout;
}
run('claude', ['plugin', 'validate', './plugins/workspace']);
run('claude', ['plugin', 'validate', '.']);
run('codex', ['plugin', 'marketplace', 'add', '.', '--json']);
run('claude', ['plugin', 'marketplace', 'add', './']);
run('codex', ['plugin', 'add', 'workspace@workspace-template', '--json']);
run('claude', ['plugin', 'install', 'workspace@workspace-template']);
evidence.before = { codex: JSON.parse(run('codex', ['plugin', 'list', '--json'])), claude: JSON.parse(run('claude', ['plugin', 'list', '--json'])) };
await cp(resolve(repo, 'plugins/workspace'), resolve(market, 'plugins/workspace'), { recursive: true });
run('claude', ['plugin', 'validate', './plugins/workspace']);
run('codex', ['plugin', 'add', 'workspace@workspace-template', '--json']);
run('claude', ['plugin', 'marketplace', 'update', 'workspace-template']);
run('claude', ['plugin', 'update', 'workspace@workspace-template']);
evidence.after = { codex: JSON.parse(run('codex', ['plugin', 'list', '--json'])), claude: JSON.parse(run('claude', ['plugin', 'list', '--json'])) };
for (const [stage, version] of [['before', '0.1.0'], ['after', candidateManifest.version]]) {
  const codex = evidence[stage].codex.installed;
  const claude = evidence[stage].claude;
  for (const plugins of [codex, claude]) {
    assert.equal(plugins.length, 1, 'Isolated home contains only the experiment plugin');
    assert.equal(plugins[0].version, version);
    assert.equal(plugins[0].enabled, true);
  }
}
const manifest = JSON.parse(await readFile(resolve(market, 'plugins/workspace/plugin.json'), 'utf8'));
assert.equal(manifest.version, candidateManifest.version);
const skillHash = async (path) => createHash('sha256').update(await readFile(path)).digest('hex');
evidence.sharedSkillSha256 = await skillHash(resolve(repo, 'plugins/workspace/skills/workspace/SKILL.md'));
for (const home of [codexHome, claudeHome]) assert.equal(await skillHash(resolve(home, 'plugins/cache/workspace-template/workspace', candidateManifest.version, 'skills/workspace/SKILL.md')), evidence.sharedSkillSha256);
evidence.installedSharedSkillHashesMatch = true;
await writeFile(resolve(output, 'install-update.json'), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify({ output, baselineRevision: baseline, candidateRevision: evidence.candidateRevision, candidateWorkingTreeDirty: evidence.candidateWorkingTreeDirty, before: { codex: evidence.before.codex.installed[0].version, claude: evidence.before.claude[0].version }, after: { codex: evidence.after.codex.installed[0].version, claude: evidence.after.claude[0].version }, installedSharedSkillHashesMatch: evidence.installedSharedSkillHashesMatch }));
