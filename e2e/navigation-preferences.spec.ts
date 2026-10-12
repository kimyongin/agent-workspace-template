import { expect } from "@playwright/test";
import { test, devLogin, env } from "./support.ts";
// Serial real Auth metadata round trip, run by the integration owner.
test("personal navigation partial save survives reload and login without changing other profile metadata", async ({ page }) => {
  await devLogin(page);
  const authenticate = async () => {
    const response = await page.request.post(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
      headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY },
      data: { email: env.DEV_USER_A_EMAIL, password: env.DEV_USER_A_PASSWORD },
    });
    expect(response.ok(), `Auth test session creation failed (HTTP ${response.status()})`).toBe(true);
    return await response.json() as { access_token: string; user: { id: string } };
  };
  const original = await authenticate();
  const headers = { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${original.access_token}` };
  const read = async () => {
    const response = await page.request.get(`${env.VITE_SUPABASE_URL}/auth/v1/user`, { headers });
    expect(response.ok()).toBe(true);
    return (await response.json()).user_metadata as Record<string, unknown>;
  };
  const before = await read();
  let bodyFailed = false;
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
    await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true }).click();
    await page.locator("#nav-profile-options").getByRole("link", { name: "로그아웃", exact: true }).click();
    await expect(page.getByRole("heading", { name: "로그인", exact: true })).toBeVisible();
    await devLogin(page);
    await expect(page.getByRole("navigation", { name: "주 메뉴", exact: true }).locator(".bottom-nav-inner > a"))
      .toHaveText(["☆원칙", "⚒할 일"]);
  } catch (cause) {
    bodyFailed = true;
    throw cause;
  } finally {
    try {
      // Global sign-out revokes every earlier password-granted session, including the reader above.
      // Obtain a fresh session solely for restoration, then verify that it belongs to the original account.
      const cleanup = await authenticate();
      expect(cleanup.user.id === original.user.id, "Navigation restoration must use the original account").toBe(true);
      const restored = await page.request.put(`${env.VITE_SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY, authorization: `Bearer ${cleanup.access_token}` },
        data: { data: { workspace_navigation: before.workspace_navigation ?? null } },
      });
      expect(restored.ok(), `Navigation restoration failed (HTTP ${restored.status()})`).toBe(true);
    } catch (cause) {
      if (!bodyFailed) throw cause;
      // Preserve the original assertion and separately flag incomplete restoration, without printing Auth payloads.
      test.info().annotations.push({
        type: "cleanup-failed",
        description: "Navigation restoration also failed; inspect the protected trace.",
      });
      console.error(
        "Navigation restoration also failed; the original test error is preserved. Inspect the protected trace.",
      );
    }
  }
});
