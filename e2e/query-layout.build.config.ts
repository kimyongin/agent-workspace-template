import { defineConfig } from "@playwright/test";
import { fileURLToPath } from "node:url";

export default defineConfig({
  testDir: ".",
  testMatch: "query-layout.build.fixture.ts",
  workers: 1,
  retries: 0,
  outputDir: "test-results/query-layout-build",
  use: { baseURL: "http://127.0.0.1:55580", trace: "retain-on-failure", screenshot: "only-on-failure" },
  webServer: {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    command:
      "npm run build -- --outDir test-results/query-layout-dist && node node_modules/vite/bin/vite.js preview --port 55580 --outDir test-results/query-layout-dist",
    url: "http://127.0.0.1:55580/agent-workspace-template/",
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    env: {
      VITE_BASE: "/agent-workspace-template/",
      VITE_SUPABASE_URL: "http://127.0.0.1:55581",
      VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      VITE_API_URL: "http://127.0.0.1:55581/api",
    },
  },
});
