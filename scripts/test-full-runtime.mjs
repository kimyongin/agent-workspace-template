import { runLeasedLocalChecks } from './local-runtime-cli.mjs';

// Ordinary test failures allow independent stages to run. Environment/cleanup failures and signals stop the run.
export async function runFullTestPlan(plan, config, adapter, { signal, leaseDirectory } = {}) {
  const results = [], errors = [];
  if (plan.planOnly) return { results, errors, exitCode: 0 };
  let stopped;
  const interruption = result => signal?.aborted || result?.interrupted;
  const signalCode = result => (signal?.reason ?? result?.signal) === 'SIGTERM' ? 143 : 130;
  let exitCode = 0;
  for (let index = 0; index < plan.stages.length; index++) {
    const stage = plan.stages[index];
    if (signal?.aborted) { stopped = 'interrupted'; exitCode = signalCode(); }
    if (stopped) { results.push({ label: stage.id, skipped: true, reason: stopped }); continue; }
    let activeStages = [stage];
    try {
      if (stage.runtime) {
        const checks = [];
        while (plan.stages[index]?.runtime) checks.push(plan.stages[index++]);
        index--;
        activeStages = checks;
        const local = await runLeasedLocalChecks(config, { checks, signal, borrowedOnly: plan.borrowedOnly }, adapter, leaseDirectory);
        results.push(...local.results.map(item => ({ ...item, runtime: local.runtime })));
        errors.push(...local.errors);
        if (local.exitCode !== 0) exitCode = local.exitCode;
        if (interruption() || local.results.some(item => item.interrupted)) {
          stopped = 'interrupted'; exitCode = signalCode(local.results.find(item => item.interrupted));
        } else if (local.errors.length) stopped = 'runtime preparation, execution or cleanup failed';
        const executed = new Set(local.results.map(item => item.label));
        for (const check of checks) if (!executed.has(check.id)) {
          results.push({ label: check.id, skipped: true, reason: stopped ?? 'runtime execution stopped' });
        }
      } else {
        const result = await adapter.run(stage, signal);
        results.push({ label: stage.id, ...result });
        if (result.code !== 0 || result.stopFailed) exitCode = 1;
        if (interruption(result)) { stopped = 'interrupted'; exitCode = signalCode(result); }
        else if (result.code === null || result.stopFailed) stopped = 'subprocess execution or cleanup failed';
      }
    } catch (error) {
      errors.push({ phase: stage.id, error });
      results.push({ label: stage.id, code: null });
      stopped = signal?.aborted ? 'interrupted' : 'execution environment failed';
      exitCode = signal?.aborted ? signalCode() : 1;
      for (const unexecuted of activeStages.slice(1)) results.push({ label: unexecuted.id, skipped: true, reason: stopped });
    }
  }
  return { results, errors, exitCode };
}
