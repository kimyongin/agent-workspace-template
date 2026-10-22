import { fixtureWorkspacePath } from "./support/workspace-scope.ts";
import { readFileSync } from "node:fs";
import { expect, type Locator, type Page, test } from "@playwright/test";
import { fixtures } from "./support/workspace-screens.ts";
import { fixtureType } from "./support/workspace-data.ts";
import { closeDetail } from "./ui-actions.ts";

test.beforeAll(() => {
  const built = new URL("../test-results/query-layout-dist/", import.meta.url);
  expect(readFileSync(new URL("404.html", built), "utf8")).toBe(readFileSync(new URL("index.html", built), "utf8"));
});

for (const width of [320, 390, 640, 1440]) {
  test(`built query ${width}px: type, search and filters remain usable without overflow`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`/agent-workspace-template${fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}`)}`);
    const picker = page.getByRole("combobox", { name: "자료 종류", exact: true });
    await expect(picker).toBeEnabled();
    const search = page.getByRole("textbox", { name: "자료 제목 검색", exact: true });
    const filter = page.getByRole("button", { name: "필터 열기", exact: true });
    const p = (await picker.locator('xpath=ancestor::*[@data-slot="input-group"][1]').boundingBox())!,
      s = (await search.boundingBox())!,
      f = (await filter.boundingBox())!;
    expect(p.y + p.height).toBeLessThanOrEqual(s.y + 1);
    expect(f.y, "filter belongs beside search, not over the type selector").toBeCloseTo(s.y, 0);
    expect(s.x + s.width).toBeLessThanOrEqual(f.x + 1);
    expect(p.x + p.width).toBeCloseTo(f.x + f.width, 0);
    await filter.click();
    await expect(page.getByRole("button", { name: "조건 초기화", exact: true })).toBeVisible();
    const panel =
      (await page.locator("[data-slot=card]").filter({ has: page.getByRole("heading", { name: "필터", exact: true }) })
        .boundingBox())!;
    expect(panel.y).toBeGreaterThanOrEqual(s.y + s.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`built-query-${width}.png`) });
    expect(state.writes).toHaveLength(0);
  });
}

async function separated(page: Page, upper: Locator, lower: Locator, min: number, max: number) {
  const a = await upper.elementHandle(), b = await lower.elementHandle();
  if (!a || !b) throw new Error("간격을 확인할 두 구획이 필요합니다");
  // A route/view change may restore scroll between calls; measure both rectangles in the same frame.
  const { gap, rem } = await page.evaluate(([upper, lower]) => {
    const a = upper!.getBoundingClientRect(), b = lower!.getBoundingClientRect();
    return { gap: b.top - a.bottom, rem: parseFloat(getComputedStyle(document.documentElement).fontSize) };
  }, [a, b]);
  await a.dispose();
  await b.dispose();
  expect(gap, "서로 다른 구획이 붙거나 과하게 벌어지지 않는다").toBeGreaterThanOrEqual(min * rem - 1);
  expect(gap, "구획 사이의 여백이 일정한 범위를 유지한다").toBeLessThanOrEqual(max * rem + 1);
}

const lists = [
  ["tasks", "할 일", "검색어"],
  ["records", "기록", "검색어"],
  ["entities", "검사 자료", "자료 제목 검색"],
] as const;

for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
  test(`주 목록 구획 간격 ${width}px: 빈 결과와 항목이 있어도 같은 묶음 유지`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width, height: 1000 });
    for (const [kind, label, searchName] of lists) {
      const rows: unknown[] = state.rows[kind];
      const original = [...rows];
      rows.length = 0;
      const path = kind === "entities" ? `/entities?entity_type_id=${fixtureType.id}` : `/${kind}`;
      await page.goto(`/agent-workspace-template${fixtureWorkspacePath(path)}`);
      const list = page.getByRole("region", { name: `${label} 목록`, exact: true });
      const search = page.getByRole("textbox", { name: searchName, exact: true });
      const filter = page.getByRole("button", { name: "필터 열기", exact: true });
      await expect(list.getByRole("heading", { level: 2 })).toContainText("0개");
      await page.screenshot({ path: info.outputPath(`${kind}-empty-${width}.png`) });
      await separated(page, filter, list, 1, 1.5);
      const s = (await search.boundingBox())!, f = (await filter.boundingBox())!;
      expect(f.y).toBeCloseTo(s.y, 0);
      expect(f.height).toBeGreaterThanOrEqual(44);
      expect(f.x + f.width - s.x).toBeLessThanOrEqual(width);
      const views = list.getByRole("radiogroup", { name: `${label} 보기 방식`, exact: true });
      await expect(views).toBeVisible();
      await separated(page, views, list.getByText(/^(아직|조건에 맞는).+없습니다\.$/), 0.5, 1);
      for (const toggle of await views.getByRole("radio").all()) {
        const box = (await toggle.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      rows.push(...original);
      await page.reload();
      await expect(list.getByRole("heading", { level: 2 })).toContainText("1개");
      await separated(page, filter, list, 1, 1.5);
      await page.screenshot({ path: info.outputPath(`${kind}-populated-${width}.png`) });
      await filter.click();
      const panel = page.locator("[data-slot=card]").filter({
        has: page.getByRole("heading", { name: "필터", exact: true }),
      });
      await separated(page, panel, list, 1, 1.5);
      if (width === 390 || width === 1440) {
        await page.screenshot({ path: info.outputPath(`${kind}-filters-${width}.png`) });
      }
      await page.getByRole("button", { name: "필터 닫기", exact: true }).click();
      await separated(page, filter, list, 1, 1.5);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    expect(state.writes).toHaveLength(0);
  });
}

for (const width of [320, 640]) {
  for (const scale of [150, 200]) {
    test(`주 목록 구획 간격 ${width}px ${scale}%: 확대와 보기 전환`, async ({ page }, info) => {
      const state = await fixtures(page);
      await page.unroute("http://127.0.0.1:55580/**");
      await page.setViewportSize({ width, height: 1000 });
      for (const [kind, label] of lists) {
        await page.goto(
          `/agent-workspace-template${
            fixtureWorkspacePath(kind === "entities" ? `/entities?entity_type_id=${fixtureType.id}` : `/${kind}`)
          }`,
        );
        const list = page.getByRole("region", { name: `${label} 목록`, exact: true });
        await expect(list.getByRole("heading", { level: 2 })).toContainText("1개");
        await page.evaluate((scale) => document.documentElement.style.fontSize = `${scale}%`, scale);
        const filter = page.getByRole("button", { name: "필터 열기", exact: true });
        await separated(page, filter, list, 1, 1.5);
        await list.getByRole("radio", { name: "카드", exact: true }).click();
        await separated(page, filter, list, 1, 1.5);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await page.screenshot({ path: info.outputPath(`${kind}-${scale}-${width}.png`) });
      }
      expect(state.writes).toHaveLength(0);
    });
  }
}

for (const width of [390, 1440]) {
  test(`자료 설정 헤더 묶음 ${width}px: 네 탭의 제목·선택·설명이 한 구획`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width, height: 1000 });
    for (const target of ["materials", "relations", "issuers", "data-model"]) {
      await page.goto(`/agent-workspace-template${fixtureWorkspacePath(`/settings/${target}`)}`);
      const title = page.getByRole("heading", { name: "자료 설정", exact: true, level: 1 });
      const heading = title.locator("xpath=ancestor::header[1]");
      const tabs = page.getByRole("tablist", { name: "자료 설정 항목", exact: true });
      await expect(tabs).toBeVisible();
      await separated(page, heading, tabs, 0.5, 1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`settings-${target}-${width}.png`) });
    }
    expect(state.writes).toHaveLength(0);
  });
}

for (const width of [320, 390, 640, 1440]) {
  test(`통합검색 조작 정렬 ${width}px: 입력·검색·필터가 같은 행`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/agent-workspace-template${fixtureWorkspacePath("/search")}`);
    const input = page.getByRole("textbox", { name: "검색어", exact: false });
    const submit = page.getByRole("button", { name: "검색", exact: true });
    const filter = page.getByRole("button", { name: "필터 열기", exact: true });
    await expect(input).toBeVisible();
    const a = (await input.boundingBox())!, b = (await submit.boundingBox())!, c = (await filter.boundingBox())!;
    expect(b.y).toBeCloseTo(a.y, 0);
    expect(c.y).toBeCloseTo(a.y, 0);
    expect(a.x + a.width).toBeLessThan(b.x);
    expect(b.x + b.width).toBeLessThan(c.x);
    await input.fill("검사");
    await submit.click();
    await expect(page).toHaveURL(/q=/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`search-actions-${width}.png`) });
    await page.evaluate(() => document.documentElement.style.fontSize = "200%");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const control of [input, submit, filter]) {
      const box = (await control.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: info.outputPath(`search-actions-200-${width}.png`) });
    expect(state.writes).toHaveLength(0);
  });
}

