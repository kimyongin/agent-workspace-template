import { defineConfig } from "@playwright/test";
import activity from "./workspace-activity-actual.config.ts";

export default defineConfig({
  ...activity,
  testMatch: "workspace-task-viewer-access.actual.ts",
  outputDir: "test-results/workspace-task-viewer-access-actual",
});
