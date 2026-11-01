import { defineConfig } from "@playwright/test";
import activity from "./workspace-activity-actual.config.ts";

export default defineConfig(activity, {
  testMatch: "workspace-text.actual.ts",
  outputDir: "test-results/workspace-text-actual",
});
