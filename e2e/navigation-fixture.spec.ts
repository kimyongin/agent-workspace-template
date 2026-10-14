import {
  fixtureIdentity,
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
    if (url.pathname === "/api/entity-types") {
      await route.fulfill({json:{items:[fixtureType],next_cursor:null}});
    } else if (url.pathname.startsWith("/api/entity-types/")) {
      await route.fulfill({
        json: url.pathname.endsWith("/schema")
          ? fixtureSchema
          : url.pathname.endsWith("/identity")
          ? fixtureIdentity()
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
async function openProfile(page: Page) {
  const profile = page.getByRole("button", { name:/^내 프로필(?: · .+)?$/, exact:true });
  if (await profile.getAttribute("aria-expanded") !== "true") await profile.click();
}
async function settings(page: Page) { await openProfile(page); await page.locator("#nav-profile-options").getByRole("link", { name:"설정", exact:true }).click(); }
async function requestLogout(page: Page) {
  await openProfile(page);
  await page.locator("#nav-profile-options").getByRole("link", { name: "로그아웃", exact: true }).click();
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

test("네 탭과 프로필은 320~1440px와 200%에서 조작 가능하다", async ({ page }, info) => {
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 }); await page.goto("/settings");
    const nav = page.getByRole("navigation", { name: "주 메뉴" });
    await expect(nav.getByRole("link")).toHaveCount(4);
    await expect(nav.getByRole("button", { name:"메뉴", exact:true })).toHaveCount(0);
    await expect(page.locator(".workspace-header")).toHaveCount(1);
    await expect(page.locator(".workspace-header")).toBeHidden();
    if(width>=1024)await expect(page.locator(".navigation-brand")).toBeVisible();
    else expect(await page.locator("#settings-title").evaluate(el => getComputedStyle(el,"::before").backgroundImage)).not.toBe("none");
    for (const size of await nav.locator(".bottom-nav-inner > a, .nav-profile-trigger").evaluateAll(nodes => nodes.map(node => { const r = node.getBoundingClientRect(); return [r.width, r.height]; }))) {
      expect(size[0]).toBeGreaterThanOrEqual(44); expect(size[1]).toBeGreaterThanOrEqual(44);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true }).click();
    await page.getByRole("link", { name: "로그아웃", exact: true }).focus();
    const action = await page.getByRole("link", { name: "로그아웃", exact: true }).boundingBox(); const bottom = await nav.boundingBox();
    if(width<1024)expect(action!.y + action!.height).toBeLessThanOrEqual(bottom!.y);
    else { expect(action!.x).toBeGreaterThanOrEqual(bottom!.x+bottom!.width); expect(bottom!.y).toBe(0); }
    await page.screenshot({ path: info.outputPath(`settings-${width}.png`) });
  }
  await page.setViewportSize({ width: 320, height: 844 });
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("settings-320-text200.png") });
  await openProfile(page); await expect(page.locator("#nav-profile-options").getByRole("link", { name: "사용 가이드", exact: true })).toBeVisible();
  await page.keyboard.press("Escape"); await expect(page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true })).toBeFocused();
  await page.evaluate(() => document.documentElement.style.fontSize = "");
  // 1440px 화면의 200% 브라우저 확대에 대응하는 CSS reflow 크기.
  await page.setViewportSize({ width: 720, height: 450 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true }).click();
  await page.getByRole("link", { name: "로그아웃", exact: true }).focus();
  const action = await page.getByRole("link", { name: "로그아웃", exact: true }).boundingBox(); const nav = await page.getByRole("navigation", { name: "주 메뉴" }).boundingBox();
  expect(action!.y + action!.height).toBeLessThanOrEqual(nav!.y);
});

