import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: ".",
  testMatch: ["workspace-scope.fixture.ts", "invitation-copy.fixture.ts"],
  workers: 1,
  retries: 0,
  timeout: 60_000,
  outputDir: "test-results/workspace-scope",
  use: { baseURL: "http://127.0.0.1:55612", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    cwd: new URL("..", import.meta.url).pathname,
    command: "node node_modules/vite/bin/vite.js --config e2e/workspace-settings-access.vite.config.ts --host 127.0.0.1 --port 55612 --strictPort",
    url: "http://127.0.0.1:55612",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:55613",
      VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      VITE_API_URL: "http://127.0.0.1:55613/api",
      VITE_DEV_LOGIN: "true",
    },
  },
});
