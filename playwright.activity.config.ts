import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir:"e2e", testMatch:"activity.fixture.ts", fullyParallel:true, workers:3, retries:0,
  outputDir:"test-results/activity-fixture",
  use:{baseURL:"http://127.0.0.1:55580",trace:"retain-on-failure",timezoneId:"Asia/Seoul"},
  // UTC desktop previously ran in workspace-screens; retain that date variant here.
  projects:[{name:"desktop-utc",use:{...devices["Desktop Chrome"],timezoneId:"UTC"}},{name:"desktop",use:{...devices["Desktop Chrome"]}},{name:"mobile",use:{...devices["Pixel 7"]}}],
  webServer:{command:"npm run dev -- --port 55580",url:"http://127.0.0.1:55580",reuseExistingServer:false,
    env:{VITE_API_URL:"http://127.0.0.1:55581/api",VITE_SUPABASE_URL:"http://127.0.0.1:55581",VITE_SUPABASE_PUBLISHABLE_KEY:"fixture-public-key"}},
});
