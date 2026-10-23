import { fulfillFixtureWorkspace } from "./support/workspace-scope.ts";
import { fixtureWorkspacePath } from "./support/workspace-scope.ts";
import { fixtureWorkspaceId } from "./support/workspace-scope.ts";
import { closeMainNavigation, listHeader, openMainNavigation } from "./ui-actions.ts";
import {
  fixtureSchema,
  fixtureType,
} from "./support/workspace-data.ts";
import { settingsResponse } from "./support/preparation-api.ts";
// 실제 App/data-router/Auth SDK를 실행한다. 원격 Auth·API 응답만 격리하며 실제 OAuth/DB 증거와 구분한다.
import { expect, type Page, test } from "@playwright/test";
const user = { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", email: "fixture@example.test", app_metadata: {}, user_metadata: { full_name: "Fixture", workspace_avatar_id: "person", provider_value: "preserved" } };
test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (await fulfillFixtureWorkspace(route, [{ target_kind: "settings", target_id: "*", access: "write" }, { target_kind: "tasks", target_id: "*", access: "write" }, { target_kind: "entity_type", target_id: fixtureType.id, access: "write" }])) return;
    if (url.pathname === "/api/entity-types") {
      await route.fulfill({json:{items:[fixtureType],next_cursor:null}});
    } else if (url.pathname.startsWith("/api/entity-types/")) {
      await route.fulfill({
        json: url.pathname.endsWith("/schema")
          ? fixtureSchema
          : fixtureType,
      });
    } else if (url.pathname.endsWith("/settings/business")) {
      await route.fulfill({
        json: settingsResponse(route, {
          versions: { record_templates:0 },
          settings: { record_templates:{} },
        }),
      });
    } else if (/\/(?:functions\/v1\/)?api\//.test(url.pathname)) await route.fulfill({ json: { items: [], next_cursor: null } });
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
const profileDisplay = (page: Page) => page.getByRole("group", { name: /^내 프로필(?: · .+)?$/, exact: true });
const mainMenu = (page: Page) => page.getByRole("navigation", { name: "주 메뉴", exact: true });
const profileIcon = (page: Page) => profileDisplay(page).locator("[aria-hidden=true]").first();
const openNavigation = openMainNavigation;

for (const width of [390, 1440]) test(`공간 선택이 헤더에 있는 모바일 탐색 ${width}px`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 844 });
  await page.goto(fixtureWorkspacePath("/tasks"));
  const banner = page.getByRole("banner");
  await expect(banner.getByText("Workspace", { exact: true })).toBeVisible();
  if (width < 1024) {
    await expect(banner.getByText("테스트 공간", { exact: true })).toBeVisible();
    await expect(banner.locator("img")).toHaveCount(1);
    const brand = (await banner.getByText("Workspace", { exact: true }).boundingBox())!;
    const name = (await banner.getByText("테스트 공간", { exact: true }).boundingBox())!;
    expect(name.y).toBeCloseTo(brand.y, 0);
  } else await expect(banner.getByText("테스트 공간", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath(`identity-${width}.png`), animations: "disabled" });
  await openNavigation(page);
  const nav = mainMenu(page), switcher = nav.getByRole("button", { name: "공간 선택", exact: true });
  await expect(switcher).toHaveCount(1);
  await expect(switcher).toContainText("테스트 공간");
  if (width < 1024) {
    const header = nav.locator('[data-slot="sheet-header"]');
    await expect(header.getByRole("button", { name: "공간 선택", exact: true })).toHaveCount(1);
    await expect(nav.getByText("Workspace", { exact: true })).toHaveCount(0);
    const a = (await switcher.boundingBox())!, b = (await nav.getByRole("button", { name: "메뉴 닫기", exact: true }).boundingBox())!;
    expect(a.y + a.height / 2).toBeCloseTo(b.y + b.height / 2, 0);
  }
  await page.screenshot({ path: info.outputPath(`drawer-identity-${width}.png`), animations: "disabled" });
  await nav.getByRole("link", { name: "로그아웃", exact: true }).scrollIntoViewIfNeeded();
  if (width < 1024) await expect(switcher).toBeInViewport({ ratio: 1 });
  else await switcher.scrollIntoViewIfNeeded();
  await switcher.click();
  await expect(page.getByRole("menuitem", { name: "테스트 공간", exact: true })).toHaveAttribute("aria-current", "page");
  await page.keyboard.press("Escape");
  await expect(switcher).toBeFocused();
  await closeMainNavigation(page);
});

