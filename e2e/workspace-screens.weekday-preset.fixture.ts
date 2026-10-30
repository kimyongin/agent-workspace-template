import { expect, test } from "@playwright/test";
import { fixtures, goApp } from "./support/workspace-screens.ts";
import { executionDialog, saveOnce } from "./ui-actions.ts";
import { id } from "./support/workspace-data.ts";
import { fixtureWorkspaceId } from "./support/workspace-scope.ts";

test("평일 프리셋은 입력한 내용을 보존하는 명시적 초안이며 최종 메모 확인 뒤 주간 규칙을 저장한다", async ({ page }, info) => {
  const state = await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  await page.setViewportSize({ width: 390, height: 900 });
  await goApp(page, "/tasks?create=1");
  const editor = page.getByRole("dialog", { name: "할 일 추가", exact: true });
  await editor.getByRole("textbox", { name: /^제목/ }).fill("평일 재고 점검");
  await editor.getByRole("textbox", { name: /^본문/ }).fill("준비한 점검 내용");
  await editor.getByRole("radio", { name: "반복", exact: true }).click();
  await editor.getByRole("textbox", { name: /^시작일/ }).fill("2028-01-03");
  await editor.getByRole("combobox", { name: /^시간대/ }).selectOption("UTC");
  await page.screenshot({ path: info.outputPath("weekday-before-mobile.png"), fullPage: true });
  await editor.getByRole("button", { name: "평일로 설정", exact: true }).click();
  await expect(editor.getByRole("radio", { name: "매주", exact: true })).toBeChecked();
  for (const name of ["월", "화", "수", "목", "금"]) {
    await expect(editor.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  for (const name of ["토", "일"]) {
    await expect(editor.getByRole("button", { name, exact: true })).toHaveAttribute("aria-pressed", "false");
  }
  await expect(editor.getByRole("textbox", { name: /^제목/ })).toHaveValue("평일 재고 점검");
  await expect(editor.getByRole("textbox", { name: /^본문/ })).toHaveValue("준비한 점검 내용");
  await expect(editor.getByRole("textbox", { name: /^시작일/ })).toHaveValue("2028-01-03");
  await expect(editor.getByRole("combobox", { name: /^시간대/ })).toHaveValue("UTC");
  expect(state.writes).toHaveLength(0);
  await page.screenshot({ path: info.outputPath("weekday-after-mobile.png"), fullPage: true });
  await editor.getByRole("button", { name: "추가", exact: true }).click();
  await expect(executionDialog(page).getByLabel("기록 메모", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await saveOnce(page);
  expect(state.writes.find(write => write.path === "/api/tasks")?.body).toMatchObject({
    title: "평일 재고 점검", body: "준비한 점검 내용", kind: "recurring", timezone: "UTC",
    recurrence: { freq: "weekly", weekdays: [1, 2, 3, 4, 5], starts_on: "2028-01-03" },
  });
  expect(state.errors).toEqual([]);
});

for (const width of [390, 1440]) {
  test(`평일 반복 ${width}: 같은 내 공간 시작점에서 수동 12회와 프리셋 7회가 같은 저장 결과를 만든다`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width, height: 900 });
    for (const preset of [false, true]) {
      const actions: string[] = [];
      const click = async (name: string, locator: ReturnType<typeof page.getByRole>) => { actions.push(name); await locator.click(); };
      await page.goto("/workspaces");
      await click("공간 열기", page.getByRole("link", { name: "열기", exact: true }));
      await click("할 일 등록", page.getByRole("button", { name: "할 일 등록", exact: true }));
      const editor = page.getByRole("dialog", { name: "할 일 추가", exact: true });
      actions.push("제목 입력");
      await editor.getByRole("textbox", { name: /^제목/ }).fill("평일 점검");
      await click("반복", editor.getByRole("radio", { name: "반복", exact: true }));
      if (preset) await click("평일로 설정", editor.getByRole("button", { name: "평일로 설정", exact: true }));
      else {
        await click("매주", editor.getByRole("radio", { name: "매주", exact: true }));
        for (const name of ["월", "화", "수", "목", "금"]) await click(name, editor.getByRole("button", { name, exact: true }));
      }
      await page.screenshot({ path: info.outputPath(`${preset ? "preset" : "manual"}-${width}.png`), fullPage: true });
      await click("추가", editor.getByRole("button", { name: "추가", exact: true }));
      await expect(executionDialog(page).getByLabel("기록 메모", { exact: true })).toBeVisible();
      actions.push("등록하고 저장");
      await saveOnce(page);
      expect(actions).toHaveLength(preset ? 7 : 12);
      await info.attach(`${preset ? "preset" : "manual"}-actions`, { body: JSON.stringify(actions, null, 2), contentType: "application/json" });
      expect(state.writes.filter(write => write.path === "/api/tasks").at(-1)?.body).toMatchObject({
        title: "평일 점검", kind: "recurring", recurrence: { freq: "weekly", weekdays: [1, 2, 3, 4, 5] },
      });
    }
    expect(state.errors).toEqual([]);
  });
}

for (const width of [390, 1440]) {
  test(`평일 편집 ${width}: 기존 월간 규칙은 명시 선택 후에만 바뀌며 키보드 보정과 취소 뒤 초안을 유지한다`, async ({ page }, info) => {
    const state = await fixtures(page, { hold: true });
    Object.assign(state.rows.tasks[0], { kind: "recurring", timezone: "UTC", recurrence: { freq: "monthly", month_days: [15], starts_on: "2028-01-03" } });
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width, height: 900 });
    await goApp(page, `/tasks/${id(2)}?edit=1`);
    const editor = page.getByRole("dialog", { name: "할 일 편집", exact: true });
    await expect(editor.getByRole("radio", { name: "매월", exact: true })).toBeChecked();
    const preset = editor.getByRole("button", { name: "평일로 설정", exact: true });
    await preset.focus();
    await preset.press("Enter");
    const friday = editor.getByRole("button", { name: "금", exact: true });
    await friday.focus();
    await friday.press("Space");
    await expect(friday).toHaveAttribute("aria-pressed", "false");
    await editor.getByRole("radio", { name: "매일", exact: true }).click();
    await editor.getByRole("radio", { name: "매주", exact: true }).click();
    await expect(friday).toHaveAttribute("aria-pressed", "false");
    await editor.getByRole("button", { name: "취소", exact: true }).click();
    await page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true }).getByRole("button", { name: "취소", exact: true }).click();
    await expect(editor.getByRole("radio", { name: "매주", exact: true })).toBeChecked();
    await expect(friday).toHaveAttribute("aria-pressed", "false");
    expect(state.writes).toHaveLength(0);
    await page.screenshot({ path: info.outputPath(`weekday-edit-${width}.png`), fullPage: true });
    await editor.getByRole("button", { name: "저장", exact: true }).click();
    const final = executionDialog(page).getByRole("button", { name: "수정하고 저장", exact: true });
    await final.click();
    await state.pending;
    const retainedPreset = page.getByRole("dialog", { name: "할 일 편집", exact: true, includeHidden: true }).getByRole("button", { name: "평일로 설정", exact: true, includeHidden: true });
    await expect(retainedPreset).toBeDisabled();
    state.release();
    await expect(executionDialog(page)).toHaveCount(0);
    expect(state.writes.find(write => write.path === `/api/tasks/${id(2)}`)?.body).toMatchObject({
      title: "할 일", body: "상세 본문", timezone: "UTC", expected_version: 1,
      recurrence: { freq: "weekly", weekdays: [1, 2, 3, 4], starts_on: "2028-01-03" },
    });
    expect(state.errors).toEqual([]);
  });
}

