// 실제 App/data-router/Auth SDK를 실행한다. 원격 Auth·API 응답만 격리하며 실제 OAuth/DB 증거와 구분한다.
import { expect, test, type Page } from "@playwright/test";
const user = { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", email: "fixture@example.test", app_metadata: {}, user_metadata: { full_name: "Fixture", workspace_avatar_id: "person", provider_value: "preserved" } };
test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/functions/v1/api/")) await route.fulfill({ json: { items: [], next_cursor: null } });
    else if (url.origin === new URL(baseURL!).origin) await route.continue();
    else await route.abort();
  });
  await page.addInitScript(user => {
    if (!sessionStorage.getItem("fixture-started")) {
      sessionStorage.setItem("fixture-started", "true");
      localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: "ui-fixture", refresh_token: "ui-fixture", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, user }));
    }
  }, user);
});
async function settings(page: Page) { await page.getByRole("button", { name: "메뉴", exact: true }).click(); await page.getByRole("link", { name: "설정", exact: true }).click(); }
async function refreshedProfile(page: Page, icon: string) {
  await page.route("**/auth/v1/token*", route => route.fulfill({ json: {
    access_token: "refreshed-fixture", refresh_token: "refreshed-fixture", token_type: "bearer", expires_in: 3600,
    user: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: icon } },
  } }));
}
async function signIn(page: Page, id = user.id) {
  await page.evaluate(async id => {
    const path = "/src/lib/supabase.ts"; const { supabase } = await import(path);
    const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600, sub: id })}.fixture`;
    const { error } = await supabase.auth.setSession({ access_token: token, refresh_token: "fixture-login" }); if (error) throw error;
  }, id);
}

test("세 탭과 프로필·메뉴는 320~1440px와 200%에서 조작 가능하다", async ({ page }, info) => {
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto("/settings");
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    await expect(nav.getByRole("link")).toHaveCount(3);
    await expect(page.locator(".app-header")).toHaveCount(0);
    for (const size of await nav.locator(".bottom-nav-inner > a, .nav-more-trigger").evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return [r.width, r.height]; }))) {
      expect(size[0]).toBeGreaterThanOrEqual(44); expect(size[1]).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("link", { name: "로그아웃", exact: true }).focus();
    const action = await page.getByRole("link", { name: "로그아웃", exact: true }).boundingBox(); const bottom = await nav.boundingBox();
    expect(action!.y + action!.height).toBeLessThanOrEqual(bottom!.y);
    await page.screenshot({ path: info.outputPath(`settings-${width}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("settings-320-text200.png") });
  await page.getByRole("button", { name: "메뉴", exact: true }).click(); await expect(page.getByRole("link", { name: "사용 가이드", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: "메뉴", exact: true })).toBeFocused();
  await page.evaluate(() => document.documentElement.style.fontSize = "");
  // 1440px 화면의 200% 브라우저 확대에 대응하는 CSS reflow 크기.
  await page.setViewportSize({ width: 720, height: 450 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("link", { name: "로그아웃", exact: true }).focus();
  const action = await page.getByRole("link", { name: "로그아웃", exact: true }).boundingBox(); const nav = await page.getByRole("navigation", { name: "주 메뉴" }).boundingBox();
  expect(action!.y + action!.height).toBeLessThanOrEqual(nav!.y);
});

