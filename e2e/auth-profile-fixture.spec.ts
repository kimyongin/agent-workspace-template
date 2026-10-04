import { expect, test, type Page } from "@playwright/test";

const user = { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", email: "fixture@example.test", app_metadata: {}, user_metadata: { workspace_avatar_id: "person", provider_value: "preserved" } };
const other = { ...user, id: "00000000-0000-0000-0000-000000000002", email: "other@example.test", user_metadata: { workspace_avatar_id: "leaf", provider_value: "other" } };
const fixture = "/e2e/fixtures/auth-profile.html";
function token(id: string) {
  const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600, sub: id })}.fixture`;
}
async function sdkState(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/lib/supabase.ts"; const { supabase } = await import(path);
    const { data } = await supabase.auth.getSession();
    const serialized = localStorage.getItem("sb-127-auth-token");
    const stored = JSON.parse(serialized ?? "null");
    return { sdk: data.session?.user.id ?? null, stored: stored?.user.id ?? null, icon: stored?.user.user_metadata.workspace_avatar_id ?? null, serialized };
  });
}
async function switchAccount(page: Page) {
  await page.evaluate(async access_token => {
    const path = "/src/lib/supabase.ts"; const { supabase } = await import(path);
    const { error } = await supabase.auth.setSession({ access_token, refresh_token: "other-refresh" });
    if (error) throw error;
  }, token(other.id));
}
async function logout(page: Page) {
  await page.evaluate(async () => {
    const path = "/src/lib/supabase.ts"; const { supabase } = await import(path);
    const { error } = await supabase.auth.signOut(); if (error) throw error;
  });
}
test.beforeEach(async ({ context, baseURL }) => {
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/v1/user") && route.request().method() === "GET") {
      const jwt = route.request().headers().authorization?.split(" ")[1];
      const id = jwt ? JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).sub : null;
      return route.fulfill({ json: id === other.id ? other : user });
    }
    if (url.pathname.endsWith("/auth/v1/logout")) return route.fulfill({ status: 204 });
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    return route.abort();
  });
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ user, access_token }) => {
    if (sessionStorage.getItem("auth-fixture-started")) return;
    sessionStorage.setItem("auth-fixture-started", "true");
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token, refresh_token: "first-refresh", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, user }));
  }, { user, access_token: token(user.id) });
});

for (const phase of ["profile", "read"]) for (const crossTab of [false, true]) for (const action of ["logout", "switch"] as const) {
  test(`늦은 ${phase} 성공 뒤 ${crossTab ? "다른 탭" : "같은 탭"} ${action}의 provider·SDK 저장소 유지`, async ({ page, context }, info) => {
    let release!: () => void; let arrived!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { arrived = resolve; });
    let written = false; let refreshes = 0;
    await page.route("**/auth/v1/user", async route => {
      if (route.request().method() !== "PUT") {
        const access = route.request().headers().authorization?.split(" ")[1];
        if (access && JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString()).sub === other.id) return route.fallback();
        if (!written) return route.fallback();
        if (phase === "read") { arrived(); await waiting; }
        return route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "sun" } } });
      }
      expect(route.request().postDataJSON().data).toEqual({ workspace_avatar_id: "sun" });
      if (phase === "profile") { arrived(); await waiting; }
      written = true;
      await route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "sun" } } });
    });
    await page.route("**/auth/v1/token*", async route => {
      refreshes++;
      await route.fulfill({ json: { access_token: token(user.id), refresh_token: "rotated-first-refresh", token_type: "bearer", expires_in: 3600,
        user: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "sun" } } } });
    });
    await page.goto(fixture); await expect(page.getByTestId("provider-account")).toHaveText(user.id);
    const actor = crossTab ? await context.newPage() : page;
    if (crossTab) { await actor.goto(fixture); await expect(actor.getByTestId("provider-account")).toHaveText(user.id); }
    await page.getByRole("button", { name: "지연 저장 검사" }).click(); await started;
    if (action === "logout") await logout(actor); else await switchAccount(actor);
    const expected = action === "logout" ? null : other.id;
    await expect(page.getByTestId("provider-account")).toHaveText(expected ?? "signed-out");
    expect(await sdkState(page)).toMatchObject({ sdk: expected, stored: expected });
    const before = (await sdkState(page)).serialized;
    release(); await expect(page.getByTestId("save-result")).toHaveText("rejected");
    await info.attach("after-delayed-profile", { contentType: "application/json", body: JSON.stringify({ provider: await page.getByTestId("provider-account").textContent(), ...await sdkState(page) }) });
    await expect(page.getByTestId("provider-account")).toHaveText(expected ?? "signed-out");
    expect(await sdkState(page)).toMatchObject({ sdk: expected, stored: expected });
    expect((await sdkState(page)).serialized).toBe(before);
    if (crossTab) { await expect(actor.getByTestId("provider-account")).toHaveText(expected ?? "signed-out"); expect(await sdkState(actor)).toMatchObject({ sdk: expected, stored: expected }); }
    expect(refreshes).toBe(0);
  });
}

test("다른 탭의 같은 계정 프로필 갱신은 미저장 선택·이동 보호를 유지하고 취소는 최신값 복원", async ({ page, context }) => {
  let icon = "person";
  await context.route("**/auth/v1/user", route => {
    if (route.request().method() === "PUT") icon = "leaf";
    return route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: icon } } });
  });
  await page.goto(fixture); await page.getByRole("radio", { name: "별", exact: true }).check();
  const second = await context.newPage(); await second.goto(fixture);
  await second.evaluate(async () => { const path = "/src/lib/supabase.ts"; const { supabase } = await import(path); const { error } = await supabase.auth.updateUser({ data: { workspace_avatar_id: "leaf" } }); if (error) throw error; });
  await expect(page.getByTestId("provider-icon")).toHaveText("leaf");
  await expect(second.getByRole("radio", { name: "잎", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "아이콘 저장" })).toBeEnabled();
  await page.getByRole("link", { name: "엔터티", exact: true }).click();
  await page.getByRole("dialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
  await page.getByRole("button", { name: "변경 취소" }).click();
  await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name: "아이콘 저장" })).toBeDisabled();
});

test("외부 갱신 뒤 로컬 저장은 응답 정본을 채택하고 다른 탭의 깨끗한 선택도 갱신한다", async ({ page, context }) => {
  let icon = "person";
  const responseUser = () => ({ ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: icon } });
  await context.route("**/auth/v1/user", route => route.fulfill({ json: responseUser() }));
  await context.route("**/auth/v1/token*", route => route.fulfill({ json: { access_token: token(user.id), refresh_token: "rotated-first-refresh", token_type: "bearer", expires_in: 3600, user: responseUser() } }));
  await page.goto(fixture); await page.getByRole("radio", { name: "별", exact: true }).check();
  const second = await context.newPage(); await second.goto(fixture);
  icon = "leaf";
  await second.evaluate(async () => { const path = "/src/lib/supabase.ts"; const { supabase } = await import(path); await supabase.auth.updateUser({ data: { workspace_avatar_id: "leaf" } }); });
  await expect(page.getByTestId("provider-icon")).toHaveText("leaf");
  await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
  // 서버가 정규화하거나 다른 쓰기가 뒤따른 경우에도 확인한 최신 응답이 정본이다.
  icon = "sun"; await page.getByRole("button", { name: "아이콘 저장" }).click();
  await expect(page.getByRole("region", { name: "설정", exact: true }).getByRole("status")).toContainText("저장했습니다");
  for (const tab of [page, second]) {
    await expect(tab.getByTestId("provider-icon")).toHaveText("sun");
    await expect(tab.getByRole("radio", { name: "해", exact: true })).toBeChecked();
    await expect(tab.getByRole("button", { name: "아이콘 저장" })).toBeDisabled();
    // 프로필 표시와 달리 SDK 세션은 마지막 Auth 이벤트 값 그대로다.
    expect(await sdkState(tab)).toMatchObject({ sdk: user.id, stored: user.id, icon: "leaf" });
  }
  await page.reload();
  await expect(page.getByTestId("provider-icon")).toHaveText("sun");
  await expect(page.getByRole("radio", { name: "해", exact: true })).toBeChecked();
  expect(await sdkState(page)).toMatchObject({ icon: "leaf" });
  await logout(page);
  await page.evaluate(async access_token => {
    const path = "/src/lib/supabase.ts"; const { supabase } = await import(path);
    const { error } = await supabase.auth.setSession({ access_token, refresh_token: "relogin-refresh" }); if (error) throw error;
  }, token(user.id));
  await expect(page.getByTestId("provider-icon")).toHaveText("sun");
  await expect(page.getByRole("radio", { name: "해", exact: true })).toBeChecked();
});

test("프로필 저장 성공·표시 재조회 실패를 구분하고 초안으로 재시도한다", async ({ page }) => {
  const updated = { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "star" } };
  let fail = true; let written = false;
  await page.route("**/auth/v1/user", route => {
    if (route.request().method() === "PUT") { written = true; return route.fulfill({ json: updated }); }
    if (!written) return route.fallback();
    return route.fulfill(fail ? { status: 400, json: { msg: "fixture read failure" } } : { json: updated });
  });
  await page.goto(fixture); await page.getByRole("radio", { name: "별", exact: true }).check(); await page.getByRole("button", { name: "아이콘 저장" }).click();
  await expect(page.getByRole("alert")).toContainText("아이콘은 저장했지만 계정 표시를 새로 불러오지 못했습니다");
  await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
  expect(await sdkState(page)).toMatchObject({ sdk: user.id, stored: user.id, icon: "person" });
  fail = false; await page.getByRole("button", { name: "아이콘 저장" }).click();
  await expect(page.getByRole("region", { name: "설정", exact: true }).getByRole("status")).toContainText("저장했습니다");
  await expect(page.getByRole("button", { name: "아이콘 저장" })).toBeDisabled();
  await expect(page.getByTestId("provider-icon")).toHaveText("star");
  expect(await sdkState(page)).toMatchObject({ icon: "person" });
});
