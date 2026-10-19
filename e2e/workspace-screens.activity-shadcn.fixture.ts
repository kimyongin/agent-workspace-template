import { fixtureWorkspacePath } from "./support/workspace-scope.ts";
import { saveOnce } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { fixtures, goApp } from "./support/workspace-screens.ts";
import { id } from "./support/workspace-data.ts";

for (const width of [390, 1440]) {
  test(`기록 ${width}: 태그 선택·연결 저장은 본문 저장과 독립이고 중첩창은 초점을 돌려준다`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width, height: 900 });
    await goApp(page, `/records/${id(3)}`);
    const viewer = page.getByRole("dialog", { name: "기록", exact: true });
    await viewer.getByRole("button", { name: "태그 연결", exact: true }).click();
    const trigger = viewer.getByRole("button", { name: "태그 선택", exact: true });
    await trigger.click();
    const chooser = page.getByRole("dialog", { name: "태그 선택", exact: true });
    const option = chooser.getByRole("option", { name: "같은 이름", exact: true });
    await option.click();
    await expect(option).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await expect(chooser).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(viewer.getByRole("button", { name: "같은 이름 선택 해제", exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(0);
    await viewer.getByRole("button", { name: "연결 적용", exact: true }).click();
    await expect(viewer).toContainText("태그 연결을 저장했습니다.");
    const tagWrite = state.writes.find((row) => row.method === "PATCH" && row.path === `/api/records/${id(3)}`);
    expect(tagWrite?.body).toMatchObject({ tag_ids: [id(11)] });
    await viewer.getByRole("button", { name: "편집", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "기록 편집", exact: true });
    await editor.getByRole("textbox", { name: /^본문/ }).fill("태그 연결을 유지하는 새 본문");
    await expect(editor.getByRole("button", { name: "태그 선택", exact: true })).toHaveCount(0);
    await editor.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "기록", exact: true })).toContainText("태그 연결을 유지하는 새 본문");
    const contentWrite = state.writes.filter((row) => row.method === "PATCH" && row.path === `/api/records/${id(3)}`)
      .at(-1)!;
    expect(contentWrite.body).not.toHaveProperty("tag_ids");
    expect(state.errors).toEqual([]);
    await page.screenshot({ path: info.outputPath(`record-tags-${width}.png`), fullPage: true });
  });
}

test("할 일 반복 입력은 주기·요일 선택과 취소 후 초안을 유지하고 외부 저장을 하지 않는다", async ({ page }, info) => {
  const state = await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  await page.setViewportSize({ width: 390, height: 900 });
  await goApp(page, "/tasks?create=1");
  const editor = page.getByRole("dialog", { name: "할 일 추가", exact: true });
  await editor.getByRole("textbox", { name: /^제목/ }).fill("매주 조사할 작업");
  await editor.getByRole("radio", { name: "반복", exact: true }).click();
  await editor.getByRole("radio", { name: "매주", exact: true }).click();
  await editor.getByRole("button", { name: "월", exact: true }).click();
  await editor.getByRole("button", { name: "금", exact: true }).click();
  await expect(editor.getByRole("button", { name: "월", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(editor.getByRole("button", { name: "금", exact: true })).toHaveAttribute("aria-pressed", "true");
  await editor.getByRole("button", { name: "취소", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: /^제목/ })).toHaveValue("매주 조사할 작업");
  await expect(editor.getByRole("radio", { name: "매주", exact: true })).toBeChecked();
  expect(state.writes).toHaveLength(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("task-recurring-mobile.png"), fullPage: true });
});

test("주간 할 일의 요일 오류는 실제 선택 버튼에 연결되고 키보드로 수정해 저장한다", async ({ page }) => {
  const state = await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  await page.setViewportSize({ width: 390, height: 900 });
  await goApp(page, "/tasks?create=1");
  const editor = page.getByRole("dialog", { name: "할 일 추가", exact: true });
  await editor.getByRole("textbox", { name: /^제목/ }).fill("화요일 조사");
  await editor.getByRole("radio", { name: "반복", exact: true }).click();
  await editor.getByRole("radio", { name: "매주", exact: true }).click();
  await editor.getByRole("textbox", { name: /^시작일/ }).fill("2028-01-03");
  await editor.getByRole("combobox", { name: "시간대", exact: false }).selectOption("UTC");
  await editor.getByRole("button", { name: "추가", exact: true }).click();
  const monday = editor.getByRole("button", { name: "월", exact: true });
  await expect(monday).toHaveAttribute("aria-invalid", "true");
  await expect(monday).toHaveAccessibleDescription("요일을 하나 이상 고르세요");
  await expect(monday).toBeFocused();
  expect(state.writes).toHaveLength(0);
  await monday.press("ArrowRight");
  const tuesday = editor.getByRole("button", { name: "화", exact: true });
  await expect(tuesday).toBeFocused();
  await tuesday.press("Space");
  await expect(tuesday).toHaveAttribute("aria-pressed", "true");
  await expect(monday).toHaveAttribute("aria-pressed", "false");
  await saveOnce(page, editor, "추가");
  expect(state.writes.find(write => write.path === "/api/tasks")?.body).toMatchObject({
    title: "화요일 조사", kind: "recurring", timezone: "UTC",
    recurrence: { freq: "weekly", weekdays: [2], starts_on: "2028-01-03" },
  });
  expect(state.errors).toEqual([]);
});

test("할 일·달력·태그 설정은 좁은 화면과 개인 배율에서 사용할 수 있다", async ({ page }, info) => {
  test.setTimeout(180_000);
  const state = await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    for (const scale of [100, 110, 125, 150]) {
      for (const [name, route] of [["task", "/tasks?create=1"], ["calendar", "/records?view=calendar"], ["tags", "/settings/tags?scope=record"]] as const) {
        await goApp(page, route);
        await expect(page.getByRole("main", { includeHidden: true })).toBeVisible();
        await page.evaluate((scale) => document.documentElement.style.setProperty("--display-scale", String(scale / 100)), scale);
        expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeCloseTo(16 * scale / 100, 1);
        if (name === "task") {
          const form = page.getByRole("dialog", { name: "할 일 추가", exact: true });
          await form.getByRole("radio", { name: "반복", exact: true }).click();
          await form.getByRole("radio", { name: "매주", exact: true }).click();
          await expect(form.getByRole("button", { name: "월", exact: true })).toBeVisible();
          await expect(form.getByRole("button", { name: "추가", exact: true })).toBeVisible();
        } else if (name === "calendar") {
          await expect(page.getByRole("heading", { name: "기록 (1개)", exact: true })).toBeVisible();
          await expect(page.getByRole("region", { name: "기록 달력", exact: true })).toBeVisible();
          const next = page.getByRole("button", { name: "다음 달", exact: true });
          await next.scrollIntoViewIfNeeded();
          await expect(next).toBeInViewport({ ratio: 1 });
          await expect(page.getByRole("button", { name: "이전 달", exact: true })).toBeInViewport({ ratio: 1 });
        } else {
          await expect(page.getByRole("radiogroup", { name: "관리 대상", exact: true }).getByRole("radio", { name: "기록", exact: true })).toBeChecked();
          await expect(page.getByRole("heading", { name: "태그 설정", exact: true })).toBeVisible();
          await expect(page.getByRole("button", { name: "같은 이름 이름 변경", exact: true })).toBeVisible();
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`${name}-${width}-${scale}.png`), fullPage: true });
        if (name === "task") {
          await page.getByRole("dialog", { name: "할 일 추가", exact: true }).getByRole("button", { name: "취소", exact: true }).click();
          await page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true }).getByRole("button", { name: "변경 버리기", exact: true }).click();
          await expect(page.getByRole("dialog", { name: "할 일 추가", exact: true })).toHaveCount(0);
        }
      }
    }
  }
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});


