// Exclusive Template-20 integration lease; root55480 and shared DBs remain separate.
import baseline from "../playwright.config.ts";
import { defineConfig } from "@playwright/test";
export default defineConfig({...baseline,testDir:".",workers:1,
  testIgnore:baseline.testIgnore,
  outputDir:"test-results/workspace-integration",
  use:{...baseline.use,baseURL:"http://127.0.0.1:56680",screenshot:"only-on-failure"},
  webServer:{command:"npm run dev -- --host 127.0.0.1 --port 56680 --strictPort",url:"http://127.0.0.1:56680",reuseExistingServer:false,timeout:60_000},
});
