import { fixtureWorkspacePath } from "./support/workspace-scope.ts";
import { businessRows } from "./table-actions.ts";
import { baseWorkspace } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { record, task } from "./support/workspace-data.ts";
import { fixtures, form, goApp } from "./support/workspace-screens.ts";
import { closeDetail, openListDetail } from "./ui-actions.ts";

for (const exit of ["close", "back"] as const) {
  test(`검색 상세에서 외부 변경 후 ${exit} 복귀는 같은 검색을 새로 읽고 초안을 유지한다`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width: 1440, height: 900 });
    await goApp(page, "/search?q=기준&kind=record&mode=keyword");
    const link = page.locator('[aria-label="기본 작업 영역"] [data-list-anchor]').first();
    await expect(link).toBeVisible();
    for (let n = 1; n <= 2; n++) {
      await link.click();
      await expect(page).toHaveURL(/\/records\//);
      expect(new URL(page.url()).pathname.startsWith(fixtureWorkspacePath("/records/"))).toBe(true);
      await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
      // A retained detail is already visible; allow this navigation to paint before returning through history.
      await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      state.rows.records.push({ ...record(500 + n), body: `외부 추가 ${n}` });
      const search = page.getByRole("textbox", { name: /^검색어/ });
      await search.fill("아직 제출하지 않은 검색어");
      if (exit === "back") await page.goBack();
      else await closeDetail(page, "기록");
      await expect(page).toHaveURL(/\/search\?/);
      expect(new URL(page.url()).pathname).toBe(fixtureWorkspacePath("/search"));
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
  await goApp(page, "/tasks");
  await openListDetail(page, "할 일");
  await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
  state.rows.tasks.push({ ...task(510), title: "외부 할 일" });
  await page.goBack();
  await expect(page).toHaveURL(/\/tasks\?/);
  expect(new URL(page.url()).pathname).toBe(fixtureWorkspacePath("/tasks"));
  await expect(businessRows(baseWorkspace(page).getByRole("region", { name: "할 일 목록", exact: true }).getByRole("table"))).toHaveCount(2);
  await expect(baseWorkspace(page).getByRole("button", { name: "할 일", exact: true })).toBeFocused();
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

for (const width of [320, 1440]) {
  test(`짧은 검색 제목 ${width}px: 44px 링크를 키보드로 열고 원래 결과로 복귀한다`, async ({ page }) => {
    const state = await fixtures(page);
    state.rows.records[0].body = "짧음";
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width, height: 900 });
    await goApp(page, "/search?q=짧음&kind=record&mode=keyword");
    const link = page.getByRole("link", { name: "짧음", exact: true });
    await expect(link).toBeVisible();
    const bounds = (await link.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    await page.getByRole("textbox", { name: /^검색어/ }).focus();
    for (let step = 0; step < 20 && !await link.evaluate(node => node === document.activeElement); step++) {
      await page.keyboard.press("Tab");
    }
    await expect(link).toBeFocused();
    await link.press("Enter");
    await expect(page).toHaveURL(/\/records\//);
    expect(new URL(page.url()).pathname.startsWith(fixtureWorkspacePath("/records/"))).toBe(true);
    await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
    await closeDetail(page, "짧음");
    await expect(page).toHaveURL(/\/search\?/);
    expect(new URL(page.url()).pathname).toBe(fixtureWorkspacePath("/search"));
    expect(new URL(page.url()).searchParams.get("q")).toBe("짧음");
    await expect(link).toBeFocused();
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}
