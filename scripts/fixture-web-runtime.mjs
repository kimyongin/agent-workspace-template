// These three browser scopes share only a development web server, never browser or mock state.
export const sharedFixtureConfigs = [
  'e2e/material-templates.config.ts', 'e2e/issuer-settings.config.ts', 'e2e/data-model.config.ts',
];

export function groupFixtureStages(stages) {
  const compatible = stages.filter(stage => sharedFixtureConfigs.includes(stage.config));
  if (compatible.length < 2) return stages;
  const first = stages.indexOf(compatible[0]);
  return [...stages.slice(0, first), ...compatible.map(stage => ({ ...stage, fixtureWebGroup: 'settings-model' })),
    ...stages.slice(first).filter(stage => !compatible.includes(stage))];
}

export async function runFixtureWebGroup(stages, adapter, signal, execute) {
  const started = performance.now(), timings = {};
  let server, result, resources, preparationFailure, cleanup;
  const errors = [];
  try {
    server = await adapter.startFixtureWebServer(signal);
    timings.preparationMs = performance.now() - started;
    const checksStarted = performance.now();
    result = await execute(server);
    timings.checksMs = performance.now() - checksStarted;
  } catch (error) {
    timings.preparationMs ??= performance.now() - started;
    if (Number.isInteger(error.code) || error.code === null) {
      preparationFailure = { code: error.code, signal: error.signal ?? null, spawnFailed: Boolean(error.spawnFailed), interrupted: Boolean(error.interrupted), timedOut: Boolean(error.timedOut) };
    }
    errors.push({ phase: 'fixture-web-preparation', error }, ...(error.fixtureCleanupErrors ?? []));
    cleanup = error.fixtureCleanup;
    resources = error.fixtureResources;
  } finally {
    const cleanupStarted = performance.now();
    if (server) {
      try { resources = await adapter.stopFixtureWebServer(server); }
      catch (error) {
        errors.push(...(error.fixtureCleanupErrors ?? [{ phase: 'fixture-web-cleanup', error }]));
        cleanup = error.fixtureCleanup;
        resources = error.fixtureResources;
      }
    }
    timings.cleanupMs = performance.now() - cleanupStarted;
    timings.totalMs = performance.now() - started;
  }
  const interrupted = signal?.aborted;
  const exitCode = interrupted ? signal.reason === 'SIGTERM' ? 143 : 130 : errors.length ? 1 : result.exitCode;
  return { results: result?.results ?? stages.map(stage => ({ label: stage.id, skipped: true,
    reason: interrupted ? 'interrupted' : 'fixture web preparation failed' })),
    errors: [...(result?.errors ?? []), ...errors], exitCode,
    metric: { group: 'settings-model', stages: stages.map(stage => stage.id), timings, resources, preparationFailure, cleanup } };
}
