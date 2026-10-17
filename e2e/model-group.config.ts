import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "model-group.fixture.ts",
  fullyParallel: true,
  workers: 2,
  projects: [{
    name: "desktop",
    use: {
      ...devices["Desktop Chrome"],
      viewport: { width: 1440, height: 1000 },
    },
  }, {
    name: "mobile",
    use: { ...devices["Pixel 7"], viewport: { width: 320, height: 568 } },
  }],
  outputDir: "test-results/model-group",
  webServer: {
    cwd: new URL("..", import.meta.url).pathname,
    command: "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 56893 --strictPort",
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