test("프로필 팝오버는 키보드·외부 클릭·경로 이동에 초점을 유지한다", async ({ page }) => {
  await page.goto("/settings"); const profile = page.getByRole("button", { name:/^내 프로필(?: · .+)?$/, exact:true }), popup = page.locator("#nav-profile-options");
  await expect(page.getByRole("button", { name:"메뉴", exact:true })).toHaveCount(0);
  await expect(page.locator(".settings").getByRole("link", { name:"사용 가이드", exact:true })).toHaveCount(0);
  await profile.click(); await expect(popup).toContainText(user.user_metadata.full_name); await expect(popup).not.toContainText(user.email);
  await profile.press("ArrowDown"); await expect(popup.getByRole("link", { name:"전체 자료", exact:true })).toBeFocused();
  await popup.getByRole("link", { name:"상태", exact:true }).focus();
  await page.keyboard.press("ArrowDown"); await expect(popup.getByRole("link", { name:"설정", exact:true })).toBeFocused();
  await page.keyboard.press("ArrowDown"); await expect(popup.getByRole("link", { name:"사용 가이드", exact:true })).toBeFocused();
  await page.keyboard.press("End"); await expect(popup.getByRole("link", { name:"로그아웃", exact:true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(profile).toBeFocused();
  await profile.click(); await page.getByRole("heading", { name:"기본 설정", exact:true }).click(); await expect(profile).toHaveAttribute("aria-expanded", "false");
  await profile.click(); await popup.getByRole("link", { name:"사용 가이드", exact:true }).click(); await expect(page).toHaveURL(/\/guide$/); await expect(profile).toHaveAttribute("aria-expanded", "false");
  await expect(profile).toHaveAttribute("data-current", "true");
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
  await page.goto("/settings"); await page.getByRole("radio", { name: "잎", exact: true }).check();
  const originalPath = await page.locator(".nav-profile .profile-icon").textContent();
  await page.getByRole("button",{name:"프로필 저장", exact: true }).click(); await expect(page.getByRole("form",{name:"프로필 설정"}).getByRole("alert")).toContainText("입력한 설정을 유지"); await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked();
  await expect(page.locator(".nav-profile .profile-icon")).toHaveText(originalPath!);
  fail = false; await page.getByRole("button",{name:"프로필 저장", exact: true }).click(); await expect(page.getByRole("form",{name:"프로필 설정"}).getByRole("status")).toContainText("저장했습니다"); expect(calls).toBe(2);
  const savedPath = await page.locator(".nav-profile .profile-icon").textContent();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sb-127-auth-token")!).user.user_metadata.provider_value)).toBe("preserved");
  await page.reload(); await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked(); await expect(page.locator(".nav-profile .profile-icon")).toHaveText(savedPath!);
  await page.getByRole("radio", { name: "기본", exact: true }).check(); await expect(page.getByRole("radio", { name: "기본", exact: true })).toBeChecked();
  await page.getByRole("form",{name:"프로필 설정"}).getByRole("button",{name:"변경 취소" }).click(); await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked();
});

test("저장 중 중복 요청과 탭·로그아웃 이동을 막고 응답 뒤 이동할 수 있다", async ({ page }) => {
  let saved = false;
  await refreshedProfile(page, () => saved ? "sun" : "person");
  let finish!: () => void; const waiting = new Promise<void>(resolve => { finish = resolve; }); let calls = 0;
  await page.route("**/auth/v1/user", async route => { if (route.request().method() !== "PUT") return route.fallback(); calls++; await waiting; saved = true; await route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "sun" } } }); });
  await page.goto("/settings"); await page.getByRole("radio", { name: "해바라기", exact: true }).check(); await page.getByRole("button",{name:"프로필 저장", exact: true }).click();
  await expect(page.getByRole("button",{name:"프로필 저장" })).toBeDisabled(); await page.locator(".bottom-nav-inner > a").and(page.getByRole("link", { name: fixtureType.label, exact: true })).click();
  await expect(page).toHaveURL(/\/settings$/); await expect(page.getByRole("dialog")).toHaveCount(0);
  await requestLogout(page); await expect(page).toHaveURL(/\/settings$/); expect(calls).toBe(1);
  finish(); await expect(page.getByRole("form",{name:"프로필 설정"}).getByRole("status")).toContainText("저장했습니다"); await page.locator(".bottom-nav-inner > a").and(page.getByRole("link", { name: fixtureType.label, exact: true })).click(); await expect(page).toHaveURL(new RegExp(`/entities\\?entity_type_id=${fixtureType.id}$`));
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
  await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked(); await expect(page.locator(".profile-preview")).toContainText("Other"); await expect(page.getByText(user.email, { exact: true })).toHaveCount(0);
  await page.route("**/auth/v1/logout*", route => route.fulfill({ status: 204 }));
  await page.evaluate(async () => { const path = "/src/lib/supabase.ts"; const { supabase } = await import(path); await supabase.auth.signOut(); });
  await expect(page).toHaveURL(/\/login\?next=/); await expect(page.getByRole("navigation", { name: "주 메뉴" })).toHaveCount(0); await expect(page.getByRole("heading", { name: "로그인", exact: true })).toBeVisible();
});

