import { execFileSync } from "node:child_process";
import { test } from "vitest";

test("실제 Auth SDK의 초기화·응답·cross-tab 경계와 canonical 표시 회귀", () => {
  execFileSync(process.execPath, ["--test", "e2e/fixtures/auth-profile-boundary.mjs"], { cwd: process.cwd(), stdio: "pipe" });
});
