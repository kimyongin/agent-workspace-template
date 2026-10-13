import { test } from "node:test";
import assert from "node:assert/strict";
import { e2eRunPlan, fixtureConfigs } from "./e2e-run-plan.mjs";
test("all E2E retains fifteen sequential scopes and actual override changes only first", () => {
  const actual = new URL(import.meta.url).pathname;
  assert.equal(e2eRunPlan([]).length, 15);
  assert.deepEqual(e2eRunPlan(["--actual-config", actual]), [actual, ...fixtureConfigs]);
  assert.deepEqual(e2eRunPlan([]).slice(1), fixtureConfigs);
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
  assert.equal(new Set(plan).size, plan.length);
});
