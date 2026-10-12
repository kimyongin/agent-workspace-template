import { expect } from "@playwright/test";
import { test, devLogin, env, mcpClient, mcpTokenViaConsent } from "./support.ts";

test("검색 대기 안내는 상태 점검과 관리자 문의로 연결하고 대기가 해제되면 숨긴다", async ({ page }) => {
  await devLogin(page);
  let pending = 23;
  await page.route(
    `${env.VITE_API_URL}/search`,
    (route) =>
      route.fulfill({
        json: { items: [], next_cursor: null, anchor_page: null, search_state: "ok", semantic_coverage: { pending, excluded: 0 } },
      }),
  );
  await page.goto("/search?q=대기점검");
  const link = page.getByRole("link", { name: "상태에서 오래 갱신되지 않은 대기 확인" });
  await expect(link).toBeVisible();
  await expect(page.getByText("대기 중인 기록은 의미 검색 결과에 빠질 수 있습니다.", { exact: false })).toContainText(
    "관리자에게 색인 서비스 점검",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await link.click();
  await expect(page.getByRole("heading", { name: "상태", exact: true })).toBeVisible();
  pending = 0;
  await page.goto("/search?q=대기해제");
  await expect(link).toHaveCount(0);
});

test("색인 대기: 문제 목록이 비어도 오래 갱신되지 않은 준비 상태와 점검 안내를 표시하고 새로고침으로 해제한다", async ({ page }) => {
  await devLogin(page);
  let prolonged = true;
  await page.route(`${env.VITE_API_URL}/status`, async (route) => {
    const response = await route.fetch(), data = await response.json();
    data.indexing.waiting = {
      long_waiting: prolonged ? 23 : 0,
      oldest_waiting_since: prolonged ? "2026-10-10T14:00:00.000Z" : null,
      threshold_minutes: 15,
    };
    await route.fulfill({ response, json: data });
  });
  await page.goto("/status");
  const waiting = page.getByRole("status").filter({ hasText: "준비 상태 갱신" });
  await expect(waiting).toContainText("15분 이상 없는 기록 23개");
  await expect(waiting).toContainText("실패로 확정된 상태는 아닙니다");
  await expect(waiting).toContainText("관리자에게 색인 서비스 점검");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  prolonged = false;
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(waiting).toHaveCount(0);
});

test("상태: 실제 인증 HTTP·OAuth MCP 집계와 lazy 기본 접힘, 그래프 클릭·터치·키보드 선택 및 설정 디자인", async ({ page, isMobile }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  let issuesRequests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/status/indexing/issues")) issuesRequests++;
  });
  try {
    await page.goto("/status");
    await expect(page.getByRole("heading", { name: "상태", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "현재 자료·최근 활동", exact: true })).toBeVisible();
    expect(issuesRequests).toBe(0);
    const toggle = page.getByRole("button", { name: /^색인 문제/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const response = await mcp.call("get_status", {});
    await expect(page.getByText(`전체 기록 ${response.indexing.total.toLocaleString("ko-KR")}개 · 현재 상태`))
      .toBeVisible();
    await expect(page.getByText("집계 기준과 날짜별 값", { exact: true })).toHaveCount(0);
    const originalViewport = page.viewportSize()!;
    const refresh = page.getByRole("button", { name: "새로고침", exact: true });
    await expect(refresh).toHaveText("");
    await expect(refresh.locator("svg")).toBeVisible();
    const refreshSize = (await refresh.boundingBox())!;
    expect(refreshSize.width).toBeGreaterThanOrEqual(44);
    expect(refreshSize.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("slider")).toHaveCount(0);
    const charts = page.getByRole("button", { name: /그래프: 막대를 누르거나 방향키로 날짜 선택/ });
    await expect(charts).toHaveCount(4);
    const metrics = [
      (day: typeof response.daily[number]) => `등록 ${day.entities_created}건`,
      (day: typeof response.daily[number]) => `생성 ${day.tasks_created}건 · 일회성 완료 ${day.once_completed}건`,
      (day: typeof response.daily[number]) => `작성 ${day.records_created}건`,
      (day: typeof response.daily[number]) =>
        `완료 ${day.indexing.indexed}건 · 준비 중 ${day.indexing.preparing}건 · 확인 필요 ${day.indexing.attention}건 · 대상 제외 ${day.indexing.excluded}건`,
    ];
    for (let i = 0; i < metrics.length; i++) {
      const chart = charts.nth(i);
      const detail = chart.locator("..").locator(".status-day-detail");
      for (const dayIndex of [0, response.daily.length - 1]) {
        await chart.scrollIntoViewIfNeeded();
        const box = (await chart.boundingBox())!;
        const x = box.width * (dayIndex + .5) / response.daily.length;
        if (isMobile) await page.touchscreen.tap(box.x + x, box.y + box.height / 2);
        else await chart.click({ position: { x, y: box.height / 2 } });
        const chosen = response.daily[dayIndex];
        await expect(detail).toHaveText(`${chosen.date} · ${metrics[i](chosen)}`);
      }
      await chart.focus();
      await page.keyboard.press("Home");
      await expect(detail).toContainText(response.daily[0].date);
      await page.keyboard.press("ArrowRight");
      await expect(detail).toContainText(response.daily[1].date);
      await page.keyboard.press("ArrowLeft");
      await expect(detail).toContainText(response.daily[0].date);
      await page.keyboard.press("ArrowLeft");
      await expect(detail).toContainText(response.daily[0].date);
      await page.keyboard.press("End");
      await expect(detail).toContainText(response.daily.at(-1).date);
    }
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => issuesRequests).toBe(1);
    await expect(page.getByText("색인 문제 조회 중…")).toHaveCount(0);
    expect(await page.locator(".status-issue-list > li").count()).toBeLessThanOrEqual(5);
    const mcpIssues = await mcp.call("list_indexing_issues", {});
    expect(mcpIssues.items.length).toBeLessThanOrEqual(5);
    await page.getByRole("button", { name: "새로고침", exact: true }).click();
    await expect(page.getByRole("button", { name: /^색인 문제/ })).toHaveAttribute("aria-expanded", "false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const styles = async (section: string, title: string) =>
      page.evaluate(({ section, title }) => {
        const pick = (selector: string, properties: string[]) => {
          const style = getComputedStyle(document.querySelector(selector)!);
          return properties.map((property) => style.getPropertyValue(property));
        };
        const pageBox = document.querySelector(".app-main > .panel")!.getBoundingClientRect();
        const titleBox = document.querySelector(".page-title")!.getBoundingClientRect();
        const firstSectionBox = document.querySelector(section)!.getBoundingClientRect();
        return {
          layout: {
            titleHeight: titleBox.height,
            titleOffset: titleBox.top - pageBox.top,
            firstSectionOffset: firstSectionBox.top - pageBox.top,
            titleToSectionGap: firstSectionBox.top - titleBox.bottom,
          },
          page: pick(".app-main > .panel", ["width", "gap", "padding"]),
          heading: pick(".page-title", ["font-size", "line-height", "font-weight", "color"]),
          section: pick(section, [
            "background-color",
            "padding",
            "border-width",
            "border-color",
            "border-radius",
            "gap",
          ]),
          title: pick(title, ["font-size", "line-height", "font-weight", "color"]),
        };
      }, { section, title });
    for (const width of [320, 639, 640, 1440]) {
      await page.setViewportSize({ width, height: originalViewport.height });
      await page.goto("/settings");
      await expect(page.getByRole("heading", { name: "설정", level: 1 })).toBeVisible();
      const settingsStyle = await styles(".settings-section", ".settings-section-title");
      await page.goto("/status");
      await expect(page.getByRole("heading", { name: "현재 자료·최근 활동", exact: true })).toBeVisible();
      expect(await styles(".status-section", ".status-section-title")).toEqual(settingsStyle);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.setViewportSize(originalViewport);
  } finally {
    await mcp.close();
  }
});

test("색인 문제: 실제 상태 화면에서 다수·마지막 페이지·이전·오류 재시도·긴 제목", async ({ page }) => {
  await devLogin(page);
  let calls = 0, fail = true;
  const item = (n: number) => ({
    id: `20261011-ABCDEF${n}${n}`,
    created_at: "2026-10-11T00:00:00.000Z",
    title: `문제${n} ` + "긴제목".repeat(24),
    reason: "provider_unknown",
    attempts: 5,
    chunks: { total: 2, succeeded: 1, preparing: 0, unknown: 1, failed: 0 },
  });
  // Mock only the network boundary for otherwise hard-to-reproduce diagnostic/error states.
  await page.route(`${env.VITE_API_URL}/status/indexing/issues**`, async (route) => {
    calls++;
    if (fail) {
      fail = false;
      await route.fulfill({ status: 503, json: { code: "unavailable", message: "fixture failure" } });
      return;
    }
    const last = new URL(route.request().url()).searchParams.has("cursor");
    await route.fulfill({
      json: {
        items: last ? [item(5)] : Array.from({ length: 5 }, (_, n) => item(n)),
        next_cursor: last ? null : "last-page",
      },
    });
  });
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "현재 자료·최근 활동", exact: true })).toBeVisible();
  expect(calls).toBe(0);
  const toggle = page.getByRole("button", { name: /^색인 문제/ });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("색인 문제를 조회하지 못했습니다");
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.locator(".status-issue-list > li")).toHaveCount(5);
  await expect(page.getByRole("button", { name: "이전", exact: true })).toBeDisabled();
  const detail = page.locator(".status-issue-list summary").first();
  await detail.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("실패나 성공으로 확정할 수 없습니다", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("현재 구간 전송 시도 5회 · 본문 구간 1/2 완료").first()).toBeVisible();
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.locator(".status-issue-list > li")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "다음", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await expect(page.locator(".status-issue-list > li")).toHaveCount(5);
  const size = await page.getByRole("button", { name: "다음", exact: true }).boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.getByRole("button", { name: /^색인 문제/ })).toHaveAttribute("aria-expanded", "false");
});

