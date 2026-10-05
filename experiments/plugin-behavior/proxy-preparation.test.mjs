import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script = fileURLToPath(new URL('./proxy-preparation.mjs', import.meta.url));
test('fault adapter rejects unallocated mode, port, upstream and missing lease before listening', () => {
  for (const [args, handoff] of [
    [['all-fail', '55684', 'http://127.0.0.1:55621/functions/v1/mcp'], 'exclusive-local'],
    [['semantic-failure', '55680', 'http://127.0.0.1:55621/functions/v1/mcp'], 'exclusive-local'],
    [['semantic-failure', '55684', 'https://example.invalid/functions/v1/mcp'], 'exclusive-local'],
    [['semantic-failure', '55684', 'http://127.0.0.1:55621/functions/v1/mcp'], ''],
  ]) {
    const result = spawnSync(process.execPath, [script, ...args], { env: { ...process.env, PLUGIN_ENV_HANDOFF: handoff }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
  }
});
