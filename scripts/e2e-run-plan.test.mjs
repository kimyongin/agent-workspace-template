import { test } from "node:test";
import assert from "node:assert/strict";
import { e2eRunPlan, fixtureConfigs } from "./e2e-run-plan.mjs";
test("all E2E retains actual plus registered fixture scopes and actual override changes only first", () => {
  const actual = new URL(import.meta.url).pathname;
  assert.equal(e2eRunPlan([]).length, 25);
  assert.deepEqual(e2eRunPlan(["--actual-config", actual]), [actual, ...fixtureConfigs]);
  assert.deepEqual(e2eRunPlan([]).slice(1), fixtureConfigs);
});

test("workspace scope, lifecycle and settings access cannot disappear from the full run", () => {
  const plan = e2eRunPlan([]);
  for (const config of [
    "e2e/workspace-scope.config.ts",
    "e2e/workspace-lifecycle.config.ts",
    "e2e/workspace-settings-access.config.ts",
  ]) assert.ok(plan.includes(config), `${config} must run`);
});
test("actual config override requires exact named option and existing absolute file", () => {
  for (const args of [["relative.ts"], ["--actual-config", "relative.ts"], ["--other", new URL(import.meta.url).pathname], ["--actual-config", "/tmp/absent-351-test-config.mjs"]]) {
    assert.throws(() => e2eRunPlan(args));
  }
});

test("schema editor and job history public screens remain in the full browser run", () => {
  const plan = e2eRunPlan([]);
  assert.ok(plan.includes("e2e/schema-editor-read.config.ts"));
  assert.ok(plan.includes("e2e/schema-job-history.config.ts"));
  assert.ok(plan.includes("e2e/material-schema.config.ts"));
  assert.ok(plan.includes("e2e/material-templates.config.ts"));
  assert.ok(plan.includes("e2e/relation-settings.config.ts"));
  assert.ok(plan.includes("e2e/data-model.config.ts"));
  assert.ok(plan.includes("e2e/model-group.config.ts"));
  assert.ok(plan.includes("e2e/create-and-link.config.ts"));
  assert.ok(plan.includes("e2e/typed-relations.config.ts"));
  assert.ok(plan.includes("playwright.design-samples.config.ts"));
  assert.ok(plan.includes("e2e/query-layout.build.config.ts"));
  assert.equal(new Set(plan).size, plan.length);
});

test("full plan includes every test boundary once without nesting overlapping bundles", async () => {
  const { fullTestPlan } = await import('./test-run-plan.mjs');
  const plan = fullTestPlan([]);
  assert.deepEqual(plan.stages.slice(0, 10).map(stage => stage.id), [
    'core', 'adapters', 'web', 'scripts', 'embedding', 'guards', 'db', 'http', 'mcp', 'actual',
  ]);
  assert.deepEqual(plan.stages.slice(10).map(stage => stage.config), fixtureConfigs);
  assert.equal(new Set(plan.stages.map(stage => stage.id)).size, plan.stages.length);
  assert.equal(plan.stages.filter(stage => stage.script === 'test:core').length, 1);
  assert.equal(plan.stages.filter(stage => stage.id === 'actual').length, 1);
  assert.deepEqual(plan.stages.filter(stage => stage.runtime).map(stage => stage.id), ['db', 'http', 'mcp', 'actual']);
  assert.match(plan.stages.find(stage => stage.id === 'actual').scope, /additional.*actual.*excluded/);
});

test('full plan validates selection and passes actual override only to actual E2E', async () => {
  const { fullTestPlan } = await import('./test-run-plan.mjs');
  const actual = new URL(import.meta.url).pathname;
  const plan = fullTestPlan(['--plan', '--only', 'actual,fixtures', '--actual-config', actual]);
  assert.equal(plan.planOnly, true);
  assert.deepEqual(plan.stages[0].args, ['--', '--config', actual]);
  assert.deepEqual(plan.stages.slice(1).map(stage => stage.config), fixtureConfigs);
  for (const args of [['--only'], ['--only', ''], ['--only', 'core,unknown'], ['--only', 'core,core'], ['--plan', '--plan'], ['--actual-config', 'relative.ts']]) {
    assert.throws(() => fullTestPlan(args), args.join(' '));
  }
});

