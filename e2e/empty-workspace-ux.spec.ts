import { expect } from "@playwright/test";
import { devLogin, test } from "./support.ts";

// A dedicated, newly created local account is required for this first-use scenario.
test.skip(process.env.RUN_EMPTY_WORKSPACE_UX !== "1", "새 빈 시험 계정을 준비한 경우에만 실행합니다.");
test("빈 계정에서 자료 준비와 모든 설정의 다음 행동을 찾고 초안 없이 이동한다", async ({ page }, info) => {
  test.setTimeout(120_000);
  await devLogin(page, "B");
  await expect(page.getByText("아직 할 일이 없습니다.", { exact: true })).toBeVisible();
  await page.goto("/records?q=없는검색어");
  await expect(page.getByText("조건에 맞는 기록이 없습니다.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "검색 조건 해제", exact: true }).click();
  await expect(page.getByText("아직 기록이 없습니다.", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "검색어", exact: true })).toBeFocused();
  await page.goto("/entities");
  await expect(page.getByText("아직 자료 종류가 없습니다.", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "자료 종류 추가", exact: true }).click();
  await expect(page.getByRole("form", { name: "자료 종류 만들기", exact: true })).toBeVisible();
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("자료 종류 선택", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "종류 추가", exact: true })).toHaveCount(0);
  await expect(page.getByRole("status").filter({ hasText: /불러오는 중|읽는 중/ })).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("first-type.png"), fullPage: true });
  for (
    const [path, heading] of [
      ["/settings", "기본 설정"],
      ["/settings/tags", "태그 설정"],
      ["/settings/records", "기록 설정"],
      ["/settings/issuers", "발급처 설정"],
    ]
  ) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "변경을 버릴까요?" })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), heading).toBe(true);
    if (path.endsWith("records")) {
      const target = page.getByLabel("대상", { exact: true });
      await expect(target.locator("option")).toHaveText(["할 일", "원칙"]);
      await target.selectOption("principle");
      await expect(page.getByRole("form", { name: "기록 자동 완성", exact: true })).toBeVisible();
    }
    if (path.endsWith("issuers")) {
      await expect(page.getByText("발급처가 없습니다.", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "발급처 추가", exact: true })).toBeEnabled();
    }
    await expect(page.getByRole("status").filter({ hasText: /불러오는 중|읽는 중/ })).toHaveCount(0);
    await expect(page.getByRole("alert")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`${path.split("/").at(-1)}-empty.png`), fullPage: true });
  }
  await page.goto("/principles");
  await expect(page.getByText("현재 원칙이 없습니다.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "전체 기록 보기", exact: true })).toHaveAttribute("href", "/records");
});
