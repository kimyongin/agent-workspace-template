import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "e2e",
  testMatch: "design-samples.fixture.ts",
  fullyParallel: true,
  workers: 2,
  retries: 0,
  outputDir: "test-results/design-samples",
  use: { baseURL: "http://127.0.0.1:55991", trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }, {
    name: "mobile",
    use: { ...devices["Pixel 7"] },
  }],
  webServer: {
    command: "node node_modules/vite/bin/vite.js --port 55991",
    url: "http://127.0.0.1:55991",
    reuseExistingServer: false,
    env: { VITE_API_URL: "", VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" },
  },
});