test("팝오버는 하나만 열리며 키보드·외부 클릭·경로 이동에 초점을 유지한다", async ({ page }) => {
  await page.goto("/settings"); const menu = page.getByRole("button", { name: "메뉴", exact: true }); const profile = page.getByRole("button", { name: "내 프로필 · 로그인됨" });
  await profile.click(); await expect(page.locator("#nav-profile-options")).toContainText(user.email);
  await menu.click(); await expect(page.locator("#nav-profile-options")).toHaveCount(0);
  await menu.press("ArrowDown"); await expect(page.getByRole("link", { name: "사용 가이드", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(page.locator("#nav-more-options").getByRole("link", { name: "설정", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(menu).toBeFocused();
  await menu.click();
  await page.getByRole("heading", { name: "설정", exact: true }).click(); await expect(menu).toHaveAttribute("aria-expanded", "false");
  await menu.click(); await page.getByRole("link", { name: "사용 가이드", exact: true }).click(); await expect(page).toHaveURL(/\/guide$/); await expect(menu).toHaveAttribute("aria-expanded", "false");
});

test("아이콘 저장 실패의 초안을 보존하고 서버 성공 응답·재조회·기본 복원을 반영한다", async ({ page }) => {
  await refreshedProfile(page, "leaf");
  let fail = true; let calls = 0;
  await page.route("**/auth/v1/user", async route => {
    calls++; const body = route.request().postDataJSON(); expect(body.data).toEqual({ workspace_avatar_id: "leaf" });
    if (fail) await route.fulfill({ status: 500, json: { msg: "fixture failure" } });
    else await route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "leaf" } } });
  });
  await page.goto("/settings"); await page.getByRole("radio", { name: "잎", exact: true }).check();
  const originalPath = await page.locator(".nav-profile path").getAttribute("d");
  await page.getByRole("button", { name: "아이콘 저장" }).click(); await expect(page.getByRole("alert")).toContainText("선택한 아이콘을 유지"); await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked();
  await expect(page.locator(".nav-profile path")).toHaveAttribute("d", originalPath!);
  fail = false; await page.getByRole("button", { name: "아이콘 저장" }).click(); await expect(page.getByRole("status")).toContainText("저장했습니다"); expect(calls).toBe(2);
  const savedPath = await page.locator(".nav-profile path").getAttribute("d");
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sb-127-auth-token")!).user.user_metadata.provider_value)).toBe("preserved");
  await page.reload(); await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked(); await expect(page.locator(".nav-profile path")).toHaveAttribute("d", savedPath!);
  await page.getByRole("button", { name: "기본값 선택" }).click(); await expect(page.getByRole("radio", { name: "기본", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "변경 취소" }).click(); await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked();
});

test("저장 중 중복 요청과 탭·로그아웃 이동을 막고 응답 뒤 이동할 수 있다", async ({ page }) => {
  await refreshedProfile(page, "sun");
  let finish!: () => void; const waiting = new Promise<void>(resolve => { finish = resolve; }); let calls = 0;
  await page.route("**/auth/v1/user", async route => { calls++; await waiting; await route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "sun" } } }); });
  await page.goto("/settings"); await page.getByRole("radio", { name: "해", exact: true }).check(); await page.getByRole("button", { name: "아이콘 저장" }).click();
  await expect(page.getByRole("button", { name: "저장 중…" })).toBeDisabled(); await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "엔터티", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/); await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("link", { name: "로그아웃", exact: true }).click(); await expect(page).toHaveURL(/\/settings$/); expect(calls).toBe(1);
  finish(); await expect(page.getByRole("status")).toContainText("저장했습니다"); await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "엔터티", exact: true }).click(); await expect(page).toHaveURL(/\/entities$/);
});

