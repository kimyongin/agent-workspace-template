import { defineConfig } from "@playwright/test";
import scope from "./workspace-scope.config.ts";

export default defineConfig(scope, {
  testMatch: "workspace-lifecycle.fixture.ts",
  outputDir: "test-results/workspace-lifecycle",
  use: { baseURL: "http://127.0.0.1:55622" },
  webServer: {
    cwd: new URL("..", import.meta.url).pathname,
    command: "node node_modules/vite/bin/vite.js --config e2e/workspace-settings-access.vite.config.ts --host 127.0.0.1 --port 55622 --strictPort",
    url: "http://127.0.0.1:55622",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "http://127.0.0.1:55623",
      VITE_SUPABASE_PUBLISHABLE_KEY: "fixture-public-key",
      VITE_API_URL: "http://127.0.0.1:55623/api",
      VITE_DEV_LOGIN: "true",
    },
  },
});
