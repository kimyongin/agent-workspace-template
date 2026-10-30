import { defineConfig } from "@playwright/test";
import workspaceScope from "./workspace-scope.config.ts";

export default defineConfig({
  ...workspaceScope,
  testMatch: "invitation-copy.fixture.ts",
  workers: 1,
  outputDir: process.env.INVITATION_EVIDENCE_DIR ?? "test-results/invitation-copy",
});
