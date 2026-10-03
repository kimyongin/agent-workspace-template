import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scripts = fileURLToPath(new URL('./', import.meta.url));
function rejected(script, args, message) {
  assert.throws(() => execFileSync(process.execPath, [resolve(scripts, script), ...args], { env: { ...process.env, PLUGIN_ENV_HANDOFF: 'exclusive-local' }, stdio: ['ignore', 'pipe', 'pipe'] }), (error) => error.status === 1 && error.stderr.toString().includes(message));
}
test('native web consent refuses external issuer, missing PKCE, and external callback before opening a browser', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'native-guards-'));
  try {
    await writeFile(resolve(root, 'env'), 'VITE_SUPABASE_URL=http://127.0.0.1:55421\n');
    for (const url of [
      'https://example.invalid/oauth/authorize?code_challenge_method=S256&redirect_uri=http%3A%2F%2Flocalhost%3A1234%2Fcallback',
      'http://127.0.0.1:55421/auth/v1/oauth/authorize?redirect_uri=http%3A%2F%2Flocalhost%3A1234%2Fcallback',
      'http://127.0.0.1:55421/auth/v1/oauth/authorize?code_challenge_method=S256&redirect_uri=https%3A%2F%2Fexample.invalid%2Fcallback',
    ]) {
      await writeFile(resolve(root, 'request'), JSON.stringify({ url }));
      rejected('authorize-native-web.mjs', [resolve(root, 'env'), resolve(root, 'request'), 'http://127.0.0.1:55480', resolve(root, 'evidence')], url.includes('redirect_uri=https') ? 'Expected normal loopback CLI callback' : 'Only allocated local PKCE authorization');
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('native read refuses canonical product, external endpoint, and injected headers before assignment or CLI spawn', async () => {
  const root = await mkdtemp(resolve(tmpdir(), 'native-guards-'));
  try {
    const plugin = resolve(root, 'plugin');
    await mkdir(resolve(plugin, '.claude-plugin'), { recursive: true });
    for (const [name, config, message] of [
      ['workspace', { url: 'http://127.0.0.1:55421/functions/v1/mcp' }, 'Only a unique experiment plugin/server'],
      ['workspace-native-check-1234', { url: 'https://example.invalid/mcp' }, 'Only loopback native OAuth'],
      ['workspace-native-check-1234', { url: 'http://127.0.0.1:55421/functions/v1/mcp', headers: { Authorization: 'test-placeholder' } }, 'Only loopback native OAuth'],
    ]) {
      await writeFile(resolve(plugin, '.claude-plugin/plugin.json'), JSON.stringify({ name }));
      await writeFile(resolve(plugin, '.mcp.json'), JSON.stringify({ mcpServers: { 'oauth-check-1234': config } }));
      rejected('read-native-claude.mjs', [plugin, resolve(root, 'nonexistent-snapshot'), resolve(root, 'evidence')], message);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
