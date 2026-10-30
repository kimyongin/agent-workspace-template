import { expect, type Locator, type Page, test } from "@playwright/test";
import { fixtures, goApp } from "./support/workspace-screens.ts";
import { fixtureType, id } from "./support/workspace-data.ts";
import { businessRows } from "./table-actions.ts";
import { chooseSetting } from "./settings-actions.ts";

test.use({ timezoneId: "America/Argentina/Buenos_Aires" });

async function setup(page: Page) {
  const state = await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  let metadata: Record<string, unknown> = {
    workspace_timezone: "America/New_York",
    workspace_navigation: { version: 1, refs: [] },
  };
  const user = {
    id: id(901),
    aud: "authenticated",
    email: "settings@example.test",
    app_metadata: {},
    user_metadata: metadata,
  };
  const writes: Record<string, unknown>[] = [];
  let fail = false;
  await page.addInitScript((user) =>
    localStorage.setItem(
      "sb-127-auth-token",
      JSON.stringify({
        access_token: "settings-fixture-access",
        refresh_token: "settings-fixture-refresh",
        token_type: "bearer",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user,
      }),
    ), user);
  await page.route("http://127.0.0.1:55581/auth/v1/user", (route) => {
    if (route.request().method() === "PUT") {
      const data = route.request().postDataJSON().data;
      writes.push(data);
      if (fail) {
        fail = false;
        return route.fulfill({ status: 500, json: { msg: "fixture save failed" } });
      }
      metadata = { ...metadata, ...data };
      for (const [key, value] of Object.entries(data)) if (value === null) delete metadata[key];
    }
    return route.fulfill({ json: { ...user, user_metadata: metadata } });
  });
  return {
    state,
    writes,
    metadata: () => metadata,
    failNext: () => {
      fail = true;
    },
  };
}

async function settle(page: Page) {
  await page.evaluate(() => document.fonts.ready);
  await expect.poll(() =>
    page.evaluate(() =>
      document.getAnimations().filter((animation) =>
        animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity
      ).length
    )
  ).toBe(0);
}

async function inViewport(control: Locator) {
  return control.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    if (
      rect.width <= 0 || rect.height <= 0 || rect.top < 0 || rect.left < 0 ||
      rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1
    ) return false;
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent), bounds = parent.getBoundingClientRect();
      if (
        ["auto", "scroll", "hidden", "clip"].includes(style.overflowY) &&
        (rect.top < bounds.top - 1 || rect.bottom > bounds.bottom + 1)
      ) return false;
      if (
        ["auto", "scroll", "hidden", "clip"].includes(style.overflowX) &&
        (rect.left < bounds.left - 1 || rect.right > bounds.right + 1)
      ) return false;
    }
    return true;
  });
}

