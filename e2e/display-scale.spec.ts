import { expect, test, type Page } from "@playwright/test";
import { installWorkspaceApi } from "./support/workspace-api.ts";
import { entity, task, record, principle, id } from "./support/workspace-data.ts";

async function fixture(page: Page, scale = "100") {
  const user = { id: id(100), aud: "authenticated", email: "fixture@example.test", app_metadata: {}, user_metadata: { workspace_display_scale: scale, workspace_mobile_display_scale: scale, workspace_avatar_id: "person", provider_value: "preserved" } };
  const state = { account: user.id, fail: false, writes: [] as Record<string, unknown>[], metadata: user.user_metadata };
  await installWorkspaceApi(page, "http://127.0.0.1:55591", { entities: [entity()], tasks: [task()], records: [record()], principles: [principle()], tags: [] });
  await page.addInitScript(user => {
    if (sessionStorage.getItem("fixture-started")) return;
    sessionStorage.setItem("fixture-started", "true");
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: "fixture", refresh_token: "fixture", expires_at: Math.floor(Date.now() / 1000) + 3600, user }));
  }, user);
  await page.route("**/auth/v1/user", async route => {
    if (route.request().method() === "PUT") {
      const changes = route.request().postDataJSON().data; state.writes.push(changes);
      if (state.fail) return route.fulfill({ status: 500, json: { msg: "fixture failure" } });
      state.metadata = { ...state.metadata, ...changes };
    }
    return route.fulfill({ json: { ...user, id: state.account, user_metadata: state.metadata } });
  });
  await page.route("**/auth/v1/logout*", route => route.fulfill({ status: 204 }));
  return state;
}
const rootSize = (page: Page) => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
async function navigate(page: Page, name: string) {
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name, exact: true }).click();
}
test("display scale: preview, cancel and approved leaving restore confirmed size without writes", async ({ page }) => {
  const state = await fixture(page); await page.goto("/settings");
  const scale = page.getByLabel("데스크톱 화면 배율", { exact: true });
  await expect(scale).toHaveValue("100"); await expect.poll(() => rootSize(page)).toBe(16);
  await scale.selectOption("125"); await expect.poll(() => rootSize(page)).toBe(20);
  await page.getByRole("form", { name: "화면 표시 설정" }).getByRole("button", { name: "변경 취소" }).click(); await expect.poll(() => rootSize(page)).toBe(16);
  await scale.selectOption("150"); await navigate(page, "할 일");
  const confirm = page.getByRole("dialog", { name: "변경을 버릴까요?" });
  await confirm.getByRole("button", { name: "취소", exact: true }).click(); await expect.poll(() => rootSize(page)).toBe(24);
  await navigate(page, "할 일"); await confirm.getByRole("button", { name: "변경 버리기" }).click();
  await expect(page).toHaveURL(/\/tasks$/); await expect.poll(() => rootSize(page)).toBe(16);
  expect(state.writes).toEqual([]);
});
test("display scale: failed save keeps selection; retry persists only changed metadata across reload", async ({ page }) => {
  const state = await fixture(page); await page.goto("/settings");
  const scale = page.getByLabel("데스크톱 화면 배율", { exact: true });
  await scale.selectOption("150"); state.fail = true;
  await page.getByRole("button",{name:"화면 표시 저장", exact: true }).click();
  await expect(page.getByRole("form",{name:"화면 표시 설정"}).getByRole("alert")).toContainText("입력한 설정을 유지");
  await expect(scale).toHaveValue("150"); expect(await rootSize(page)).toBe(24);
  state.fail = false; await page.getByRole("button",{name:"화면 표시 저장", exact: true }).click();
  await expect(page.getByRole("form", { name: "화면 표시 설정" }).getByRole("status")).toContainText("저장했습니다");
  expect(state.writes).toEqual([{ workspace_display_scale: "150" }, { workspace_display_scale: "150" }]);
  expect(state.metadata.provider_value).toBe("preserved");
  await page.reload(); await expect(scale).toHaveValue("150"); await expect.poll(() => rootSize(page)).toBe(24);
  await scale.selectOption("110"); await expect.poll(() => rootSize(page)).toBeCloseTo(17.6, 1);
  await page.getByRole("form", { name: "화면 표시 설정" }).getByRole("button", { name: "변경 취소" }).click(); await expect.poll(() => rootSize(page)).toBe(24);
  await navigate(page, "전체 자료"); await expect(page.getByRole("heading", { name: "전체 자료", exact: true, level: 1 })).toBeVisible();
  expect(await rootSize(page)).toBe(24);
  await page.getByRole("button", { name: "내 프로필" }).click(); await page.getByRole("link", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login/); await expect.poll(() => rootSize(page)).toBe(16);
});
test("display scale: 150% keeps main filters, details, confirmation and resize usable on desktop/mobile", async ({ page }, info) => {
  await page.setViewportSize({ width: 2160, height: 1080 });
  const state = await fixture(page, "150"); await page.goto("/entities");
  await expect(page.getByRole("heading", { name: "전체 자료", exact: true, level: 1 })).toBeVisible();
  await expect.poll(() => rootSize(page)).toBe(24);
  await page.getByRole("button", { name: "필터 열기" }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.goto(`/tasks/${id(2)}`);
  await expect(page.getByRole("separator", { name: "상세 패널 너비 조절" })).toBeVisible();
  await page.getByRole("separator", { name: "상세 패널 너비 조절" }).press("End");
  expect((await page.locator(".workspace-list").boundingBox())!.width).toBeGreaterThanOrEqual(24 * 28);
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await page.getByLabel("본문", { exact: true }).fill("크기를 바꾸어도 보존할 입력");
  await page.screenshot({ path: info.outputPath("display-scale-desktop150.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  const modal = page.locator("dialog.modal:not(.modal-confirm)[open]");
  await expect(modal.getByLabel("본문", { exact: true })).toHaveValue("크기를 바꾸어도 보존할 입력");
  await modal.getByRole("button", { name: "저장", exact: true }).click();
  await expect(modal.getByRole("button", { name: "수정하고 저장" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("display-scale-mobile150-confirm.png") });
  await modal.getByRole("button", { name: "취소", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByLabel("본문", { exact: true })).toHaveValue("크기를 바꾸어도 보존할 입력");
  const notify = () => page.evaluate(id => { const channel = new BroadcastChannel("workspace-decorative-profile"); channel.postMessage(id); channel.close(); }, id(100));
  state.metadata.workspace_display_scale = "100"; await notify();
  await expect(page.getByRole("separator", { name: "상세 패널 너비 조절" })).toBeVisible();
  await expect(page.getByLabel("본문", { exact: true })).toHaveValue("크기를 바꾸어도 보존할 입력");
  state.metadata.workspace_display_scale = "150"; await notify();
  await expect.poll(() => rootSize(page)).toBe(24);
  await expect(modal.getByLabel("본문", { exact: true })).toHaveValue("크기를 바꾸어도 보존할 입력");
  expect(state.writes).toEqual([]);
});
test("display scale: 150% settings, menus and lists reflow at compact widths", async ({ page }, info) => {
  await fixture(page, "150"); await page.goto("/settings");
  await expect(page.getByLabel("데스크톱 화면 배율", { exact: true })).toHaveValue("150");
  for (const width of [320, 390, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `settings ${width}`).toBe(true);
  }
  await page.screenshot({ path: info.outputPath("display-scale-settings150.png") });
  await page.locator(".settings-section").filter({ has: page.getByLabel("데스크톱 화면 배율", { exact: true }) }).screenshot({ path: info.outputPath("display-scale-setting-control.png") });
  const smallFont = await page.addStyleTag({ content: ":root { font-size: 12px; }" });
  for (const option of await page.locator(".profile-choice").all()) {
    const box = (await option.boundingBox())!; expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await smallFont.evaluate(node => node.remove());
  await page.setViewportSize({ width: 320, height: 844 });
  for (const path of ["/entities", "/tasks", "/records", "/principles", "/guide"]) {
    await page.goto(path);
    await expect(page.locator("main h1")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
  }
  await page.getByRole("button", { name: "내 프로필" }).click();
  await expect(page.getByRole("link", { name: "설정", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("display scale: external profile updates preserve dirty preview and cancel to latest saved size", async ({ page }) => {
  const state = await fixture(page); await page.goto("/settings");
  const scale = page.getByLabel("데스크톱 화면 배율", { exact: true });
  await expect(scale).toHaveValue("100");
  const notify = () => page.evaluate(id => { const channel = new BroadcastChannel("workspace-decorative-profile"); channel.postMessage(id); channel.close(); }, id(100));
  state.metadata.workspace_display_scale = "125"; await notify();
  await expect(scale).toHaveValue("125"); await expect.poll(() => rootSize(page)).toBe(20);
  await scale.selectOption("150");
  state.metadata.workspace_display_scale = "110";
  await Promise.all([page.waitForResponse(response => response.url().endsWith("/auth/v1/user") && response.request().method() === "GET"), notify()]);
  await expect(scale).toHaveValue("150"); expect(await rootSize(page)).toBe(24);
  await page.getByRole("form", { name: "화면 표시 설정" }).getByRole("button", { name: "변경 취소" }).click();
  await expect(scale).toHaveValue("110"); await expect.poll(() => rootSize(page)).toBeCloseTo(17.6, 1);
  expect(state.writes).toEqual([]);
});
test("display scale: switching accounts removes the previous account's unsaved preview", async ({ page }) => {
  const state = await fixture(page); await page.goto("/settings");
  const scale = page.getByLabel("데스크톱 화면 배율", { exact: true });
  await scale.selectOption("150"); await expect.poll(() => rootSize(page)).toBe(24);
  await page.getByLabel("모바일 화면 배율", { exact: true }).selectOption("150");
  await page.getByRole("separator", { name: "탐색 메뉴 너비 조절" }).press("End");
  await expect.poll(async () => (await page.getByRole("navigation", { name: "주 메뉴" }).boundingBox())!.width).toBe(480);
  const handle = (await page.getByRole("separator", { name: "탐색 메뉴 너비 조절" }).boundingBox())!;
  await page.mouse.move(handle.x + 6, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(handle.x - 14, handle.y + handle.height / 2);
  await expect(page.locator(".app-shell")).toHaveClass(/is-resizing/);
  state.metadata.workspace_display_scale = "125";
  for (const account of [id(101), id(100)]) {
    state.account = account;
    await page.evaluate(async account => {
    const path = "/src/lib/supabase.ts"; const { supabase } = await import(path);
    const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
    const token = `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600, sub: account })}.fixture`;
    const { error } = await supabase.auth.setSession({ access_token: token, refresh_token: "fixture-login" }); if (error) throw error;
  }, state.account);
  await expect(scale).toHaveValue("125"); await expect.poll(() => rootSize(page)).toBe(20);
  await expect.poll(async () => (await page.getByRole("navigation", { name: "주 메뉴" }).boundingBox())!.width).toBe(260);
    await page.mouse.move(handle.x - 44, handle.y + handle.height / 2);
    await expect(page.locator(".app-shell")).not.toHaveClass(/is-resizing/);
    expect((await page.getByRole("navigation", { name: "주 메뉴" }).boundingBox())!.width).toBe(260);
    await expect(page.getByRole("button",{name:"화면 표시 저장", exact: true })).toBeDisabled();
  }
  await page.mouse.up();
  await page.setViewportSize({ width: 390, height: 844 }); await expect.poll(() => rootSize(page)).toBe(16);
  expect(state.writes).toEqual([]);
});

test("display scale: mobile and desktop preview, save and cancel independently at the 1024px boundary", async ({ page }, info) => {
  const state = await fixture(page); await page.goto("/settings");
  const desktop = page.getByLabel("데스크톱 화면 배율", { exact: true }), mobile = page.getByLabel("모바일 화면 배율", { exact: true });
  await desktop.selectOption("125"); await mobile.selectOption("150"); await expect.poll(() => rootSize(page)).toBe(20);
  await page.setViewportSize({ width: 1023, height: 900 }); await expect.poll(() => rootSize(page)).toBe(24);
  await page.setViewportSize({ width: 1024, height: 900 }); await expect.poll(() => rootSize(page)).toBe(20);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button",{name:"화면 표시 저장", exact: true }).click(); await expect(page.getByRole("form", { name: "화면 표시 설정" }).getByRole("status")).toContainText("저장했습니다");
  expect(state.writes).toEqual([{ workspace_display_scale: "125", workspace_mobile_display_scale: "150" }]);
  await page.reload(); await expect(desktop).toHaveValue("125"); await expect(mobile).toHaveValue("150");
  await page.setViewportSize({ width: 390, height: 844 }); await expect.poll(() => rootSize(page)).toBe(24);
  await mobile.selectOption("110"); await desktop.selectOption("150"); await expect.poll(() => rootSize(page)).toBeCloseTo(17.6, 1);
  await page.getByRole("form", { name: "화면 표시 설정" }).getByRole("button", { name: "변경 취소" }).click(); await expect.poll(() => rootSize(page)).toBe(24);
  await expect(desktop).toHaveValue("125"); await expect(mobile).toHaveValue("150");
  await page.setViewportSize({ width: 1440, height: 900 }); await expect.poll(() => rootSize(page)).toBe(20);
  await page.locator(".settings-section").filter({ has: mobile }).screenshot({ path: info.outputPath("mobile-desktop-display-scales.png") });
  expect(state.writes).toHaveLength(1); expect(state.metadata.provider_value).toBe("preserved");
});

test("display scale: existing saved scale is preserved for desktop; mobile-only saves leave it untouched", async ({ page }) => {
  const state = await fixture(page, "125"); Object.assign(state.metadata, { workspace_mobile_display_scale: undefined });
  await page.goto("/settings"); await expect.poll(() => rootSize(page)).toBe(20);
  await expect(page.getByLabel("모바일 화면 배율", { exact: true })).toHaveValue("100");
  await page.setViewportSize({ width: 390, height: 844 }); await expect.poll(() => rootSize(page)).toBe(16);
  await page.getByLabel("모바일 화면 배율", { exact: true }).selectOption("150");
  await page.getByRole("button",{name:"화면 표시 저장", exact: true }).click(); await expect(page.getByRole("form", { name: "화면 표시 설정" }).getByRole("status")).toContainText("저장했습니다");
  expect(state.writes).toEqual([{ workspace_mobile_display_scale: "150" }]);
  expect(state.metadata.workspace_display_scale).toBe("125");
  await page.reload(); await expect.poll(() => rootSize(page)).toBe(24);
  await page.setViewportSize({ width: 1440, height: 900 }); await expect.poll(() => rootSize(page)).toBe(20);
});
