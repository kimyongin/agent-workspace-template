import { expect, test } from "@playwright/test";
import { devLogin, env } from "./support.ts";
// Serial real Auth metadata round trip, run by the integration owner.
test("personal navigation partial save survives reload and login without changing other profile metadata", async ({ page }) => {
  await devLogin(page);
  const tokenResponse = await page.request.post(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY },
    data: { email: env.DEV_USER_A_EMAIL, password: env.DEV_USER_A_PASSWORD },
  });
  expect(tokenResponse.ok()).toBe(true);
  const token = (await tokenResponse.json()).access_token;
  const headers = { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${token}` };
  const read = async () => {
    const response = await page.request.get(`${env.VITE_SUPABASE_URL}/auth/v1/user`, { headers });
    expect(response.ok()).toBe(true);
    return (await response.json()).user_metadata as Record<string, unknown>;
  };
  const before = await read();
  try {
    await page.goto("/settings");
    await page.getByRole("link", { name: "메뉴 바로가기", exact: true }).click();
    const list = page.getByRole("list", { name: "선택한 바로가기" });
    await expect(list).toBeVisible();
    while (await list.locator("li").count()) await list.getByRole("button", { name: /숨기기$/ }).first().click();
    const save = page.getByRole("button", { name: "메뉴 바로가기 저장" });
    if (await save.isEnabled()) {
      await save.click();
      await expect(page.getByRole("status")).toHaveText("메뉴 설정을 저장했습니다.");
    }
    await page.getByRole("button", { name: "원칙 추가", exact: true }).click();
    await page.getByRole("button", { name: "할 일 추가", exact: true }).click();
    await page.getByRole("button", { name: "메뉴 바로가기 저장" }).click();
    await expect(page.getByRole("status")).toHaveText("메뉴 설정을 저장했습니다.");
    const after = await read();
    expect(after.workspace_navigation).toEqual({
      version: 1,
      refs: [{ kind: "builtin", id: "principles" }, { kind: "builtin", id: "tasks" }],
    });
    const { workspace_navigation: _old, ...oldOther } = before;
    const { workspace_navigation: _next, ...newOther } = after;
    expect(newOther).toEqual(oldOther);
    await page.reload();
    await expect(page.getByRole("navigation", { name: "주 메뉴", exact: true }).locator(".bottom-nav-inner > a"))
      .toHaveText(["☆원칙", "⚒할 일"]);
    await page.getByRole("button", { name: "내 프로필", exact: true }).click();
    await page.locator("#nav-profile-options").getByRole("link", { name: "로그아웃", exact: true }).click();
    await expect(page.getByRole("heading", { name: "로그인", exact: true })).toBeVisible();
    await devLogin(page);
    await expect(page.getByRole("navigation", { name: "주 메뉴", exact: true }).locator(".bottom-nav-inner > a"))
      .toHaveText(["☆원칙", "⚒할 일"]);
  } finally {
    const restored = await page.request.put(`${env.VITE_SUPABASE_URL}/auth/v1/user`, {
      headers,
      data: { data: { workspace_navigation: before.workspace_navigation ?? null } },
    });
    expect(restored.ok()).toBe(true);
  }
});
