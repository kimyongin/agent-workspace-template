import { expect, test } from "@playwright/test";
import { entityKey, fixtureSchema, fixtureType } from "./support/workspace-data.ts";
import { fixtures, form, go } from "./support/workspace-screens.ts";

for (const width of [320, 390, 1440]) {
  test(`여러 줄 자료 속성 ${width}px: 편집·재조회에서 절차와 줄바꿈을 보존한다`, async ({ page }, info) => {
    const state = await fixtures(page);
    const definition = structuredClone(fixtureSchema);
    definition.schema.properties.prop_2.minimum = 0;
    definition.schema.properties.prop_7 = { type: "string", title: "점검 절차", "x-order": 70, maxLength: 4096 };
    state.rows.entities[0].properties.prop_7 = "1. 전원 차단\n2. 잠금 표찰 확인";
    let schemaFails = false;
    await page.route(
      `**/api/entity-types/${fixtureType.id}/schema**`,
      (route) =>
        schemaFails
          ? route.fulfill({ status: 503, json: { code: "unavailable", message: "점검 정의 재조회 시험 실패" } })
          : route.fulfill({ json: definition }),
    );
    await page.setViewportSize({ width, height: 844 });
    await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
    const read = form(page).locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: /^점검 절차$/ }) });
    await expect(read.locator("dd")).toHaveCSS("white-space", "pre-wrap");
    const positions = await read.evaluate((el) => ({
      label: el.querySelector("dt")!.getBoundingClientRect(),
      value: el.querySelector("dd")!.getBoundingClientRect(),
    }));
    expect(positions.value.x).toBeCloseTo(positions.label.x, 0);
    expect(positions.value.y).toBeGreaterThanOrEqual(positions.label.bottom);
    await form(page).getByRole("button", { name: "편집", exact: true }).click();
    const procedure = form(page).getByRole("textbox", { name: "점검 절차", exact: true });
    await expect(procedure).toHaveValue("1. 전원 차단\n2. 잠금 표찰 확인");
    const value = "1. 전원 차단\n2. 잠금 표찰 확인\n3. φ25 씰·가드 복구 — 정상 😀";
    await procedure.fill(value);
    await expect(procedure).toHaveValue(value);
    await procedure.press("End");
    await procedure.press("Enter");
    await page.keyboard.type("4. 시험 운전");
    const expected = value + "\n4. 시험 운전";
    await expect(procedure).toHaveValue(expected);
    await expect(form(page).getByRole("button", { name: "저장", exact: true })).toBeEnabled();
    if (width === 390) {
      await form(page).getByRole("textbox", { name: "수량", exact: true }).fill("-1");
      await form(page).getByRole("button", { name: "저장", exact: true }).click();
      await expect(form(page).getByRole("alert").filter({ hasText: "0 이상이어야 합니다" })).toBeVisible();
      schemaFails = true;
      await form(page).getByRole("button", { name: "속성 정의 다시 조회", exact: true }).click();
      await expect(form(page).getByRole("alert").filter({ hasText: "점검 정의 재조회 시험 실패" })).toBeVisible();
      await expect(procedure).toHaveValue(expected);
      schemaFails = false;
      await form(page).getByRole("button", { name: "속성 정의 다시 조회", exact: true }).click();
      await form(page).getByRole("button", { name: "확인한 정의로 편집", exact: true }).click();
      await expect(procedure).toHaveValue(expected);
      await form(page).getByRole("textbox", { name: "수량", exact: true }).fill("0");
    }
    await form(page).getByRole("button", { name: "저장", exact: true }).click();
    await form(page).getByRole("button", { name: "수정하고 저장", exact: true }).click();
    await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
    expect(state.rows.entities[0].properties.prop_7).toBe(expected);
    await form(page).getByRole("button", { name: "편집", exact: true }).click();
    await expect(form(page).getByRole("textbox", { name: "점검 절차", exact: true })).toHaveValue(expected);
    for (const zoom of [1, 2]) {
      await page.evaluate((zoom) => {
        document.documentElement.style.zoom = String(zoom);
      }, zoom);
      await procedure.scrollIntoViewIfNeeded();
      await procedure.focus();
      await expect(procedure).toBeFocused();
      await expect(form(page).getByRole("button", { name: "저장", exact: true })).toBeInViewport();
      expect(
        await form(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      await page.screenshot({ path: info.outputPath(`multiline-${width}-zoom${zoom}.png`) });
    }
    expect(state.errors).toEqual([]);
  });
}
