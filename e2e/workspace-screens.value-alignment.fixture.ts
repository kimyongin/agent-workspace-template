import { expect, test } from "@playwright/test";
import { fixtures, goApp } from "./support/workspace-screens.ts";

// Representative devices, reflow boundaries on both sides, and large desktops.
const widths = [320, 327, 328, 329, 359, 360, 390, 575, 576, 577, 639, 640, 641, 767, 768, 769, 1023, 1024, 1025, 1440, 1920, 2560];

test("좁은 테이블의 상태와 펼친 본문은 같은 값 열과 세로 전환을 사용한다", async ({ page }, info) => {
  const state = await fixtures(page);
  state.rows.tasks[0].body = "정렬 검수용 긴 본문입니다. 필요한 자료와 일정을 확인합니다.";
  await page.unroute("http://127.0.0.1:55580/**");
  await goApp(page, "/tasks");
  const table = page.getByRole("table", { name: "할 일 목록", exact: true });
  await table.getByRole("button", { name: state.rows.tasks[0].title, exact: true }).click();
  const body = table.getByText(state.rows.tasks[0].body, { exact: true });
  await expect(body).toBeVisible();
  const measurements = [];
  for (const width of widths) {
    for (const scale of [1, 1.5, 2]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(scale => { document.documentElement.style.fontSize = `${scale * 100}%`; }, scale);
      const geometry = await table.evaluate(node => {
        const status = [...node.querySelectorAll("td")].find(cell => cell.textContent?.startsWith("상태"))!;
        const statusValue = status.querySelector('[data-slot="badge"]')!;
        const label = status.querySelector('span[aria-hidden="true"]')!;
        return { statusX: statusValue.getBoundingClientRect().x, bodyX: node.querySelector("dd")!.getBoundingClientRect().x,
          labelX: label.getBoundingClientRect().x, bodyLabelX: node.querySelector("dt")!.getBoundingClientRect().x,
          reflowed: label.getBoundingClientRect().height > 0 };
      });
      measurements.push({ width, scale, ...geometry });
      if (geometry.reflowed) {
        expect(Math.abs(geometry.statusX - geometry.bodyX), JSON.stringify({ width, scale, ...geometry })).toBeLessThanOrEqual(1);
        expect(Math.abs(geometry.labelX - geometry.bodyLabelX)).toBeLessThanOrEqual(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (scale === 1 && [320, 390, 640, 1440].includes(width)) {
        await page.screenshot({ path: info.outputPath(`value-alignment-${width}.png`), animations: "disabled" });
      }
    }
  }
  await info.attach("table-alignment-matrix.json", { body: JSON.stringify(measurements), contentType: "application/json" });
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("카드의 제목·속성·펼친 본문은 화면 폭과 확대에도 같은 정렬 축을 쓴다", async ({ page }, info) => {
  const state = await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  await goApp(page, "/tasks?view=cards");
  const toggle = page.getByRole("button", { name: state.rows.tasks[0].title, exact: true });
  const card = page.getByRole("listitem").filter({ has: toggle });
  await toggle.click();
  await expect(card.getByText(state.rows.tasks[0].body, { exact: true })).toBeVisible();
  const measurements = [];
  for (const width of widths) {
    for (const scale of [1, 1.5, 2]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(scale => { document.documentElement.style.fontSize = `${scale * 100}%`; }, scale);
      const positions = await card.evaluate(node => ({
        labels: [...node.querySelectorAll("dt")].map(el => el.getBoundingClientRect().x),
        values: [...node.querySelectorAll("dd")].map(el => el.getBoundingClientRect().x),
      }));
      measurements.push({ width, scale, ...positions });
      for (const axis of [positions.labels, positions.values]) {
        expect(Math.max(...axis) - Math.min(...axis), JSON.stringify({ width, scale, positions })).toBeLessThanOrEqual(1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (scale === 1 && [320, 390, 1440].includes(width)) {
        await page.screenshot({ path: info.outputPath(`card-value-alignment-${width}.png`), animations: "disabled" });
      }
    }
  }
  await info.attach("card-alignment-matrix.json", { body: JSON.stringify(measurements), contentType: "application/json" });
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});
