import { browserLaunchOptions } from "./browser-options.ts";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({ testDir: ".", testMatch: "entity-tags-fixtures.spec.ts", fullyParallel: false, workers: 1, reporter: "list", outputDir: "test-results/entity-tags-fixtures",
  use: { launchOptions: browserLaunchOptions, baseURL: "http://127.0.0.1:55584", trace: "retain-on-failure" },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }, { name: "mobile", use: { ...devices["Pixel 7"] } }],
  webServer: { command: "npm run dev -- --port 55584", url: "http://127.0.0.1:55584", reuseExistingServer: false,
    env: { VITE_SUPABASE_URL: "http://127.0.0.1:55585", VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key", VITE_API_URL: "http://127.0.0.1:55585/api" } },
});
