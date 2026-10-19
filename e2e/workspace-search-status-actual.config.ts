import { defineConfig } from "@playwright/test";
import activity from "./workspace-activity-actual.config.ts";

export default defineConfig({
  ...activity,
  testMatch: "workspace-search-status.actual.ts",
  outputDir: "test-results/workspace-search-status-actual",
});
