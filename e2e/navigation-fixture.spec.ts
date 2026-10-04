// UI 계약만 검사한다. 임시 Auth 세션과 route 응답이며 실제 인증/DB/E2E 증거와 구분한다.
import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/functions/v1/api/")) {
      await route.fulfill({ json: { items: [], next_cursor: null } });
    } else if (url.origin === new URL(baseURL!).origin) await route.continue();
    else await route.abort();
  });
  await page.addInitScript(() => {
    localStorage.setItem("sb-127-auth-token", JSON.stringify({
      access_token: "ui-fixture", refresh_token: "ui-fixture", token_type: "bearer",
      expires_at: Math.floor(Date.now() / 1000) + 3600,
      user: { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated" },
    }));
  });
});

test("하단 탐색·활동·첫 사용 흐름은 모든 폭과 큰 글자에서 조작할 수 있다", async ({ page }, testInfo) => {
  for (const width of [360, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/tasks");
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    await expect(nav.getByRole("link", { name: "활동", exact: true })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("navigation", { name: "활동 종류" }).getByRole("link", { name: "할 일", exact: true })).toHaveAttribute("aria-current", "page");
    await page.screenshot({ path: testInfo.outputPath(`tasks-${width}.png`) });
    await page.getByRole("link", { name: "처음이라면 사용 가이드" }).click();
    await expect(page.getByRole("heading", { name: "사용 가이드", exact: true })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`guide-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const sizes = await nav.locator("a, .nav-more-trigger").evaluateAll(nodes => nodes.map(node => {
      const rect = node.getBoundingClientRect(); return { width: rect.width, height: rect.height };
    }));
    for (const size of sizes) { expect(size.width).toBeGreaterThanOrEqual(44); expect(size.height).toBeGreaterThanOrEqual(44); }
    await page.getByRole("link", { name: "저장한 기록 확인" }).focus();
    const action = await page.getByRole("link", { name: "저장한 기록 확인" }).boundingBox();
    const bottom = await nav.boundingBox();
    expect(action!.y + action!.height).toBeLessThanOrEqual(bottom!.y);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  // 200% 글자 확대 및 별도 200% zoom의 reflow 폭을 확인한다.
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "더보기", exact: true }).click();
  await expect(page.getByRole("link", { name: "태그 관리", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "더보기", exact: true }).press("Escape");
  await page.evaluate(() => document.documentElement.style.fontSize = "");
  await page.setViewportSize({ width: 720, height: 450 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("더보기 키보드·바깥 클릭·경로 이동과 복사 실패를 안내한다", async ({ page }) => {
  await page.goto("/guide");
  const more = page.getByRole("button", { name: "더보기", exact: true });
  await more.focus(); await more.press("Enter"); await more.press("ArrowDown");
  await expect(page.getByRole("link", { name: "태그 관리", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("link", { name: "사용 가이드", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(more).toBeFocused();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click(); await page.getByRole("heading", { name: "사용 가이드", exact: true }).click();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await more.click(); await page.getByRole("link", { name: "태그 관리", exact: true }).click();
  await expect(page).toHaveURL(/\/tags$/); await expect(more).toHaveAttribute("aria-expanded", "false");
  await page.goto("/guide");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true,
    value: { writeText: async () => { throw new Error("denied"); } } }));
  await page.getByRole("button", { name: "연결 주소 복사" }).click();
  await expect(page.getByRole("status")).toContainText("위 주소를 선택해 직접 복사");
  await expect(page.getByLabel("이 앱의 MCP 연결 주소")).toHaveValue(/\/functions\/v1\/mcp$/);
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true,
    value: { writeText: async () => {} } }));
  await page.getByRole("button", { name: "연결 주소 복사" }).click();
  await expect(page.getByRole("status")).toHaveText("연결 주소를 복사했습니다.");
});
