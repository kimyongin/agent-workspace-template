import { expect, type Page, type TestInfo } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, ownedWorkspace, test, workspacePath } from "./support.ts";
import { closeDetail, detailDialog, openMainNavigation } from "./ui-actions.ts";

async function setup(page: Page) {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const client = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  const marker = `공유검색${crypto.randomUUID()}`;
  const kind = await client.call("create_entity_type", { label: "검색 본문 자료" });
  await workspace.grantKind(kind.id);
  const document = await client.call("export_data_model", {});
  const definition = document.entity_types.find((item: { schema: Record<string, unknown> }) =>
    item.schema["x-type-id"] === kind.id
  );
  definition.schema.properties.prop_1["x-search-text"] = true;
  definition.schema.properties.prop_1.title = "검색본문";
  const input = { mode: "update", document: JSON.stringify(document) };
  const review = await client.call("preview_data_model", input);
  const change = await client.call("prepare_data_model", { ...input, preview_fingerprint: review.fingerprint });
  expect((await client.call("apply_data_model", { id: change.id, expected_version: change.version })).status).toBe(
    "applied",
  );
  const entity = await client.call("create_entity", {
    entity_type_id: kind.id,
    schema_version: 2,
    properties: { prop_1: marker },
  });
  const task = await client.call("create_task", { kind: "once", title: "공유 검색 수행" });
  const completed = await client.call("complete_task", { id: task.id, expected_version: task.version, body: marker });
  return { workspace, client, marker, entity, record: completed.record, kind };
}

async function navigate(page: Page, name: string) {
  await openMainNavigation(page);
  await page.getByRole("navigation", { name: "주 메뉴", exact: true }).getByRole("link", { name, exact: true }).click();
}

async function snapshot(page: Page, info: TestInfo, name: string) {
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('[aria-busy="true"]').filter({ visible: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const path = info.outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true, animations: "disabled", caret: "hide" });
  await info.attach(name, { path, contentType: "image/png" });
}