test("읽기 전용으로 바뀐 반복 초안은 프리셋을 막고 권한 복구 뒤 같은 초안을 수정한다", async ({ page }) => {
  const state = await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  await goApp(page, "/tasks?create=1");
  const editor = page.getByRole("dialog", { name: "할 일 추가", exact: true });
  await editor.getByRole("textbox", { name: /^제목/ }).fill("보존할 초안");
  await editor.getByRole("radio", { name: "반복", exact: true }).click();
  let readonly = true;
  await page.route(`**/api/workspaces/${fixtureWorkspaceId}`, route => route.fulfill({ json: {
    workspace: { id: fixtureWorkspaceId, name: "테스트 공간", deleted_at: null }, can_manage: false,
    membership_version: 2, grants: [{ target_kind: "tasks", target_id: "*", access: readonly ? "read" : "write" }],
  } }));
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const preset = editor.getByRole("button", { name: "평일로 설정", exact: true });
  await expect(preset).toBeDisabled();
  await expect(editor).toContainText("현재 읽기 전용입니다");
  await expect(editor.getByRole("textbox", { name: /^제목/ })).toHaveValue("보존할 초안");
  await expect(editor.getByRole("radio", { name: "매일", exact: true })).toBeChecked();
  expect(state.writes).toHaveLength(0);
  readonly = false;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(preset).toBeEnabled();
  await preset.click();
  await expect(editor.getByRole("radio", { name: "매주", exact: true })).toBeChecked();
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("평일 프리셋은 좁은 화면의 확대와 키보드 높이에서도 실제 규칙·요일·저장에 접근한다", async ({ page }, info) => {
  const state = await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  for (const [width, height, scale] of [[320, 900, 2], [390, 450, 1]] as const) {
    await page.setViewportSize({ width, height });
    await goApp(page, "/tasks?create=1");
    await page.evaluate(scale => document.documentElement.style.setProperty("--display-scale", String(scale)), scale);
    const editor = page.getByRole("dialog", { name: "할 일 추가", exact: true });
    await editor.getByRole("textbox", { name: /^제목/ }).fill("확대 점검");
    await editor.getByRole("radio", { name: "반복", exact: true }).click();
    const preset = editor.getByRole("button", { name: "평일로 설정", exact: true });
    await preset.scrollIntoViewIfNeeded();
    await expect(preset).toBeInViewport({ ratio: 1 });
    const bounds = await preset.boundingBox();
    expect(bounds!.height).toBeGreaterThanOrEqual(44);
    expect(bounds!.width).toBeGreaterThanOrEqual(44);
    await preset.focus();
    await preset.press("Space");
    await expect(editor.getByRole("radio", { name: "매주", exact: true })).toBeChecked();
    const saturday = editor.getByRole("button", { name: "토", exact: true });
    await saturday.scrollIntoViewIfNeeded();
    await saturday.focus();
    await saturday.press("Space");
    await expect(saturday).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`weekday-${width}-${height}-${scale}.png`), fullPage: true });
    const save = editor.getByRole("button", { name: "추가", exact: true });
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeInViewport({ ratio: 1 });
    await editor.getByRole("button", { name: "취소", exact: true }).click();
    await page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true }).getByRole("button", { name: "변경 버리기", exact: true }).click();
  }
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});