test('full execution uses one runtime lease, continues independent test failures and retains every original code', async () => {
  const { fullTestPlan } = await import('./test-run-plan.mjs');
  const { runFullTestPlan } = await import('./test-full-runtime.mjs');
  const calls = [];
  const adapter = {
    source: '/unused', now: Date.now,
    observe: async () => { calls.push('observe'); return { state: 'ready' }; },
    run: async stage => { calls.push(stage.id); return { code: stage.id === 'core' ? 9 : 0 }; },
  };
  const result = await runFullTestPlan(fullTestPlan(['--only', 'core,db,http,mcp,actual,fixtures']),
    { projectId: `plan-test-${process.pid}`, apiUrl: 'http://127.0.0.1:1' }, adapter);
  assert.equal(result.exitCode, 1);
  assert.equal(result.results.find(stage => stage.label === 'core').code, 9);
  assert.deepEqual(calls.filter(call => call !== 'observe'), ['core', 'db', 'http', 'mcp', 'actual', ...fixtureConfigs.map(config => `fixture:${config}`)]);
  assert.equal(result.results.filter(stage => stage.label === 'actual').length, 1);
  assert.ok(result.results.every(stage => !stage.skipped));
});

test('runtime startup failure and interruption skip remaining planned scopes with reasons', async () => {
  const { fullTestPlan } = await import('./test-run-plan.mjs');
  const { runFullTestPlan } = await import('./test-full-runtime.mjs');
  for (const reason of ['startup', 'SIGINT', 'SIGTERM', 'cleanup']) {
    const controller = new AbortController(), calls = [];
    const adapter = {
      now: Date.now,
      observe: async () => ({ state: reason === 'startup' ? 'failed' : 'ready' }),
      run: async stage => {
        calls.push(stage.id);
        if (reason.startsWith('SIG')) controller.abort(reason);
        return { code: 23, stopFailed: reason === 'cleanup' };
      },
    };
    const result = await runFullTestPlan(fullTestPlan(['--only', 'db,http,fixtures']),
      { projectId: `failure-test-${process.pid}`, apiUrl: 'http://127.0.0.1:1' }, adapter, { signal: controller.signal });
    assert.equal(result.exitCode, reason === 'SIGINT' ? 130 : reason === 'SIGTERM' ? 143 : 1);
    assert.deepEqual(calls, reason === 'startup' ? [] : ['db']);
    assert.equal(result.results.find(stage => stage.label === 'http').skipped, true);
    assert.ok(result.results.filter(stage => stage.skipped).every(stage => stage.reason));
    if (reason !== 'startup') assert.equal(result.results[0].code, 23);
    assert.equal(result.results.length, 26);
  }
});

