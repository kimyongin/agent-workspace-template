import { expect, test } from "@playwright/test";
import { fillText, fixtures, form, go } from "./support/workspace-screens.ts";
import { openDetailEditor, openTabFilters, saveOnce } from "./ui-actions.ts";
import { fixtureType } from "./support/workspace-data.ts";

test("미확정 응답의 긴 재시도 행동도 큰 글자에서 잘리지 않고 중복 실행하지 않는다", async ({ page }, info) => {
  const state = await fixtures(page, { failWrite: "unknown" });
  await page.setViewportSize({ width: 390, height: 900 });
  await go(page, "/tasks?create=1");
  await fillText(page, "큰 글자 재시도");
  await saveOnce(page, form(page), "추가");
  const retry = form(page).getByRole("button", { name: "같은 내용 다시 시도", exact: true });
  await expect(retry).toBeVisible();
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  await page.screenshot({ path: info.outputPath("retry-320-200.png"), fullPage: true });
  const bounds = await retry.evaluate((element) => {
    const box = element.getBoundingClientRect(),
      footer = element.closest('[data-slot="dialog-footer"]')!.getBoundingClientRect();
    return {
      left: box.left,
      right: box.right,
      min: footer.left,
      max: footer.right,
      width: box.width,
      height: box.height,
    };
  });
  expect(bounds.left).toBeGreaterThanOrEqual(bounds.min);
  expect(bounds.right).toBeLessThanOrEqual(bounds.max);
  expect(bounds.width).toBeGreaterThanOrEqual(44);
  expect(bounds.height).toBeGreaterThanOrEqual(44);
  expect(
    await retry.evaluate((element) =>
      element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight
    ),
  ).toBe(true);
  expect(state.writes).toHaveLength(1);
});

test("편집 푸터의 보이는 순서와 Tab 순서가 같고 위험 확인 취소는 초안을 보존한다", async ({ page }, info) => {
  const state = await fixtures(page);
  state.rows.tasks[0].body = "확인 취소 뒤에도 보존할 본문";
  for (const [width, scale] of [[320, 100], [390, 100], [1440, 100], [320, 200]]) {
    await page.setViewportSize({ width, height: 900 });
    await go(page, `/tasks/${state.rows.tasks[0].id}`);
    await page.evaluate((scale) => document.documentElement.style.fontSize = `${scale}%`, scale);
    await openDetailEditor(page);
    const editor = form(page), footer = editor.locator('[data-slot="dialog-footer"]');
    const buttons = footer.getByRole("button");
    const positions = await buttons.evaluateAll((elements) =>
      elements.map((element) => {
        const { top, left, width, height } = element.getBoundingClientRect();
        return { label: element.textContent?.trim(), top, left, width, height };
      })
    );
    await page.screenshot({ path: info.outputPath(`footer-${width}-${scale}.png`), fullPage: true });
    const visual = [...positions].sort((a, b) => a.top - b.top || a.left - b.left).map((value) => value.label);
    const keyboard = [];
    await buttons.first().focus();
    for (let i = 0; i < positions.length; i++) {
      keyboard.push(await page.evaluate(() => document.activeElement?.textContent?.trim()));
      await page.keyboard.press("Tab");
    }
    expect(keyboard).toEqual(visual);
    expect(positions.every((value) => value.width >= 44 && value.height >= 44)).toBe(true);
    await footer.getByRole("button", { name: "삭제", exact: true }).click();
    const confirm = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "삭제하시겠습니까?", exact: true }),
    });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "취소", exact: true }).click();
    await expect(editor.getByRole("textbox", { name: "본문", exact: true })).toHaveValue(
      "확인 취소 뒤에도 보존할 본문",
    );
    await footer.getByRole("button", { name: "취소", exact: true }).click();
  }
  expect(state.writes).toHaveLength(0);
});

