import { defineConfig } from "@playwright/test";

// 별도 Vite55482 + 공개 loopback fixture 설정으로 실행한다. DB·함수 서비스를 실행하지 않는다.
export default defineConfig({
  testDir: ".",
  testMatch: "navigation-fixture.spec.ts",
  workers: 1,
  use: { baseURL: "http://127.0.0.1:55482", trace: "retain-on-failure" },
});
