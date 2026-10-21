import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cwd = fileURLToPath(new URL("../", import.meta.url));
function discover(value, args = []) {
  const env = { ...process.env };
  delete env.WORKSPACE_ISSUER_FIXTURE_WORKERS;
  if (value !== undefined) env.WORKSPACE_ISSUER_FIXTURE_WORKERS = value;
  const result = spawnSync(process.execPath, [
    "node_modules/@playwright/test/cli.js", "test", "--config", "e2e/issuer-settings.config.ts",
    "--list", "--reporter=json", ...args,
  ], { cwd, env, encoding: "utf8", timeout: 30_000 });
  assert.ifError(result.error);
  return { ...result, report: result.status === 0 ? JSON.parse(result.stdout) : null };
}
function cases(report) {
  const result = [];
  function visit(suites) {
    for (const suite of suites) {
      for (const spec of suite.specs ?? []) {
        for (const item of spec.tests) result.push(`${item.projectName}:${spec.title}`);
      }
      visit(suite.suites ?? []);
    }
  }
  visit(report.suites);
  return result.sort();
}

test("issuer fixture worker opt-in preserves discovery and explicit CLI override", () => {
  const baseline = discover();
  assert.equal(baseline.status, 0, baseline.stderr);
  assert.equal(baseline.report.config.workers, 1);
  assert.ok(cases(baseline.report).length > 0);
  for (const count of ["2", "3"]) {
    const optedIn = discover(count);
    assert.equal(optedIn.status, 0, optedIn.stderr);
    assert.equal(optedIn.report.config.workers, Number(count));
    assert.deepEqual(cases(optedIn.report), cases(baseline.report));
  }
  const override = discover("2", ["--workers=1"]);
  assert.equal(override.status, 0, override.stderr);
  assert.equal(override.report.config.workers, 1);
  for (const value of ["", "0", "4", "1.5", "2x"]) {
    const invalid = discover(value);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /WORKSPACE_ISSUER_FIXTURE_WORKERS/);
  }
});
