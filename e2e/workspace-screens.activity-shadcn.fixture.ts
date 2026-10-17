import { expect, test } from "@playwright/test";
import { fixtures, go } from "./support/workspace-screens.ts";
import { id } from "./support/workspace-data.ts";

for (const width of [390, 1440]) {
  test(`기록 ${width}: 태그 선택·연결 저장은 본문 저장과 독립이고 중첩창은 초점을 돌려준다`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width, height: 900 });
    await go(page, `/records/${id(3)}`);
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
  await go(page, "/tasks?create=1");
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
