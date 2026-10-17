import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { fixtures } from "./support/workspace-screens.ts";
import { fixtureType } from "./support/workspace-data.ts";

test.beforeAll(() => {
  const built = new URL("../test-results/query-layout-dist/", import.meta.url);
  expect(readFileSync(new URL("404.html", built), "utf8")).toBe(readFileSync(new URL("index.html", built), "utf8"));
});

for (const width of [320, 390, 640, 1440]) {
  test(`built query ${width}px: type, search and filters remain usable without overflow`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/agent-workspace-template/entities?entity_type_id=${fixtureType.id}`);
    const picker = page.getByRole("combobox", { name: "자료 종류", exact: true });
    await expect(picker).toBeEnabled();
    const search = page.getByRole("textbox", { name: "자료 제목 검색", exact: true });
    const filter = page.getByRole("button", { name: "필터 열기", exact: true });
    const p = (await picker.locator('xpath=ancestor::*[@data-slot="input-group"][1]').boundingBox())!, s = (await search.boundingBox())!, f = (await filter.boundingBox())!;
    expect(p.y + p.height).toBeLessThanOrEqual(s.y + 1);
    expect(f.y, "filter belongs beside search, not over the type selector").toBeCloseTo(s.y, 0);
    expect(s.x + s.width).toBeLessThanOrEqual(f.x + 1);
    expect(p.x + p.width).toBeCloseTo(f.x + f.width, 0);
    await filter.click();
    await expect(page.getByRole("button", { name: "조건 초기화", exact: true })).toBeVisible();
    const panel = (await page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "필터", exact: true }) }).boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(s.y + s.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`built-query-${width}.png`) });
    expect(state.writes).toHaveLength(0);
  });
}
