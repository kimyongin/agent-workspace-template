// 웹↔MCP 실제 사용자 흐름 E2E. 로컬 Supabase·Edge Functions가 떠 있어야 한다(npm run setup:local, npm run serve:functions).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  fullyParallel: false,
  // 로컬 Edge/DB 연결 한도 안에서 브라우저와 OAuth 흐름을 재현한다.
  workers: 2,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: "http://127.0.0.1:55480", trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: { command: "npm run dev", url: "http://127.0.0.1:55480", reuseExistingServer: true, timeout: 60_000 },
});