test("색인 문제: 접기와 새로고침은 오래된 요청을 취소하고 늦은 결과를 표시하지 않는다", async ({ page }) => {
  await devLogin(page);
  let calls = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const item = {
    id: "20261011-ABCDEF00",
    created_at: "2026-10-11T00:00:00.000Z",
    title: "새 조회의 문제",
    reason: "configuration",
    attempts: 1,
    chunks: { total: 1, succeeded: 0, preparing: 0, unknown: 0, failed: 1 },
  };
  await page.route(`${env.VITE_API_URL}/status/indexing/issues**`, async (route) => {
    const first = ++calls === 1;
    if (first) await held;
    try {
      await route.fulfill({
        json: { items: [{ ...item, title: first ? "오래된 요청의 문제" : item.title }], next_cursor: null },
      });
    } catch { /* Aborted requests may no longer accept a response. */ }
  });
  await page.goto("/status");
  await expect(page.getByRole("heading", { name: "현재 자료·최근 활동", exact: true })).toBeVisible();
  const toggle = page.getByRole("button", { name: /^색인 문제/ });
  await toggle.click();
  await expect.poll(() => calls).toBe(1);
  await expect(page.getByText("색인 문제 조회 중…")).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByText("새 조회의 문제")).toBeVisible();
  release();
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.getByRole("heading", { name: "현재 자료·최근 활동", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^색인 문제/ })).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByText("오래된 요청의 문제")).toHaveCount(0);
});