test('plan-only and invalid CLI options never invoke subprocesses or runtime services', async () => {
  const { spawnSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, existsSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'full-plan-cli-'));
  const npm = join(directory, 'npm.mjs'), marker = join(directory, 'unexpected');
  try {
    writeFileSync(npm, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'called');`);
    const env = { ...process.env, PATH: directory, npm_execpath: npm };
    const result = spawnSync(process.execPath, ['scripts/test-full.mjs', '--plan'], { env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).stages.length, 34);
    for (const args of [['--unknown'], ['--actual-config', '/absent/config.ts'], ['--only', 'missing']]) {
      const invalid = spawnSync(process.execPath, ['scripts/test-full.mjs', ...args], { env, encoding: 'utf8' });
      assert.equal(invalid.status, 1);
    }
    assert.equal(existsSync(marker), false);
  } finally { rmSync(directory, { recursive: true }); }
});

test('lease acquisition failure reports all unexecuted runtime stages and skips fixtures', async () => {
  const { fullTestPlan } = await import('./test-run-plan.mjs');
  const { runFullTestPlan } = await import('./test-full-runtime.mjs');
  const { acquireRuntimeLock } = await import('./local-runtime-cli.mjs');
  const config = { projectId: `busy-plan-${process.pid}`, apiUrl: 'http://127.0.0.1:1' };
  const release = acquireRuntimeLock(`${config.projectId}:${config.apiUrl}`);
  try {
    const result = await runFullTestPlan(fullTestPlan(['--only', 'db,http,actual,fixtures']), config, {});
    assert.equal(result.exitCode, 1);
    assert.equal(result.results.length, 27);
    assert.ok(result.results.find(item => item.label === 'http').skipped);
    assert.ok(result.results.find(item => item.label === 'actual').skipped);
  } finally { release(); }
});

test('successful subprocess status cannot hide child cleanup failure', async () => {
  const { fullTestPlan } = await import('./test-run-plan.mjs');
  const { runFullTestPlan } = await import('./test-full-runtime.mjs');
  const result = await runFullTestPlan(fullTestPlan(['--only', 'core,web']), {}, {
    run: async () => ({ code: 0, stopFailed: true }),
  });
  assert.equal(result.exitCode, 1);
  assert.equal(result.results[0].code, 0);
  assert.equal(result.results[0].stopFailed, true);
  assert.equal(result.results[1].skipped, true);
});

test('isolated runtime and env file are paired and actual contract commands use only the explicit env file', async () => {
  const { fullTestPlan } = await import('./test-run-plan.mjs');
  const file = new URL(import.meta.url).pathname;
  const plan = fullTestPlan(['--runtime-config', file, '--env-file', file, '--actual-config', file, '--only', 'db,http,mcp,actual']);
  assert.equal(plan.runtimeConfig, file);
  assert.equal(plan.envFile, file);
  assert.equal(plan.borrowedOnly, true);
  for (const stage of plan.stages.slice(0, 3)) {
    assert.ok(stage.npmArgs.includes(`--env-file=${file}`));
    assert.ok(!stage.npmArgs.includes('--env-file=.env.local'));
  }
  assert.equal(plan.stages[3].config, file);
  for (const args of [['--runtime-config', file], ['--env-file', file], ['--runtime-config', 'relative', '--env-file', file]]) assert.throws(() => fullTestPlan(args));
});

test('isolated environment preflight rejects mismatched API and DB before any runtime effects without exposing secrets', async () => {
  const { readTestRunEnvironment } = await import('./test-run-environment.mjs');
  const { mkdtempSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const directory = mkdtempSync(join(tmpdir(), 'full-env-'));
  const config = join(directory, 'config.toml'), env = join(directory, 'env');
  const raw = 'VITE_SUPABASE_URL=http://127.0.0.1:62121\nVITE_API_URL=http://127.0.0.1:62121/functions/v1/api\nLOCAL_DB_URL=postgresql://postgres:private-placeholder@127.0.0.1:62122/postgres\nLOCAL_POOLER_PORT=62129\n';
  try {
    writeFileSync(config, `project_id='full-isolated'\n[api]\nport=62121\n[db]\nport=62122\n[db.pooler]\nenabled=true\nport=62129\n[auth]\nsite_url='http://127.0.0.1:62180'\n`);
    writeFileSync(env, raw);
    const plan = { runtimeConfig: config, envFile: env };
    const result = readTestRunEnvironment(plan, { PATH: '/safe/path', VITE_SUPABASE_URL: 'http://127.0.0.1:wrong' });
    assert.equal(result.config.projectId, 'full-isolated');
    assert.equal(result.env.VITE_SUPABASE_URL, 'http://127.0.0.1:62121');
    assert.equal(result.env.WORKSPACE_E2E_ENV_FILE, env);
    assert.equal(result.env.WORKSPACE_E2E_CONFIG, config);
    assert.equal(result.env.PATH, '/safe/path');
    for (const invalid of [raw.replaceAll('62121', '62131'), raw.replace('62122', '62132'), raw.replace('62129', '62139'), raw.replaceAll('127.0.0.1', 'example.invalid')]) {
      writeFileSync(env, invalid);
      assert.throws(() => readTestRunEnvironment(plan, {}), error => !error.message.includes('private-placeholder'));
    }
    writeFileSync(env, raw);
    assert.throws(() => readTestRunEnvironment(plan, { WORKSPACE_E2E_CONFIG: '/other/config.toml' }));
  } finally { rmSync(directory, { recursive: true }); }
});
