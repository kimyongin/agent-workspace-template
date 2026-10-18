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
    records: { total: 7, result: 6, change: 1 },
    indexing: { total: 7, indexed: 3, preparing: 2, attention: 1, excluded: 1, waiting:{long_waiting:0,oldest_waiting_since:null,threshold_minutes:15} },
    entity_indexing: { total: 1234567, indexed: 1234560, preparing: 3, attention: 4, excluded: 0, waiting: { long_waiting: 0, oldest_waiting_since: null, threshold_minutes: 15 } },
    daily: [0, 1, 2].map((n) => ({
      date: `2026-10-${14 + n}`,
      entities_created: n === 2 ? 1234567 : n,
      tasks_created: n + 1,
      once_completed: n,
      records_created: n + 2,
      indexing: { indexed: n, preparing: 3 - n, attention: 1, excluded: 0 },
      entity_indexing: { indexed: n + 1, preparing: n, attention: 2, excluded: 0 },
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
  ["등록일별 현재 자료 색인 상태", ["3건", "2건", "2건", "0건"], ["1건", "0건", "2건", "0건"]],
] as const;

test("다섯 차트는 마지막 날짜와 정확한 수치를 제공하고 키보드·버튼으로 날짜를 선택한다", async ({ page }) => {
  await fixture(page);
  await expect(page.getByRole("button", { name: "색인 문제 5개 펼치기", exact: true })).toBeVisible();
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
  await expect(page.getByText(/과거 대기량·실패량이나 당일 처리량의 이력이 아닙니다/)).toHaveCount(2);
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
    await page.evaluate((scale) => document.documentElement.style.setProperty("--display-scale", String(scale / 100)), scale);
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeCloseTo(16 * scale / 100, 1);
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(values.getByRole("cell")).toHaveText(["1건"]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const table of await page.getByRole("table", { name: /날짜별 수치$/ }).all()) expect(await table.evaluate(el => ({ table: el.scrollWidth <= el.clientWidth + 1, container: el.parentElement!.scrollWidth <= el.parentElement!.clientWidth + 1 })), `${width}px ${scale}%`).toEqual({ table: true, container: true });
      await page.screenshot({ path: info.outputPath(`status-${width}-${scale}.png`), fullPage: true });
    }
  }
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const table of await page.getByRole("table", { name: /날짜별 수치$/ }).all()) expect(await table.evaluate(el => ({ table: el.scrollWidth <= el.clientWidth + 1, container: el.parentElement!.scrollWidth <= el.parentElement!.clientWidth + 1 })), "320px text200%").toEqual({ table: true, container: true });
  await page.screenshot({ path: info.outputPath("status-320-text200.png"), fullPage: true });
  data.daily = data.daily.slice(2);
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(values.getByRole("cell")).toHaveText(["1,234,567건"]);
});

test("빈 날짜 응답과 새로고침 실패는 수치를 만들거나 이전 권한 결과를 다시 표시하지 않는다", async ({ page }) => {
  const data = await fixture(page, { ...overview(), daily: [] });
  await expect(page.getByText("표시할 날짜가 없습니다.", { exact: true })).toHaveCount(5);
  await expect(page.getByRole("table", { name: /날짜별 수치$/ })).toHaveCount(0);
  data.daily = overview().daily;
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.getByRole("table", { name: /날짜별 수치$/ })).toHaveCount(5);
  await page.route("**/api/status", (route) => route.fulfill({ status: 503, json: { error: "fixture failure" } }));
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("상태를 조회하지 못했습니다");
  await expect(page.getByRole("table", { name: /날짜별 수치$/ })).toHaveCount(0);
});

