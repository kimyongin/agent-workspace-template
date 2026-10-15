import { expect, test } from "@playwright/test";
import { fixtures } from "./support/workspace-screens.ts";
import { fixtureType } from "./support/workspace-data.ts";

for (const width of [320, 390, 640, 1440]) {
  test(`built query ${width}px: type is above search and filter shares the search row`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/agent-workspace-template/entities?entity_type_id=${fixtureType.id}`);
    const picker = page.getByRole("combobox", { name: "자료 종류", exact: true });
    await expect(picker).toBeEnabled();
    const search = page.getByRole("textbox", { name: "자료 제목 검색", exact: true });
    const filter = page.getByRole("button", { name: "필터 열기", exact: true });
    const p = (await picker.boundingBox())!, s = (await search.boundingBox())!, f = (await filter.boundingBox())!;
    expect(p.y + p.height).toBeLessThan(s.y);
    expect(f.y, "filter belongs beside search, not over the type selector").toBeCloseTo(s.y, 0);
    expect(s.x + s.width).toBeLessThan(f.x);
    expect(p.x + p.width).toBeCloseTo(f.x + f.width, 0);
    await filter.click();
    await expect(page.getByRole("button", { name: "조건 초기화", exact: true })).toBeVisible();
    const panel = (await page.locator(".tab-filters > .form").boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(s.y + s.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`built-query-${width}.png`) });
    expect(state.writes).toHaveLength(0);
  });
}
