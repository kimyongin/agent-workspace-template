import { browserLaunchOptions } from "./browser-options.ts";
import { defineConfig } from "@playwright/test";

// #133 own fixture lease: Vite 55580, route-mocked API 55581. Root actual 556 is separate.
export default defineConfig({
  testDir: ".",
  testMatch: ["navigation-fixture.spec.ts"],
  workers: 1,
  outputDir: "test-results/workspace-navigation",
  use: { launchOptions: browserLaunchOptions, baseURL: "http://127.0.0.1:55580", trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev -- --port 55580",
    url: "http://127.0.0.1:55580",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:55581",
      VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      VITE_API_URL: "http://127.0.0.1:55581/functions/v1/api",
    },
  },
});