test(
  "actual search and status: selected entity original, record READ revocation, charts and scaled layout",
  async ({ page }, info) => {
    const { workspace, client, marker, entity, record } = await setup(page);
    await page.goto(workspacePath(workspace.id, `/search?q=${encodeURIComponent(marker)}&kind=entity&mode=keyword`));
    const entityLink = page.locator(`[id="search-entity-${entity.id}"]`);
    await expect(entityLink).toBeVisible();
    await expect(page.getByRole("table", { name: "검색 결과" })).toContainText("검색본문");
    await snapshot(page, info, "selected-entity-keyword-result");
    await entityLink.click();
    await expect(detailDialog(page).getByText(marker, { exact: true }).first()).toBeVisible();
    await snapshot(page, info, "selected-entity-readable-original");
    await closeDetail(page, entity.title);
    await expect(entityLink).toBeFocused();
    await page.goto(
      workspacePath(
        workspace.id,
        `/search?q=${encodeURIComponent(marker)}&kind=record&record_kind=result&mode=keyword`,
      ),
    );
    await expect(page.locator(`[id="search-record-${record.id}"]`)).toBeVisible();
    await workspace.setTaskAccess("none");
    const refreshed = page.waitForResponse((response) =>
      response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/api/search")
    );
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await refreshed;
    await expect(page.locator(`[id="search-record-${record.id}"]`)).toHaveCount(0);
    await expect(page.getByText("검색 결과가 없습니다.", { exact: true })).toBeVisible();
    await workspace.setTaskAccess("read");
    await page.goto(workspacePath(workspace.id, "/status"));
    await expect(page.getByRole("region", { name: "할 일 현황", exact: true })).toBeVisible();
    const oracle = await client.call("get_status", {});
    await expect(
      page.getByRole("region", { name: "할 일 현황", exact: true }).getByText(`${oracle.tasks.total}개`, {
        exact: true,
      }),
    ).toBeVisible();
    const graph = page.getByRole("group", {
      name: "일별 등록 그래프: 막대를 누르거나 방향키로 날짜 선택",
      exact: true,
    });
    const date = graph.locator("..").locator("time");
    await graph.press("Home");
    await graph.press("ArrowRight");
    const selectedDate = await date.getAttribute("datetime");
    const statusRefresh = page.waitForResponse((response) =>
      response.request().method() === "GET" && new URL(response.url()).pathname.endsWith("/api/status")
    );
    await page.getByRole("button", { name: "새로고침", exact: true }).click();
    await (await statusRefresh).finished();
    await expect(page.locator('[aria-busy="true"]').filter({ visible: true })).toHaveCount(0);
    await expect(date).toHaveAttribute("datetime", selectedDate!);
    const initialViewport = page.viewportSize()!;
    for (const [width, scale] of [[320, 150], [1440, 100]]) {
      await page.setViewportSize({ width, height: 1000 });
      // Layout-only probe, without modifying saved personal Auth metadata.
      await page.evaluate(
        (value) => document.documentElement.style.setProperty("--display-scale", String(value / 100)),
        scale,
      );
      await expect.poll(() => page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize)))
        .toBeCloseTo(16 * scale / 100, 1);
      await expect(date).toHaveAttribute("datetime", selectedDate!);
      for (const table of await page.getByRole("table", { name: /날짜별 수치$/ }).all()) {
        expect(await table.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
      }
      // Page width alone misses SVG labels clipped inside their chart viewport.
      await expect.poll(() => page.locator('[data-slot="chart"]').evaluateAll((charts) =>
        charts.every((chart) => {
          const viewport = chart.querySelector("svg.recharts-surface")?.getBoundingClientRect();
          return viewport && [...chart.querySelectorAll(".recharts-cartesian-axis-tick-value")].every((tick) => {
            const bounds = tick.getBoundingClientRect();
            return bounds.left >= viewport.left - 1 && bounds.right <= viewport.right + 1;
          });
        })
      )).toBe(true);
      await page.getByRole("heading", { name: "상태", exact: true, level: 1 }).scrollIntoViewIfNeeded();
      await snapshot(page, info, `current-status-${width}-${scale}`);
      await page.getByRole("region", { name: "자료 색인 현황", exact: true }).scrollIntoViewIfNeeded();
      await snapshot(page, info, `current-indexing-${width}-${scale}`);
    }
    await page.setViewportSize(initialViewport);
    await page.evaluate(() => document.documentElement.style.removeProperty("--display-scale"));
  },
);

test("actual status: delayed previous-workspace response never replaces the new workspace", async ({ page }, info) => {
  const { workspace, marker } = await setup(page);
  await page.goto(workspacePath(workspace.id, "/tasks"));
  const other = await ownedWorkspace(page);
  const entered = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  let held = false;
  const handling: Promise<void>[] = [];
  await page.route("**/api/status", (route) => {
    const run = async () => {
      if (held || route.request().headers()["x-workspace-id"] !== workspace.id) return await route.continue();
      held = true;
      const response = await route.fetch();
      entered.resolve();
      await release.promise;
      await route.fulfill({ response });
    };
    const pending = run();
    handling.push(pending);
    return pending;
  });
  try {
    await page.goto(workspacePath(workspace.id, "/status"));
    await entered.promise;
    await openMainNavigation(page);
    await page.getByRole("button", { name: "공간 선택", exact: true }).click();
    await page.getByRole("menu").locator(`a[href="${workspacePath(other.id)}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/w/${other.id}/tasks$`));
    await expect(page.getByRole("heading", { name: "할 일", exact: true, level: 1 })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "주 메뉴", exact: true, includeHidden: true })).toHaveCount(0);
    await navigate(page, "상태");
    await expect(page.getByText("아직 보관한 자료가 없습니다.", { exact: true })).toBeVisible();
    release.resolve();
    await Promise.all(handling);
    await expect(page).toHaveURL(new RegExp(`/w/${other.id}/status$`));
    await expect(page.getByText("아직 보관한 자료가 없습니다.", { exact: true })).toBeVisible();
    await expect(page.getByText(marker, { exact: true })).toHaveCount(0);
    await snapshot(page, info, "current-workspace-after-delayed-response");
  } finally {
    release.resolve();
    await Promise.all(handling);
    await page.unroute("**/api/status");
  }
});
