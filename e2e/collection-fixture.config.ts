import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: ".", testMatch: "collection-fixture.spec.ts", workers: 1, reporter: "list",
  use: { baseURL: "http://127.0.0.1:55586", trace: "retain-on-failure" },
  projects: [{ name: "collection", use: { ...devices["Desktop Chrome"] } }],
  outputDir: "test-results/collection-fixtures",
  webServer: { command: "npm run dev -- --port 55586", url: "http://127.0.0.1:55586", reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: "http://127.0.0.1:55587", VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key", VITE_API_URL: "http://127.0.0.1:55587/api" } },
});
