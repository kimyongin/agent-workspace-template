import { expect, test, type Page } from "@playwright/test";
import { installWorkspaceApi } from "./support/workspace-api.ts";
import { entity, task, record, id } from "./support/workspace-data.ts";

async function fixture(page: Page, scale = "100") {
  const state = await installWorkspaceApi(page, "http://127.0.0.1:55591", { entities: [entity()], tasks: [task()], records: [record()], tags: [] });
  const user = { id: id(100), aud: "authenticated", email: "shell@example.test", app_metadata: {}, user_metadata: { workspace_display_scale: scale, workspace_mobile_display_scale: scale } };
  await page.addInitScript(user => localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: "fixture", refresh_token: "fixture", expires_at: Math.floor(Date.now() / 1000) + 3600, user })), user);
  await page.route("**/auth/v1/user", route => route.fulfill({ json: user }));
  return state;
}

for (const scale of ["100", "110", "125", "150"]) {
  test(`shell ${scale}%: retained edit and cursor survive desktop/mobile round trip`, async ({ page }, info) => {
    const state = await fixture(page, scale);
    await page.setViewportSize({ width: 2160, height: 1080 });
    await page.goto(`/tasks/${id(2)}`);
    const surface = page.getByRole("dialog", { name: "할 일", exact: true });
    await surface.getByRole("button", { name: "편집", exact: true }).click();
    const body = page.getByRole("textbox", { name: /^본문/ });
    await body.fill("배율과 화면 전환에도 유지할 초안");
    await body.evaluate((el: HTMLTextAreaElement) => { el.focus(); el.setSelectionRange(3, 7); });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(body).toHaveValue("배율과 화면 전환에도 유지할 초안");
    await expect(body).toBeFocused();
    expect(await body.evaluate((el: HTMLTextAreaElement) => [el.selectionStart, el.selectionEnd])).toEqual([3, 7]);
    await page.setViewportSize({ width: 2160, height: 1080 });
    await expect(body).toHaveValue("배율과 화면 전환에도 유지할 초안");
    await expect(body).toBeFocused();
    await expect(page.getByRole("dialog", { name: "할 일 편집", exact: true })).toHaveCount(1);
    await page.screenshot({ path: info.outputPath(`retained-${scale}.png`) });
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test("shell mobile: nested confirmation, Escape and discard preserve the correct draft", async ({ page }, info) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/tasks/${id(2)}`);
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const body = page.getByRole("textbox", { name: /^본문/ });
  await body.fill("확인 취소 뒤에도 유지할 초안");
  const saveButton = page.getByRole("button", { name: "저장", exact: true });
  await saveButton.click();
  const confirmation = page.getByRole("dialog", { name: "수정하시겠습니까?", exact: true });
  await expect(confirmation.getByRole("textbox", { name: "기록 메모", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirmation).toHaveCount(0);
  await expect(saveButton).toBeFocused();
  await expect(body).toHaveValue("확인 취소 뒤에도 유지할 초안");
  const headerCloseButton = page.getByRole("button", { name: "닫기", exact: true });
  await headerCloseButton.click();
  const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(headerCloseButton).toBeFocused();
  await expect(body).toHaveValue("확인 취소 뒤에도 유지할 초안");
  await page.screenshot({ path: info.outputPath("mobile-draft.png") });
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("shell mobile: official navigation opens, follows a route and restores trigger focus", async ({ page }, info) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/tasks");
  const trigger = page.getByRole("button", { name: "주 메뉴 열기", exact: true });
  await trigger.click();
  const menu = page.getByRole("dialog", { name: "주 메뉴", exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole("link", { name: "기록", exact: true }).click();
  await expect(page).toHaveURL(/\/records$/);
  await expect(menu).toHaveCount(0);
  await trigger.click();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.screenshot({ path: info.outputPath("mobile-navigation.png") });
});

test("shell desktop: tabs retain drafts and both official dividers resize by keyboard", async ({ page }, info) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(`/tasks/${id(2)}`);
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const body = page.getByRole("textbox", { name: /^본문/ });
  await body.fill("탭을 옮겨도 유지할 초안");
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "기록", exact: true }).click();
  const list = page.getByRole("region", { name: "기록 목록", exact: true });
  await list.getByRole("button", { name: "기록", exact: true }).click();
  await list.getByRole("link", { name: "기록 상세", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("tab", { name: "할 일", exact: true }).click();
  await expect(body).toHaveValue("탭을 옮겨도 유지할 초안");
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  const navDivider = page.getByRole("separator", { name: "탐색 메뉴 너비 조절" });
  const before = (await nav.boundingBox())!.width;
  await navDivider.press("End");
  await expect.poll(async () => (await nav.boundingBox())!.width).toBeGreaterThan(before);
  await navDivider.press("Home");
  await expect.poll(async () => (await nav.boundingBox())!.width).toBeLessThanOrEqual(before);
  const divider = page.getByRole("separator", { name: "상세 패널 너비 조절" });
  const surface = page.getByRole("dialog", { name: "할 일 편집", exact: true });
  const width = (await surface.boundingBox())!.width;
  await divider.press("ArrowLeft");
  await expect.poll(async () => (await surface.boundingBox())!.width).toBeGreaterThan(width);
  await page.getByRole("button", { name: "상세 패널 숨기기", exact: true }).click();
  await page.getByRole("button", { name: "상세 탭 보기 (2개)", exact: true }).click();
  await expect(body).toHaveValue("탭을 옮겨도 유지할 초안");
  await page.screenshot({ path: info.outputPath("desktop-tabs-resize.png") });
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("shell reflow: 200% text and zoom preserve a usable workspace at 1024 and 1440px", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/tasks/${id(2)}`);
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const body = page.getByRole("textbox", { name: /^본문/ });
  await body.fill("텍스트 확대와 브라우저 확대에도 유지할 초안");
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const enlargement of ["text", "zoom"] as const) {
      await page.evaluate(kind => {
        document.documentElement.style.fontSize = kind === "text" ? "200%" : "";
        document.documentElement.style.zoom = kind === "zoom" ? "2" : "";
      }, enlargement);
      await expect(body).toHaveValue("텍스트 확대와 브라우저 확대에도 유지할 초안");
      await expect.poll(() => page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth })), `${width}px ${enlargement}: root content fits the available viewport`).toMatchObject({ scroll: width, client: width });
      await expect(body).toBeInViewport();
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; document.documentElement.style.zoom = ""; });
  }
  expect(state.writes).toEqual([]);
});

test("shell previous: returning from a related editor restores its originating detail link", async ({ page }) => {
  const state = await fixture(page);
  state.rows.tasks[0].entity_ids = [entity().id];
  state.rows.tasks[0].entity_context = [{ id: entity().id, title: "자료", source: "selection", captured_at: entity().created_at }];
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/tasks/${id(2)}`);
  const detail = page.getByRole("dialog").filter({ visible: true });
  const related = detail.getByRole("region", { name: "연결된 자료 (1개)", exact: true });
  await related.getByRole("button", { name: "자료", exact: true }).click();
  const origin = related.getByRole("link", { name: "자료 상세", exact: true });
  await origin.click();
  await detail.getByRole("button", { name: "편집", exact: true }).click();
  await detail.getByRole("button", { name: "취소", exact: true }).click();
  await detail.getByRole("button", { name: "이전: 할 일", exact: true }).click();
  await expect(origin).toBeFocused();
  expect(state.writes).toEqual([]);
});