test("미저장 폐기 확인도 보이는 순서와 Tab 순서를 맞추고 취소는 초안을 보존한다", async ({ page }, info) => {
  const state = await fixtures(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await go(page, `/tasks/${state.rows.tasks[0].id}`);
  await openDetailEditor(page);
  const editor = form(page);
  await editor.getByRole("textbox", { name: "본문", exact: true }).fill("폐기 확인 취소 뒤 보존할 초안");
  await editor.getByRole("button", { name: "취소", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true });
  await expect(confirm).toBeVisible();
  const buttons = confirm.getByRole("button");
  const positions = await buttons.evaluateAll((elements) =>
    elements.map((element) => {
      const { top, left } = element.getBoundingClientRect();
      return { label: element.textContent?.trim(), top, left };
    })
  );
  await page.screenshot({ path: info.outputPath("discard-order-390.png"), fullPage: true });
  await buttons.first().focus();
  const keyboard = [];
  for (let i = 0; i < positions.length; i++) {
    keyboard.push(await page.evaluate(() => document.activeElement?.textContent?.trim()));
    await page.keyboard.press("Tab");
  }
  expect(keyboard).toEqual([...positions].sort((a, b) => a.top - b.top || a.left - b.left).map((value) => value.label));
  await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(editor.getByRole("textbox", { name: "본문", exact: true })).toHaveValue("폐기 확인 취소 뒤 보존할 초안");
  expect(state.writes).toHaveLength(0);
});

test(
  "긴 Markdown 표는 읽을 열 폭과 내부 이동을 제공하고 짧은 표를 불필요하게 늘리지 않는다",
  async ({ page }, info) => {
    const state = await fixtures(page);
    state.rows.records[0].body =
      "|작업구분|담당부서|예상작업비용|확인결과|등록일자|참고사항|\n|---|---|---|---|---|---|\n|검수 업무|운영 지원|123,456원|이상 없음|2026-10-30|본문 보존|";
    await page.setViewportSize({ width: 390, height: 900 });
    await go(page, `/records/${state.rows.records[0].id}`);
    const table = form(page).getByRole("term").filter({ hasText: /^본문$/ }).locator("..").getByRole("table");
    await expect(table.getByRole("cell", { name: "123,456원", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("markdown-long-390.png"), fullPage: true });
    const headings = await table.getByRole("columnheader").evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          text: element.textContent,
          height: element.getBoundingClientRect().height,
          fontSize: style.fontSize,
          paddingTop: style.paddingTop,
          paddingBottom: style.paddingBottom,
          max: parseFloat(style.fontSize) * 3 + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom) + 1,
        };
      })
    );
    expect(headings.every((value) => value.height <= value.max), JSON.stringify(headings)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(table.getByRole("cell")).toHaveCount(6);
    await table.focus();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
    state.rows.records[0].body = "|수량|단가|\n|---|---|\n|2|10|";
    await go(page, `/records/${state.rows.records[0].id}`);
    await expect(table.getByRole("cell", { name: "10", exact: true })).toBeVisible();
    expect(
      await table.evaluate((element) => element.getBoundingClientRect().width <= element.parentElement!.clientWidth),
    ).toBe(true);
    const url = `https://example.com/${"long-reference-".repeat(12)}`;
    state.rows.records[0].body = `|참고 주소|확인|\n|---|---|\n|[${url}](${url})|원문 보존|`;
    for (const width of [320, 390, 1440]) {
      for (const scale of [100, 200]) {
        await page.setViewportSize({ width, height: 900 });
        await go(page, `/records/${state.rows.records[0].id}`);
        await page.evaluate((scale) => document.documentElement.style.fontSize = `${scale}%`, scale);
        const link = table.getByRole("link", { name: url, exact: true });
        await expect(link).toHaveAttribute("href", url);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await table.focus();
        expect(await table.evaluate((element) => element === document.activeElement)).toBe(true);
        if (await table.evaluate((element) => element.scrollWidth > element.clientWidth)) {
          await page.keyboard.press("ArrowRight");
          await expect.poll(() => table.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
        }
        await form(page).getByRole("button", { name: "편집", exact: true }).focus();
        await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeFocused();
        await page.screenshot({ path: info.outputPath(`markdown-url-${width}-${scale}.png`), fullPage: true });
      }
    }
    expect(state.writes).toHaveLength(0);
  },
);

