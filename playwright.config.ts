// 웹↔MCP 실제 사용자 흐름 E2E. 로컬 Supabase·Edge Functions가 떠 있어야 한다(npm run setup:local, npm run serve:functions).
import { defineConfig, devices } from "@playwright/test";
import { readLocalConfig } from "./scripts/local-config.mjs";

const { webUrl } = readLocalConfig();

export default defineConfig({
  testDir: "e2e",
  // Isolated feature fixtures run with their own API origins via test:e2e:all.
  testIgnore: ["**/*fixture*", "**/detail-workspace.spec.ts", "**/display-scale.spec.ts", "**/consent.spec.ts"],
  timeout: 60_000,
  fullyParallel: false,
  // Both projects share DEV_USER_A: account-wide current/history and dictionary fixtures require one writer.
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  use: { baseURL: webUrl, trace: "retain-on-failure" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: { command: "npm run dev", url: webUrl, reuseExistingServer: true, timeout: 60_000 },
});
