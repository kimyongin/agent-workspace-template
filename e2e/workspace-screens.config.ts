import { defineConfig, devices } from "@playwright/test";
export default defineConfig({testDir:".",testMatch:["workspace-screens.fixture.ts","activity.fixture.ts","navigation-fixture.spec.ts","consent.spec.ts"],fullyParallel:false,workers:1,retries:0,
  timeout:60_000,reporter:"list",outputDir:"test-results/workspace-screens",
  use:{baseURL:"http://127.0.0.1:55580",trace:"retain-on-failure",screenshot:"only-on-failure"},
  projects:[{name:"screens",use:{...devices["Desktop Chrome"]}}],
  webServer:{command:"npm run dev -- --port 55580",url:"http://127.0.0.1:55580",reuseExistingServer:false,
    env:{VITE_SUPABASE_URL:"http://127.0.0.1:55581",VITE_SUPABASE_PUBLISHABLE_KEY:"fixture-public-key",VITE_API_URL:"http://127.0.0.1:55581/api",VITE_DEV_LOGIN:"true"}},
});