test("구획 간격은 상세 복귀와 데스크톱에서 모바일 전환 후에도 유지된다", async ({ page }) => {
  const state = await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/agent-workspace-template${fixtureWorkspacePath("/tasks")}`);
  const list = page.getByRole("region", { name: "할 일 목록", exact: true });
  const filter = page.getByRole("button", { name: "필터 열기", exact: true });
  await expect(list.getByRole("heading", { level: 2 })).toContainText("1개");
  await list.getByRole("link", { name: "할 일 상세", exact: true }).click();
  await expect(page.getByRole("complementary", { name: "상세 작업 영역", exact: true })).toBeVisible();
  await closeDetail(page, "할 일");
  await separated(page, filter, list, 1, 1.5);
  for (const width of [390, 640, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await separated(page, filter, list, 1, 1.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  expect(state.writes).toHaveLength(0);
});

for (const width of [390, 1440]) {
  test(`주변 화면 간격 시각 검수 ${width}px`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width, height: 1000 });
    for (
      const [path, title] of [
        ["settings", "기본 설정"],
        ["settings/records", "기록 설정"],
        ["settings/tags", "태그 설정"],
        ["search", "검색"],
        ["status", "상태"],
      ]
    ) {
      await page.goto(`/agent-workspace-template${fixtureWorkspacePath(`/${path}`)}`);
      await expect(page.getByRole("heading", { name: title, exact: true, level: 1 })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`audit-${path.replaceAll("/", "-")}-${width}.png`) });
    }
    expect(state.writes).toHaveLength(0);
  });
}
