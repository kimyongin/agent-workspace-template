import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".",
  testMatch: "typed-relations.fixture.ts",
  workers: 1,
  timeout: 45000,
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }, {
    name: "mobile",
    use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 } },
  }],
  outputDir: "test-results/typed-relations",
  webServer: {
    command: "npm run dev -- --host 127.0.0.1 --port 56895 --strictPort",
    url: "http://127.0.0.1:56895",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:56896",
      VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      VITE_API_URL: "http://127.0.0.1:56896/api",
    },
  },
  use: { baseURL: "http://127.0.0.1:56895", trace: "retain-on-failure" },
});
