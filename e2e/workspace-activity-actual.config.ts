import { defineConfig, devices } from "@playwright/test";

// Source-authored actual scenarios; no runtime proof until the root runs them.
// The root supplies an already-running, explicitly owned local runtime.
for (
  const name of [
    "WORKSPACE_E2E_BASE_URL",
    "WORKSPACE_E2E_ENV_FILE",
    "WORKSPACE_E2E_CONFIG",
    "WORKSPACE_E2E_OWNERSHIP",
    "WORKSPACE_E2E_SOURCE_REVISION",
  ]
) {
  if (!process.env[name]) {
    throw new Error(
      `Explicit owned activity fixture setting required: ${name}`,
    );
  }
}
export default defineConfig({
  testDir: ".",
  testMatch: "workspace-activity.actual.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/workspace-activity-actual",
  reporter: [["list"]],
  use: {
    baseURL: process.env.WORKSPACE_E2E_BASE_URL,
    trace: "off",
    video: "off",
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
      },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
});
