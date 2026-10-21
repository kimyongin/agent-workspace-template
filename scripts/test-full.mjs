import { reportMetadata, saveTestReport, printReportLocation } from './test-report.mjs';
import { fullTestPlan } from './test-run-plan.mjs';

// Validate all options before reading service configuration or acquiring any runtime lease.
try {
  const plan = fullTestPlan(process.argv.slice(2));
  const { readTestRunEnvironment } = await import('./test-run-environment.mjs');
  // Explicit preflight reads only configuration files, including for --plan.
  const execution = plan.runtimeConfig || !plan.planOnly ? readTestRunEnvironment(plan) : undefined;
  console.log(JSON.stringify(plan, null, 2));
  if (!plan.planOnly) {
    const { createLocalRuntimeAdapter } = await import('./local-runtime-cli.mjs');
    const { runFullTestPlan } = await import('./test-full-runtime.mjs');
    const { config, env } = execution, adapter = createLocalRuntimeAdapter(config, { env });
    const controller = new AbortController();
    const handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => controller.abort(signal)]));
    for (const [signal, handler] of handlers) process.on(signal, handler);
    try {
      const metadata = reportMetadata('npm run test:full', plan);
      const executed = await runFullTestPlan(plan, config, adapter, { signal: controller.signal });
      const result = saveTestReport(executed, metadata, plan.reportFile);
      console.table(result.results);
      for (const error of result.errors) console.error(`Failed: ${error.phase}; ${error.error.message}; runtime log: ${adapter.log}`);
      printReportLocation(result);
      process.exitCode = result.exitCode;
    } finally {
      for (const [signal, handler] of handlers) process.off(signal, handler);
    }
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
