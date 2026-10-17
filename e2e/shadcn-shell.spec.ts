import { expect, test, type Page } from "@playwright/test";
import { installWorkspaceApi } from "./support/workspace-api.ts";
import { entity, task, record, id } from "./support/workspace-data.ts";
import { closeDetail, openListDetail } from "./ui-actions.ts";

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

test("shell desktop: closing a detail returns long-list scrolling and append ownership to main", async ({ page }) => {
  const state = await fixture(page);
  state.rows.entities = Array.from({ length: 59 }, (_, index) => entity(1000 + index, { prop_1: `스크롤 자료 ${index}` }));
  state.listPages("entities", [state.rows.entities.slice(0, 20), state.rows.entities.slice(20, 40), state.rows.entities.slice(40)]);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/entities");
  const main = page.getByRole("main");
  await expect(main.locator("[data-list-anchor]")).toHaveCount(20);
  await openListDetail(page, "스크롤 자료 19");
  // An external insertion pushes the return anchor to page two, requiring lookahead before append.
  state.rows.entities.unshift(entity(9999, { prop_1: "외부 추가 자료" }));
  state.listPages("entities", [state.rows.entities.slice(0, 20), state.rows.entities.slice(20, 40), state.rows.entities.slice(40)]);
  await closeDetail(page, "스크롤 자료 19");
  const anchor = main.getByRole("button", { name: "스크롤 자료 19", exact: true });
  await expect(anchor).toBeFocused();
  await expect(main.locator("[data-list-anchor]")).toHaveCount(40);
  const more = main.getByRole("button", { name: "더 보기", exact: true });
  await expect(more).toHaveAttribute("aria-disabled", "false");
  await more.scrollIntoViewIfNeeded();
  const top = await main.evaluate(element => element.scrollTop);
  expect(top).toBeGreaterThan(0);
  expect(await more.evaluate(button => {
    for (let element = button.parentElement; element && element.tagName !== "MAIN"; element = element.parentElement) {
      if (element.scrollTop !== 0) return false;
    }
    return true;
  })).toBe(true);
  await more.click();
  await expect(main.locator("[data-list-anchor]")).toHaveCount(60);
  await expect(more).toBeFocused();
  expect(await main.evaluate(element => element.scrollTop)).toBe(top);
  await expect(anchor).toHaveCount(1);
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

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

test("shell mobile: simulated visual viewport keeps confirmation actions visible and cancellation preserves the draft", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await page.goto(`/tasks/${id(2)}`);
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const body = page.getByRole("textbox", { name: /^본문/ });
  await body.fill("키보드가 열린 동안에도 유지할 초안");
  const save = page.getByRole("button", { name: "저장", exact: true });
  await save.click();
  const confirmation = page.getByRole("dialog", { name: "수정하시겠습니까?", exact: true });
  await expect(confirmation.getByRole("textbox", { name: "기록 메모", exact: true })).toBeVisible();
  // Simulate an on-screen keyboard's visual rectangle without shrinking the layout viewport.
  const viewportSimulation = await page.evaluateHandle(() => {
    const viewport = window.visualViewport!;
    const descriptors = ["height", "offsetTop"].map(key => [key, Object.getOwnPropertyDescriptor(viewport, key)] as const);
    Object.defineProperty(viewport, "height", { configurable: true, get: () => 300 });
    Object.defineProperty(viewport, "offsetTop", { configurable: true, get: () => 70 });
    viewport.dispatchEvent(new Event("resize"));
    return { restore() {
      for (const [key, descriptor] of descriptors) {
        if (descriptor) Object.defineProperty(viewport, key, descriptor);
        else Reflect.deleteProperty(viewport, key);
      }
      viewport.dispatchEvent(new Event("resize"));
    } };
  });
  try {
    expect(await page.evaluate(() => window.innerHeight)).toBe(800);
    await expect.poll(() => confirmation.evaluate(root => {
      const viewport = window.visualViewport!;
      const top = viewport.offsetTop, bottom = top + viewport.height;
      const elements = [root, ...root.querySelectorAll('[data-slot="dialog-footer"] button')];
      return elements.length === 3 && elements.every(element => {
        const rect = element.getBoundingClientRect();
        return rect.top >= top - 1 && rect.bottom <= bottom + 1;
      });
    })).toBe(true);
    await expect(confirmation.getByRole("button", { name: "수정하고 저장", exact: true })).toBeVisible();
    await confirmation.getByRole("button", { name: "취소", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(body).toHaveValue("키보드가 열린 동안에도 유지할 초안");
    await expect(save).toBeFocused();
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  } finally {
    await viewportSimulation.evaluate(simulation => simulation.restore());
    await viewportSimulation.dispose();
  }
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

test("shell enlarged text: navigation constraints remain feasible at desktop widths", async ({ page }, info) => {
  const state = await fixture(page, "150");
  await page.goto("/tasks");
  const divider = page.getByRole("separator", { name: "탐색 메뉴 너비 조절", exact: true });
  const navigation = page.getByRole("navigation", { name: "주 메뉴", exact: true });
  for (const width of [1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const fontSize of [32, 48]) {
      await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
      await expect.poll(() => divider.evaluate(element => Number(element.getAttribute("aria-valuemin")) * (element.parentElement!.clientWidth - (element as HTMLElement).offsetWidth) / 100)).toBeCloseTo(13 * fontSize, 0);
      await expect.poll(() => divider.evaluate(element => {
        const minimum = Number(element.getAttribute("aria-valuemin"));
        const maximum = Number(element.getAttribute("aria-valuemax"));
        const current = Number(element.getAttribute("aria-valuenow"));
        return minimum <= maximum && current >= minimum - 1 && current <= maximum + 1;
      }), `${width}px/root${fontSize}px: official separator exposes a feasible keyboard range`).toBe(true);
      await divider.press("Home");
      await expect.poll(() => navigation.evaluate(element => element.getBoundingClientRect().width)).toBeCloseTo(13 * fontSize, 0);
      await divider.press("End");
      await expect.poll(() => divider.evaluate(element => {
        const current = Number(element.getAttribute("aria-valuenow"));
        return Math.abs(current - Number(element.getAttribute("aria-valuemax"))) <= 1;
      })).toBe(true);
      await expect(navigation.getByRole("link", { name: "기록", exact: true })).toBeInViewport();
      await expect(page.getByRole("main")).toBeInViewport();
      expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px/root${fontSize}px`).toBe(width);
      if (width === 1024 && fontSize === 48) {
        const views = page.getByRole("radiogroup", { name: "할 일 보기 방식", exact: true });
        const choices = views.getByRole("radio");
        await expect(choices).toHaveCount(3);
        expect(await choices.evaluateAll(elements => elements.every(element => {
          const target = element.getBoundingClientRect(), main = element.closest("main")!.getBoundingClientRect();
          return target.width >= 44 && target.height >= 44 && target.left >= main.left - 1 && target.right <= main.right + 1;
        }))).toBe(true);
        await choices.first().focus();
        await page.keyboard.down("ArrowRight");
        await expect(views.getByRole("radio", { name: "카드", exact: true })).toBeFocused();
        await page.keyboard.up("ArrowRight");
        await page.keyboard.press("Space");
        await expect(views.getByRole("radio", { name: "카드", exact: true })).toBeChecked();
        await expect(views.getByRole("radio", { name: "카드", exact: true })).toBeInViewport();
        await page.screenshot({ path: info.outputPath("navigation-text200-scale150.png") });
      }
    }
  }
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

for (const [width, scale] of [[1440, "100"], [1280, "125"], [390, "100"]] as const) test(`shell previous ${width}px/${scale}%: returning from a related editor restores its originating detail link`, async ({ page }) => {
  const state = await fixture(page, scale);
  state.rows.tasks[0].entity_ids = [entity().id];
  state.rows.tasks[0].entity_context = [{ id: entity().id, title: "자료", source: "selection", captured_at: entity().created_at }];
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`/tasks/${id(2)}`);
  const detail = page.getByRole("dialog").filter({ visible: true });
  const related = detail.getByRole("region", { name: "연결된 자료 (1개)", exact: true });
  await related.getByRole("button", { name: "자료", exact: true }).click();
  const origin = related.getByRole("link", { name: "자료 상세", exact: true });
  await origin.click();
  await expect(detail.getByRole("heading", { name: entity().type.label, exact: true })).toBeVisible();
  await detail.getByRole("button", { name: "편집", exact: true }).click();
  await detail.getByRole("button", { name: "취소", exact: true }).click();
  await detail.getByRole("button", { name: "이전: 할 일", exact: true }).click();
  await expect(origin).toBeFocused();
  expect(state.writes).toEqual([]);
});

test("shell blocked profile: discard cancellation restores the durable menu trigger", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/settings/tags");
  const name = page.getByRole("textbox", { name: /태그 이름/ });
  await name.fill("탐색 취소 뒤 유지할 태그 초안");
  const profile = page.getByRole("button", { name: "내 프로필", exact: true });
  await profile.click();
  await page.getByRole("menuitem", { name: "설정", exact: true }).click();
  const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(profile).toBeFocused();
  await expect(name).toHaveValue("탐색 취소 뒤 유지할 태그 초안");
  await expect(page).toHaveURL(/\/settings\/tags$/);
  expect(state.writes).toEqual([]);
});
