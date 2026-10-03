import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, cp, readFile, writeFile, rm, mkdir, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { repository, validatePlugin, pluginFiles } from './check-plugin.mjs';
import { packagePlugin, zipPlugin } from './package-plugin.mjs';

test('shared package manifests, endpoints, references and server tools agree', async () => {
  const result = await validatePlugin();
  assert.equal(result.version, '0.1.0');
  assert(result.tools.includes('search'));
});

test('package rejection catches endpoint drift, missing tools and leaked files', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'workspace-plugin-check-'));
  try {
    for (const path of ['plugins', '.agents/plugins', '.claude-plugin', 'supabase/functions/_shared/adapters/mcp']) {
      await cp(resolve(repository, path), resolve(root, path), { recursive: true });
    }
    const mcpPath = resolve(root, 'plugins/workspace/.mcp.json');
    const original = await readFile(mcpPath, 'utf8');
    await writeFile(mcpPath, original.replace('ayzcluvdppsppwszzaqx', 'wrongproject'));
    await assert.rejects(validatePlugin(root));
    await writeFile(mcpPath, original);
    const skillPath = resolve(root, 'plugins/workspace/skills/workspace/SKILL.md');
    const skill = await readFile(skillPath, 'utf8');
    await writeFile(skillPath, skill.replace('`search` |', '`unknown_tool` |'));
    await assert.rejects(validatePlugin(root), /tool names differ/);
    await writeFile(skillPath, skill);
    await writeFile(resolve(root, 'plugins/workspace/.env'), 'SECRET=value\n');
    await assert.rejects(validatePlugin(root), /Unexpected package file/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('archive is deterministic, includes hidden manifests and forbids source output', async () => {
  const files = await pluginFiles(resolve(repository, 'plugins/workspace'));
  assert.deepEqual(zipPlugin(files), zipPlugin([...files].reverse()));
  const bytes = zipPlugin(files);
  assert(bytes.includes(Buffer.from('workspace/.claude-plugin/plugin.json')));
  assert(bytes.includes(Buffer.from('workspace/.mcp.json')));
  await assert.rejects(packagePlugin(resolve(repository, 'plugins/workspace/test.zip')), /outside the repository/);
});

test('canonical repository junction and destination links reject before any output is written', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'workspace-plugin-path-'));
  const repo = resolve(root, 'repo');
  try {
    await mkdir(resolve(repo, 'artifacts'), { recursive: true });
    await symlink(repo, resolve(root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
    const output = resolve(root, 'alias/artifacts/nested/plugin.zip');
    await assert.rejects(packagePlugin(output, repo), /canonical path/);
    await assert.rejects(lstat(resolve(repo, 'artifacts/nested')), { code: 'ENOENT' });

    for (const suffix of ['', '.json']) {
      const target = resolve(repo, `preserved${suffix || '.zip'}`);
      await mkdir(target);
      await writeFile(resolve(target, 'original'), 'preserve original\n');
      const archive = resolve(root, `release${suffix ? '-sidecar' : ''}.zip`);
      await symlink(target, `${archive}${suffix}`, process.platform === 'win32' ? 'junction' : 'dir');
      await assert.rejects(packagePlugin(archive, repo), /symlink or junction/);
      assert.equal(await readFile(resolve(target, 'original'), 'utf8'), 'preserve original\n');
      // Neither archive nor sidecar may be created as a partial result.
      await assert.rejects(lstat(`${archive}${suffix ? '' : '.json'}`), { code: 'ENOENT' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('existing file symlinks at archive or sidecar never overwrite their target', async (t) => {
  const root = await mkdtemp(resolve(tmpdir(), 'workspace-plugin-file-link-'));
  const repo = resolve(root, 'repo');
  try {
    await mkdir(repo);
    const target = resolve(repo, 'original');
    await writeFile(target, 'preserve original\n');
    for (const suffix of ['', '.json']) {
      const archive = resolve(root, `release${suffix ? '-sidecar' : ''}.zip`);
      try {
        await symlink(target, `${archive}${suffix}`, 'file');
      } catch (error) {
        if (process.platform === 'win32' && error.code === 'EPERM') {
          t.skip('Windows file symlink creation requires a privilege unavailable in this session');
          return;
        }
        throw error;
      }
      await assert.rejects(packagePlugin(archive, repo), /symlink or junction/);
      assert.equal(await readFile(target, 'utf8'), 'preserve original\n');
      await assert.rejects(lstat(`${archive}${suffix ? '' : '.json'}`), { code: 'ENOENT' });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
