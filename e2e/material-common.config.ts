import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "material-common.fixture.ts",
  fullyParallel: true,
  workers: 2,
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }, {
    name: "mobile",
    use: { ...devices["Pixel 7"], viewport: { width: 320, height: 568 } },
  }],
  outputDir: "test-results/material-common",
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 56883 --strictPort",
    url: "http://127.0.0.1:56883",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:56884",
      VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      VITE_API_URL: "http://127.0.0.1:56884/api",
      VITE_DEV_LOGIN: "true",
    },
  },
  use: { baseURL: "http://127.0.0.1:56883", trace: "retain-on-failure" },
});