test.describe("차트 직접 선택", () => {
  test.use({ hasTouch: true });
  test("그래프를 클릭하거나 터치하면 선택 날짜의 정확한 값이 바뀐다", async ({ page }, info) => {
    test.setTimeout(120_000);
    await fixture(page);
    for (const scale of [100, 110, 125, 150]) {
      await page.evaluate((scale) => document.documentElement.style.setProperty("--display-scale", String(scale / 100)), scale);
      expect(await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize))).toBeCloseTo(16 * scale / 100, 1);
      for (const width of [320, 390, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const [title, last, first] of charts) {
          await test.step(`${width}px · ${scale}% · ${title}`, async () => {
            const graph = page.getByRole("group", { name: `${title} 그래프: 막대를 누르거나 방향키로 날짜 선택`, exact: true });
            const values = page.getByRole("table", { name: `${title} 날짜별 수치`, exact: true });
            await graph.evaluate((node) => node.scrollIntoView({ block: "center" }));
            const firstLabel = graph.getByText("10-14", { exact: true });
            await expect(firstLabel).toBeVisible();
            await firstLabel.hover();
            let box = (await graph.boundingBox())!;
            const firstTick = (await firstLabel.boundingBox())!;
            await graph.click({ position: { x: firstTick.x + firstTick.width / 2 - box.x, y: box.height * .4 } });
            await expect(values.getByRole("cell")).toHaveText([...first]);
            box = (await graph.boundingBox())!;
            const lastLabel = graph.getByText("10-16", { exact: true });
            await expect(lastLabel).toBeVisible();
            const lastTick = (await lastLabel.boundingBox())!;
            await page.touchscreen.tap(lastTick.x + lastTick.width / 2, box.y + box.height * .4);
            await expect(values.getByRole("cell")).toHaveText([...last]);
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
            if (width === 320 && (scale === 110 || scale === 150)) {
              await graph.screenshot({ path: info.outputPath(`pointer-${title}-${width}-${scale}.png`) });
            }
            await graph.press("Home");
            await expect(values.getByRole("cell")).toHaveText([...first]);
            await graph.press("End");
            await expect(values.getByRole("cell")).toHaveText([...last]);
            if (width === 320 && scale === 150) {
              const graphBounds = (await graph.boundingBox())!;
              const axisBounds = (await graph.getByText("10-16", { exact: true }).boundingBox())!;
              for (const label of await values.getByRole("rowheader").allTextContents()) {
                const legendLabel = graph.getByText(label, { exact: true });
                await expect(legendLabel).toHaveCount(1);
                const labelBounds = (await legendLabel.boundingBox())!;
                expect(labelBounds.y).toBeGreaterThanOrEqual(axisBounds.y + axisBounds.height);
                expect(labelBounds.y + labelBounds.height).toBeLessThanOrEqual(graphBounds.y + graphBounds.height);
              }
              const previous = (await page.getByRole("button", { name: `${title} 이전 날짜`, exact: true }).boundingBox())!;
              const next = (await page.getByRole("button", { name: `${title} 다음 날짜`, exact: true }).boundingBox())!;
              const date = (await page.getByRole("region", { name: title, exact: true }).locator(`time[datetime="2026-10-16"]`).boundingBox())!;
              expect(previous.y).toBeCloseTo(next.y, 1);
              expect(previous.x).toBeLessThan(next.x);
              expect(date.y + date.height).toBeLessThanOrEqual(previous.y);
              const tableBounds = (await values.boundingBox())!;
              expect(graphBounds.y + graphBounds.height).toBeLessThanOrEqual(previous.y);
              expect(previous.y + previous.height).toBeLessThanOrEqual(tableBounds.y);
              if (title === "작성일별 현재 색인 상태") {
                const card = page.getByRole("region", { name: "기록 색인 현황", exact: true });
                const cardBounds = (await card.boundingBox())!;
                // Keep width and scale fixed while fitting the whole card in the capture viewport.
                await page.setViewportSize({ width, height: Math.ceil(cardBounds.height + 200) });
                await card.screenshot({ path: info.outputPath("indexing-whole-card-320-150.png") });
                await page.setViewportSize({ width, height: 900 });
              }
            }
          });
        }
      }
    }
  });
});

test("색인 문제 표는 지연 조회·실패 재시도·페이지·좁은 화면의 상세를 유지한다", async ({ page }, info) => {
  const requests: string[] = [];
  let fail = true;
  const item = (n: number) => ({ kind: "record", path: `/records/20261011-ABCDEF${n}${n}`, id: `20261011-ABCDEF${n}${n}`, created_at: "2026-10-11T00:00:00.000Z", title: `문제${n} ` + "긴제목".repeat(24), reason: "provider_unknown", attempts: 5, chunks: { total: 2, succeeded: 1, preparing: 0, unknown: 1, failed: 0 } });
  await fixture(page);
  await page.route("**/api/status/indexing/issues**", route => {
    requests.push(route.request().url());
    if (fail) { fail = false; return route.fulfill({ status: 503, json: { code: "unavailable", message: "fixture failure" } }); }
    const last = new URL(route.request().url()).searchParams.has("cursor");
    return route.fulfill({ json: { items: last ? [item(5)] : Array.from({ length: 5 }, (_, n) => item(n)), next_cursor: last ? null : "last-page" } });
  });
  expect(requests).toHaveLength(0);
  await page.getByRole("button", { name: /^색인 문제/ }).click();
  await expect(page.getByRole("alert")).toContainText("색인 문제를 조회하지 못했습니다");
  expect(requests).toHaveLength(1);
  await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  const table = page.getByRole("table", { name: "색인 문제 항목", exact: true });
  await expect(table).toBeVisible();
  await expect(table.getByRole("button", { name: /^문제\d/ })).toHaveCount(5);
  const trigger = table.getByRole("button", { name: /^문제0/ });
  await trigger.press("Enter");
  await expect(table).toContainText("실패나 성공으로 확정할 수 없습니다");
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(await table.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await table.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("indexing-issues-table.png"), fullPage: true });
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(table.getByRole("button", { name: /^문제\d/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "다음", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await expect(table.getByRole("button", { name: /^문제\d/ })).toHaveCount(5);
  expect(requests).toHaveLength(4);
});