test("미저장 설정의 탭·프로필·뒤로가기·로그아웃은 같은 폐기 확인을 거친다", async ({ page }) => {
  let logoutCalls = 0; await page.route("**/auth/v1/logout*", async route => { logoutCalls++; await route.fulfill({ status: 204 }); });
  await page.goto("/guide"); await settings(page); await page.getByRole("radio", { name: "별", exact: true }).check();
  const confirm = page.getByRole("dialog", { name: "변경을 버릴까요?" });
  let step = 0;
  for (const action of [async () => page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "할 일", exact: true }).click(), async () => { await openProfile(page); await page.locator("#nav-profile-options").getByRole("link", { name: "사용 가이드", exact: true }).click(); }, async () => { await page.goBack(); }, async () => {
    await requestLogout(page);
  }]) {
    await action(); await expect(confirm).toBeVisible(); await confirm.getByRole("button", { name: "취소", exact: true }).click(); await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
    if (step === 1) { await expect(page.locator("#nav-profile-options").getByRole("link", { name: "사용 가이드", exact: true })).toBeFocused(); await expect(page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true })).toHaveAttribute("aria-expanded", "true"); }
    if (step === 3) {
      await expect(page.locator("#nav-profile-options").getByRole("link", { name:"로그아웃", exact:true })).toBeFocused();
      await expect(page.getByRole("button", { name:/^내 프로필(?: · .+)?$/, exact:true })).toHaveAttribute("aria-expanded", "true");
    }
    step++;
  }
  expect(logoutCalls).toBe(0); await requestLogout(page); await confirm.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/); expect(logoutCalls).toBe(1); await expect(page.getByRole("navigation", { name: "주 메뉴" })).toHaveCount(0);
});

test("원격 로그아웃 실패는 로컬 해제를 안내하며 재로그인은 프로필을 복원한다", async ({ page }) => {
  let fail = true; let calls = 0;
  await page.route("**/auth/v1/logout*", async route => { calls++; await route.fulfill(fail ? { status: 500, json: { msg: "fixture failure" } } : { status: 204 }); });
  await page.route("**/auth/v1/user", route => route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "leaf" } } }));
  await page.goto("/settings"); await requestLogout(page);
  await expect(page.getByRole("alert")).toContainText("이 기기에서는 로그아웃했습니다",{timeout:15000});
  await expect(page.getByRole("navigation", { name: "주 메뉴" })).toHaveCount(0);
  fail = false; await page.getByRole("link", { name: "로그인으로 이동", exact: true }).click(); await expect(page).toHaveURL(/\/login$/); expect(calls).toBe(1);
  await signIn(page); await expect(page).toHaveURL(/\/tasks$/); await settings(page); await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked(); expect(calls).toBe(1);
});

test("가이드의 복사 실패와 성공 안내는 유지한다", async ({ page }) => {
  await page.goto("/guide");
  await page.getByText("설치·연결 정보",{exact:true}).click();
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("denied"); } } }));
  await page.getByRole("button", { name: "연결 주소 복사" }).click(); await expect(page.getByRole("status")).toContainText("위 주소를 선택해 직접 복사");
  await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => {} } }));
  await page.getByRole("button", { name: "연결 주소 복사" }).click(); await expect(page.getByRole("status")).toHaveText("연결 주소를 복사했습니다.");
});