test("긴 공간 이름과 200% 확대에서도 모바일 헤더와 고정 선택·닫기가 넘치지 않는다", async ({ page }, info) => {
  const name = "긴워크스페이스이름".repeat(12);
  const workspace = { id: fixtureWorkspaceId, name, deleted_at: null };
  await page.route("**/api/workspaces**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/workspaces") return route.fulfill({ json: { items: [workspace] } });
    if (path === `/api/workspaces/${fixtureWorkspaceId}`) return route.fulfill({ json: {
      workspace, can_manage: true, membership_version: 1,
      grants: [{ target_kind: "settings", target_id: "*", access: "write" }, { target_kind: "tasks", target_id: "*", access: "write" }],
    } });
    await route.fallback();
  });
  await page.setViewportSize({ width: 320, height: 400 });
  await page.goto(fixtureWorkspacePath("/tasks"));
  const label = page.getByRole("banner").getByText(name, { exact: true });
  await expect(label).toBeVisible();
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  await expect(label).toBeVisible();
  expect((await label.boundingBox())!.width).toBeGreaterThan(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("identity-long-200.png"), animations: "disabled" });
  await openNavigation(page);
  const nav = mainMenu(page), switcher = nav.getByRole("button", { name: "공간 선택", exact: true });
  await expect(switcher).toContainText(name);
  await expect(switcher).toHaveAccessibleDescription(name);
  expect((await switcher.getByText(name, { exact: true }).boundingBox())!.width).toBeGreaterThanOrEqual(44);
  await nav.getByRole("link", { name: "로그아웃", exact: true }).scrollIntoViewIfNeeded();
  for (const control of [switcher, nav.getByRole("button", { name: "메뉴 닫기", exact: true })]) {
    await expect(control).toBeInViewport({ ratio: 1 });
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("drawer-long-200.png"), animations: "disabled" });
  await closeMainNavigation(page);
});