test.describe("complete settings journeys include actual scrolling", () => {
  test.use({ timezoneId: "Asia/Seoul" });
  for (const width of [390, 1440]) {
    for (const scenario of ["menu", "timezone"]) {
      test(`space-to-settings ${scenario} counts navigation, disclosure and save ${width}`, async ({ page }, info) => {
        const { writes, state } = await setup(page);
        await page.setViewportSize({ width, height: 900 });
        const actions: string[] = [];
        const scrollPositions = () =>
          page.evaluate(() =>
            [...document.querySelectorAll("*")].filter((element) => element.scrollTop || element.scrollLeft)
              .map((element) => [element.tagName, element.scrollTop, element.scrollLeft])
          );
        const reveal = async (label: string, control: Locator) => {
          await settle(page);
          if (await inViewport(control)) return;
          const before = await scrollPositions();
          await control.scrollIntoViewIfNeeded();
          await settle(page);
          await expect.poll(() => inViewport(control)).toBe(true);
          expect(await scrollPositions()).not.toEqual(before);
          actions.push(`${label}까지 스크롤`);
        };
        const click = async (label: string, control: Locator) => {
          await reveal(label, control);
          await control.click();
          actions.push(label);
        };
        await page.goto("/workspaces");
        await click("공간 열기", page.getByRole("link", { name: "열기", exact: true }));
        const menu = page.getByRole("button", { name: "주 메뉴 열기", exact: true });
        if (await menu.isVisible()) await click("주 메뉴 열기", menu);
        await click(
          "기본 설정 링크",
          page.getByRole("navigation", { name: "주 메뉴", exact: true })
            .getByRole("link", { name: "기본 설정", exact: true }),
        );
        const section = page.getByRole("region", {
          name: scenario === "menu" ? "메뉴 바로가기" : "날짜와 시각",
          exact: true,
        });
        if (scenario === "menu") {
          const picker = section.getByRole("combobox", { name: "추가할 메뉴", exact: true });
          await click("추가할 메뉴 열기", picker);
          await click("기록을 초안에 추가", page.getByRole("option", { name: "기록 · 초안에 추가", exact: true }));
          await expect(section.getByRole("table", { name: "선택한 바로가기" })).toContainText("기록");
          await expect(picker).toHaveValue("");
          await expect(section.getByRole("button", { name: "메뉴 바로가기 저장", exact: true })).toBeEnabled();
          expect(writes).toHaveLength(0);
          await click("메뉴 바로가기 저장", section.getByRole("button", { name: "메뉴 바로가기 저장", exact: true }));
          await expect.poll(() => writes.length).toBe(1);
          expect(writes[0]).toEqual({
            workspace_navigation: { version: 1, refs: [{ kind: "builtin", id: "records" }] },
          });
          await expect(section.getByRole("status")).toHaveText("메뉴 설정을 저장했습니다.");
        } else {
          await click("기기 시간대 사용 선택", section.getByRole("button", { name: /^기기 시간대 사용/ }));
          const select = section.getByLabel("표시 시간대", { exact: true });
          await expect(select).toBeFocused();
          await expect(select).toHaveValue("");
          expect(writes).toHaveLength(0);
          await click("날짜와 시각 저장", section.getByRole("button", { name: "날짜와 시각 저장", exact: true }));
          await expect.poll(() => writes.length).toBe(1);
          expect(writes[0]).toEqual({ workspace_timezone: null });
          await expect(section.getByRole("status")).toContainText("설정을 저장했습니다");
        }
        await reveal("저장 결과 확인", section.getByRole("status"));
        const expected = scenario === "menu" ? (width === 390 ? 8 : 6) : (width === 390 ? 6 : 5);
        expect(actions).toHaveLength(expected);
        expect(state.writes).toHaveLength(0);
        await info.attach("all-actions", {
          body: JSON.stringify({
            start: "내 공간 목록",
            end: scenario === "menu" ? "기록 바로가기 저장 결과 확인" : "기기 추종 시간대 저장 결과 확인",
            width,
            height: 900,
            actions,
            count: actions.length,
            scroll: "조작 또는 저장 결과가 보이지 않아 실제 위치가 바뀐 스크롤만1회씩 계산; 캡처는 완료 후",
          }),
          contentType: "application/json",
        });
        await page.screenshot({ path: info.outputPath(`${scenario}-${width}.png`) });
      });
    }
  }
});

