import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "relation-settings.fixture.ts",
  workers: 1,
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }, {
    name: "mobile",
    use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
  }],
  outputDir: "test-results/relation-settings",
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 56893 --strictPort",
    url: "http://127.0.0.1:56893",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:56894",
      VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      VITE_API_URL: "http://127.0.0.1:56894/api",
      VITE_DEV_LOGIN: "true",
    },
  },
  use: { baseURL: "http://127.0.0.1:56893", trace: "retain-on-failure" },
});