test("공간 문맥 없는 계정 화면은 모바일 헤더에 앱만 표시한다", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings");
  const banner = page.getByRole("banner");
  await expect(banner.getByText("Workspace", { exact: true })).toBeVisible();
  await expect(banner.getByText("테스트 공간", { exact: true })).toHaveCount(0);
  await expect(banner.getByText("·", { exact: true })).toHaveCount(0);
  await expect(banner.locator("img")).toHaveCount(1);
  await openNavigation(page);
  await expect(mainMenu(page).getByRole("button", { name: "공간 선택", exact: true })).toHaveText("공간 선택");
});
async function settings(page: Page) { await openNavigation(page); await mainMenu(page).getByRole("link", { name: "기본 설정", exact:true }).click(); }
async function requestLogout(page: Page) {
  await openNavigation(page);
  await mainMenu(page).getByRole("link", { name: "로그아웃", exact: true }).click();
}
async function refreshedProfile(page: Page, icon: () => string) {
  await page.route("**/auth/v1/user", route => {
    if (route.request().method() === "PUT") return route.fallback();
    return route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: icon() } } });
  });
}
async function signIn(page: Page, id = user.id) {
  await page.evaluate(async id => {
    const path = "/src/lib/supabase.ts"; const { supabase } = await import(path);
    const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600, sub: id })}.fixture`;
    const { error } = await supabase.auth.setSession({ access_token: token, refresh_token: "fixture-login" }); if (error) throw error;
  }, id);
}

test("자료 메뉴와 계정 정보는 320~1440px와 200%에서 조작 가능하다", async ({ page }, info) => {
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto(fixtureWorkspacePath("/settings"));
    await expect(page.getByRole("banner").getByText("Workspace", { exact: true })).toBeVisible();
    const spaces = page.getByRole("region", { name: "워크스페이스", exact: true }).getByRole("link", { name: "공간 목록 · 새 공간", exact: true });
    await expect(spaces).toHaveAttribute("href", "/workspaces");
    await expect(spaces).toBeVisible();
    await openNavigation(page);
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    const switcher = nav.getByRole("button", { name: "공간 선택", exact: true });
    await expect(switcher).toBeVisible();
    const switcherBox = (await switcher.boundingBox())!;
    expect(switcherBox.width).toBeGreaterThanOrEqual(44); expect(switcherBox.height).toBeGreaterThanOrEqual(44);
    for (const name of [fixtureType.label, "할 일", "기록"]) {
      const link = nav.getByRole("link", { name, exact: true }); await expect(link).toBeVisible();
      const box = (await link.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await openNavigation(page);
    const action = mainMenu(page).getByRole("link", { name: "로그아웃", exact: true }); await action.focus();
    await expect(action).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`settings-${width}.png`) });
    await closeMainNavigation(page);
  }
  for (const [width, height, text] of [[320, 844, "200%"], [720, 450, ""]] as const) {
    await page.setViewportSize({ width, height }); await page.goto(fixtureWorkspacePath("/settings"));
    await page.evaluate(text => document.documentElement.style.fontSize = text, text);
    await openNavigation(page); await expect(mainMenu(page).getByRole("link", { name: "기록 설정", exact: true })).toBeVisible();
    await mainMenu(page).getByRole("link", { name: "로그아웃", exact: true }).focus(); await expect(mainMenu(page).getByRole("link", { name: "로그아웃", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`settings-reflow-${width}.png`) });
    await closeMainNavigation(page);
    await page.evaluate(() => document.documentElement.style.fontSize = "");
  }
});

test("설정과 계정 목적지는 드로어에 펼치고 현재 위치를 표시한다", async ({ page }) => {
  await page.goto(fixtureWorkspacePath("/settings"));
  await openNavigation(page);
  const navigation = mainMenu(page);
  await expect(page.getByRole("button", { name: "설정 메뉴", exact: true })).toHaveCount(0);
  await expect(navigation.getByRole("button", { name: "내 프로필", exact: true })).toHaveCount(0);
  await expect(navigation.locator('[aria-haspopup="menu"]')).toHaveCount(1);
  for (const name of ["기본 설정", "자료 설정", "태그 설정", "기록 설정", "공간 목록 · 새 공간", "상태", "로그아웃"]) {
    await expect(navigation.getByRole("link", { name, exact: true })).toHaveCount(1);
  }
  await expect(navigation.getByRole("link", { name: "기본 설정", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(navigation.getByRole("link", { name: "사용 가이드", exact: true })).toHaveCount(0);
  await navigation.getByRole("link", { name: "상태", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(navigation.getByRole("link", { name: "로그아웃", exact: true })).toBeFocused();
  await navigation.getByRole("link", { name: "기록 설정", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/records$/);
  await expect(page.getByRole("heading", { name: "기록 설정", exact: true })).toBeVisible();
});

test("저장 실패의 초안을 보존하고 서버 성공 응답·재조회·기본 복원을 반영한다", async ({ page }) => {
  let fail = true; let calls = 0;
  await refreshedProfile(page, () => fail ? "person" : "leaf");
  await page.route("**/auth/v1/user", async route => {
    if (route.request().method() !== "PUT") return route.fallback();
    calls++; const body = route.request().postDataJSON(); expect(body.data).toEqual({ workspace_avatar_id: "leaf" });
    if (fail) await route.fulfill({ status: 500, json: { msg: "fixture failure" } });
    else await route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "leaf" } } });
  });
  await page.goto(fixtureWorkspacePath("/settings")); await page.getByRole("radio", { name: "잎", exact: true }).check();
  const originalPath = await profileIcon(page).textContent();
  await page.getByRole("button",{name:"프로필 저장", exact: true }).click(); await expect(page.getByRole("form",{name:"프로필 설정"}).getByRole("alert")).toContainText("입력한 설정을 유지"); await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked();
  await expect(profileIcon(page)).toHaveText(originalPath!);
  fail = false; await page.getByRole("button",{name:"프로필 저장", exact: true }).click(); await expect(page.getByRole("form",{name:"프로필 설정"}).getByRole("status")).toContainText("저장했습니다"); expect(calls).toBe(2);
  const savedPath = await profileIcon(page).textContent();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sb-127-auth-token")!).user.user_metadata.provider_value)).toBe("preserved");
  await page.reload(); await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked(); await expect(profileIcon(page)).toHaveText(savedPath!);
  await page.getByRole("radio", { name: "기본", exact: true }).check(); await expect(page.getByRole("radio", { name: "기본", exact: true })).toBeChecked();
  await page.getByRole("form",{name:"프로필 설정"}).getByRole("button",{name:"변경 취소" }).click(); await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked();
});

test("저장 중 중복 요청과 탭·로그아웃 이동을 막고 응답 뒤 이동할 수 있다", async ({ page }) => {
  let saved = false;
  await refreshedProfile(page, () => saved ? "sun" : "person");
  let finish!: () => void; const waiting = new Promise<void>(resolve => { finish = resolve; }); let calls = 0;
  await page.route("**/auth/v1/user", async route => { if (route.request().method() !== "PUT") return route.fallback(); calls++; await waiting; saved = true; await route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "sun" } } }); });
  await page.goto(fixtureWorkspacePath("/settings")); await page.getByRole("radio", { name: "해바라기", exact: true }).check(); await page.getByRole("button",{name:"프로필 저장", exact: true }).click();
  await expect(page.getByRole("button",{name:"프로필 저장" })).toBeDisabled(); await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: fixtureType.label, exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/); await expect(page.getByRole("dialog")).toHaveCount(0);
  await requestLogout(page); await expect(page).toHaveURL(/\/settings$/); expect(calls).toBe(1);
  finish(); await expect(page.getByRole("form",{name:"프로필 설정"}).getByRole("status")).toContainText("저장했습니다"); await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: fixtureType.label, exact: true }).click(); await expect(page).toHaveURL(new RegExp(`/entities\\?entity_type_id=${fixtureType.id}$`));
});

test("알 수 없는 아이콘은 기본값이며 계정 전환과 세션 만료는 이전 초안을 지운다", async ({ page }) => {
  await page.goto(fixtureWorkspacePath("/settings"));
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
  await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked(); await expect(page.getByLabel("닉네임", { exact: true })).toHaveValue(""); await expect(page.getByLabel("닉네임", { exact: true })).toHaveAttribute("placeholder", "Other"); await expect(page.getByText(user.email, { exact: true })).toHaveCount(0);
  await page.route("**/auth/v1/logout*", route => route.fulfill({ status: 204 }));
  await page.evaluate(async () => { const path = "/src/lib/supabase.ts"; const { supabase } = await import(path); await supabase.auth.signOut(); });
  await expect(page).toHaveURL(/\/login\?next=/); await expect(page.getByRole("navigation", { name: "주 메뉴" })).toHaveCount(0); await expect(page.getByRole("heading", { name: "로그인", exact: true })).toBeVisible();
});

test("미저장 설정의 탭·프로필·뒤로가기·로그아웃은 같은 폐기 확인을 거친다", async ({ page }) => {
  let logoutCalls = 0; await page.route("**/auth/v1/logout*", async route => { logoutCalls++; await route.fulfill({ status: 204 }); });
  await page.goto(fixtureWorkspacePath("/guide")); await settings(page); await page.getByRole("radio", { name: "별", exact: true }).check();
  const confirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
  let step = 0;
  for (const action of [async () => page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "할 일", exact: true }).click(), async () => { await openNavigation(page); await mainMenu(page).getByRole("link", { name: "기록 설정", exact: true }).click(); }, async () => { await page.goBack(); }, async () => {
    await requestLogout(page);
  }]) {
    await action(); await expect(confirm).toBeVisible(); await confirm.getByRole("button", { name: "취소", exact: true }).click(); await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
    if (step === 1) await expect(mainMenu(page).getByRole("link", { name: "기록 설정", exact: true })).toBeFocused();
    if (step === 3) {
      await expect(mainMenu(page).getByRole("link", { name: "로그아웃", exact: true })).toBeFocused();
    }
    step++;
  }
  expect(logoutCalls).toBe(0); await requestLogout(page); await confirm.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/); expect(logoutCalls).toBe(1); await expect(page.getByRole("navigation", { name: "주 메뉴" })).toHaveCount(0);
});

test("원격 로그아웃 실패는 로컬 해제를 안내하며 재로그인은 프로필을 복원한다", async ({ page }, info) => {
  let fail = true; let calls = 0;
  await page.route("**/auth/v1/logout*", async route => { calls++; await route.fulfill(fail ? { status: 500, json: { msg: "fixture failure" } } : { status: 204 }); });
  await page.route("**/auth/v1/user", route => route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "leaf" } } }));
  await page.goto(fixtureWorkspacePath("/settings")); await requestLogout(page);
  await expect(page.getByRole("alert")).toContainText("이 기기에서는 로그아웃했습니다",{timeout:15000});
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toHaveCount(0);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`logout-failure-${width}.png`) });
  }
  fail = false; await page.getByRole("link", { name: "로그인으로 이동", exact: true }).click(); await expect(page).toHaveURL(/\/login$/); expect(calls).toBe(1);
  await signIn(page);
  await expect(page).toHaveURL(/\/workspaces$/);
  const workspace = page.getByRole("table", { name: "공간 목록", exact: true }).getByRole("row").filter({ hasText: "테스트 공간" });
  await expect(workspace).toHaveCount(1);
  const enter = workspace.getByRole("link", { name: "열기", exact: true });
  await expect(enter).toHaveAttribute("href", fixtureWorkspacePath(""));
  await enter.click();
  await expect(page).toHaveURL(new URL(fixtureWorkspacePath("/tasks"), page.url()).href);
  await settings(page); await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked(); expect(calls).toBe(1);
});

test("떠난 로그아웃의 늦은 성공은 보호 화면의 로그인 복귀 경로를 덮지 않는다", async ({ page }) => {
  let release!: () => void, arrived!: () => void;
  let calls = 0;
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { arrived = resolve; });
  await page.route("**/auth/v1/logout*", async route => {
    calls++;
    arrived();
    await waiting;
    await route.fulfill({ status: 204 });
  });
  await page.route("**/auth/v1/user", route => route.fulfill({ json: user }));
  const original = fixtureWorkspacePath("/settings?logout_return=1#settings-profile");
  await page.goto(original);
  await expect(page.getByRole("heading", { name: "기본 설정", exact: true })).toBeVisible();
  await requestLogout(page);
  await started;
  try {
    await expect(page).toHaveURL(/\/logout$/);
    await page.goBack();
    await expect(page).toHaveURL(new URL(original, page.url()).href);
    await expect(page.getByRole("heading", { name: "기본 설정", exact: true })).toBeVisible();
    release();
    await expect(page.getByRole("heading", { name: "로그인", exact: true })).toBeVisible();
    expect(await page.evaluate(async () => {
      const path = "/src/lib/supabase.ts";
      const { supabase } = await import(path);
      const { data } = await supabase.auth.getSession();
      return { actor: data.session?.user.id ?? null, stored: localStorage.getItem("sb-127-auth-token") };
    })).toEqual({ actor: null, stored: null });
    await expect(page).toHaveURL(new URL(`/login?next=${encodeURIComponent(original)}`, page.url()).href);
    await expect(page.getByRole("navigation", { name: "주 메뉴", exact: true })).toHaveCount(0);
    await signIn(page);
    await expect(page).toHaveURL(new URL(original, page.url()).href);
    await expect(page.getByRole("heading", { name: "기본 설정", exact: true })).toBeVisible();
    expect(calls).toBe(1);
  } finally {
    release();
  }
});

test("가이드의 복사 실패와 성공 안내는 유지한다", async ({ page }) => {
  await page.goto(fixtureWorkspacePath("/guide"));
  await page.getByText("설치·연결 정보",{exact:true}).click();
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  await page.getByRole("button", { name: "연결 주소 복사" }).click(); await expect(page.getByRole("status")).toContainText("위 주소를 선택해 직접 복사");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } }));
  await page.getByRole("button", { name: "연결 주소 복사" }).click(); await expect(page.getByRole("status")).toHaveText("연결 주소를 복사했습니다.");
});

for (const width of [390, 1440]) test(`#205 ${width}px: 설정·가이드 구획과 펼친 탐색`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 900 }); await page.goto(fixtureWorkspacePath("/settings"));
  for (const name of ["프로필 설정", "화면 표시 설정"]) await expect(page.getByRole("form", { name, exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath(`settings-${width}.png`) });
  await openNavigation(page); await mainMenu(page).getByRole("link", { name: "로그아웃", exact: true }).focus(); await expect(mainMenu(page).getByRole("link", { name: "로그아웃", exact: true })).toBeInViewport();
  await closeMainNavigation(page);
  await page.goto(fixtureWorkspacePath("/guide")); await expect(page.getByRole("list").filter({ has: page.getByRole("heading", { level: 2 }) }).locator(":scope > li")).toHaveCount(5);
  await page.screenshot({ path: info.outputPath(`guide-${width}.png`) });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const [label, path] of [["할 일로 이동", "/tasks"], ["기록으로 이동", "/records"]]) {
    const link = page.getByRole("link", { name: label, exact: true });
    await expect(link).toHaveAttribute("href", fixtureWorkspacePath(path));
    await link.click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await page.goBack();
    await expect(page.getByRole("heading", { name: "사용 가이드", level: 1, exact: true })).toBeVisible();
  }
  if (width >= 1024) for (const height of [320, 280]) {
    await page.setViewportSize({ width, height }); await openNavigation(page); await mainMenu(page).getByRole("link", { name: "로그아웃", exact: true }).focus(); await expect(mainMenu(page).getByRole("link", { name: "로그아웃", exact: true })).toBeInViewport();
    await page.keyboard.press("Escape");
  }
});