test("shortcut typing and Escape never add; Enter adds once and the fourth item retains keyboard focus", async ({ page }) => {
  const { writes } = await setup(page);
  await goApp(page, "/settings#settings-navigation");
  await page.getByLabel("닉네임", { exact: true }).fill("다른 구획의 초안");
  const section = page.getByRole("region", { name: "메뉴 바로가기", exact: true });
  const picker = section.getByRole("combobox", { name: "추가할 메뉴", exact: true });
  const rows = businessRows(section.getByRole("table", { name: "선택한 바로가기" }));
  await picker.fill("기록");
  await settle(page);
  await picker.press("ArrowDown");
  await picker.dispatchEvent("keydown", {
    key: "Enter",
    code: "Enter",
    keyCode: 13,
    which: 13,
    isComposing: true,
  });
  await expect(rows).toHaveCount(0);
  await picker.dispatchEvent("compositionstart");
  await picker.press("Enter");
  await expect(rows).toHaveCount(0);
  await picker.dispatchEvent("compositionend");
  await expect(rows).toHaveCount(0);
  await picker.press("Escape");
  await expect(rows).toHaveCount(0);
  await expect(page.getByRole("listbox", { includeHidden: true })).toHaveCount(0);
  await picker.click();
  await picker.fill("기록");
  await picker.press("ArrowDown");
  await picker.press("Enter");
  await expect(rows).toHaveCount(1);
  await expect(picker).toHaveValue("");
  await expect(picker).toBeFocused();
  expect(writes).toHaveLength(0);
  await picker.fill("없는 메뉴");
  await expect(page.getByRole("option")).toHaveCount(0);
  await picker.press("Enter");
  await expect(section.getByRole("button", { name: "메뉴 바로가기 저장", exact: true })).toBeEnabled();
  expect(writes).toHaveLength(0);
  await expect(rows).toHaveCount(1);
  await picker.fill("");
  for (const label of ["할 일", "전체 자료", fixtureType.label]) await chooseSetting(page, picker, label);
  await expect(rows).toHaveCount(4);
  await expect(picker).toBeDisabled();
  await expect(section.getByRole("button", { name: `${fixtureType.label} 숨기기`, exact: true }))
    .toBeFocused();
  await section.getByRole("button", { name: "변경 취소", exact: true }).click();
  await expect(rows).toHaveCount(0);
  await expect(page.getByLabel("닉네임", { exact: true })).toHaveValue("다른 구획의 초안");
  expect(writes).toHaveLength(0);
  await chooseSetting(page, picker, "기록");
  const save = section.getByRole("button", { name: "메뉴 바로가기 저장", exact: true });
  await save.focus();
  await save.press("Enter");
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toEqual({
    workspace_navigation: { version: 1, refs: [{ kind: "builtin", id: "records" }] },
  });
  await expect(page.getByLabel("닉네임", { exact: true })).toHaveValue("다른 구획의 초안");
});

test("device timezone selection preserves other drafts and fixed-zone cancel, failure and retry", async ({ page }) => {
  const state = await setup(page);
  await goApp(page, "/settings");
  await page.getByLabel("닉네임", { exact: true }).fill("프로필 미저장");
  const date = page.getByRole("region", { name: "날짜와 시각", exact: true });
  const select = date.getByLabel("표시 시간대", { exact: true });
  const useDevice = date.getByRole("button", { name: /^기기 시간대 사용/ });
  const device = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  await expect(useDevice).toContainText(device);
  await useDevice.click();
  await expect(select).toHaveValue("");
  await date.getByRole("button", { name: "변경 취소", exact: true }).click();
  await expect(select).toHaveValue("America/New_York");
  await expect(page.getByLabel("닉네임", { exact: true })).toHaveValue("프로필 미저장");
  await useDevice.click();
  state.failNext();
  await date.getByRole("button", { name: "날짜와 시각 저장", exact: true }).click();
  await expect(date.getByRole("alert")).toContainText("입력한 설정을 유지");
  await expect(select).toHaveValue("");
  expect(state.metadata().workspace_timezone).toBe("America/New_York");
  await date.getByRole("button", { name: "날짜와 시각 저장", exact: true }).click();
  await expect(date.getByRole("status")).toContainText("설정을 저장");
  expect(state.writes).toEqual([{ workspace_timezone: null }, { workspace_timezone: null }]);
  expect(state.metadata()).not.toHaveProperty("workspace_timezone");
  await expect(useDevice).toBeDisabled();
  await expect(page.getByLabel("닉네임", { exact: true })).toHaveValue("프로필 미저장");
});

test(
  "personal shortcut controls retain readable content and 44px actions at narrow and enlarged widths",
  async ({ page }, info) => {
    await setup(page);
    for (const [width, scale] of [[390, 100], [1440, 100], [320, 200]]) {
      await page.setViewportSize({ width, height: 1000 });
      await goApp(page, "/settings");
      await page.evaluate((value) => document.documentElement.style.fontSize = `${value}%`, scale);
      for (const name of ["날짜와 시각", "메뉴 바로가기"]) {
        const section = page.getByRole("region", { name, exact: true });
        await section.scrollIntoViewIfNeeded();
        await settle(page);
        expect(await section.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(
          true,
        );
        await section.screenshot({
          path: info.outputPath(`${name === "날짜와 시각" ? "timezone" : "menu"}-${width}-${scale}.png`),
        });
        for (const button of await section.getByRole("button").all()) {
          const box = await button.boundingBox();
          expect(box!.height).toBeGreaterThanOrEqual(44);
          expect(box!.width).toBeGreaterThanOrEqual(44);
        }
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  },
);
