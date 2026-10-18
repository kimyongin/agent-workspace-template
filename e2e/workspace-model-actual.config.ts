import { defineConfig, devices } from "@playwright/test";
// Root owns the already-running web/API/DB runtime. Never start or reuse an
// implicitly selected development server from this feature configuration.
if (!process.env.WORKSPACE_E2E_BASE_URL) {
  throw new Error("Explicit owned actual web URL required");
}
export default defineConfig({
  testDir: ".",
  testMatch: "workspace-model.actual.ts",
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: "test-results/workspace-model-actual",
  reporter: [["list"]],
  use: {
    baseURL: process.env.WORKSPACE_E2E_BASE_URL,
    trace: "off",
    video: "off",
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
