import { spawnSync } from "node:child_process";

// Configs remain sequential: fixture servers reuse ports; real-account writes share state.
const configs = [
  "playwright.config.ts",
  "e2e/collection-fixture.config.ts",
  "e2e/detail-workspace.config.ts",
  "e2e/entity-tags-fixtures.config.ts",
  "e2e/principle-current.config.ts",
  "playwright.activity.config.ts",
  "e2e/navigation-fixture.config.ts",
  "e2e/workspace-screens.config.ts",
];
const results = [];
for (const config of configs) {
  console.log(`\nE2E: ${config}`);
  const started = performance.now();
  const result = spawnSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--config", config], { stdio: "inherit" });
  if (result.error) throw result.error;
  results.push({ config, exit: result.status ?? 1, seconds: Math.round((performance.now() - started) / 100) / 10 });
  if (result.signal) break;
}
console.table(results);
process.exitCode = results.some(result => result.exit !== 0) ? 1 : 0;
