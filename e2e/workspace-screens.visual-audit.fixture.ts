import { openDialogs, openMainNavigation } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { entityKey, fixtureType, id, stamp } from "./support/workspace-data.ts";
import { fixtures, go } from "./support/workspace-screens.ts";

// Render the real App shell with isolated API data, rather than the reduced detail fixture shell.
for (const width of [390, 1440]) {
  test(`전체 화면 시각 조사 ${width}px: 실제 탐색 shell·설정·조회·상세`, async ({ page }, info) => {
    test.setTimeout(120_000);
    const state = await fixtures(page);
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width, height: 900 });
    await page.route(
      "**/api/entity-types/*/schemas**",
      (route) =>
        route.fulfill({
          json: { items: [{ type_id: fixtureType.id, schema_version: 1, created_at: stamp }], next_cursor: null },
        }),
    );
    await page.route(
      "**/api/entity-types/*/schema-changes**",
      (route) => route.fulfill({ json: { items: [], next_cursor: null } }),
    );
    await page.route(
      "**/api/entity-schema-migrations**",
      (route) => route.fulfill({ json: { items: [], next_cursor: null } }),
    );
    await page.route("**/api/entity-issuers**", (route) =>
      route.fulfill({
        json: {
          items: route.request().url().includes("/rules")
            ? [{
              id: id(701),
              source: "app",
              label: "자동 발급",
              meaning: "앱 번호",
              generation: "automatic",
              active: true,
              version: 1,
            }]
            : [{ code: "app", label: "앱", active: true, system: true, version: 1 }],
        },
      }));
    await page.route("**/api/status", (route) =>
      route.fulfill({
        json: {
          timezone: "Asia/Seoul",
          queried_at: stamp,
          period: { from: "2026-09-16", to: "2026-10-15", days: 30 },
          entities: { total: 12, active: 10, deleted: 2 },
          tasks: { total: 8, open: 4, done: 2, active: 2, stopped: 0 },
          records: { total: 20, user: 10, result: 5, change: 5 },
          indexing: {
            total: 20,
            indexed: 18,
            preparing: 1,
            attention: 1,
            excluded: 0,
            waiting: { long_waiting: 0, oldest_waiting_since: null, threshold_minutes: 15 },
          },
          daily: Array.from(
            { length: 30 },
            (_, n) => ({
              date: new Date(Date.UTC(2026, 8, 16 + n)).toISOString().slice(0, 10),
              entities_created: n % 3,
              tasks_created: n % 4,
              once_completed: n % 2,
              records_created: n % 5,
              indexing: { indexed: n % 4, preparing: n % 2, attention: 0, excluded: 0 },
            }),
          ),
        },
      }));
    const paths = [
      ["entities", "/entities"],
      ["tasks", "/tasks"],
      ["records", "/records"],
      ["search", "/search"],
      ["status", "/status"],
      ["guide", "/guide"],
      ["settings", "/settings"],
      ["material-create", "/settings/entity-types"],
      ["material", `/settings/entity-types/${fixtureType.id}`],
      ["tags", "/settings/tags"],
      ["record-settings", "/settings/records"],
      ["issuers", "/settings/issuers"],
      ["entity-detail", `/entities/${encodeURIComponent(entityKey(1))}`],
      ["task-detail", `/tasks/${id(2)}`],
      ["record-detail", `/records/${id(3)}`],
      ["missing-page", "/unknown-page"],
    ];
    for (const [name, path] of paths) {
      await go(page, path);
      await expect(page.locator("h1").first()).toBeVisible();
      if (width < 1024 && name.endsWith("-detail")) {
        await expect(openDialogs(page)).toHaveCount(1);
        await expect(page.getByRole("navigation", { name: "주 메뉴", exact: true })).toHaveCount(0);
      } else {
        await openMainNavigation(page);
        if (width < 1024) {
          await page.getByRole("button", { name: "메뉴 닫기", exact: true }).click();
          await expect(page.getByRole("dialog", { name: "주 메뉴", exact: true })).toHaveCount(0);
        }
      }
      await expect(page.getByRole("status").filter({ hasText: /로그인 상태를 확인/ })).toHaveCount(0);
      const introduction = name.endsWith("-detail")
        ? page.locator('[role="dialog"] [data-slot="dialog-description"]')
        : name === "missing-page" ? page.locator('[data-slot="empty-description"]')
        : page.getByRole("heading", { level: 1 }).first().locator("xpath=ancestor::header[1]").locator(":scope > p");
      await expect(introduction).toHaveCount(1);
      await expect(introduction).toBeVisible();
      expect(await introduction.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
      if (name === "status") await expect(page.getByRole("region", { name: "자료 현황" })).toBeVisible();
      if (name === "status") {
        await expect(page.getByRole("table", { name: /날짜별 수치$/ })).toHaveCount(4);
      }
      if (name === "material") {
        const menu = page.getByRole("button", { name: "설정 메뉴", exact: true });
        await expect(menu.locator("svg")).toBeVisible();
        const target = await menu.evaluate(node => node.getBoundingClientRect().toJSON());
        expect(target.width).toBeGreaterThanOrEqual(44);
        expect(target.height).toBeGreaterThanOrEqual(44);
        for (const title of ["기본 정보", "자료 번호", "입력 항목"]) {
          await page.getByRole("button", { name: title, exact: true }).click();
        }
      }
      if (name.endsWith("-detail")) {
        for (const list of await page.locator("[data-slot='item-group']:empty").all()) {
          expect(await list.evaluate((node) => getComputedStyle(node).borderTopWidth)).toBe("0px");
        }
      }
      if (name === "record-settings") {
        await expect(page.getByRole("textbox", { name: "메모 템플릿", exact: true })).toBeVisible();
      }
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`), fullPage: true });
      await info.attach(`${name}-${width}`, {
        body: Buffer.from(await page.locator("main").innerText()),
        contentType: "text/plain",
      });
    }
    for (
      const [name, path] of [
        ["entity-filters", "/entities?filters=1"],
        ["task-filters", "/tasks?filters=1"],
        ["search-results", "/search?q=기록&kind=record&mode=keyword"],
        ["record-filters", "/records?filters=1"],
        ["entity-cards", "/entities?view=cards"],
        ["entity-table", "/entities?view=table"],
        ["record-calendar", "/records?view=calendar"],
        ["entity-create", "/entities?create=1"],
        ["task-create", "/tasks?create=1"],
        ["record-create", "/records?create=1"],
        ["entity-edit", `/entities/${encodeURIComponent(entityKey(1))}?edit=1`],
        ["record-edit", `/records/${id(3)}?edit=1`],
      ]
    ) {
      await go(page, path);
      if (name.endsWith("-create") || name.endsWith("-edit")) {
        await expect(page.getByRole("textbox").first()).toBeVisible();
        await expect(page.locator('[role="dialog"] [data-slot="dialog-description"]')).toBeVisible();
      }
      if (name.endsWith("-filters")) await expect(page.getByRole("heading", { name: "필터", exact: true })).toBeVisible();
      if (name === "record-calendar") await expect(page.getByRole("region", { name: "기록 달력", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), name).toBe(true);
      await page.screenshot({ path: info.outputPath(`${name}-${width}.png`) });
    }
    await go(page, `/tasks/${id(2)}?edit=1`);
    await page.getByRole("textbox", { name: /^제목/ }).fill("보호할 변경 내용");
    const closeEditor = () =>
      width >= 1280
        ? page.getByRole("button", { name: "할 일 탭 닫기", exact: true }).click({ timeout: 5000 })
        : openDialogs(page).last().getByRole("button", { name: "닫기", exact: true }).click({
          timeout: 5000,
        });
    await closeEditor();
    const confirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true });
    await expect(confirm).toBeVisible();
    await page.screenshot({ path: info.outputPath(`confirmation-${width}.png`) });
    await confirm.getByRole("button", { name: "취소", exact: true }).click();
    await expect(page.getByRole("textbox", { name: /^제목/ })).toHaveValue("보호할 변경 내용");
    await closeEditor();
    await page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true }).getByRole("button", {
      name: "변경 버리기",
      exact: true,
    }).click();
    await go(page, "/settings");
    await page.getByRole("button", { name: "설정 메뉴", exact: true }).click();
    await expect(page.getByRole("menu", { name: "설정 메뉴", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`settings-menu-${width}.png`) });
    await page.keyboard.press("Escape");
    await openMainNavigation(page);
    await page.getByRole("button", { name: /^내 프로필/ }).click();
    await expect(page.locator('[role="menu"]')).toBeVisible();
    await page.screenshot({ path: info.outputPath(`profile-menu-${width}.png`) });
    expect(state.errors).toEqual([]);
    expect(state.writes).toHaveLength(0);
  });
}

for (const width of [390, 1440]) {
  test(`빈 목록과 조회 실패 시각 조사 ${width}px: 안내·재시도·읽기 순서`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.unroute("http://127.0.0.1:55580/**");
    await page.setViewportSize({ width, height: 900 });
    state.rows.tasks.length = 0;
    await go(page, "/tasks");
    await expect(page.getByText("아직 할 일이 없습니다.", { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`empty-tasks-${width}.png`) });
    state.failRead({ kind: "tasks" }, { status: 503 });
    await page.reload();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await page.screenshot({ path: info.outputPath(`failed-tasks-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(state.writes).toHaveLength(0);
  });
  test(`로그인 화면 시각 조사 ${width}px: 인증 전 읽기와 주요 행동`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: "로그인", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Google로 로그인", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`login-${width}.png`) });
  });
}

