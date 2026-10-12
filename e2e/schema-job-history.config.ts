import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "schema-job-history.fixture.ts",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 20_000,
  outputDir: "test-results/schema-job-history",
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }, {
    name: "mobile",
    use: { ...devices["Pixel 7"], viewport: { width: 320, height: 568 } },
  }],
  use: { baseURL: "http://127.0.0.1:55587", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 55587 --strictPort",
    url: "http://127.0.0.1:55587",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:55588",
      VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      VITE_API_URL: "http://127.0.0.1:55588/api",
      VITE_DEV_LOGIN: "true",
    },
  },
});
