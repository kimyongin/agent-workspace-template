import { isAbsolute } from "node:path";
import { statSync } from "node:fs";
export const fixtureConfigs = [
  "e2e/collection-fixture.config.ts", "e2e/detail-workspace.config.ts",
  "e2e/entity-tags-fixtures.config.ts",
  "playwright.activity.config.ts", "e2e/navigation-fixture.config.ts",
  "e2e/type-navigation.config.ts", "e2e/typed-entity-consumers.config.ts",
  "e2e/schema-editor-read.config.ts", "e2e/schema-job-history.config.ts",
  "e2e/navigation-preferences.config.ts", "e2e/workspace-screens.config.ts",
  "e2e/material-schema.config.ts", "e2e/material-templates.config.ts", "e2e/issuer-settings.config.ts",
  "e2e/relation-settings.config.ts", "e2e/typed-relations.config.ts", "e2e/data-model.config.ts",
  "e2e/create-and-link.config.ts",
  "playwright.design-samples.config.ts",
  "e2e/query-layout.build.config.ts",
];
export function e2eRunPlan(args) {
  if (args.length === 0) return ["playwright.config.ts", ...fixtureConfigs];
  if (args.length !== 2 || args[0] !== "--actual-config" || !isAbsolute(args[1]) || !statSync(args[1]).isFile()) {
    throw new Error("Usage: test-e2e-all.mjs [--actual-config /absolute/isolated/playwright.config.mjs]");
  }
  return [args[1], ...fixtureConfigs];
}
