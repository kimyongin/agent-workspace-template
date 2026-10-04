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
    const stored = JSON.parse(localStorage.getItem("sb-127-auth-token") ?? "null");
    return { sdk: data.session?.user.id ?? null, stored: stored?.user.id ?? null, icon: stored?.user.user_metadata.workspace_avatar_id ?? null };
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
    if (url.pathname.endsWith("/auth/v1/user") && route.request().method() === "GET") return route.fulfill({ json: other });
    if (url.pathname.endsWith("/auth/v1/logout")) return route.fulfill({ status: 204 });
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    return route.abort();
  });
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ user, access_token }) => localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token, refresh_token: "first-refresh", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, user })), { user, access_token: token(user.id) });
});

for (const phase of ["profile", "refresh"]) for (const crossTab of [false, true]) for (const action of ["logout", "switch"] as const) {
  test(`늦은 ${phase} 성공 뒤 ${crossTab ? "다른 탭" : "같은 탭"} ${action}의 provider·SDK 저장소 유지`, async ({ page, context }, info) => {
    let release!: () => void; let arrived!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { arrived = resolve; });
    await page.route("**/auth/v1/user", async route => {
      if (route.request().method() !== "PUT") return route.fallback();
      expect(route.request().postDataJSON().data).toEqual({ workspace_avatar_id: "sun" });
      if (phase === "profile") { arrived(); await waiting; }
      await route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "sun" } } });
    });
    await page.route("**/auth/v1/token*", async route => {
      if (phase === "refresh") { arrived(); await waiting; }
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
    release(); await expect(page.getByTestId("save-result")).toHaveText("rejected");
    await info.attach("after-delayed-profile", { contentType: "application/json", body: JSON.stringify({ provider: await page.getByTestId("provider-account").textContent(), ...await sdkState(page) }) });
    await expect(page.getByTestId("provider-account")).toHaveText(expected ?? "signed-out");
    expect(await sdkState(page)).toMatchObject({ sdk: expected, stored: expected });
    if (crossTab) { await expect(actor.getByTestId("provider-account")).toHaveText(expected ?? "signed-out"); expect(await sdkState(actor)).toMatchObject({ sdk: expected, stored: expected }); }
  });
}

test("다른 탭의 같은 계정 프로필 갱신은 미저장 선택·이동 보호를 유지하고 취소는 최신값 복원", async ({ page, context }) => {
  await context.route("**/auth/v1/user", route => route.request().method() === "PUT"
    ? route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "leaf" } } }) : route.fallback());
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
  let icon = "leaf";
  const responseUser = () => ({ ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: icon } });
  await context.route("**/auth/v1/user", route => route.request().method() === "PUT" ? route.fulfill({ json: responseUser() }) : route.fallback());
  await context.route("**/auth/v1/token*", route => route.fulfill({ json: { access_token: token(user.id), refresh_token: "rotated-first-refresh", token_type: "bearer", expires_in: 3600, user: responseUser() } }));
  await page.goto(fixture); await page.getByRole("radio", { name: "별", exact: true }).check();
  const second = await context.newPage(); await second.goto(fixture);
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
    expect(await sdkState(tab)).toMatchObject({ sdk: user.id, stored: user.id, icon: "sun" });
  }
});

test("프로필 저장 성공·표시 재조회 실패를 구분하고 초안으로 재시도한다", async ({ page }) => {
  const updated = { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "star" } };
  let fail = true;
  await page.route("**/auth/v1/user", route => route.request().method() === "PUT" ? route.fulfill({ json: updated }) : route.fallback());
  await page.route("**/auth/v1/token*", route => route.fulfill(fail ? { status: 400, json: { msg: "fixture refresh failure" } }
    : { json: { access_token: token(user.id), refresh_token: "rotated-first-refresh", token_type: "bearer", expires_in: 3600, user: updated } }));
  await page.goto(fixture); await page.getByRole("radio", { name: "별", exact: true }).check(); await page.getByRole("button", { name: "아이콘 저장" }).click();
  await expect(page.getByRole("alert")).toContainText("아이콘은 저장했지만 계정 표시를 새로 불러오지 못했습니다");
  await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
  expect(await sdkState(page)).toMatchObject({ sdk: user.id, stored: user.id, icon: "person" });
  // 고정 SDK는 refresh 실패를 60초 캐시한다. SDK를 교체하지 않고 시계만 진행한다.
  await page.clock.setFixedTime(new Date(Date.now() + 61_000));
  fail = false; await page.getByRole("button", { name: "아이콘 저장" }).click();
  await expect(page.getByRole("region", { name: "설정", exact: true }).getByRole("status")).toContainText("저장했습니다");
  await expect(page.getByRole("button", { name: "아이콘 저장" })).toBeDisabled();
  expect(await sdkState(page)).toMatchObject({ icon: "star" });
});
