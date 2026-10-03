import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = new URL('.', import.meta.url);
for (const line of readFileSync(new URL('results/inputs.sha256', root), 'utf8').trim().split('\n')) {
  const [expected, file] = line.split('  ');
  const actual = createHash('sha256').update(readFileSync(new URL(file, root))).digest('hex');
  if (actual !== expected) throw new Error(`Frozen fixture changed: ${file}`);
}
const oracle = readFileSync(new URL('oracle.test.mjs', root));
for (const [label, file, expectedCode] of [
  ['baseline', 'implementation.mjs', 1],
  ['codex', 'results/codex-implementation.mjs', 0],
  ['claude', 'results/claude-implementation.mjs', 0],
]) {
  const workspace = mkdtempSync(join(tmpdir(), `model-oracle-${label}-`));
  writeFileSync(join(workspace, 'implementation.mjs'), readFileSync(new URL(file, root)));
  writeFileSync(join(workspace, 'oracle.test.mjs'), oracle);
  const result = spawnSync(process.execPath, ['--test', 'oracle.test.mjs'], { cwd: workspace, encoding: 'utf8' });
  const expectedSummary = expectedCode === 0 ? 'pass 4' : 'fail 4';
  if (result.status !== expectedCode || !result.stdout.includes(expectedSummary)) {
    throw new Error(`${label}: unexpected oracle result\n${result.stdout}\n${result.stderr}`);
  }
  console.log(`${label}: expected ${expectedSummary}; isolated oracle verified`);
}
