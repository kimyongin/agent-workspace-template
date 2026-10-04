import { defineConfig } from "@playwright/test";

// navigation 세션 전용 Vite56580 + 공개 loopback fixture. DB·함수 서비스를 실행하지 않는다.
export default defineConfig({
  testDir: ".",
  testMatch: "navigation-fixture.spec.ts",
  workers: 1,
  outputDir: "test-results/navigation-fixtures",
  use: { baseURL: "http://127.0.0.1:56580", trace: "retain-on-failure" },
});
