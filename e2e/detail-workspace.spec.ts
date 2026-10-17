import { fixtureIdentity } from "./support/workspace-data.ts";
import { expect, test, type Page } from "@playwright/test";
import { entityKey } from "./support/workspace-data.ts";
import { installWorkspaceApi, type FakeOptions } from "./support/workspace-api.ts";
import { entity, task, record,  id, stamp } from "./support/workspace-data.ts";
import { saveOnce } from "./ui-actions.ts";

async function fixture(page: Page, options: FakeOptions = {}, metadata: Record<string, unknown> = {}) {
  const t = { ...task(), title: "등심 구매하기", entity_ids: [entityKey(1)], entity_context: [{ id: entityKey(1), title: "등심", source: "selection" as const, captured_at: stamp }] };
  const r = { ...record(), body: "구매 기준을 정리했습니다.", task_id: id(2), entity_ids: [entityKey(1)], entity_context: t.entity_context };
  const e = { ...entity(1, { prop_1: "등심" }), tasks: { count: 1, items: [t] }, records: { count: 1, items: [r] } };
  const state = await installWorkspaceApi(page, "http://127.0.0.1:55591", { entities: [e, entity(6, { prop_1: "버섯" })], tasks: [t], records: [r],  tags: [] }, options);
  const user = { id: id(100), aud: "authenticated", email: "fixture@example.test", app_metadata: {}, user_metadata: metadata };
  await page.addInitScript(user => localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: "fixture", refresh_token: "fixture", expires_at: Math.floor(Date.now() / 1000) + 3600, user })), user);
  await page.route("**/auth/v1/user", route => route.fulfill({ json: user }));
  return state;
}
const panel = (page: Page) => page.getByRole("tabpanel").filter({ visible: true });
async function detailWidth(page: Page) {
  return (await page.locator(".workspace-details").boundingBox())!.width;
}
async function dragSplit(page: Page, distance: number) {
  const box = (await page.getByRole("separator", { name: "상세 패널 너비 조절" }).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + distance, box.y + box.height / 2, { steps: 8 });
  await page.mouse.up();
}
async function openEntity(page: Page, title = "등심") {
  const list = page.locator(".workspace-list").getByRole("region", { name: /^(전체 자료|검사 자료) 목록$/, exact: true });
  await list.getByRole("button", { name: title, exact: true }).click();
  await list.getByRole("link", { name: `${title} 상세`, exact: true }).click();
  await expect(page.getByRole("tab", {name:title,exact:true})).toHaveAttribute("aria-selected","true");
}
async function openTask(page: Page) {
  const section = panel(page).getByRole("region", { name: "할 일 (1개)" });
  const toggle = section.getByRole("button", { name: "등심 구매하기", exact: true });
  if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
  await section.getByRole("link", { name: "등심 구매하기 상세", exact: true }).click();
  await expect(page.getByRole("tab", { name: "등심 구매하기", exact: true })).toHaveAttribute("aria-selected", "true");
}

const tabNames = (page: Page) => page.getByRole("tab").allTextContents();

