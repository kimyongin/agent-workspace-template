import { defineConfig } from "@playwright/test";
import defaultActual from "../playwright.config.ts";
import ownedActual from "./workspace-activity-actual.config.ts";

// The caller supplies the owned runtime through the same guarded configuration
// as the feature actual tests. Fixture/build configs remain separate run scopes.
export default defineConfig(ownedActual, {
  testMatch: [
    "**/*.spec.ts",
    "workspace-model.actual.ts",
    "workspace-entity-tags.actual.ts",
    "workspace-activity.actual.ts",
    "workspace-task-viewer-access.actual.ts",
    "workspace-search-status.actual.ts",
    "workspace-search-guide.actual.ts",
  ],
  testIgnore: defaultActual.testIgnore,
  outputDir: "test-results/workspace-full-actual",
});
