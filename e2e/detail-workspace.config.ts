import { defineConfig } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: ["detail-workspace.spec.ts", "display-scale.spec.ts"], fullyParallel: true, workers: 3, retries: 0, timeout: 40_000, reporter: "list", outputDir: "test-results/detail-workspace",
  use: { baseURL: "http://127.0.0.1:55590", viewport: { width: 1440, height: 900 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: { command: "npm run dev -- --port 55590", url: "http://127.0.0.1:55590", reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: "http://127.0.0.1:55591", VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key", VITE_API_URL: "http://127.0.0.1:55591/api" } },
});
