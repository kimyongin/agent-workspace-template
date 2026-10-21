import { expect, test } from "@playwright/test";
import { entity, fixtureSchema, fixtureType } from "./support/workspace-data.ts";
import { fixtures, goApp } from "./support/workspace-screens.ts";

test("카드 밀도와 선택 속성·펼친 기본 정보의 정렬은 화면 폭에 맞게 유지한다", async ({ page }, info) => {
  const state = await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  const schema = structuredClone(fixtureSchema);

  await page.route("**/api/entity-types/*/schema**", route => route.fulfill({ json: schema }));
  const title = "17761cc7-f259-48dd-869e-ad8c19611b10";
  Object.assign(state.rows.entities[0], entity(1, { prop_1: title, prop_2: null, prop_3: null }), { });
  state.rows.entities.push(entity(4, { prop_1: "다음 자료" }));
  await goApp(page, `/entities?entity_type_id=${fixtureType.id}&view=cards`);
  const trigger = page.getByRole("button", { name: title, exact: true });
  const row = page.getByRole("listitem").filter({ has: trigger });
  await trigger.press("Enter");
  await expect(row.getByRole("term").filter({ hasText: /^식별자 · 자료 식별자$/ })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => {}));
  for (const width of [390, 1440, 2410]) {
    await page.setViewportSize({ width, height: 1100 });
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    // Read related rectangles in one browser task: responsive transitions can
    // move the whole card between separate boundingBox calls.
    const geometry = await row.evaluate((node, { value, title, property, identity }) => {
      const rect = (element: Element | null) => {
        if (!element?.isConnected) throw new Error("Measured card content must remain connected");
        const bounds = element.getBoundingClientRect();
        if (bounds.width <= 0 || bounds.height <= 0) throw new Error("Measured card content must have a nonempty rectangle");
        return bounds;
      };
      const bounds = rect(node), last = rect(value), titleBounds = rect(title);
      return { width: bounds.width, titleWidth: titleBounds.width, bottomGap: bounds.bottom - last.bottom,
        leftDifference: property && identity ? Math.abs(rect(property).left - rect(identity).left) : null,
        grids: [...node.querySelectorAll("dl")].map(grid => ({ text: grid.textContent?.slice(0, 80), width: grid.getBoundingClientRect().width,
          left: grid.getBoundingClientRect().left, columns: getComputedStyle(grid).gridTemplateColumns })) };
    }, { value: await row.getByRole("definition").last().elementHandle(), title: await trigger.elementHandle(),
      property: width >= 1440 ? await row.getByText("날짜", { exact: true }).elementHandle() : null,
      identity: width >= 1440 ? await row.getByRole("term").filter({ hasText: /^식별자 · 자료 식별자$/ }).elementHandle() : null });
    expect(geometry.bottomGap).toBeLessThanOrEqual(24);
    if (width >= 1440) {
      if (geometry.width >= 800) expect(geometry.titleWidth).toBeLessThan(geometry.width / 2);
      expect(geometry.leftDifference, JSON.stringify({ width, grids: geometry.grids })).toBeLessThan(1);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await row.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`card-density-${width}.png`), animations: "disabled" });
  }
  await trigger.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});