for (const width of [390, 1100, 1440]) {
  test(`상세 제목 ${width}px: 자동 초점은 유지하고 제목 테두리만 숨긴다`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page);
    await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`);
    const view = page.locator("dialog.modal[open]").first();
    const title = view.locator(".dialog-title");
    await expect(title).toBeFocused();
    await expect(title).toHaveAttribute("tabindex", "-1");
    await expect(title).toHaveCSS("outline-style", "none");
    await page.screenshot({ path: info.outputPath(`title-focus-${width}.png`) });

    await page.keyboard.press("Tab");
    const edit = view.getByRole("button", { name: "편집", exact: true });
    await edit.focus();
    await expect(edit).toBeFocused();
    await expect(edit).toHaveCSS("outline-style", "solid");
    await expect(edit).toHaveCSS("outline-width", "2px");
    await edit.press("Enter");
    const input = view.getByLabel("제목", { exact: false });
    await input.focus();
    await expect(input).toBeFocused();
    await expect(input).toHaveCSS("outline-style", "solid");
    await expect(input).toHaveCSS("outline-width", "2px");
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

async function dragTab(page: Page, source: string, targetId: string, after = true) {
  const target = page.locator(`.workspace-tab[data-tab-id="${targetId}"]`);
  const box = (await target.boundingBox())!;
  await page.getByRole("tab", { name: source, exact: true }).dragTo(target, { targetPosition: { x: after ? box.width - 2 : 2, y: 20 } });
}

test("desktop: tab drag and keyboard reorder preserve the selected URL, draft and scroll", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 600 });
  const state = await fixture(page); await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`); await openTask(page); await openEntity(page, "버섯");
  await page.getByRole("tab", { name: "등심 구매하기", exact: true }).click();
  await expect(page.getByRole("tab", { name: "등심 구매하기", exact: true })).toHaveAttribute("aria-selected", "true");
  await panel(page).getByRole("button", { name: "편집", exact: true }).click();
  await panel(page).getByLabel("본문", { exact: true }).fill("순서를 바꿔도 보존할 초안");
  await panel(page).locator(".modal-body").evaluate(el => { el.scrollTop = 40; });
  const scroll = await panel(page).locator(".modal-body").evaluate(el => el.scrollTop), url = page.url();
  expect(scroll).toBeGreaterThan(0);
  await dragTab(page, "등심", `/entities/${encodeURIComponent(entityKey(6))}`);
  await expect.poll(() => tabNames(page)).toEqual(["등심 구매하기", "버섯", "등심"]);
  expect(page.url()).toBe(url);
  await expect(panel(page).getByLabel("본문", { exact: true })).toHaveValue("순서를 바꿔도 보존할 초안");
  expect(await panel(page).locator(".modal-body").evaluate(el => el.scrollTop)).toBe(scroll);
  const selected = page.getByRole("tab", { name: "등심 구매하기", exact: true });
  await selected.press("Control+Shift+ArrowRight");
  await expect.poll(() => tabNames(page)).toEqual(["버섯", "등심 구매하기", "등심"]); await expect(selected).toBeFocused();
  expect(page.url()).toBe(url); await page.screenshot({ path: info.outputPath("reordered-tabs-and-navigation-divider.png") });
  await page.getByRole("tab", { name: "등심", exact: true }).click();
  await page.getByRole("button", { name: "등심 탭 닫기", exact: true }).click();
  await expect(selected).toHaveAttribute("aria-selected", "true");
  await expect(panel(page).getByLabel("본문", { exact: true })).toHaveValue("순서를 바꿔도 보존할 초안");
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test("desktop: canceled or external tab drops leave order unchanged; overflow keyboard moves stay visible", async ({ page }) => {
  const state = await fixture(page);
  const titles = Array.from({ length: 7 }, (_, i) => `순서 조절을 검증할 긴 엔터티 제목 ${i}`);
  state.rows.entities.push(...titles.map((title, i) => entity(200 + i, { prop_1: title })));
  await page.goto("/entities");
  for (const title of titles) await openEntity(page, title);
  const original = await tabNames(page), last = page.getByRole("tab", { name: titles[6], exact: true });
  await last.dragTo(page.locator(".workspace-list h1"));
  expect(await tabNames(page)).toEqual(original); await expect(page.locator(".workspace-tab[data-dragging]")).toHaveCount(0);
  const box = (await last.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 35, box.y + 20, { steps: 4 });
  await page.keyboard.press("Escape"); await page.mouse.up();
  expect(await tabNames(page)).toEqual(original); await expect(page.locator(".workspace-tab[data-drop]")).toHaveCount(0);
  await last.press("Control+Shift+ArrowLeft");
  await expect.poll(() => tabNames(page)).toEqual([...titles.slice(0, 5), titles[6], titles[5]]);
  await expect(last).toBeFocused();
  const moved = (await last.boundingBox())!, strip = (await page.getByRole("tablist").boundingBox())!;
  expect(moved.x).toBeGreaterThanOrEqual(strip.x); expect(moved.x + moved.width).toBeLessThanOrEqual(strip.x + strip.width + 1);
  await expect(page.getByRole("button", { name: `${titles[6]} 탭 닫기`, exact: true })).not.toHaveAttribute("draggable", "true");
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test("desktop: navigation drag, keyboard limits, cancellation and reset reserve working pane widths", async ({ page }) => {
  const state = await fixture(page); await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`);
  const handle = page.getByRole("separator", { name: "탐색 메뉴 너비 조절" }), nav = page.getByRole("navigation", { name: "주 메뉴" });
  const navWidth = async () => (await nav.boundingBox())!.width;
  await expect(handle).toBeVisible(); expect(await navWidth()).toBe(208);
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x + 66, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(navWidth).toBe(268); await handle.press("ArrowLeft"); await expect.poll(navWidth).toBe(252);
  await handle.press("Home"); await expect.poll(navWidth).toBe(208);
  await handle.press("End"); await expect.poll(navWidth).toBe(320);
  expect((await page.locator(".workspace-list").boundingBox())!.width).toBeGreaterThanOrEqual(448);
  expect(await detailWidth(page)).toBeGreaterThanOrEqual(432);
  const end = (await handle.boundingBox())!;
  await page.mouse.move(end.x + 6, end.y + end.height / 2); await page.mouse.down();
  await handle.dispatchEvent("pointercancel", { pointerId: 1 }); await page.mouse.move(end.x - 80, end.y + end.height / 2); await page.mouse.up();
  expect(await navWidth()).toBe(320); await handle.dblclick(); await expect.poll(navWidth).toBe(208);
  await page.getByRole("button", { name: "상세 패널 숨기기" }).click();
  await page.setViewportSize({ width: 1024, height: 320 });
  const tasks = nav.getByRole("link", { name: "할 일", exact: true }); const menu = (await tasks.boundingBox())!;
  await tasks.click({ position: { x: menu.width - 2, y: menu.height / 2 } }); await expect(page).toHaveURL(/\/tasks$/);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test("desktop: both dividers at 150% preserve tabs and draft through hiding and mobile", async ({ page }) => {
  const state = await fixture(page, {}, { workspace_display_scale: "150", workspace_mobile_display_scale: "150" }); await page.setViewportSize({ width: 2160, height: 1080 });
  await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`); await openTask(page);
  await panel(page).getByRole("button", { name: "편집", exact: true }).click(); await panel(page).getByLabel("본문", { exact: true }).fill("양쪽 폭을 바꿔도 유지할 초안");
  const handle = page.getByRole("separator", { name: "탐색 메뉴 너비 조절" }), nav = page.getByRole("navigation", { name: "주 메뉴" });
  await handle.press("End"); await expect.poll(async () => (await nav.boundingBox())!.width).toBe(480);
  await dragSplit(page, -50); const width = await detailWidth(page);
  await page.getByRole("button", { name: "상세 패널 숨기기" }).click();
  await expect(handle).toBeVisible(); await page.getByRole("button", { name: "상세 탭 보기 (2개)" }).click();
  await expect.poll(() => detailWidth(page)).toBeCloseTo(width, 0);
  await page.setViewportSize({ width: 390, height: 844 }); await expect(page.getByRole("separator")).toHaveCount(0);
  await expect(page.locator("dialog.modal[open]").getByLabel("본문", { exact: true })).toHaveValue("양쪽 폭을 바꿔도 유지할 초안");
  await page.setViewportSize({ width: 2160, height: 1080 }); await expect(handle).toBeVisible();
  expect((await nav.boundingBox())!.width).toBe(480); await expect(panel(page).getByLabel("본문", { exact: true })).toHaveValue("양쪽 폭을 바꿔도 유지할 초안");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});
test("desktop: split dragging, keyboard limits and reset keep both panes readable", async ({ page }, info) => {
  const state = await fixture(page); await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`);
  const separator = page.getByRole("separator", { name: "상세 패널 너비 조절" });
  await expect(separator).toBeVisible();
  const original = await detailWidth(page);
  await dragSplit(page, -100);
  await expect.poll(() => detailWidth(page)).toBeCloseTo(original + 100, 0);
  await expect(page.locator(".detail-workspace")).not.toHaveClass(/is-resizing/);
  await separator.press("ArrowRight");
  await expect.poll(() => detailWidth(page)).toBeCloseTo(original + 84, 0);
  await separator.press("Home");
  await expect.poll(() => detailWidth(page)).toBeCloseTo(432, 0);
  await separator.press("End");
  expect((await page.locator(".workspace-list").boundingBox())!.width).toBeCloseTo(448, 0);
  expect(Number(await separator.getAttribute("aria-valuenow"))).toBe(Number(await separator.getAttribute("aria-valuemax")));
  await dragSplit(page, -2000);
  expect((await page.locator(".workspace-list").boundingBox())!.width).toBeCloseTo(448, 0);
  await dragSplit(page, 2000);
  expect(await detailWidth(page)).toBeCloseTo(432, 0);
  await separator.dblclick();
  await expect.poll(() => detailWidth(page)).toBeCloseTo(original, 0);
  await dragSplit(page, -80);
  await page.screenshot({ path: info.outputPath("resizable-detail-panel.png") });
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});
test("desktop: resized split preserves draft, tabs, hide/reopen and responsive proportions", async ({ page }) => {
  const state = await fixture(page); await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`); await openTask(page);
  await panel(page).getByRole("button", { name: "편집", exact: true }).click();
  await panel(page).getByLabel("본문", { exact: true }).fill("너비를 바꿔도 보존할 초안");
  await dragSplit(page, -60);
  const width = await detailWidth(page);
  const originalAvailable = (await page.locator(".detail-workspace").boundingBox())!.width - 12;
  await page.getByRole("tab", { name: "등심", exact: true }).click();
  expect(await detailWidth(page)).toBeCloseTo(width, 0);
  await page.getByRole("button", { name: "상세 패널 숨기기" }).click();
  await expect(page.getByRole("separator", { name: "상세 패널 너비 조절" })).toHaveCount(0);
  await page.getByRole("button", { name: "상세 탭 보기 (2개)" }).click();
  await expect.poll(() => detailWidth(page)).toBeCloseTo(width, 0);
  await page.getByRole("tab", { name: "등심 구매하기", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("separator", { name: "상세 패널 너비 조절" })).toHaveCount(0);
  await expect(page.locator("dialog.modal:not(.modal-confirm)[open]").getByLabel("본문", { exact: true })).toHaveValue("너비를 바꿔도 보존할 초안");
  await page.setViewportSize({ width: 1600, height: 900 });
  await expect(page.getByRole("separator", { name: "상세 패널 너비 조절" })).toBeVisible();
  const available = (await page.locator(".detail-workspace").boundingBox())!.width - 12;
  await expect.poll(async () => await detailWidth(page) / available).toBeCloseTo(width / originalAvailable, 2);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect.poll(async () => (await page.locator(".workspace-list").boundingBox())!.width).toBeGreaterThanOrEqual(448);
  expect(await detailWidth(page)).toBeGreaterThanOrEqual(432);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(() => detailWidth(page)).toBeCloseTo(width, 0);
  await expect(panel(page).getByLabel("본문", { exact: true })).toHaveValue("너비를 바꿔도 보존할 초안");
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});
test("desktop: pointer cancellation ends resizing without consuming later mouse moves", async ({ page }) => {
  const state = await fixture(page); await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`);
  const separator = page.getByRole("separator", { name: "상세 패널 너비 조절" });
  const box = (await separator.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + 100); await page.mouse.down();
  await page.mouse.move(box.x - 50, box.y + 100);
  await expect(page.locator(".detail-workspace")).toHaveClass(/is-resizing/);
  await separator.dispatchEvent("pointercancel", { pointerId: 1 });
  await expect(page.locator(".detail-workspace")).not.toHaveClass(/is-resizing/);
  const width = await detailWidth(page);
  await page.mouse.move(box.x - 100, box.y + 100); await page.mouse.up();
  expect(await detailWidth(page)).toBeCloseTo(width, 0);
  await dragSplit(page, 20);
  await expect.poll(() => detailWidth(page)).toBeCloseTo(width - 20, 0);
  expect(state.writes).toEqual([]);
});
test("desktop: separator target leaves tab icons clickable and adapts to large text", async ({ page }) => {
  await fixture(page); await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`); await openTask(page);
  const first = page.getByRole("tab", { name: "등심", exact: true });
  await first.locator("svg").click({ position: { x: 2, y: 8 } });
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".detail-workspace")).not.toHaveClass(/is-resizing/);
  const separator = page.getByRole("separator", { name: "상세 패널 너비 조절" });
  const box = (await separator.boundingBox())!;
  const before = await detailWidth(page);
  // The central grip has a 44x44 target, but does not steal header/footer clicks.
  await page.mouse.move(box.x - 10, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x - 30, box.y + box.height / 2); await page.mouse.up();
  await expect.poll(() => detailWidth(page)).toBeCloseTo(before + 20, 0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.addStyleTag({ content: ":root { font-size: 21px; }" });
  const available = (await page.locator(".detail-workspace").boundingBox())!.width - 12;
  await expect.poll(() => detailWidth(page)).toBeCloseTo(available / 2, 0);
  expect((await page.locator(".workspace-list").boundingBox())!.width).toBeCloseTo(available / 2, 0);
  await separator.press("End");
  expect(await detailWidth(page)).toBeCloseTo(available / 2, 0);
});
test("desktop: list stays usable, related details become unique tabs and close restores list", async ({ page }, info) => {
  const state = await fixture(page); await page.goto("/entities?view=table");
  await openEntity(page); await expect(page.getByRole("tab", { name: "등심", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".workspace-list")).not.toHaveAttribute("inert");
  expect(await panel(page).locator("dialog").evaluate(el => el.matches(":modal"))).toBe(false);
  await openTask(page); await expect(page.getByRole("tab")).toHaveCount(2);
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole("tab", { name: "등심", exact: true }).click();
  await panel(page).getByRole("region", { name: "할 일 (1개)" }).getByRole("link", { name: "등심 구매하기 상세", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
  await page.getByRole("button", { name: "등심 구매하기 탭 닫기", exact: true }).click();
  await expect(page.getByRole("tab", { name: "등심", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.screenshot({ path: info.outputPath("desktop-panel.png") });
  await page.getByRole("button", { name: "등심 탭 닫기", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(0); await expect(page).toHaveURL(/\/entities\?view=table/);
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});
test("desktop: drafts survive tab switch, panel hiding and responsive modal transition", async ({ page }, info) => {
  const state = await fixture(page); await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`); await openTask(page);
  await panel(page).getByRole("button", { name: "편집", exact: true }).click(); await panel(page).getByLabel("본문", { exact: true }).fill("보존할 편집 초안");
  await page.getByRole("tab", { name: "등심", exact: true }).click(); await page.getByRole("tab", { name: "등심 구매하기", exact: true }).click();
  await expect(panel(page).getByLabel("본문", { exact: true })).toHaveValue("보존할 편집 초안");
  await page.getByRole("button", { name: "상세 패널 숨기기" }).click(); await expect(page.locator(".workspace-details")).toBeHidden();
  await page.getByRole("button", { name: "상세 탭 보기 (2개)" }).click(); await expect(panel(page).getByLabel("본문", { exact: true })).toHaveValue("보존할 편집 초안");
  await page.setViewportSize({ width: 390, height: 844 });
  const modal = page.locator("dialog.modal:not(.modal-confirm)[open]"); await expect(modal.getByLabel("본문", { exact: true })).toHaveValue("보존할 편집 초안");
  // The media-query update and effect must finish closing the docked dialog and calling showModal.
  await expect.poll(() => modal.evaluate(el => el.matches(":modal"))).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 }); await expect(panel(page).getByLabel("본문", { exact: true })).toHaveValue("보존할 편집 초안");
  await page.screenshot({ path: info.outputPath("desktop-tabs-edit.png") });
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});
test("desktop: closing an inactive dirty tab asks once; cancel and discard preserve the active tab", async ({ page }) => {
  const state = await fixture(page); await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`); await openTask(page);
  await panel(page).getByRole("button", { name: "편집", exact: true }).click(); await panel(page).getByLabel("본문", { exact: true }).fill("초안");
  await page.getByRole("tab", { name: "등심", exact: true }).click();
  await page.getByRole("button", { name: "등심 구매하기 탭 닫기" }).click();
  const confirm = page.getByRole("dialog", { name: "변경을 버릴까요?" }); await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await page.getByRole("button", { name: "등심 구매하기 탭 닫기" }).click(); await confirm.getByRole("button", { name: "변경 버리기" }).click();
  await expect(page.getByRole("tab")).toHaveCount(1); await expect(confirm).not.toBeVisible();
  await expect(panel(page).getByRole("heading", { name: "등심", exact: true })).toBeVisible(); expect(state.errors).toEqual([]);
});
test("desktop: settings and guide preserve retained drafts; logout still protects them", async ({ page }, info) => {
  const state = await fixture(page);
  await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`);
  await openTask(page);
  await panel(page).getByRole("button", { name: "편집", exact: true }).click();
  await panel(page).getByLabel("본문", { exact: true }).fill("메뉴를 이동해도 유지할 초안");
  await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/ }).click();
  await page.getByRole("link", { name: "설정", exact: true }).click();
  const left = page.locator(".workspace-list");
  await expect(left.getByRole("heading", { name: "기본 설정", level: 1, exact: true })).toBeVisible();
  await expect(panel(page).getByLabel("본문", { exact: true })).toHaveValue("메뉴를 이동해도 유지할 초안");
  await left.getByLabel("닉네임", { exact: true }).fill("왼쪽 설정의 초안");
  await page.getByRole("tab", { name: "등심", exact: true }).click();
  await page.getByRole("tab", { name: "등심 구매하기", exact: true }).click();
  await expect(left.getByLabel("닉네임", { exact: true })).toHaveValue("왼쪽 설정의 초안");
  await expect(page.getByRole("button", { name: /^내 프로필 · 설정 현재 화면$/ })).toHaveAttribute("aria-current", "page");
  await expect(panel(page).getByLabel("본문", { exact: true })).toHaveValue("메뉴를 이동해도 유지할 초안");
  await page.screenshot({ path: info.outputPath("settings-and-retained-detail.png") });
  await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/ }).click();
  await page.getByRole("link", { name: "사용 가이드", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "변경을 버릴까요?" });
  await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(left.getByLabel("닉네임", { exact: true })).toHaveValue("왼쪽 설정의 초안");
  if (await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/ }).getAttribute("aria-expanded") !== "true") await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/ }).click();
  await page.getByRole("link", { name: "사용 가이드", exact: true }).click();
  await confirm.getByRole("button", { name: "변경 버리기" }).click();
  await expect(left.getByRole("heading", { name: "사용 가이드", level: 1, exact: true })).toBeVisible();
  await expect(panel(page).getByLabel("본문", { exact: true })).toHaveValue("메뉴를 이동해도 유지할 초안");
  await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/ }).click();
  await page.getByRole("link", { name: "로그아웃", exact: true }).click();
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});
test("mobile: direct detail keeps existing modal and no desktop tabs", async ({ page }) => {
  const state = await fixture(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`);
  const modal = page.locator("dialog.modal:not(.modal-confirm)[open]"); await expect(modal.getByRole("heading", { name: "등심" })).toBeVisible();
  expect(await modal.evaluate(el => el.matches(":modal"))).toBe(true); await expect(page.getByRole("tab")).toHaveCount(0);
  await modal.getByRole("button", { name: "닫기", exact: true }).click(); await expect(page).toHaveURL(/\/entities/); expect(state.errors).toEqual([]);
});

test("desktop: saving updates the retained list; confirmation remains small and uncertain retry identical", async ({ page }) => {
  const state = await fixture(page, { failWrite: "unknown" }); await page.goto("/tasks");
  const list = page.locator(".workspace-list"); await list.getByRole("button", { name: "등심 구매하기", exact: true }).click(); await list.getByRole("link", { name: "등심 구매하기 상세" }).click();
  await expect(page.getByRole("tab", { name: "등심 구매하기" })).toHaveAttribute("aria-selected", "true");
  await panel(page).getByRole("button", { name: "편집", exact: true }).click(); await panel(page).getByLabel("제목").fill("새 구매 계획");
  await panel(page).getByRole("button", { name: "저장", exact: true }).click();
  const confirmation = page.locator("dialog.modal-action[open]"); await expect(confirmation.getByLabel("기록 메모")).toBeVisible();
  expect(await confirmation.evaluate(el => el.matches(":modal"))).toBe(true); expect((await confirmation.boundingBox())!.width).toBeLessThan(650);
  await confirmation.getByRole("button", { name: "수정하고 저장" }).click(); await confirmation.getByRole("button", { name: "같은 내용 다시 시도" }).click();
  await expect(page.getByRole("tab", { name: "새 구매 계획" })).toHaveAttribute("aria-selected", "true");
  await expect(list.getByRole("button", { name: "새 구매 계획", exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(2);
  expect(state.writes[0]).toMatchObject({ method: "PATCH", path: `/api/tasks/${id(2)}`, body: {
    title: "새 구매 계획", body: "상세 본문", tag_ids: [], due_on: null, expected_version: 1,
    change_note: "새 구매 계획 수정", change_tag_ids: [],
  } });
  expect(state.writes[0].body).not.toHaveProperty("entity_ids");
  expect(state.writes[1].body).toEqual(state.writes[0].body);
  expect(state.writes[0].requestKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(state.writes[1].requestKey).toBe(state.writes[0].requestKey);
  expect(state.errors).toEqual([]);
});

test("desktop: recurring task confirmation cancellation prepares and saves the changed draft", async ({ page }) => {
  const state = await fixture(page);
  Object.assign(state.rows.tasks[0], {
    kind: "recurring",
    status: "active",
    recurrence: { freq: "daily", starts_on: "2026-10-04" },
    timezone: "Asia/Seoul",
  });
  await page.route(/\/api\/tasks\/[^/]+\/occurrences\?/, route => route.fulfill({ json: { today: "2026-10-11", items: [] } }));
  const preparations: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/records/prepare")) preparations.push(request.postDataJSON());
  });
  await page.goto(`/tasks/${id(2)}`);
  await panel(page).getByRole("button", { name: "편집", exact: true }).click();
  await panel(page).getByLabel("제목").fill("처음 계획");
  await panel(page).getByRole("button", { name: "저장", exact: true }).click();
  const confirmation = page.locator("dialog.modal-action[open]");
  await expect(confirmation.getByLabel("기록 메모")).toHaveValue("처음 계획 수정");
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await panel(page).getByLabel("제목").fill("월간 계획");
  await panel(page).getByRole("radio", { name: "매월", exact: true }).check();
  await panel(page).getByLabel("날짜", { exact: true }).fill("1, 15");
  await panel(page).getByLabel("시간대").selectOption("America/New_York");
  await panel(page).getByRole("button", { name: "저장", exact: true }).click();
  await expect(confirmation.getByLabel("기록 메모")).toHaveValue("월간 계획 수정");
  await confirmation.getByLabel("기록 메모").fill("월간 검토로 변경");
  await confirmation.getByRole("button", { name: "수정하고 저장" }).click();
  await expect(panel(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
  const input = {
    title: "월간 계획",
    body: "상세 본문",
    tag_ids: [],
    recurrence: { freq: "monthly", month_days: [1, 15], starts_on: "2026-10-04" },
    timezone: "America/New_York",
  };
  expect(preparations).toHaveLength(2);
  expect(preparations[1]).toEqual({ model: "task", action: "update", target_id: id(2), expected_version: 1, input });
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({ method: "PATCH", path: `/api/tasks/${id(2)}` });
  expect(state.writes[0].body).toEqual({
    ...input,
    change_note: "월간 검토로 변경",
    change_tag_ids: [],
    expected_version: 1,
  });
  expect(state.errors).toEqual([]);
});

test("desktop: creating a task from an entity prepares and saves its selected relationship", async ({ page }) => {
  const state = await fixture(page);
  const preparations: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.url().endsWith("/records/prepare")) preparations.push(request.postDataJSON());
  });
  await page.goto(`/entities/${encodeURIComponent(entityKey(1))}?create=task`);
  await panel(page).getByLabel("제목").fill("다음 구매");
  await panel(page).getByLabel("기한").fill("2026-11-01");
  await saveOnce(page, panel(page), "추가");
  await expect(panel(page).getByLabel("제목")).toHaveCount(0);
  const input = {
    title: "다음 구매",
    body: "",
    tag_ids: [],
    due_on: "2026-11-01",
    kind: "once",
    entity_ids: [entityKey(1)],
  };
  expect(preparations).toEqual([{ model: "task", action: "create", input }]);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({
    method: "POST",
    path: "/api/tasks",
    body: { ...input, change_note: "다음 구매 등록", change_tag_ids: [] },
  });
  expect(state.writes[0].body).not.toHaveProperty("expected_version");
  expect(state.errors).toEqual([]);
});

test("desktop: pending writes block tab switching, close, hide and navigation", async ({ page }) => {
  const state = await fixture(page, { hold: true }); await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`); await openTask(page);
  await panel(page).getByRole("button", { name: "편집", exact: true }).click(); await panel(page).getByLabel("본문", { exact: true }).fill("새 내용"); await panel(page).getByRole("button", { name: "저장", exact: true }).click();
  await page.locator("dialog.modal-action[open]").getByRole("button", { name: "수정하고 저장" }).click(); await state.pending;
  await page.getByRole("tab", { name: "등심 구매하기", exact: true }).dispatchEvent("keydown", { key: "ArrowLeft", ctrlKey: true, shiftKey: true, bubbles: true });
  expect(await tabNames(page)).toEqual(["등심", "등심 구매하기"]);
  for (const label of ["등심 탭 닫기", "등심 구매하기 탭 닫기", "상세 패널 숨기기"]) await page.getByRole("button", { name: label, exact: true }).evaluate((el: HTMLButtonElement) => el.click());
  await page.getByRole("tab", { name: "등심", exact: true }).evaluate((el: HTMLButtonElement) => el.click());
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "검사 자료", exact: true }).evaluate((el: HTMLAnchorElement) => el.click());
  await expect(page.getByRole("tab", { name: "등심 구매하기", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".workspace-details")).toBeVisible(); await expect(page.getByRole("tab")).toHaveCount(2);
  state.release(); await expect(panel(page).getByRole("button", { name: "편집", exact: true })).toBeVisible(); expect(state.errors).toEqual([]);
});


test("desktop: creation opens a viewer tab, deletion closes it and refreshes the list", async ({ page }) => {
  const state = await fixture(page); await page.goto("/tasks");
  await page.getByRole("button", { name: "할 일 등록", exact: true }).click();
  const creation = page.getByRole("dialog", { name: "할 일 추가", exact: true });
  await creation.getByLabel("제목").fill("새 할 일"); await saveOnce(page, creation, "추가");
  await expect(creation).not.toBeVisible(); await expect(page.getByRole("tab", { name: "새 할 일", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.locator(".workspace-list").getByRole("button", { name: "새 할 일", exact: true })).toBeVisible();
  await panel(page).getByRole("button", { name: "편집", exact: true }).click(); await panel(page).getByRole("button", { name: "삭제", exact: true }).click();
  await page.locator("dialog.modal-action[open]").getByRole("button", { name: "삭제하고 기록", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(0); await expect(page).not.toHaveURL(/create=/);
  await expect(page.locator(".workspace-list").getByRole("button", { name: "새 할 일", exact: true })).toHaveCount(0);
  await expect(page.locator(".workspace-list").getByRole("button", { name: "등심 구매하기", exact: true })).toBeVisible();
  expect(state.writes.map(write => write.method)).toEqual(["POST", "POST"]); expect(state.errors).toEqual([]);
});

test("desktop: list position survives panel hide, reopen and last close", async ({ page }) => {
  const state = await fixture(page);
  state.rows.entities.push(...Array.from({ length: 40 }, (_, i) => entity(i + 200, { prop_1: `상품 ${i}` })));
  await page.goto("/entities"); await openEntity(page);
  const list = page.locator(".workspace-list"); await list.evaluate(el => { el.scrollTop = 750; });
  await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(750);
  await page.getByRole("button", { name: "상세 패널 숨기기" }).click(); await expect.poll(() => page.evaluate(() => scrollY)).toBe(750);
  await page.getByRole("button", { name: "상세 탭 보기 (1개)" }).click(); await expect.poll(() => list.evaluate(el => el.scrollTop)).toBe(750);
  await page.getByRole("button", { name: "등심 탭 닫기", exact: true }).click(); await expect.poll(() => page.evaluate(() => scrollY)).toBe(750);
  const origin = list.getByRole("button", { name: "등심", exact: true });
  await expect(origin).toBeFocused(); expect(await origin.evaluate(element => element.tabIndex)).toBe(0); expect(state.errors).toEqual([]);
});

test("desktop: each detail retains its own body scroll and reopening a dirty target reuses its editor", async ({ page }) => {
  const state = await fixture(page); state.rows.tasks[0].body = Array.from({ length: 60 }, (_, i) => `상세 설명 ${i}`).join("\n\n");
  await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`); await openTask(page);
  const body = panel(page).locator(".modal-body"); await body.evaluate(el => { el.scrollTop = 400; });
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBe(400);
  await page.getByRole("tab", { name: "등심", exact: true }).click(); await page.getByRole("tab", { name: "등심 구매하기", exact: true }).click();
  await expect.poll(() => body.evaluate(el => el.scrollTop)).toBe(400);
  await panel(page).getByRole("button", { name: "편집", exact: true }).click(); await panel(page).getByLabel("본문", { exact: true }).fill("보존할 초안");
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "할 일", exact: true }).click();
  const list = page.locator(".workspace-list"); await list.getByRole("button", { name: "등심 구매하기", exact: true }).click(); await list.getByRole("link", { name: "등심 구매하기 상세", exact: true }).click();
  await expect(panel(page).getByLabel("본문", { exact: true })).toHaveValue("보존할 초안"); await expect(page.getByRole("tab")).toHaveCount(2);
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

test("desktop: browser history selects retained tabs without discarding their drafts", async ({ page }) => {
  const state = await fixture(page); await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`); await openTask(page);
  await panel(page).getByRole("button", { name: "편집", exact: true }).click(); await panel(page).getByLabel("본문", { exact: true }).fill("이력 이동 후에도 보존");
  await page.goBack(); await expect(page.getByRole("tab", { name: "등심", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.goForward(); await expect(panel(page).getByLabel("본문", { exact: true })).toHaveValue("이력 이동 후에도 보존");
  await expect(page.getByRole("dialog", { name: "변경을 버릴까요?" })).not.toBeVisible(); expect(state.errors).toEqual([]);
});

test("desktop: many long titles scroll inside the tab strip and keyboard selection stays visible", async ({ page }) => {
  const state = await fixture(page);
  const titles = Array.from({ length: 7 }, (_, i) => `긴 상품 설명과 조건을 담은 엔터티 제목 ${i}`);
  state.rows.entities.push(...titles.map((title, i) => entity(200 + i, { prop_1: title })));
  await page.goto("/entities");
  for (const title of titles) {
    await openEntity(page, title);
    const selected = page.getByRole("tab", { name: title, exact: true });
    await expect(selected).toHaveAttribute("aria-selected", "true");
    await expect.poll(async () => {
      const tab = await selected.boundingBox(), strip = await page.getByRole("tablist").boundingBox();
      return !!tab && !!strip && tab.x >= strip.x && tab.x + tab.width <= strip.x + strip.width + 1;
    }).toBe(true);
  }
  const strip = page.getByRole("tablist"); expect(await strip.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  await page.getByRole("tab", { name: titles[6], exact: true }).focus(); await page.keyboard.press("Home");
  await expect(page.getByRole("tab", { name: titles[0], exact: true })).toBeFocused();
  await expect.poll(() => strip.evaluate(el => el.scrollLeft)).toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(state.errors).toEqual([]);
});

test("desktop: saving can be followed immediately by editing again", async ({ page }) => {
  const state = await fixture(page); await page.goto(`/tasks/${id(2)}`);
  await panel(page).getByRole("button", { name: "편집", exact: true }).click(); await panel(page).getByLabel("본문", { exact: true }).fill("저장한 내용");
  await saveOnce(page, panel(page)); await panel(page).getByRole("button", { name: "편집", exact: true }).click();
  await expect(panel(page).getByLabel("본문", { exact: true })).toHaveValue("저장한 내용");
  await panel(page).getByRole("button", { name: "취소", exact: true }).click(); await panel(page).getByRole("button", { name: "편집", exact: true }).click();
  await expect(panel(page).getByRole("button", { name: "저장", exact: true })).toBeVisible(); expect(state.errors).toEqual([]);
});

test("desktop: record tabs use distinct body previews and logout removes the retained workspace", async ({ page }) => {
  const state = await fixture(page); state.rows.records.push({ ...record(200), body: "다음 상담 때 확인할 내용" });
  await page.route("**/auth/v1/logout**", route => route.fulfill({ status: 200, json: {} }));
  await page.goto("/records");
  const list = page.locator(".workspace-list");
  for (const title of ["구매 기준을 정리했습니다.", "다음 상담 때 확인할 내용"]) {
    await list.getByRole("button", { name: title, exact: true }).click(); await list.getByRole("link", { name: `${title} 상세`, exact: true }).click();
  await expect(page.getByRole("tab", {name:title,exact:true})).toHaveAttribute("aria-selected","true");
    await expect(page.getByRole("tab", { name: title, exact: true })).toHaveAttribute("aria-selected", "true");
  }
  await expect(page.getByRole("tab")).toHaveCount(2); await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/ }).click(); await page.getByRole("link", { name: "로그아웃", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/); await expect(page.getByRole("tab")).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("sb-127-auth-token"))).toBeNull(); expect(state.errors).toEqual([]);
});
test("mobile: expanding an unfinished native editor never reparents or loses its draft", async ({ page }) => {
  const state = await fixture(page); await page.setViewportSize({ width: 390, height: 844 }); await page.goto(`/tasks/${id(2)}?edit=1`);
  const modal = page.locator("dialog.modal:not(.modal-confirm)[open]"); await modal.getByLabel("본문", { exact: true }).fill("모바일 초안");
  await page.setViewportSize({ width: 1440, height: 900 }); await expect(modal.getByLabel("본문", { exact: true })).toHaveValue("모바일 초안"); await expect(page.getByRole("tab")).toHaveCount(0);
  await modal.getByRole("button", { name: "취소", exact: true }).click(); await page.getByRole("dialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" }).click();
  await modal.getByRole("button", { name: "닫기", exact: true }).click(); await expect(page.locator(".workspace-list")).toBeVisible(); expect(state.errors).toEqual([]);
  await expect(page.getByRole("tab")).toHaveCount(0); await expect(page.locator(".workspace-details")).toBeHidden();
});

test("desktop: relation saves refresh retained filtered lists without leaving the viewer", async ({ page }) => {
  const state = await fixture(page);
  await page.route(url => url.origin === "http://127.0.0.1:55591" && url.pathname === "/api/tasks" && url.searchParams.has("entity_id"), route => {
    return route.fulfill({ json: { items: state.rows.tasks.filter(task => task.entity_ids.includes(entityKey(1))), next_cursor: null } });
  });
  await page.goto(`/tasks?entity_id=${encodeURIComponent(entityKey(1))}`);
  const list = page.locator(".workspace-list"); await list.getByRole("button", { name: "등심 구매하기", exact: true }).click(); await list.getByRole("link", { name: "등심 구매하기 상세", exact: true }).click();
  const entities = panel(page).getByRole("region", { name: "연결된 자료 (1개)", exact: true });
  await entities.getByRole("button", { name: "등심", exact: true }).click(); await entities.getByRole("button", { name: "등심 해제", exact: true }).click();
  await page.locator("dialog.modal-action[open]").getByRole("button", { name: "해제하고 저장", exact: true }).click();
  await expect(panel(page).getByRole("heading", { name: "연결된 자료 (0개)", exact: true })).toBeVisible();
  await expect(list.getByRole("button", { name: "등심 구매하기", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "등심 구매하기", exact: true })).toHaveAttribute("aria-selected", "true");
  expect(state.writes).toHaveLength(1); expect(state.errors).toEqual([]);
});

for (const width of [320, 390]) {
  test(`long domain heading ${width}: description keeps the close control on the title row`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page);
    const label = "긴자료종류이름".repeat(8);
    state.rows.entities[0].type = { ...state.rows.entities[0].type, label };
    await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`);
    const view = page.locator("dialog.modal[open]:not(.modal-confirm)");
    const title = view.locator(".dialog-title");
    await expect(title).toHaveText(label);
    const close = view.getByRole("button", { name: "닫기", exact: true });
    const titleBox = (await title.boundingBox())!, closeBox = (await close.boundingBox())!;
    expect(closeBox.x).toBeGreaterThanOrEqual(titleBox.x + titleBox.width);
    const descriptionBox = (await view.locator(".modal-head > .page-description").boundingBox())!;
    expect(descriptionBox.y).toBeGreaterThanOrEqual(
      Math.max(titleBox.y + titleBox.height, closeBox.y + closeBox.height),
    );
    expect(await view.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    await close.click();
    await expect(view).toHaveCount(0);
  });
}

for (const width of [390, 1440]) test(`detail hierarchy ${width}: domain headings, content first and value-only editing`, async ({page}, info) => {
  await page.setViewportSize({width,height:900});
  const state=await fixture(page);
  for (const item of [
    {path:`/entities/${encodeURIComponent(entityKey(1))}`,domain:"검사 자료",title:"등심"},
    {path:`/tasks/${id(2)}`,domain:"할 일",title:"등심 구매하기"},
    {path:`/records/${id(3)}`,domain:"기록",title:null},
  ]) {
    await page.goto(item.path);
    const view=page.locator("dialog.modal[open]:not(.modal-confirm)");
    await expect(view.locator(".modal-head .dialog-title")).toHaveText(item.domain);
    const description = view.locator(".modal-head > .page-description");
    await expect(description).toBeVisible();
    const readDescription = await description.innerText();
    await expect(view).toHaveAttribute("aria-describedby", await description.getAttribute("id") as string);
    if(item.title) await expect(view.locator(".modal-body .detail-title")).toHaveText(item.title);
    else await expect(view.locator(".record-content")).toHaveText("구매 기준을 정리했습니다.");
    const relation=view.locator(".detail-relations");
    {
      await expect(relation).toBeVisible();
      expect(await relation.evaluate(el=>getComputedStyle(el).borderTopWidth)).toBe("1px");
      expect(await relation.evaluate(el=>parseFloat(getComputedStyle(el).paddingTop))).toBeGreaterThanOrEqual(24);
    }
    expect(await view.evaluate(el=>el.scrollWidth<=el.clientWidth)).toBe(true);
    if(item.domain==="할 일") await view.screenshot({path:info.outputPath(`detail-hierarchy-${width}.png`)});
    await view.getByRole("button",{name:"편집",exact:true}).click();
    await expect(view.locator(".modal-head .dialog-title")).toHaveText(item.domain);
    await expect(description).not.toHaveText(readDescription);
    await expect(description).toHaveCSS("font-size", "13px");
    await expect(view.getByRole("region",{name:/^(엔터티|할 일|기록) \(\d+개\)$/})).toHaveCount(0);
    await expect(view.getByRole("button",{name:/^(엔터티|할 일|기록).* (연결|해제)$/})).toHaveCount(0);
    if(item.domain==="기록") {
      await view.getByLabel("본문",{exact:false}).fill("관계를 보존하는 본문 정정");
      await view.getByRole("button",{name:"저장",exact:true}).click();
      await expect(view.locator(".record-content")).toHaveText("관계를 보존하는 본문 정정");
      const write=state.writes.find(row=>row.method==="PATCH"&&row.path===`/api/records/${id(3)}`)!;
      expect(write.body).not.toHaveProperty("entity_ids"); expect(write.body).not.toHaveProperty("task_id");
      await expect(view.getByRole("region",{name:"연결된 자료 (1개)",exact:true})).toBeVisible();
      await expect(view.getByRole("region",{name:"할 일 (1개)",exact:true})).toBeVisible();
    } else await view.getByRole("button",{name:"취소",exact:true}).click();
    await expect(description).toHaveText(readDescription);
  }
  expect(state.errors).toEqual([]);
});

test("related previous: one starting tab survives cross-links, dirty drafts, resize and root close",async({page})=>{
  const state=await fixture(page); await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`); await openTask(page);
  await expect(panel(page).getByRole("button",{name:"이전: 등심",exact:true})).toBeVisible();
  const entities=panel(page).getByRole("region",{name:"연결된 자료 (1개)",exact:true});
  await entities.getByRole("button",{name:"등심",exact:true}).click();
  await entities.getByRole("link",{name:"등심 상세",exact:true}).click();
  await expect(page.getByRole("tab",{name:"등심",exact:true})).toHaveAttribute("aria-selected","true");
  await expect(panel(page).getByRole("button",{name:/^이전:/})).toHaveCount(0);
  await openTask(page);
  const records=panel(page).getByRole("region",{name:"기록 (1개)",exact:true});
  await records.getByRole("button",{name:"구매 기준을 정리했습니다.",exact:true}).click();
  await records.getByRole("link",{name:"구매 기준을 정리했습니다. 상세",exact:true}).click();
  await expect(page.getByRole("tab",{name:"구매 기준을 정리했습니다.",exact:true})).toHaveAttribute("aria-selected","true");
  await expect(panel(page).getByRole("button",{name:"이전: 등심",exact:true})).toBeVisible();
  await panel(page).getByRole("button",{name:"이전: 등심",exact:true}).click();
  await expect(page.getByRole("tab",{name:"등심",exact:true})).toHaveAttribute("aria-selected","true");
  await expect(page.getByRole("tab")).toHaveCount(3);
  await page.getByRole("tab",{name:"등심 구매하기",exact:true}).click();
  await expect(page.getByRole("tab",{name:"등심 구매하기",exact:true})).toHaveAttribute("aria-selected","true");
  await panel(page).getByRole("button",{name:"편집",exact:true}).click();
  await panel(page).getByLabel("본문",{exact:true}).fill("이전 이동해도 보존할 초안");
  await panel(page).getByRole("button",{name:"이전: 등심",exact:true}).click();
  await expect(page.getByRole("tab",{name:"등심",exact:true})).toHaveAttribute("aria-selected","true");
  await expect(page.getByRole("dialog",{name:"변경을 버릴까요?"})).not.toBeVisible();
  await page.getByRole("tab",{name:"등심 구매하기",exact:true}).click();
  await expect(page.getByRole("tab",{name:"등심 구매하기",exact:true})).toHaveAttribute("aria-selected","true");
  await expect(panel(page).getByLabel("본문",{exact:true})).toHaveValue("이전 이동해도 보존할 초안");
  await page.setViewportSize({width:390,height:844});
  const modal=page.locator("dialog.modal[open]:not(.modal-confirm)");
  await modal.getByRole("button",{name:"이전: 등심",exact:true}).click();
  await expect(modal.locator(".detail-title")).toHaveText("등심");
  await page.setViewportSize({width:1440,height:900});
  await page.getByRole("button",{name:"등심 탭 닫기",exact:true}).click();
  await page.getByRole("tab",{name:"등심 구매하기",exact:true}).click();
  await expect(page.getByRole("tab",{name:"등심 구매하기",exact:true})).toHaveAttribute("aria-selected","true");
  await expect(panel(page).getByRole("button",{name:/^이전:/})).toHaveCount(0);
  await expect(panel(page).getByLabel("본문",{exact:true})).toHaveValue("이전 이동해도 보존할 초안");
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test("mobile direct visit: related previous restores its source without stacked dialogs",async({page})=>{
  await page.setViewportSize({width:390,height:844}); const state=await fixture(page);
  await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`);
  const modal=page.locator("dialog.modal[open]:not(.modal-confirm)");
  await expect(modal.getByRole("button",{name:/^이전:/})).toHaveCount(0);
  const tasks=modal.getByRole("region",{name:"할 일 (1개)",exact:true});
  await tasks.getByRole("button",{name:"등심 구매하기",exact:true}).click();
  await tasks.getByRole("link",{name:"등심 구매하기 상세",exact:true}).click();
  await expect(modal.locator(".modal-head .dialog-title")).toHaveText("할 일");
  await expect(modal).toHaveCount(1);
  await modal.getByRole("button",{name:/^이전:/}).click();
  await expect(modal.locator(".modal-head .dialog-title")).toHaveText("검사 자료");
  await expect(modal.locator(".detail-title")).toHaveText("등심");
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});


test("related previous: an explicit new source replaces the single return target; selecting tabs does not",async({page})=>{
  const state=await fixture(page);
  state.rows.entities[1].tasks={count:1,items:[state.rows.tasks[0]]};
  await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`); await openTask(page);
  await expect(panel(page).getByRole("button",{name:"이전: 등심",exact:true})).toBeVisible();
  await openEntity(page,"버섯"); await openTask(page);
  await expect(panel(page).getByRole("button",{name:"이전: 버섯",exact:true})).toBeVisible();
  await page.getByRole("tab",{name:"등심",exact:true}).click();
  await page.getByRole("tab",{name:"등심 구매하기",exact:true}).click();
  await expect(page.getByRole("tab",{name:"등심 구매하기",exact:true})).toHaveAttribute("aria-selected","true");
  await panel(page).getByRole("button",{name:"이전: 버섯",exact:true}).click();
  await expect(page.getByRole("tab",{name:"버섯",exact:true})).toHaveAttribute("aria-selected","true");
  await expect(page.getByRole("tab")).toHaveCount(3); expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});


test("desktop: ordinary edits preserve the immutable identity, retained tab and URL", async ({page}) => {
  await page.setViewportSize({width:1440,height:900});
  const state = await fixture(page), oldId = entityKey(1);
  await page.goto(`/entities/${encodeURIComponent(oldId)}`);
  await panel(page).getByRole("button", {name:"편집",exact:true}).click();
  await expect(panel(page).getByLabel("번호",{exact:true})).toHaveAttribute("readonly", "");
  await panel(page).getByLabel("제목",{exact:false}).fill("등심 수정");
  await saveOnce(page,panel(page));
  await expect(page).toHaveURL(new RegExp(encodeURIComponent(oldId)));
  await expect(page.getByRole("tab",{name:"등심 수정",exact:true})).toHaveCount(1);
  expect(state.rows.entities[0].id).toBe(oldId);
  expect(state.rows.entities[0].external_id).toBe(id(1));
  expect(state.errors).toEqual([]);
});

for (const entered of [false,true]) test(`manual identity defaults preserve cancel state: entered=${entered}`, async ({page}) => {
  await fixture(page);
  let releaseSettings!: () => void;
  const ready = new Promise<void>(resolve => {releaseSettings=resolve;});
  await page.route("**/api/entity-types/*/identity", async route => {
    await ready;
    const config = fixtureIdentity();
    await route.fulfill({json:{...config,label:"자료 번호",default_source:"crm",sources:[{...config.sources[0],code:"crm",source_label:"고객",generation:"direct"}]}});
  });
  await page.goto("/entities?entity_type_id=00000000-0000-4000-8000-000000000900");
  await page.getByRole("button", {name:"검사 자료 추가",exact:true}).click();
  const form = page.getByRole("dialog", {name:"검사 자료 추가",exact:true});
  await expect(form.getByRole("textbox", { name: "번호", exact: true })).toBeDisabled();
  if (entered) await form.getByLabel("제목").fill("설정 도착 전 입력");
  releaseSettings();
  await expect(form.getByLabel("자료 번호")).toBeEnabled();
  await expect(form.getByLabel("자료 번호")).toHaveValue("");
  await expect(form.getByText("고객", {exact:true})).toBeVisible();
  await expect(form.getByRole("combobox", {name:"번호 출처",exact:true})).toHaveCount(0);
  if (entered) await expect(form.getByLabel("제목")).toHaveValue("설정 도착 전 입력");
  await form.getByRole("button", {name:"취소",exact:true}).click();
  const discard = page.getByRole("dialog", {name:"변경을 버릴까요?",exact:true});
  if (entered) {
    await expect(discard).toBeVisible();
    await discard.getByRole("button", {name:"변경 버리기",exact:true}).click();
  } else await expect(discard).toHaveCount(0);
  await expect(form).toHaveCount(0);
});


test("desktop: closing a search detail restores the originating result and reload focus",async({page})=>{
  const state=await fixture(page);await page.setViewportSize({width:1440,height:900});
  await page.goto("/search?q=등심&mode=keyword&kind=task");
  const result=page.locator(".workspace-list").getByRole("link",{name:"등심 구매하기",exact:true});
  await result.click();await expect(page.getByRole("tab",{name:"등심 구매하기",exact:true})).toHaveAttribute("aria-selected","true");
  await page.getByRole("button",{name:"등심 구매하기 탭 닫기",exact:true}).click();
  await expect(result).toBeFocused();expect(await result.evaluate(element=>element.tabIndex)).toBe(0);expect(new URL(page.url()).hash).toBe(`#search-task-${id(2)}`);
  await page.reload();await expect(result).toBeFocused();expect(state.errors).toEqual([]);
});

test("desktop: entity list focus round trips a Unicode and percent identity through its encoded hash",async({page})=>{
  const state=await fixture(page);await page.setViewportSize({width:1440,height:900});
  const external="고객 / # ? % : 7",canonical=`crm:${id(900)}:${external}`;
  Object.assign(state.rows.entities[0],{id:canonical,source:"crm",external_id:external,source_label:"고객 관리"});
  await page.goto("/entities");await openEntity(page);
  await page.getByRole("button",{name:"등심 탭 닫기",exact:true}).click();
  const target=page.locator(".workspace-list").getByRole("button",{name:"등심",exact:true});
  await expect(target).toBeFocused();expect(await target.evaluate(element=>element.tabIndex)).toBe(0);expect(new URL(page.url()).hash).toBe(`#${encodeURIComponent(`entity-${canonical}`)}`);
  await page.reload();await expect(target).toBeFocused();expect(state.errors).toEqual([]);
});

for(const width of [390,1440]) test(`전체 펼침 ${width}px 토글은 표시된 목록을 함께 열고 모달 구획은 독립적으로 유지한다`, async ({page}) => {
  await page.setViewportSize({width,height:900});
  const state=await fixture(page);
  await page.goto('/entities');
  const main=page.getByRole('region',{name:/^(전체 자료|검사 자료) 목록$/,exact:true});
  await main.getByRole('button',{name:'등심',exact:true}).click();
  await main.getByRole('button',{name:'전체 자료 전체 열기',exact:true}).click();
  for(const name of ['등심','버섯']) await expect(main.getByRole('button',{name,exact:true})).toHaveAttribute('aria-expanded','true');
  expect(new URL(page.url()).searchParams.getAll('open')).toHaveLength(2);
  await page.reload();
  await main.getByRole('button',{name:'전체 자료 전체 닫기',exact:true}).click();
  for(const name of ['등심','버섯']) await expect(main.getByRole('button',{name,exact:true})).toHaveAttribute('aria-expanded','false');
  expect(new URL(page.url()).searchParams.getAll('open')).toHaveLength(0);
  await main.getByRole("button",{name:"등심",exact:true}).click();
  await main.getByRole("link",{name:"등심 상세",exact:true}).click();
  const detail=page.getByRole("dialog",{name:"검사 자료",exact:true});
  const tasks=detail.getByRole('region',{name:'할 일 (1개)',exact:true});
  const records=detail.getByRole('region',{name:'기록 (1개)',exact:true});
  await tasks.getByRole('button',{name:'할 일 전체 열기',exact:true}).click();
  await expect(tasks.getByRole('button',{name:'등심 구매하기',exact:true})).toHaveAttribute('aria-expanded','true');
  await expect(records.getByRole('button',{name:'기록 전체 열기',exact:true})).toBeVisible();
  await records.getByRole('button',{name:'기록 전체 열기',exact:true}).click();
  await tasks.getByRole('button',{name:'할 일 전체 닫기',exact:true}).click();
  await expect(tasks.getByRole('button',{name:'등심 구매하기',exact:true})).toHaveAttribute('aria-expanded','false');
  await expect(records.getByRole('button',{name:'기록 전체 닫기',exact:true})).toBeVisible();
  expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});

test("#335 준비 충돌: 패널 숨김은 초안 보존, 탭 닫기 승인 뒤 재열기는 최신 내용", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const state = await fixture(page);
  await page.goto( `/tasks/${id(2)}?edit=1`);
  await panel(page).getByLabel("제목", { exact: false }).fill("숨겨도 보존할 초안");
  Object.assign(state.rows.tasks[0], { title: "외부 최신 이름", body: "외부 최신 본문", version: 2 });
  await page.route("**/records/prepare", route => route.fulfill({ status: 409,
    json: { code: "conflict", message: "다른 변경이 저장되어 있습니다.", retryable: false } }));
  await panel(page).getByRole("button", { name: "저장", exact: true }).click();
  const confirmation = page.locator("dialog.modal-action[open]");
  await expect(confirmation).toContainText("탭 닫기");
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("button", { name: "상세 패널 숨기기", exact: true }).click();
  await page.getByRole("button", { name: "상세 탭 보기 (1개)", exact: true }).click();
  await expect(panel(page).getByLabel("제목", { exact: false })).toHaveValue("숨겨도 보존할 초안");
  await page.getByRole("button", { name: /탭 닫기$/ }).click();
  const discard = page.getByRole("dialog", { name: "변경을 버릴까요?" });
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(panel(page).getByLabel("제목", { exact: false })).toHaveValue("숨겨도 보존할 초안");
  await page.getByRole("button", { name: /탭 닫기$/ }).click();
  await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await page.goto( `/tasks/${id(2)}`);
  await expect(panel(page)).toContainText("외부 최신 이름");
  await expect(panel(page)).toContainText("외부 최신 본문");
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("#341 일반 기록 저장은 작성 URL을 제거하고 새로고침 후 상세를 유지한다", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/tasks/${id(2)}`);
  await panel(page).getByRole("button", { name: "기록 작성", exact: true }).click();
  await panel(page).getByRole("textbox", { name: /^본문/ }).fill("새로고침해도 다시 작성하지 않을 메모");
  await panel(page).getByRole("button", { name: "저장", exact: true }).click();
  await expect(panel(page).getByRole("heading", { name: "등심 구매하기", exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/action=record/);
  await page.reload();
  await expect(panel(page).getByRole("heading", { name: "등심 구매하기", exact: true })).toBeVisible();
  await expect(panel(page).getByRole("textbox", { name: /^본문/ })).toHaveCount(0);
  expect(state.writes.filter(write => write.method === "POST" && write.path.endsWith("/records"))).toHaveLength(1);
  expect(state.errors).toEqual([]);
});

test("#341 기록 저장 대기는 이동을 막고 응답 뒤에만 작성 모드를 종료한다", async ({ page }) => {
  const state = await fixture(page,{hold:true});
  await page.goto(`/tasks/${id(2)}`);
  await panel(page).getByRole("button",{name:"기록 작성",exact:true}).click();
  await panel(page).getByRole("textbox",{name:/^본문/}).fill("대기 중에도 보호할 메모");
  await panel(page).getByRole("button",{name:"저장",exact:true}).click(); await state.pending;
  await page.getByRole("navigation",{name:"주 메뉴"}).getByRole("link",{name:"기록",exact:true}).click();
  await expect(page).toHaveURL(/action=record/);
  await expect(panel(page).getByRole("button",{name:"처리 중…",exact:true})).toBeDisabled();
  state.release();
  await expect(panel(page).getByRole("heading",{name:"등심 구매하기",exact:true})).toBeVisible();
  await expect(page).not.toHaveURL(/action=record/);
  expect(state.errors).toEqual([]);
});


test("confirmation overlays the retained mobile editor and restores its focus", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/tasks/${id(2)}`);
  const editor = page.locator("dialog.modal:not(.modal-confirm)[open]");
  await editor.getByRole("button", { name: "편집", exact: true }).click();
  await editor.getByLabel("제목").fill("겹친 확인창 초안");
  const save = editor.getByRole("button", { name: "저장", exact: true });
  await save.click();
  await expect(page.locator("dialog[open]")).toHaveCount(2);
  const confirmation = page.locator("dialog.modal-confirm[open]");
  await expect(confirmation.getByLabel("기록 메모")).toBeVisible();
  await expect(editor).toBeVisible();
  await expect(editor.getByLabel("제목")).toHaveValue("겹친 확인창 초안");
  expect(await editor.evaluate(el => el.matches(":modal"))).toBe(true);
  expect(await confirmation.evaluate(el => el.matches(":modal"))).toBe(true);
  expect((await confirmation.boundingBox())!.width).toBeLessThan(390);
  await confirmation.getByLabel("기록 메모").fill("취소해도 보존할 메모");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await expect(confirmation.getByLabel("기록 메모")).toHaveValue("취소해도 보존할 메모");
    await expect.poll(() => confirmation.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await confirmation.getByRole("button", { name: "취소", exact: true }).press("Tab");
    expect(await confirmation.evaluate(el => el.contains(document.activeElement))).toBe(true);
  }
  await confirmation.press("Escape");
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await expect(save).toBeFocused();
  await expect(editor.getByLabel("제목")).toHaveValue("겹친 확인창 초안");
  for (const width of [1440, 390]) {
    await save.click();
    await expect(confirmation.getByLabel("기록 메모")).toHaveValue("취소해도 보존할 메모");
    await page.setViewportSize({ width, height: 844 });
    await confirmation.press("Escape");
    await expect(save).toBeFocused();
  }
  await save.click();
  await confirmation.getByRole("button", { name: "수정하고 저장", exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(editor.getByRole("button", { name: "편집", exact: true })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test("resizing after confirmation cancellation keeps the original editor action focused", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/tasks/${id(2)}`);
  await panel(page).getByRole("button", { name: "편집", exact: true }).click();
  const editor = page.locator("dialog.modal:not(.modal-confirm)[open]");
  await editor.getByLabel("제목").fill("확인 취소 뒤 화면 전환");
  const save = editor.getByRole("button", { name: "저장", exact: true });
  await save.click();
  const confirmation = page.locator("dialog.modal-confirm[open]");
  await expect(confirmation.getByLabel("기록 메모")).toBeVisible();
  await confirmation.press("Escape");
  await expect(save).toBeFocused();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => editor.evaluate(el => el.matches(":modal"))).toBe(width === 390);
    await expect(save).toBeFocused();
    await expect(editor.getByLabel("제목")).toHaveValue("확인 취소 뒤 화면 전환");
  }
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("docked confirmation remains topmost during one-way resize and cancellation", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`/tasks/${id(2)}`);
  const editor = page.locator("dialog.modal:not(.modal-confirm)[open]");
  await panel(page).getByRole("button", { name: "편집", exact: true }).click();
  const save = editor.getByRole("button", { name: "저장", exact: true });
  await editor.getByLabel("제목").fill("패널의 확인창 초안");
  expect(await editor.evaluate(el => el.matches(":modal"))).toBe(false);
  for (const width of [390, 1440]) {
    await save.click();
    const confirmation = page.locator("dialog.modal-confirm[open]");
    await expect(confirmation.getByLabel("기록 메모")).toBeVisible();
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => confirmation.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await confirmation.press("Escape");
    await expect(save).toBeFocused();
    await expect.poll(() => editor.evaluate(el => el.matches(":modal"))).toBe(width === 390);
    await expect(editor.getByLabel("제목")).toHaveValue("패널의 확인창 초안");
  }
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});


test("related navigation hides the previous model edit action while the destination read is pending", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto(`/tasks/${id(2)}`);
  const viewer = page.locator("dialog.modal:not(.modal-confirm)[open]:visible");
  await expect(viewer.getByRole("heading", { name: "등심 구매하기", exact: true })).toBeVisible();
  await viewer.getByRole("region", { name: /^연결된 자료/ }).getByRole("button", { name: "등심", exact: true }).click();
  let release!: () => void;
  let arrived = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/entities/**", async route => {
    if (decodeURIComponent(new URL(route.request().url()).pathname).endsWith(`/entities/${entityKey(1)}`) && route.request().method() === "GET") {
      arrived = true;
      await gate;
    }
    await route.fallback();
  });
  try {
    await viewer.getByRole("link", { name: "등심 상세", exact: true }).click();
    await expect.poll(() => arrived).toBe(true);
    await expect.poll(() => new URL(page.url()).pathname).toBe(`/entities/${encodeURIComponent(entityKey(1))}`);
    await expect(viewer.getByRole("button", { name: "편집", exact: true })).toHaveCount(0);
    await expect(viewer.getByRole("textbox", { name: "제목", exact: false })).toHaveCount(0);
    release();
    await expect(viewer.getByRole("heading", { name: "등심", exact: true })).toBeVisible();
    await viewer.getByRole("button", { name: "편집", exact: true }).click();
    await expect(viewer.getByLabel("제목", { exact: false })).toHaveValue("등심");
    await viewer.getByRole("button", { name: "취소", exact: true }).click();
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  } finally {
    release();
  }
});

test("desktop: opened detail tabs stay visible while navigating to another list", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`);
  await openTask(page);
  await panel(page).getByRole("button", { name: "편집", exact: true }).click();
  await panel(page).getByLabel("본문", { exact: true }).fill("목록 이동 후에도 유지");
  await page.getByRole("navigation", { name: "주 메뉴", exact: true }).getByRole("link", { name: "기록", exact: true }).click();
  await expect(page).toHaveURL(/\/records$/);
  await expect(page.getByRole("heading", { name: "기록", level: 1, exact: true })).toBeVisible();
  await expect(page.locator(".detail-workspace")).toHaveClass(/has-detail-panel/);
  await expect(page.getByRole("tab", { name: "등심", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "등심 구매하기", exact: true })).toBeVisible();
  await expect(panel(page).getByLabel("본문", { exact: true })).toHaveValue("목록 이동 후에도 유지");
  expect(state.writes).toEqual([]);
});

test("desktop: opened detail tabs stay visible when opening settings from the left menu", async ({ page }) => {
  await fixture(page);
  await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`);
  await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/ }).click();
  await page.getByRole("link", { name: "설정", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "기본 설정", level: 1, exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "등심", exact: true })).toBeVisible();
});

test("desktop: a pending detail write remains protected while settings is the left pane", async ({ page }) => {
  const state = await fixture(page, { hold: true });
  await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`);
  await openTask(page);
  await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/ }).click();
  await page.getByRole("link", { name: "설정", exact: true }).click();
  await expect(page.locator(".workspace-list").getByRole("heading", { name: "기본 설정", exact: true })).toBeVisible();
  await panel(page).getByRole("button", { name: "편집", exact: true }).click();
  await panel(page).getByLabel("본문", { exact: true }).fill("설정 화면에서 상세 저장");
  await panel(page).getByRole("button", { name: "저장", exact: true }).click();
  await page.locator("dialog.modal-action[open]").getByRole("button", { name: "수정하고 저장" }).click();
  await state.pending;
  try {
    await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "기록", exact: true }).evaluate((el: HTMLAnchorElement) => el.click());
    for (const label of ["등심 탭 닫기", "등심 구매하기 탭 닫기", "상세 패널 숨기기"]) await page.getByRole("button", { name: label, exact: true }).evaluate((el: HTMLButtonElement) => el.click());
    await expect(page.locator(".workspace-list").getByRole("heading", { name: "기본 설정", exact: true })).toBeVisible();
    await expect(page.getByRole("tab")).toHaveCount(2);
    await expect(page.locator(".detail-workspace")).toHaveClass(/has-detail-panel/);
  } finally { state.release(); }
  await expect(panel(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
  expect(state.errors).toEqual([]);
});

test("desktop: a pending base setting also prevents closing or hiding the retained detail", async ({ page }) => {
  await fixture(page);
  let release!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => { release = resolve; });
  const pending = new Promise<void>((resolve) => { started = resolve; });
  await page.route("**/auth/v1/user", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    started();
    await waiting;
    await route.fulfill({ status: 400, json: { message: "Fixture profile save rejected" } });
  });
  await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`);
  await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/ }).click();
  await page.getByRole("link", { name: "설정", exact: true }).click();
  const form = page.getByRole("form", { name: "프로필 설정", exact: true });
  await form.getByLabel("닉네임", { exact: true }).fill("진행 중인 왼쪽 설정");
  await form.getByRole("button", { name: "프로필 저장", exact: true }).click();
  await pending;
  try {
    await page.getByRole("button", { name: "등심 탭 닫기", exact: true }).evaluate((el: HTMLButtonElement) => el.click());
    await page.getByRole("button", { name: "상세 패널 숨기기", exact: true }).evaluate((el: HTMLButtonElement) => el.click());
    await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "기록", exact: true }).click();
    await expect(form).toHaveAttribute("aria-busy", "true");
    await expect(page.getByRole("tab", { name: "등심", exact: true })).toBeVisible();
    await expect(page.locator(".detail-workspace")).toHaveClass(/has-detail-panel/);
  } finally { release(); }
  await expect(form).toHaveAttribute("aria-busy", "false");
  await expect(form.getByLabel("닉네임", { exact: true })).toHaveValue("진행 중인 왼쪽 설정");
});

for (const screen of ["materials", "relations"] as const) test(`desktop: uncertain ${screen} settings lock retained tabs and preserve identical retry`, async ({ page }) => {
  await fixture(page);
  const writes: Array<{ key?: string; body: unknown }> = [];
  const endpoint = screen === "materials" ? "entity-types" : "entity-relation-definitions";
  await page.route(`**/api/${endpoint}`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    writes.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
    return route.abort();
  });
  await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`);
  await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/ }).click();
  await page.getByRole("link", { name: "설정", exact: true }).click();
  const left = page.locator(".workspace-list");
  await left.getByRole("button", { name: "설정 메뉴", exact: true }).click();
  await left.getByRole("navigation", { name: "설정 메뉴", exact: true }).getByRole("link", { name: "자료", exact: true }).click();
  if (screen === "materials") {
    await left.getByLabel("자료 종류 이름", { exact: true }).fill("미확정 종류");
    await left.getByRole("button", { name: "자료 종류 만들기", exact: true }).click();
  } else {
    await left.getByRole("link", { name: "연결 설정", exact: true }).click();
    await left.getByRole("button", { name: "연결 설정 추가", exact: true }).click();
    await left.getByLabel("첫 번째 자료 종류", { exact: true }).selectOption("00000000-0000-4000-8000-000000000900");
    await left.getByLabel("두 번째 자료 종류", { exact: true }).selectOption("00000000-0000-4000-8000-000000000900");
    await left.getByLabel("첫 번째 연결 이름", { exact: true }).fill("선행 자료");
    await left.getByLabel("두 번째 연결 이름", { exact: true }).fill("후속 자료");
    await left.getByRole("button", { name: "추가", exact: true }).click();
  }
  const retry = left.getByRole("button", { name: screen === "materials" ? "같은 요청 다시 확인" : "같은 저장 다시 확인", exact: true });
  await expect(retry).toBeEnabled();
  await page.getByRole("button", { name: "등심 탭 닫기", exact: true }).evaluate((el: HTMLButtonElement) => el.click());
  await expect(page.getByRole("tab", { name: "등심", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "상세 패널 숨기기", exact: true }).evaluate((el: HTMLButtonElement) => el.click());
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "기록", exact: true }).click();
  await expect(page.locator(".detail-workspace")).toHaveClass(/has-detail-panel/);
  await expect(retry).toBeEnabled();
  await expect(page.getByRole("dialog", { name: "변경을 버릴까요?" })).not.toBeVisible();
  await retry.click();
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[0]).toEqual(writes[1]);
});

