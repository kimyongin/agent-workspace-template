import { defineConfig, devices } from "@playwright/test";

// navigation 세션 전용 Vite56580 + 공개 loopback fixture. DB·함수 서비스를 실행하지 않는다.
export default defineConfig({
  testDir: ".",
  projects: [
    { name: "navigation", testMatch: ["navigation-fixture.spec.ts", "auth-profile-fixture.spec.ts"], use: { ...devices["Desktop Chrome"] } },
    { name: "consent-desktop", testMatch: "consent.spec.ts", use: { ...devices["Desktop Chrome"] } },
    { name: "consent-mobile", testMatch: "consent.spec.ts", use: { ...devices["Pixel 7"] } },
  ],
  fullyParallel: true, workers: 3,
  outputDir: "test-results/navigation-fixtures",
  webServer: {command:"npm run dev -- --host 127.0.0.1 --port 56580 --strictPort",url:"http://127.0.0.1:56580",reuseExistingServer:true,
    env:{VITE_SUPABASE_URL:"http://127.0.0.1:56581",VITE_SUPABASE_PUBLISHABLE_KEY:"fixture-public-key",VITE_API_URL:"http://127.0.0.1:56581/api",VITE_DEV_LOGIN:"true"}},
  use: { baseURL: "http://127.0.0.1:56580", trace: "retain-on-failure" },
});
