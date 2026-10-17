import { baseWorkspace } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { record, task } from "./support/workspace-data.ts";
import { fixtures, form, go } from "./support/workspace-screens.ts";
import { closeDetail, openListDetail } from "./ui-actions.ts";

for (const exit of ["close", "back"] as const) {
  test(`검색 상세에서 외부 변경 후 ${exit} 복귀는 같은 검색을 새로 읽고 초안을 유지한다`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width: 1440, height: 900 });
    await go(page, "/search?q=기준&kind=record&mode=keyword");
    const link = page.locator('[aria-label="기본 작업 영역"] [data-list-anchor]').first();
    await expect(link).toBeVisible();
    for (let n = 1; n <= 2; n++) {
      await link.click();
      await expect(page).toHaveURL(/\/records\//);
      await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
      state.rows.records.push({ ...record(500 + n), body: `외부 추가 ${n}` });
      const search = page.getByRole("textbox", { name: /^검색어/ });
      await search.fill("아직 제출하지 않은 검색어");
      if (exit === "back") await page.goBack();
      else await closeDetail(page, "기록");
      await expect(page).toHaveURL(/\/search\?/);
      if (exit === "back") {
        await expect(page.locator("[aria-label=\"상세 작업 영역\"]")).toBeVisible();
        await expect(page.getByRole("tab")).toHaveCount(1);
      } else {
        await expect(page.locator("[aria-label=\"상세 작업 영역\"]")).toBeHidden();
        await expect(page.getByRole("tab")).toHaveCount(0);
      }
      await expect(page.locator('[aria-label="기본 작업 영역"] [data-list-anchor]')).toHaveCount(1 + n);
      await expect(search).toHaveValue("아직 제출하지 않은 검색어");
      await expect(link).toBeFocused();
      expect(new URL(page.url()).searchParams.get("q")).toBe("기준");
    }
    await page.screenshot({ path: info.outputPath(`search-${exit}-return.png`) });
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

test("할 일 상세 뒤로 가기는 외부 추가와 원래 행 초점을 복원한다", async ({ page }) => {
  const state = await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  await page.setViewportSize({ width: 1440, height: 900 });
  await go(page, "/tasks");
  await openListDetail(page, "할 일");
  await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
  state.rows.tasks.push({ ...task(510), title: "외부 할 일" });
  await page.goBack();
  await expect(page).toHaveURL(/\/tasks\?/);
  await expect(page.locator('[aria-label="기본 작업 영역"] [data-list-row]')).toHaveCount(2);
  await expect(baseWorkspace(page).getByRole("button", { name: "할 일", exact: true })).toBeFocused();
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});