test("desktop: closing the last detail retains the dirty base setting without a discard prompt", async ({ page }) => {
  await fixture(page);
  await page.goto(`/entities/${encodeURIComponent(entityKey(1))}`);
  await openTask(page);
  await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/ }).click();
  await page.getByRole("link", { name: "설정", exact: true }).click();
  const nickname = page.locator(".workspace-list").getByLabel("닉네임", { exact: true });
  await nickname.fill("마지막 상세를 닫아도 유지");
  await page.getByRole("button", { name: "등심 구매하기 탭 닫기", exact: true }).click();
  await expect(page.getByRole("tab", { name: "등심", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "등심 탭 닫기", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("dialog", { name: "변경을 버릴까요?" })).not.toBeVisible();
  await expect(nickname).toHaveValue("마지막 상세를 닫아도 유지");
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("mobile settings: widening into the desktop workspace retains the original draft", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const state = await fixture(page);
  await page.goto("/settings");
  const nickname = page.getByLabel("닉네임", { exact: true });
  await nickname.fill("화면 크기를 바꿔도 유지할 초안");
  await page.screenshot({ path: info.outputPath("mobile-settings-draft.png") });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.locator(".workspace-list")).toBeVisible();
  await expect(nickname).toHaveValue("화면 크기를 바꿔도 유지할 초안");
  await page.setViewportSize({ width: 390, height: 900 });
  await expect(nickname).toHaveValue("화면 크기를 바꿔도 유지할 초안");
  expect(state.writes).toEqual([]);
});