for(const width of [390,1440])test(`#205 ${width}px: 설정·가이드 구획과 탐색 팝오버`,async({page},info)=>{
  await page.setViewportSize({width,height:900});await page.goto("/settings");
  const groups=page.locator(".settings .settings-section");await expect(groups).toHaveCount(5);
  expect((await page.locator(".settings").boundingBox())!.width).toBeLessThanOrEqual(768);
  await page.screenshot({path:info.outputPath(`compact-settings-${width}.png`)});
  await page.getByRole("button",{name:/^내 프로필(?: · .+)?$/,exact:true}).click();const popup=page.locator("#nav-profile-options"),box=(await popup.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(width);expect(box.y).toBeGreaterThanOrEqual(0);
  await page.keyboard.press("Escape");await expect(page.getByRole("button",{name:/^내 프로필(?: · .+)?$/,exact:true})).toBeFocused();
  await page.goto("/guide");await expect(page.locator(".guide-step")).toHaveCount(5);await page.screenshot({path:info.outputPath(`compact-guide-${width}.png`)});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  if(width>=1024){
    for(const height of [320,280]){
      await page.setViewportSize({width,height});
      for(const node of await page.locator(".bottom-nav-inner > a,.nav-profile-trigger").all())await expect(node).toBeInViewport();
    }
    const nav=(await page.locator(".bottom-nav").boundingBox())!;expect(nav.y).toBeGreaterThan(0);expect(nav.y+nav.height).toBeCloseTo(280);
    await page.getByRole("button",{name:/^내 프로필(?: · .+)?$/,exact:true}).click();const short=(await page.locator("#nav-profile-options").boundingBox())!;expect(short.y).toBeGreaterThanOrEqual(0);expect(short.y+short.height).toBeLessThanOrEqual(280);
  }
});

// #215 exercises the real App shell and URL filters without writing user data.
test("#215 메인 네 탭의 상단 구획·브랜드·필터 조작은 좁은 화면에서도 정렬된다", async ({ page }, info) => {
  test.setTimeout(90_000);
  await page.route(/\/(?:functions\/v1\/)?api\/principles\/current$/, route => route.fulfill({ json: { current: null } }));
  for (const width of [320, 360, 390, 479, 480, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [path, title] of [["entities", "전체 자료"], ["tasks", "할 일"], ["records", "기록"], ["principles", "원칙"]]) {
      await page.goto(`/${path}`);
      const header = page.getByRole("region", { name: title, exact: true });
      await expect(header.getByRole("heading", { level: 1, name: title, exact: true })).toBeVisible();
      const border = await header.evaluate(el => getComputedStyle(el).borderBottomWidth);
      expect(border).toBe("1px");
      expect(await header.evaluate(el => getComputedStyle(el).paddingBottom)).toBe("20px");
      await expect(page.locator(".workspace-header")).toBeHidden();
      if(width>=1024)await expect(page.locator(".navigation-brand")).toBeVisible();
      else {
        await expect(page.locator(".navigation-brand")).toBeHidden();
        expect(await header.getByRole("heading", {level:1}).evaluate(el => getComputedStyle(el,"::before").backgroundImage)).not.toBe("none");
      }
      if (path === "principles") {
        await expect(page.getByRole("button", { name: /^필터/ })).toHaveCount(0);
        continue;
      }
      const search = header.getByRole("textbox", { name: path === "entities" ? "자료 제목 검색" : "검색어", exact: true }), toggle = header.getByRole("button", { name: /^필터 (열기|닫기)/ });
      const closedToggle = (await toggle.boundingBox())!;
      await expect(toggle).toHaveText("");
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
      await expect(header.locator(".tab-filters > .form").getByRole("button", {name:"조건 초기화"})).toBeVisible();
      for (const button of [toggle, reset]) { const b = (await button.boundingBox())!; expect(b.height).toBeGreaterThanOrEqual(44); expect(b.width).toBeGreaterThanOrEqual(44); }
      await reset.click(); expect(new URL(page.url()).searchParams.get("filters")).toBe("1");
      await page.reload(); await expect(page.getByRole("button", { name: "필터 닫기", exact: true })).toHaveAttribute("aria-expanded", "true");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 390 || width === 1440) await page.screenshot({ path: info.outputPath(`main-${path}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 320, height: 844 }); await page.goto("/entities?entity_type_id=00000000-0000-4000-8000-000000000900&filters=1&property_filters=%5B%7B%22key%22%3A%22prop_4%22%2C%22operator%22%3A%22eq%22%2C%22value%22%3A%22a%22%7D%5D");
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  const toggle = page.getByRole("button", { name: /필터 닫기/ }), reset = page.locator(".main-tab-header").getByRole("button", { name: "조건 초기화" });
  const t = (await toggle.boundingBox())!, r = (await reset.boundingBox())!;
  expect(r.y >= t.y + t.height || r.x >= t.x + t.width).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => document.documentElement.style.fontSize = "");
  await page.setViewportSize({ width: 1440, height: 280 });
  await expect(page.locator(".workspace-header")).toBeHidden();
  await expect(page.locator(".navigation-brand")).toBeHidden();
});

// #217 checks the real settings/sidebar/footer consumers of profile presentation.
test("#217 아이콘 선택은 가용 폭을 채우고 팝오버 이모지는 탐색과 같은 크기다", async ({ page }, info) => {
  const columns: number[] = [];
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto("/settings");
    const settings = page.getByRole("region", { name: "설정", exact: true });
    await expect(settings.getByRole("link", { name: "로그아웃", exact: true })).toHaveCount(0);
    const grid = page.locator(".profile-choices"), nickname = page.getByLabel("닉네임", { exact: true });
    const g = (await grid.boundingBox())!, n = (await nickname.boundingBox())!;
    expect(g.x).toBeCloseTo(n.x); expect(g.width).toBeCloseTo(n.width);
    expect(await grid.evaluate(el => el.clientHeight)).toBe(128);
    const tiles = await grid.locator(".profile-choice").evaluateAll(nodes => nodes.map(el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, right:r.right, width:r.width, height:r.height }; }));
    const row = tiles.filter(tile => Math.abs(tile.y - tiles[0].y) < 1); columns.push(row.length);
    expect(g.x + g.width - row.at(-1)!.right).toBeLessThanOrEqual(16);
    for (const tile of tiles) { expect(tile.width).toBeGreaterThanOrEqual(44); expect(tile.height).toBeGreaterThanOrEqual(44); }
    const profile = page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true }); await profile.click();
    const popup = page.locator("#nav-profile-options");
    const expectedLinks = ["전체 자료", fixtureType.label, "할 일", "기록", "원칙", "상태", "설정", "사용 가이드", "로그아웃"];
    for (const name of expectedLinks) await expect(popup.getByRole("link", { name, exact: true })).toHaveCount(1);
    await expect(popup.getByRole("link")).toHaveCount(expectedLinks.length);
    await profile.press("ArrowDown"); await expect(popup.getByRole("link", { name: "전체 자료", exact:true })).toBeFocused();
    await popup.getByRole("link", { name: "상태", exact:true }).focus();
    await page.keyboard.press("ArrowDown"); await expect(popup.getByRole("link", { name: "설정", exact:true })).toBeFocused();
    await page.keyboard.press("End"); await expect(popup.getByRole("link", { name: "로그아웃", exact:true })).toBeFocused();
    const iconStyle = (selector: string) => page.locator(selector).evaluate(el => { const s = getComputedStyle(el), b = el.getBoundingClientRect(); return { width:b.width, height:b.height, font:s.fontSize, border:s.borderWidth }; });
    expect(await iconStyle(".nav-profile-identity .profile-icon")).toEqual(await iconStyle(".nav-profile > button .profile-icon"));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390 || width === 1440) await page.screenshot({ path:info.outputPath(`profile-polish-${width}.png`) });
    await page.keyboard.press("Escape"); await expect(profile).toBeFocused();
  }
  expect(new Set(columns).size).toBeGreaterThan(1); expect(Math.max(...columns)).toBeGreaterThan(5);
  for (const height of [320, 280]) {
    await page.setViewportSize({ width:1440, height });
    const trigger = page.getByRole("button", { name:/^내 프로필(?: · .+)?$/, exact:true }); await trigger.click(); await trigger.press("End");
    const popup = page.locator("#nav-profile-options"), b = (await popup.boundingBox())!;
    expect(b.y).toBeGreaterThanOrEqual(0); expect(b.y + b.height).toBeLessThanOrEqual(height);
    await expect(popup.getByRole("link", { name:"로그아웃", exact:true })).toBeInViewport();
    await page.keyboard.press("Escape");
  }
});

test("#340 열린 메뉴가 화면 높이·확대·긴 닉네임 변경에도 화면 안에 유지된다", async ({ page }) => {
  await page.route("**/auth/v1/user", route => route.fulfill({json:{...user,user_metadata:{...user.user_metadata,full_name:"긴 닉네임 ".repeat(15)}}}));
  await page.goto("/settings"); await openProfile(page);
  const popup = page.locator("#nav-profile-options");
  for (const height of [900, 481, 480, 321, 320, 280, 900]) {
    await page.setViewportSize({width:1440,height});
    await expect.poll(async()=>{const box=(await popup.boundingBox())!;return box.y>=0 && box.y+box.height<=height;}).toBe(true);
    await popup.getByRole("link",{name:"로그아웃",exact:true}).focus();
    await expect(popup.getByRole("link",{name:"로그아웃",exact:true})).toBeInViewport();
  }
  await page.evaluate(()=>document.documentElement.style.fontSize="200%");
  await page.setViewportSize({width:1440,height:320});
  await expect.poll(async()=>{const box=(await popup.boundingBox())!;return box.y>=0 && box.y+box.height<=320;}).toBe(true);
  await popup.getByRole("link",{name:"로그아웃",exact:true}).focus();
  await expect(popup.getByRole("link",{name:"로그아웃",exact:true})).toBeInViewport();
});
