import { expect, test } from "@playwright/test";
import { fixtures, goApp } from "./support/workspace-screens.ts";

test("좁은 테이블의 상태와 펼친 본문은 같은 값 열과 세로 전환을 사용한다", async ({ page }, info) => {
  const state = await fixtures(page);
  state.rows.tasks[0].body = "정렬 검수용 긴 본문입니다. 필요한 자료와 일정을 확인합니다.";
  await page.unroute("http://127.0.0.1:55580/**");
  await goApp(page, "/tasks");
  const table = page.getByRole("table", { name: "할 일 목록", exact: true });
  await table.getByRole("button", { name: state.rows.tasks[0].title, exact: true }).click();
  const body = table.getByText(state.rows.tasks[0].body, { exact: true });
  await expect(body).toBeVisible();
  for (const width of [390, 320, 640]) {
    await page.setViewportSize({ width, height: 844 });
    const geometry = await table.evaluate(node => {
      const status = [...node.querySelectorAll("td")].find(cell => cell.textContent?.startsWith("상태"))!;
      const statusValue = status.querySelector('[data-slot="badge"]')!;
      const body = node.querySelector("dd")!;
      return { statusX: statusValue.getBoundingClientRect().x, bodyX: body.getBoundingClientRect().x };
    });
    expect(Math.abs(geometry.statusX - geometry.bodyX), JSON.stringify({ width, ...geometry })).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`value-alignment-${width}.png`), animations: "disabled" });
  }
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});
