import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

for (const script of ['run-client.mjs', 'prepare-fixture.mjs', 'proxy-saving.mjs', 'web-roundtrip.mjs']) {
  test(`retired owner protocol ${script} rejects before setup, network, browser or CLI work`, () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL(script, import.meta.url))], {
      env: { ...process.env, PLUGIN_ENV_HANDOFF: 'exclusive-local' },
      encoding: 'utf8',
      timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Retired owner\/general-record experiment protocol/);
  });
}