test("상태의 실제 수치와 선택 날짜는 폭·글자 확대에서도 정확히 읽힌다", async ({ page }, info) => {
  await fixtures(page);
  await page.unroute("http://127.0.0.1:55580/**");
  const day = (date: string, amount: number) => ({ date, entities_created: amount, tasks_created: amount, once_completed: 0, records_created: amount, indexing: { indexed: amount, preparing: 0, attention: 0, excluded: 0 } });
  await page.route("**/api/status", route => route.fulfill({ json: {
    timezone: "Asia/Seoul", queried_at: stamp, period: { from: "2026-10-14", to: "2026-10-15", days: 2 },
    entities: { total: 2, active: 2, deleted: 0 }, tasks: { total: 1, open: 1, done: 0, active: 0, stopped: 0 },
    records: { total: 2, user: 2, result: 0, change: 0 }, indexing: { total: 2, indexed: 1, preparing: 0, attention: 1, excluded: 0, waiting: { long_waiting: 1, oldest_waiting_since: stamp, threshold_minutes: 15 } },
    daily: [day("2026-10-14", 0), day("2026-10-15", 2)],
  } }));
  await go(page, "/status");
  const graph = page.getByRole("group", { name: "일별 등록 그래프: 막대를 누르거나 방향키로 날짜 선택", exact: true });
  const values = page.getByRole("table", {name:"일별 등록 날짜별 수치",exact:true});
  await graph.press("Home");
  await expect(values.getByRole("cell")).toHaveText(["0건"]);
  await graph.press("ArrowRight");
  await expect(values.getByRole("cell")).toHaveText(["2건"]);
  await expect(page.getByRole("region", {name:"자료 현황",exact:true})).toContainText("2개");
  for (const width of [320, 1440]) {
    await page.setViewportSize({width,height:1000});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await expect(values.getByRole("cell")).toHaveText(["2건"]);
    await page.screenshot({path:info.outputPath(`status-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:320,height:1000});
  await page.evaluate(()=>document.documentElement.style.fontSize="200%");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await expect(values.getByRole("cell")).toHaveText(["2건"]);
  await page.screenshot({path:info.outputPath("status-320-text200.png"),fullPage:true});
});
