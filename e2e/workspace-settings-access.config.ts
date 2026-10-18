import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "workspace-settings-access.fixture.ts",
  workers: 1,
  outputDir: "test-results/workspace-settings-access",
  use: { baseURL: "http://127.0.0.1:55632", trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }, {
    name: "mobile",
    use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
  }],
  webServer: {
    cwd: new URL("..", import.meta.url).pathname,
    command:
      "node node_modules/vite/bin/vite.js --config e2e/workspace-settings-access.vite.config.ts --host 127.0.0.1 --port 55632 --strictPort",
    url: "http://127.0.0.1:55632",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:55633",
      VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      VITE_API_URL: "http://127.0.0.1:55633/api",
      VITE_DEV_LOGIN: "true",
    },
  },
});