// #215 exercises the real App shell and URL filters without writing user data.
test("#215 메인 목록 탭의 상단 구획·브랜드·필터 조작은 좁은 화면에서도 정렬된다", async ({ page }, info) => {
  test.setTimeout(90_000);
  for (const width of [320, 360, 390, 479, 480, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [path, title] of [["entities", "전체 자료"], ["tasks", "할 일"], ["records", "기록"]]) {
      await page.goto(fixtureWorkspacePath(`/${path}`));
      const header = page.getByRole("region", { name: title, exact: true });
      await expect(header.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
      await expect(page.getByRole("banner")).toBeVisible();

      const search = header.getByRole("textbox", { name: path === "entities" ? "자료 제목 검색" : "검색어", exact: true }), toggle = header.getByRole("button", { name: /^필터 (열기|닫기)/ });
      const closedToggle = (await toggle.boundingBox())!;
      await toggle.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      const reset = header.getByRole("button", { name: "조건 초기화", exact: true });
      const s = (await search.boundingBox())!, t = (await toggle.boundingBox())!, r = (await reset.boundingBox())!;
      expect(t.x).toBeCloseTo(closedToggle.x);
      expect(t.y).toBeCloseTo(closedToggle.y);
      expect(t.y + t.height / 2).toBeCloseTo(s.y + s.height / 2);
      expect(t.height).toBeCloseTo(s.height);
      expect(s.x + s.width).toBeLessThanOrEqual(t.x);
      expect(r.y).toBeGreaterThanOrEqual(t.y + t.height);
      await expect(header.getByRole("heading", { name: "필터", exact: true })).toBeVisible();
      for (const button of [toggle, reset]) { const b = (await button.boundingBox())!; expect(b.height).toBeGreaterThanOrEqual(44); expect(b.width).toBeGreaterThanOrEqual(44); }
      await reset.click(); expect(new URL(page.url()).searchParams.get("filters")).toBe("1");
      await page.reload(); await expect(page.getByRole("button", { name: "필터 닫기", exact: true })).toHaveAttribute("aria-expanded", "true");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 390 || width === 1440) await page.screenshot({ path: info.outputPath(`main-${path}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto(fixtureWorkspacePath("/entities?entity_type_id=00000000-0000-4000-8000-000000000900&filters=1&property_filters=%5B%7B%22key%22%3A%22prop_4%22%2C%22operator%22%3A%22eq%22%2C%22value%22%3A%22a%22%7D%5D"));
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  const toggle = page.getByRole("button", { name: /필터 닫기/ }), reset = listHeader(page).getByRole("button", { name: "조건 초기화" });
  const t = (await toggle.boundingBox())!, r = (await reset.boundingBox())!;
  expect(r.y >= t.y + t.height || r.x >= t.x + t.width).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => document.documentElement.style.fontSize = "");
  await page.setViewportSize({ width: 1440, height: 280 });
  await expect(page.getByRole("banner")).toBeVisible();
  await expect(page.getByRole("button", { name: "주 메뉴 열기", exact: true })).toBeVisible();
});

// #217 checks actual accessible profile choices and the official navigation menu.
test("#217 아이콘 선택은 가용 폭에서 조작 가능하고 펼친 드로어는 키보드로 이동한다", async ({ page }, info) => {
  const columns: number[] = [];
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(fixtureWorkspacePath("/settings"));
    const grid = page.getByRole("radiogroup", { name: "프로필 아이콘", exact: true });
    await expect(grid).toBeVisible();
    await expect(grid.getByRole("radio")).toHaveCount(20);
    const tiles = await grid.locator("label").evaluateAll(nodes => nodes.map(el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height }; }));
    expect(tiles).toHaveLength(20); columns.push(tiles.filter(tile => Math.abs(tile.y - tiles[0].y) < 1).length);
    for (const tile of tiles) { expect(tile.width).toBeGreaterThanOrEqual(44); expect(tile.height).toBeGreaterThanOrEqual(44); }
    await openNavigation(page); const popup = mainMenu(page);
    for (const name of ["기본 설정", "자료 설정", "태그 설정", "기록 설정", "상태", "로그아웃"]) await expect(popup.getByRole("link", { name, exact: true })).toHaveCount(1);
    await popup.getByRole("link", { name: "상태", exact: true }).focus();
    await page.keyboard.press("Tab"); await expect(popup.getByRole("link", { name: "로그아웃", exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390 || width === 1440) await page.screenshot({ path: info.outputPath(`profile-${width}.png`) });
    await closeMainNavigation(page);
  }
  expect(new Set(columns).size).toBeGreaterThan(1);
  for (const height of [320, 280]) {
    await page.setViewportSize({ width: 1440, height }); await openNavigation(page); await mainMenu(page).getByRole("link", { name: "로그아웃", exact: true }).focus(); await expect(mainMenu(page).getByRole("link", { name: "로그아웃", exact: true })).toBeInViewport();
    await page.keyboard.press("Escape");
  }
});

test("#340 열린 메뉴가 화면 높이·확대·긴 닉네임 변경에도 화면 안에 유지된다", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/auth/v1/user", route => route.fulfill({json:{...user,user_metadata:{...user.user_metadata,full_name:"긴 닉네임 ".repeat(15)}}}));
  await page.goto(fixtureWorkspacePath("/settings")); await openNavigation(page);
  const popup = mainMenu(page);
  for (const height of [900, 481, 480, 321, 320, 280, 900]) {
    await page.setViewportSize({width:1440,height});
    await openNavigation(page);
    await expect.poll(async()=>{const box=(await popup.boundingBox())!;return box.y>=0 && box.y+box.height<=height;}).toBe(true);
    await popup.getByRole("link", { name: "로그아웃",exact:true}).focus();
    await expect(popup.getByRole("link", { name: "로그아웃",exact:true})).toBeInViewport();
  }
  await page.evaluate(()=>document.documentElement.style.fontSize="200%");
  await page.setViewportSize({width:1440,height:320});
  await openNavigation(page);
  await expect.poll(async()=>{const box=(await popup.boundingBox())!;return box.y>=0 && box.y+box.height<=320;}).toBe(true);
  await popup.getByRole("link", { name: "로그아웃",exact:true}).focus();
  await expect(popup.getByRole("link", { name: "로그아웃",exact:true})).toBeInViewport();
  expect(errors).toEqual([]);
});

for (const width of [390, 1440]) test(`자료 그룹 통합과 펼친 드로어 시각 검수 ${width}px`, async ({ page }, info) => {
  await page.addInitScript(() => {
    const key = "sb-127-auth-token";
    const session = JSON.parse(localStorage.getItem(key)!);
    session.user.user_metadata.workspace_navigation = { version: 1, refs: [{ kind: "builtin", id: "tasks" }, { kind: "builtin", id: "records" }] };
    localStorage.setItem(key, JSON.stringify(session));
  });
  await page.setViewportSize({ width, height: width === 1440 ? 1100 : 844 });
  await page.goto(fixtureWorkspacePath("/settings/records"));
  await expect(page.getByRole("heading", { name: "기록 설정", exact: true, level: 1 })).toBeVisible();
  await openNavigation(page);
  const nav = mainMenu(page);
  const materials = nav.locator('[data-slot="sidebar-group"][aria-label="자료"]');
  await expect(materials.getByRole("link")).toHaveText(["전체 자료", fixtureType.label]);
  await expect(nav.getByText("업무", { exact: true })).toHaveCount(0);
  await expect(nav.getByText("자료 종류", { exact: true })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "할 일", exact: true })).toHaveCount(1);
  await expect(nav.getByRole("link", { name: "기록 설정", exact: true })).toHaveAttribute("aria-current", "page");
  await nav.getByRole("link", { name: "기록 설정", exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath(`drawer-merged-${width}.png`), animations: "disabled" });
});

test("종류 수가 줄어도 남은 검색 조건을 같은 자리에서 해제할 수 있다", async ({ page }) => {
  const types = Array.from({ length: 9 }, (_, index) => ({ ...fixtureType, id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`, label: `검수 종류 ${index + 1}` }));
  let visible = types;
  await page.route("**/api/entity-types{,?**}", route => route.fulfill({ json: { items: visible, next_cursor: null } }));
  await page.route("**/*", async route => {
    if (await fulfillFixtureWorkspace(route, [{ target_kind: "settings", target_id: "*", access: "write" }, ...types.map(type => ({ target_kind: "entity_type" as const, target_id: type.id, access: "read" as const }))])) return;
    await route.fallback();
  });
  await page.goto(fixtureWorkspacePath("/settings"));
  await openNavigation(page);
  const nav = mainMenu(page), search = nav.getByRole("searchbox", { name: "자료 종류 검색", exact: true });
  await search.fill("검수 종류 9");
  visible = types.slice(0, 8);
  await nav.getByRole("link", { name: "기록 설정", exact: true }).click();
  await openNavigation(page);
  await expect(search).toHaveValue("검수 종류 9");
  await search.fill("");
  await expect(nav.getByRole("link", { name: "검수 종류 8", exact: true })).toHaveCount(1);
});
