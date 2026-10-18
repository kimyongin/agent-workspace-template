import { expect, test } from "@playwright/test";
import { entity, fixtureSchema, fixtureType } from "./support/workspace-data.ts";
import { fixtures, go } from "./support/workspace-screens.ts";

test("카드 밀도와 선택 속성·펼친 기본 정보의 정렬은 화면 폭에 맞게 유지한다", async ({ page }, info) => {
  const state = await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  const schema = structuredClone(fixtureSchema);
  schema.schema.properties.prop_3["x-show-in-list"] = true;
  await page.route("**/api/entity-types/*/schema**", route => route.fulfill({ json: schema }));
  const title = "17761cc7-f259-48dd-869e-ad8c19611b10";
  Object.assign(state.rows.entities[0], entity(1, { prop_1: title, prop_2: null, prop_3: null }), { display_properties: { prop_1: title, prop_2: null, prop_3: null } });
  state.rows.entities.push(entity(4, { prop_1: "다음 자료" }));
  await go(page, `/entities?entity_type_id=${fixtureType.id}&view=cards`);
  const trigger = page.getByRole("button", { name: title, exact: true });
  const row = page.getByRole("listitem").filter({ has: trigger });
  await trigger.press("Enter");
  await expect(row.getByText("자료 번호", { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => {}));
  for (const width of [390, 1440, 2410]) {
    await page.setViewportSize({ width, height: 1100 });
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    const rowBox = (await row.boundingBox())!;
    const lastValue = (await row.getByRole("definition").last().boundingBox())!;
    expect(rowBox.y + rowBox.height - lastValue.y - lastValue.height).toBeLessThanOrEqual(24);
    if (width >= 1440) {
      if (rowBox.width >= 800) expect((await trigger.boundingBox())!.width).toBeLessThan(rowBox.width / 2);
      const property = (await row.getByText("날짜", { exact: true }).boundingBox())!;
      const identity = (await row.getByText("번호 출처", { exact: true }).boundingBox())!;
      const grids = await row.locator("dl").evaluateAll(nodes => nodes.map(node => ({ text: node.textContent?.slice(0, 80), width: node.getBoundingClientRect().width, left: node.getBoundingClientRect().left, columns: getComputedStyle(node).gridTemplateColumns })));
      expect(Math.abs(property.x - identity.x), JSON.stringify({ width, grids })).toBeLessThan(1);
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
