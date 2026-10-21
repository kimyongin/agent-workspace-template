import { e2eRunPlan } from './e2e-run-plan.mjs';
import { readLocalConfig } from './local-config.mjs';
import { createLocalRuntimeAdapter } from './local-runtime-cli.mjs';
import { runFullTestPlan } from './test-full-runtime.mjs';
import { reportMetadata, saveTestReport, printReportLocation } from './test-report.mjs';

// Browser scopes remain sequential; this command does not acquire/setup an actual runtime.
const configs = e2eRunPlan(process.argv.slice(2));
const plan = { stages: configs.map((config, index) => ({
  id: index === 0 ? 'actual' : `fixture:${config}`, config,
  nodeArgs: ['node_modules/@playwright/test/cli.js', 'test', '--config', config],
})) };
const controller = new AbortController();
const handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => controller.abort(signal)]));
for (const [signal, handler] of handlers) process.on(signal, handler);
try {
  const adapter = createLocalRuntimeAdapter(readLocalConfig());
  const metadata = reportMetadata('npm run test:e2e:all', plan);
  const executed = await runFullTestPlan(plan, undefined, adapter, { signal: controller.signal });
  const result = saveTestReport(executed, metadata);
  console.table(result.results.map(item => ({ config: configs[plan.stages.findIndex(stage => stage.id === item.label)],
    exit: item.code, seconds: item.seconds, skipped: item.skipped, reason: item.reason })));
  printReportLocation(result);
  process.exitCode = result.exitCode;
} finally {
  for (const [signal, handler] of handlers) process.off(signal, handler);
}
