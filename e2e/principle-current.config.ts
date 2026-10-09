import { browserLaunchOptions } from "./browser-options.ts";
import { defineConfig, devices } from "@playwright/test";
export default defineConfig({testDir:".",testMatch:"principle-current.fixture.ts",workers:1,retries:0,timeout:20_000,
  outputDir:"test-results/principle-current",use:{ launchOptions: browserLaunchOptions,baseURL:"http://127.0.0.1:55586",trace:"retain-on-failure"},
  projects:[{name:"desktop",use:{...devices["Desktop Chrome"]}},{name:"mobile",use:{...devices["Pixel 7"]}}],
  webServer:{command:"npm run dev -- --port 55586",url:"http://127.0.0.1:55586",reuseExistingServer:false,
    env:{VITE_SUPABASE_URL:"http://127.0.0.1:55587",VITE_SUPABASE_PUBLISHABLE_KEY:"fixture-public",VITE_API_URL:"http://127.0.0.1:55587/api"}},
});
