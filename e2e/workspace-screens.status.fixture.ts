import { expect, type Page, test } from "@playwright/test";
import { fixtures, go } from "./support/workspace-screens.ts";
import { stamp } from "./support/workspace-data.ts";
import type { StatusOverview } from "../supabase/functions/_shared/contracts/status.ts";

function overview(): StatusOverview {
  return {
    timezone: "Asia/Seoul",
    queried_at: stamp,
    period: { from: "2026-10-14", to: "2026-10-16", days: 3 },
    entities: { total: 1234567, active: 1234567, deleted: 0 },
    tasks: { total: 9, open: 2, done: 3, active: 4, stopped: 0 },
    records: { total: 7, user: 2, result: 4, change: 1 },
    indexing: { total: 7, indexed: 3, preparing: 2, attention: 1, excluded: 1, waiting:{long_waiting:0,oldest_waiting_since:null,threshold_minutes:15} },
    daily: [0, 1, 2].map((n) => ({
      date: `2026-10-${14 + n}`,
      entities_created: n === 2 ? 1234567 : n,
      tasks_created: n + 1,
      once_completed: n,
      records_created: n + 2,
      indexing: { indexed: n, preparing: 3 - n, attention: 1, excluded: 0 },
    })),
  };
}
async function fixture(page: Page, data = overview()) {
  await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  await page.route("**/api/status", (route) => route.fulfill({ json: data }));
  await go(page, "/status");
  return data;
}
const charts = [
  ["일별 등록", ["1,234,567건"], ["0건"]],
  ["일별 생성·완료", ["3건", "2건"], ["1건", "0건"]],
  ["일별 작성", ["4건"], ["2건"]],
  ["작성일별 현재 색인 상태", ["2건", "1건", "1건", "0건"], ["0건", "3건", "1건", "0건"]],
] as const;

test("네 차트는 마지막 날짜와 정확한 수치를 제공하고 키보드·버튼으로 날짜를 선택한다", async ({ page }) => {
  await fixture(page);
  for (const [title, last, first] of charts) {
    const values = page.getByRole("table", { name: `${title} 날짜별 수치`, exact: true });
    const graph = page.getByRole("group", { name: `${title} 그래프: 막대를 누르거나 방향키로 날짜 선택`, exact: true });
    await expect(values.getByRole("cell")).toHaveText([...last]);
    await graph.press("Home");
    await expect(values.getByRole("cell")).toHaveText([...first]);
    await expect(page.getByRole("button", { name: `${title} 이전 날짜`, exact: true })).toBeDisabled();
    await graph.press("End");
    await expect(values.getByRole("cell")).toHaveText([...last]);
    await expect(page.getByRole("button", { name: `${title} 다음 날짜`, exact: true })).toBeDisabled();
    await graph.press("ArrowLeft");
    await page.getByRole("button", { name: `${title} 다음 날짜`, exact: true }).click();
    await expect(values.getByRole("cell")).toHaveText([...last]);
  }
  await expect(page.getByText(/과거 대기량·실패량이나 당일 처리량의 이력이 아닙니다/)).toBeVisible();
});

test("차트 선택은 새로고침·화면 크기·개인 배율 변경에도 유지되고 조회 기간 밖이면 보정한다", async ({ page }, info) => {
  const data = await fixture(page);
  const title = "일별 등록";
  const values = page.getByRole("table", { name: `${title} 날짜별 수치`, exact: true });
  const graph = page.getByRole("group", { name: `${title} 그래프: 막대를 누르거나 방향키로 날짜 선택`, exact: true });
  await graph.press("Home");
  await graph.press("ArrowRight");
  await expect(values.getByRole("cell")).toHaveText(["1건"]);
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(values.getByRole("cell")).toHaveText(["1건"]);
  for (const scale of [100, 110, 125, 150]) {
    await page.evaluate((scale) => document.documentElement.style.fontSize = `${scale}%`, scale);
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(values.getByRole("cell")).toHaveText(["1건"]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`status-${width}-${scale}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("status-320-text200.png"), fullPage: true });
  data.daily = data.daily.slice(2);
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(values.getByRole("cell")).toHaveText(["1,234,567건"]);
});

test("빈 날짜 응답과 새로고침 실패는 수치를 만들거나 기존 결과를 지우지 않는다", async ({ page }) => {
  const data = await fixture(page, { ...overview(), daily: [] });
  await expect(page.getByText("표시할 날짜가 없습니다.", { exact: true })).toHaveCount(4);
  await expect(page.getByRole("table", { name: /날짜별 수치$/ })).toHaveCount(0);
  data.daily = overview().daily;
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.getByRole("table", { name: /날짜별 수치$/ })).toHaveCount(4);
  await page.route("**/api/status", (route) => route.fulfill({ status: 503, json: { error: "fixture failure" } }));
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("상태를 조회하지 못했습니다");
  await expect(page.getByRole("table", { name: "일별 등록 날짜별 수치", exact: true }).getByRole("cell")).toHaveText([
    "1,234,567건",
  ]);
});

test.describe("차트 직접 선택", () => {
  test.use({ hasTouch: true });
  test("그래프를 클릭하거나 터치하면 선택 날짜의 정확한 값이 바뀐다", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await fixture(page);
    const graph = page.getByRole("group", {
      name: "일별 등록 그래프: 막대를 누르거나 방향키로 날짜 선택",
      exact: true,
    });
    const values = page.getByRole("table", { name: "일별 등록 날짜별 수치", exact: true });
    await graph.evaluate((node) => node.scrollIntoView({ block: "center" }));
    let box = (await graph.boundingBox())!;
    await graph.click({ position: { x: box.width * .2, y: box.height * .4 } });
    await expect(values.getByRole("cell")).toHaveText(["0건"]);
    box = (await graph.boundingBox())!;
    await page.touchscreen.tap(box.x + box.width * .85, box.y + box.height * .4);
    await expect(values.getByRole("cell")).toHaveText(["1,234,567건"]);
  });
});
