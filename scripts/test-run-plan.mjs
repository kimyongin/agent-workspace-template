import { e2eRunPlan, fixtureConfigs } from "./e2e-run-plan.mjs";

// This is a finite composition, not a dependency engine. Individual npm scripts retain their scopes.
export function fullTestPlan(args) {
  let planOnly = false, only, runtimeConfig, envFile, actualConfig = 'playwright.config.ts';
  for (let index = 0; index < args.length; index++) {
    const option = args[index];
    if (option === '--plan' && !planOnly) planOnly = true;
    else if (option === '--only' && only === undefined) {
      if (!args[index + 1]) throw new Error('--only requires test scopes');
      only = args[++index].split(',');
    }
    else if (option === '--actual-config' && actualConfig === 'playwright.config.ts') {
      actualConfig = e2eRunPlan([option, args[++index]])[0];
    } else if (option === '--runtime-config' && !runtimeConfig) {
      runtimeConfig = e2eRunPlan(['--actual-config', args[++index]])[0];
    } else if (option === '--env-file' && !envFile) {
      envFile = e2eRunPlan(['--actual-config', args[++index]])[0];
    } else throw new Error('Usage: test:full [--plan] [--only core,adapters,web,scripts,embedding,guards,db,http,mcp,actual,fixtures] [--actual-config /absolute/config] [--runtime-config /absolute/config.toml --env-file /absolute/env]');
  }
  if (Boolean(runtimeConfig) !== Boolean(envFile)) throw new Error('--runtime-config and --env-file must be supplied together');
  const stages = [
    { id: 'core', script: 'test:core' },
    { id: 'adapters', script: 'test:adapters:fast' },
    { id: 'web', script: 'test:web' },
    { id: 'scripts', nodeArgs: ['--test', 'scripts/*.test.mjs'] },
    { id: 'embedding', nodeArgs: ['--test', 'experiments/t02-3-embedding/evaluate.test.mjs'] },
    { id: 'guards', nodeArgs: ['--test', 'experiments/plugin-behavior/*.test.mjs'] },
    { id: 'db', script: 'test:db', runtime: true },
    { id: 'http', script: 'test:http', runtime: true },
    { id: 'mcp', script: 'test:mcp', runtime: true },
    { id: 'actual', script: 'test:e2e', args: ['--', '--config', actualConfig], runtime: true,
      config: actualConfig, scope: actualConfig === 'playwright.config.ts'
        ? 'base *.spec.ts; additional *.actual.ts excluded'
        : 'explicit actual config; collected scenarios are owned by this config' },
    ...fixtureConfigs.map(config => ({ id: `fixture:${config}`, group: 'fixtures', config,
      script: 'test:e2e', args: ['--', '--config', config] })),
  ];
  if (envFile) for (const stage of stages.filter(item => ['db', 'http', 'mcp'].includes(item.id))) {
    stage.npmArgs = ['exec', '--', 'deno', 'test', '--config', 'supabase/functions/deno.json',
      '--allow-env', '--allow-net', '--allow-read', `--env-file=${envFile}`,
      `supabase/tests/${stage.id === 'db' ? 'database' : stage.id}`];
  }
  const groups = new Set([...stages.map(stage => stage.id), 'fixtures']);
  if (only && (!only.length || only.some(id => !groups.has(id)) || new Set(only).size !== only.length)) {
    throw new Error('Unknown or repeated --only test scope');
  }
  const selected = stages.filter(stage => !only || only.includes(stage.id) || only.includes(stage.group));
  if (runtimeConfig && actualConfig === 'playwright.config.ts' && selected.some(stage => stage.id === 'actual')) {
    throw new Error('An isolated runtime requires an explicit --actual-config for its browser scope');
  }
  return {
    planOnly, runtimeConfig, envFile, borrowedOnly: Boolean(runtimeConfig),
    stages: selected,
    excluded: [
      'static checks/build (separate check:docs, check:boundaries, check:deno, build)',
      'actual CLI/provider trials and RUN_PINECONE_E2E=1 (explicit opt-in; see experiments/README.md)',
    ],
  };
}
