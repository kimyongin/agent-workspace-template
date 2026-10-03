import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { resolve, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repository = fileURLToPath(new URL('../', import.meta.url));
export const endpoint = 'https://ayzcluvdppsppwszzaqx.supabase.co/functions/v1/mcp';
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function pluginFiles(root) {
  const files = [];
  async function visit(path) {
    const stat = await lstat(path);
    assert(!stat.isSymbolicLink(), `Symlink is not packaged: ${path}`);
    if (stat.isDirectory()) {
      for (const name of (await readdir(path)).sort()) await visit(resolve(path, name));
    } else {
      assert(stat.isFile(), `Not a regular file: ${path}`);
      const name = relative(root, path).split(sep).join('/');
      assert(/^(plugin\.json|mcp\.json|\.mcp\.json|\.claude-plugin\/plugin\.json|README\.md|skills\/workspace\/(SKILL\.md|references\/[^/]+\.md))$/.test(name), `Unexpected package file: ${name}`);
      const bytes = await readFile(path);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      assert(!bytes.subarray(0, 3).equals(Buffer.from([239, 187, 191])) && !text.includes('\r'), `Expected UTF-8 without BOM and LF: ${name}`);
      files.push({ name, bytes, sha256: sha256(bytes) });
    }
  }
  await visit(root);
  return files;
}

export async function validatePlugin(repo = repository) {
  const root = resolve(repo, 'plugins/workspace');
  const files = await pluginFiles(root);
  const json = async (path) => JSON.parse(await readFile(resolve(repo, path), 'utf8'));
  const portable = await json('plugins/workspace/plugin.json');
  const claude = await json('plugins/workspace/.claude-plugin/plugin.json');
  assert.equal(portable.$schema, 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json');
  assert.equal(portable.name, 'workspace');
  assert.match(portable.version, /^\d+\.\d+\.\d+$/);
  for (const field of ['name', 'version', 'description', 'author']) assert.deepEqual(claude[field], portable[field], `Manifest ${field} mismatch`);
  for (const field of ['skills', 'mcpServers', 'apps', 'interface']) assert(!(field in portable), `Portable manifest must discover ${field} automatically`);
  assert(portable.extensions['com.openai'].interface.shortDescription.length <= 30);
  const mcp = await json('plugins/workspace/mcp.json');
  assert.equal(mcp.$schema, 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json');
  assert.deepEqual(mcp.mcpServers, { workspace: { type: 'streamable-http', url: endpoint } });
  assert.deepEqual(await json('plugins/workspace/.mcp.json'), { mcpServers: { workspace: { type: 'http', url: endpoint } } });
  const codexMarket = await json('.agents/plugins/marketplace.json');
  const claudeMarket = await json('.claude-plugin/marketplace.json');
  assert.equal(codexMarket.name, 'workspace-template');
  assert.equal(claudeMarket.name, codexMarket.name);
  assert.deepEqual(codexMarket.plugins, [{ name: portable.name, source: { source: 'local', path: './plugins/workspace' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }]);
  assert.deepEqual(claudeMarket.plugins, [{ name: portable.name, source: './plugins/workspace' }]);
  assert(claudeMarket.owner.name);
  const skill = files.find((file) => file.name === 'skills/workspace/SKILL.md');
  assert(skill, 'Missing shared product skill');
  assert.match(skill.bytes.toString(), /^---\nname: workspace\ndescription: .+\n---\n/);
  const documented = new Set();
  for (const file of files.filter((file) => file.name.startsWith('skills/'))) {
    const text = file.bytes.toString();
    for (const row of text.split('\n').filter((line) => /^\|/.test(line))) {
      for (const match of row.matchAll(/`([a-z]+(?:_[a-z]+)+|search)`/g)) documented.add(match[1]);
    }
    for (const match of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || /^https?:/.test(link)) continue;
      const target = resolve(root, file.name, '..', link);
      assert(!relative(root, target).startsWith('..'), `Reference escapes package: ${link}`);
      assert((await lstat(target)).isFile(), `Missing reference: ${link}`);
    }
  }
  const sourceNames = new Set();
  const toolsRoot = resolve(repo, 'supabase/functions/_shared/adapters/mcp');
  const sources = [];
  for (const name of (await readdir(toolsRoot)).filter((name) => name.endsWith('-tools.ts')).sort()) {
    const bytes = await readFile(resolve(toolsRoot, name));
    sources.push({ name, sha256: sha256(bytes) });
    for (const match of bytes.toString().matchAll(/name:\s*"([a-z_]+)"/g)) sourceNames.add(match[1]);
  }
  assert(sourceNames.size > 0, 'Server tool definitions missing');
  assert.deepEqual([...documented].sort(), [...sourceNames].sort(), 'Product skill/server tool names differ');
  return { name: portable.name, version: portable.version, endpoint, tools: [...sourceNames].sort(), serverSourceSha256: sha256(JSON.stringify(sources)), files: files.map(({ name, sha256 }) => ({ name, sha256 })) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(await validatePlugin(), null, 2));
}
