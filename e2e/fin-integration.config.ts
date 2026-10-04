import baseline from "../playwright.config.ts";
import { defineConfig } from "@playwright/test";
export default defineConfig({ ...baseline, testDir: ".", workers: 1,
  testIgnore: ["**/*fixture*", "**/entity-tags-fixtures.spec.ts"],
  outputDir: "test-results/fin-integration",
  use: { ...baseline.use, baseURL: "http://127.0.0.1:58480", screenshot: "only-on-failure" },
  webServer: { command: "npm run dev -- --host 127.0.0.1 --port 58480 --strictPort", url: "http://127.0.0.1:58480", reuseExistingServer: false, timeout: 60_000 },
});