test("알 수 없는 아이콘은 기본값이며 계정 전환과 세션 만료는 이전 초안을 지운다", async ({ page }) => {
  await page.goto("/settings");
  await page.evaluate(() => { const stored = JSON.parse(localStorage.getItem("sb-127-auth-token")!); stored.user.user_metadata.workspace_avatar_id = "unknown-old-id"; localStorage.setItem("sb-127-auth-token", JSON.stringify(stored)); });
  await page.reload(); await expect(page.getByRole("radio", { name: "기본", exact: true })).toBeChecked(); await page.getByRole("radio", { name: "별", exact: true }).check();
  const alternate = { ...user, id: "00000000-0000-0000-0000-000000000002", email: "other@example.test", user_metadata: { full_name: "Other", workspace_avatar_id: "leaf" } };
  await page.route("**/auth/v1/user", route => route.fulfill({ json: alternate }));
  await page.evaluate(async user => {
    const path = "/src/lib/supabase.ts"; const { supabase } = await import(path);
    const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600, sub: user.id })}.fixture`;
    const { error } = await supabase.auth.setSession({ access_token: token, refresh_token: "fixture-other" }); if (error) throw error;
  }, alternate);
  await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked(); await expect(page.getByText("other@example.test", { exact: true })).toBeVisible(); await expect(page.getByText(user.email, { exact: true })).toHaveCount(0);
  await page.route("**/auth/v1/logout*", route => route.fulfill({ status: 204 }));
  await page.evaluate(async () => { const path = "/src/lib/supabase.ts"; const { supabase } = await import(path); await supabase.auth.signOut(); });
  await expect(page).toHaveURL(/\/login\?next=/); await expect(page.getByRole("navigation", { name: "주 메뉴" })).toHaveCount(0); await expect(page.getByRole("heading", { name: "로그인", exact: true })).toBeVisible();
});

test("미저장 설정의 탭·메뉴·뒤로가기·로그아웃은 같은 폐기 확인을 거친다", async ({ page }) => {
  let logoutCalls = 0; await page.route("**/auth/v1/logout*", async route => { logoutCalls++; await route.fulfill({ status: 204 }); });
  await page.goto("/guide"); await settings(page); await page.getByRole("radio", { name: "별", exact: true }).check();
  const confirm = page.getByRole("dialog", { name: "변경을 버릴까요?" });
  let step = 0;
  for (const action of [async () => page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "활동", exact: true }).click(), async () => { await page.getByRole("button", { name: "메뉴", exact: true }).click(); await page.getByRole("link", { name: "사용 가이드", exact: true }).click(); }, async () => { await page.goBack(); }, async () => {
    // 취소 뒤 유지된 메뉴는 작은 화면에서 본문의 로그아웃 위에 열린다.
    const menu = page.getByRole("button", { name: "메뉴", exact: true });
    if (await menu.getAttribute("aria-expanded") === "true") await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "false");
    await page.getByRole("link", { name: "로그아웃", exact: true }).click();
  }]) {
    await action(); await expect(confirm).toBeVisible(); await confirm.getByRole("button", { name: "취소", exact: true }).click(); await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
    if (step === 1) { await expect(page.getByRole("link", { name: "사용 가이드", exact: true })).toBeFocused(); await expect(page.getByRole("button", { name: "메뉴", exact: true })).toHaveAttribute("aria-expanded", "true"); }
    step++;
  }
  expect(logoutCalls).toBe(0); await page.getByRole("link", { name: "로그아웃", exact: true }).click(); await confirm.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/); expect(logoutCalls).toBe(1); await expect(page.getByRole("navigation", { name: "주 메뉴" })).toHaveCount(0);
});

test("원격 로그아웃 실패는 로컬 해제를 안내하며 재로그인은 프로필을 복원한다", async ({ page }) => {
  let fail = true; let calls = 0;
  await page.route("**/auth/v1/logout*", async route => { calls++; await route.fulfill(fail ? { status: 500, json: { msg: "fixture failure" } } : { status: 204 }); });
  await page.route("**/auth/v1/user", route => route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "leaf" } } }));
  await page.goto("/settings"); await page.getByRole("link", { name: "로그아웃", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("이 기기에서는 로그아웃했습니다");
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toHaveCount(0);
  fail = false; await page.getByRole("link", { name: "로그인으로 이동", exact: true }).click(); await expect(page).toHaveURL(/\/login$/); expect(calls).toBe(1);
  await signIn(page); await expect(page).toHaveURL(/\/tasks$/); await settings(page); await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked(); expect(calls).toBe(1);
});

test("가이드의 복사 실패와 성공 안내는 유지한다", async ({ page }) => {
  await page.goto("/guide");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  await page.getByRole("button", { name: "연결 주소 복사" }).click(); await expect(page.getByRole("status")).toContainText("위 주소를 선택해 직접 복사");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } }));
  await page.getByRole("button", { name: "연결 주소 복사" }).click(); await expect(page.getByRole("status")).toHaveText("연결 주소를 복사했습니다.");
});