test("좁은 확대 달력은 주 끝과 시작으로 키보드 이동할 때 날짜 전체를 내부 스크롤에 드러낸다", async ({ page }, info) => {
  const state = await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  await page.setViewportSize({ width: 320, height: 900 });
  await goApp(page, "/records?view=calendar&calendar_month=2026-10&calendar_day=2026-10-04");
  const calendar = page.getByRole("region", { name: "기록 달력", exact: true });
  const sunday = calendar.getByRole("button", { name: /^2026-10-04, 불러온 기록/ });
  const saturday = calendar.getByRole("button", { name: /^2026-10-10, 불러온 기록/ });
  await expect(sunday).toBeVisible();
  await page.evaluate(() => document.documentElement.style.setProperty("--display-scale", "1.5"));
  await sunday.focus();
  const viewport = calendar.locator('[data-slot="scroll-area-viewport"]').filter({
    // `has` resolves within each viewport; do not repeat the outer calendar region.
    has: page.getByRole("button", { name: /^2026-10-04, 불러온 기록/ }),
  });
  await expect.poll(() => viewport.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
  const assertFocusedDayVisible = async (day: typeof sunday, date: string) => {
    await expect(day).toBeFocused();
    await expect(day).toHaveAttribute("aria-pressed", "true");
    await expect(page).toHaveURL(new RegExp(`calendar_day=${date}`));
    expect(new URL(page.url()).pathname).toBe(fixtureWorkspacePath("/records"));
    await expect(page.getByRole("region", { name: `${date} 기록`, exact: true })).toBeVisible();
    await expect.poll(() => day.evaluate(el => {
      const clip = el.closest('[data-slot="scroll-area-viewport"]')!.getBoundingClientRect();
      const box = el.getBoundingClientRect();
      return box.left >= clip.left - 1 && box.right <= clip.right + 1 &&
        box.top >= clip.top - 1 && box.bottom <= clip.bottom + 1;
    })).toBe(true);
  };
  await sunday.press("End");
  await assertFocusedDayVisible(saturday, "2026-10-10");
  const scrolled = await viewport.evaluate(el => el.scrollLeft);
  expect(scrolled).toBeGreaterThan(0);
  const scrollbar = calendar.locator('[data-slot="scroll-area-scrollbar"][data-orientation="horizontal"]');
  await expect(scrollbar).toBeVisible();
  const thumb = scrollbar.locator('[data-slot="scroll-area-thumb"]');
  await expect(thumb).toBeVisible();
  const thumbBox = await thumb.boundingBox();
  expect(thumbBox!.width).toBeGreaterThan(0);
  expect(thumbBox!.height).toBeGreaterThan(0);
  await saturday.press("Home");
  await assertFocusedDayVisible(sunday, "2026-10-04");
  await expect.poll(() => viewport.evaluate(el => el.scrollLeft)).toBeLessThanOrEqual(1);
  await expect(calendar.getByRole("button", { name: "이전 달", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(calendar.getByRole("button", { name: "다음 달", exact: true })).toBeInViewport({ ratio: 1 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
  await page.screenshot({ path: info.outputPath("calendar-keyboard-scroll-320-150.png"), fullPage: true });
});
