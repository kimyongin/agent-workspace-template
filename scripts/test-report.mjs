import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir, freemem, totalmem, release } from 'node:os';
import { join, relative, isAbsolute, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

export function reportMetadata(command, plan = {}) {
  const revision = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  const dirty = spawnSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' });
  return {
    command, options: { actualConfig: plan.stages?.find(stage => stage.id === 'actual')?.config ?? null, runtimeConfig: plan.runtimeConfig ?? null, envFile: plan.envFile ?? null },
    runnerRevision: revision.status === 0 ? revision.stdout.trim() : null,
    runnerTrackedChanges: dirty.status === 0 ? Boolean(dirty.stdout.trim()) : null,
    scopes: plan.stages?.map(({ id, config, runtime }) => ({ id, config, runtime: Boolean(runtime) })) ?? null,
    workers: plan.workers ?? null, workerSource: plan.workers ? 'explicit browser override' : 'configuration-defined; not observed',
    cacheState: plan.cacheState ?? 'unspecified',
    cacheDefinition: 'cold/warm is caller-declared. Each command starts a fresh command child; browser fixtures start fresh Vite, while actual API may borrow an existing runtime as recorded separately. Existing dependency/build/browser caches and DB are never reset. warm denotes retained caches; it does not assert runtime freshness.',
    execution: 'executed commands at their selected unit/mock/actual boundaries; not a discovered test count or proof of an unselected API scope',
    testCounts: null,
    environment: { platform: process.platform, arch: process.arch, osRelease: release(), node: process.version,
      hostTotalBytes: totalmem(), hostFreeBytesBefore: freemem() },
    limits: [
      'RSS sampling adds ps invocation overhead; it is included in command elapsed time.',
      'Full-run elapsed time excludes option/config preflight, metadata generation and report writing. Whole-run elapsed time is measured directly; nested stage/runtime phase durations must not be summed as whole elapsed time.',
      'Browser command time includes Vite readiness, Playwright collection, tests and teardown; these phases are not separately observable here.',
      'Process-tree RSS samples exclude Docker/VM and reparented processes; shared pages may be counted more than once. Sampled maxima are not exact OS peaks.',
      'Host free memory is an OS reading, not guaranteed available capacity. Other processes can affect all samples.',
      'No test discovery/list output, environment contents, raw subprocess arguments or user bodies are collected.',
    ],
  };
}

export function defaultReportFile() {
  return join(mkdtempSync(join(tmpdir(), 'workspace-test-report-')), 'report.json');
}

export function externalReportPath(file, cwd = process.cwd()) {
  const path = relative(cwd, file);
  if (!isAbsolute(file) || path === '' || path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)) throw new Error('Report path must be absolute and outside the checkout');
  return file;
}

export function saveTestReport(result, metadata, file) {
  const actualLabels = new Set(['DB', 'HTTP', 'MCP', 'E2E', 'db', 'http', 'mcp', 'actual']);
  const usesService = metadata.scopes?.some(stage => stage.runtime || stage.id === 'actual')
    || result.runtime || result.runtimeMetrics?.length || result.results?.some(stage => actualLabels.has(stage.label));
  // A matching bind/nonce proves identity and ownership, not the immutable source revision.
  // Caller environment declarations are not promoted to verified service provenance.
  const serviceSource = usesService ? {
    revision: null, verification: 'unverified',
    warning: 'Service source revision is not verified. Runner revision describes only the runner checkout; a matching functions bind/container identity does not establish backend revision. Do not assume a same-source performance comparison.',
  } : { revision: null, verification: 'not-applicable', reason: 'No actual backend scope selected' };
  const report = { schemaVersion: 2, recordedAt: new Date().toISOString(), metadata: { ...metadata, serviceSource },
    result: { ...result, results: result.results?.map(item => ({ ...item, status: item.skipped ? 'skipped' : item.interrupted ? 'interrupted' : item.code === 0 && !item.stopFailed ? 'passed' : 'failed' })), errors: result.errors?.map(({ phase }) => ({ phase })) },
    hostFreeBytesAfter: freemem() };
  try {
    const reportFile = file ?? defaultReportFile();
    writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return { ...result, reportFile };
  } catch {
    return { ...result, exitCode: result.exitCode === 0 ? 1 : result.exitCode, reportError: true, unsavedReport: report };
  }
}

export function printReportLocation(result) {
  if (result.reportError) {
    console.error('Structured report could not be saved; original results follow.');
    console.error(JSON.stringify(result.unsavedReport));
  } else console.log(`Structured report: ${result.reportFile}`);
}