test("할 일과 기록의 긴 본문은 전체 입력 폭과 원문을 유지한다", async ({ page }, info) => {
  const state = await fixtures(page);
  const body = "줄바꿈과 원문을 보존할 긴 본문\n\n".repeat(12);
  state.rows.tasks[0].body = body;
  state.rows.records[0].body = body;
  for (const kind of ["tasks", "records"] as const) {
    for (const [width, scale] of [[320, 100], [390, 100], [1440, 100], [390, 200]]) {
      await page.setViewportSize({ width, height: 900 });
      await go(page, `/${kind}/${state.rows[kind][0].id}`);
      await page.evaluate((scale) => document.documentElement.style.fontSize = `${scale}%`, scale);
      await openDetailEditor(page);
      const input = form(page).getByRole("textbox", { name: /^본문/ });
      await expect(input).toHaveValue(body);
      await page.screenshot({ path: info.outputPath(`body-${kind}-${width}-${scale}.png`), fullPage: true });
      const ratio = await input.evaluate((element) =>
        element.getBoundingClientRect().width / element.closest('[data-slot="field"]')!.getBoundingClientRect().width
      );
      expect(ratio).toBeGreaterThan(0.95);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  }
  expect(state.writes).toHaveLength(0);
});

test("자료 펼침은 전체 속성을 보존하고 이미 표시한 같은 종류만 반복하지 않는다", async ({ page }, info) => {
  const state = await fixtures(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto("/entities?view=cards");
  const trigger = page.getByRole("button", { name: state.rows.entities[0].title, exact: true });
  const row = page.getByRole("listitem").filter({ has: trigger });
  await trigger.click();
  const panelId = await trigger.getAttribute("aria-controls");
  expect(panelId).toBeTruthy();
  const panel = row.locator(`[id="${panelId}"]`);
  for (const name of ["제목", "수량", "날짜", "분류", "식별자 · 자료 식별자"]) {
    await expect(panel.getByRole("term").filter({ hasText: new RegExp(`^${name}$`) })).toBeVisible();
  }
  await expect(row.getByText(fixtureType.label, { exact: true })).toHaveCount(1);
  await page.screenshot({ path: info.outputPath("expanded-entity-390.png"), fullPage: true });
  await page.route(
    (url) => url.pathname === `/api/entities/${encodeURIComponent(state.rows.entities[0].id)}`,
    (route) =>
      route.fulfill({ json: { ...state.rows.entities[0], type: { ...fixtureType, label: "이름이 바뀐 종류" } } }),
  );
  await page.goto("/entities?view=cards");
  await trigger.click();
  await expect(row.getByText(fixtureType.label, { exact: true })).toHaveCount(1);
  await expect(row.getByText("이름이 바뀐 종류", { exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
});

test("좁은 필터와 큰 글자 목록 도구는 초안·누름 영역·읽기 순서를 유지한다", async ({ page }, info) => {
  const state = await fixtures(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await go(page, "/entities");
  await openTabFilters(page);
  await page.getByRole("button", { name: "속성 조건 추가", exact: true }).click();
  const value = page.getByLabel("조건 1 값", { exact: true });
  await value.fill("아직 적용하지 않은 긴 값");
  const property = await page.getByLabel("조건 1 속성", { exact: true }).boundingBox();
  const valueWidth = (await value.boundingBox())!.width;
  await page.screenshot({ path: info.outputPath("filter-390.png"), fullPage: true });
  expect(new URL(page.url()).searchParams.has("property_filters")).toBe(false);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  await expect(value).toHaveValue("아직 적용하지 않은 긴 값");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("filter-320-200.png"), fullPage: true });
  await go(page, "/entities");
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  const tools = page.getByRole("region", { name: "검사 자료 목록", exact: true });
  for (const name of ["검사 자료 전체 열기", "테이블", "카드", "검사 자료 추가"]) {
    const control = tools.getByRole("button", { name, exact: true }).or(
      tools.getByRole("radio", { name, exact: true }),
    );
    await expect(control).toBeVisible();
    const box = (await control.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("toolbar-320-200.png"), fullPage: true });
  expect(valueWidth).toBeGreaterThan(property!.width * 1.5);
  expect(state.writes).toHaveLength(0);
});
