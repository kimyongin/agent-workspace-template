import { expect } from "@playwright/test";
import { devLogin, env, mcpClient, mcpTokenViaConsent, ownedWorkspace, test, workspacePath } from "./support.ts";

test("검색 대기 안내는 상태 점검과 관리자 문의로 연결하고 대기가 해제되면 숨긴다", async ({ page }) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  let pending = 23;
  await page.route(
    `${env.VITE_API_URL}/search`,
    (route) =>
      route.fulfill({
        json: {
          items: [],
          next_cursor: null,
          anchor_page: null,
          search_state: "ok",
          semantic_coverage: { pending, excluded: 0, failed: 0 },
        },
      }),
  );
  await page.goto(workspacePath(workspace.id, "/search?q=대기점검"));
  const link = page.getByRole("link", { name: "상태에서 오래 갱신되지 않은 대기 확인" });
  await expect(link).toBeVisible();
  await expect(page.getByText("대기 중인 자료와 기록은 의미 검색 결과에 빠질 수 있습니다.", { exact: false })).toContainText(
    "관리자에게 색인 서비스 점검",
  );
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await link.click();
  await expect(page.getByRole("heading", { name: "상태", exact: true })).toBeVisible();
  pending = 0;
  await page.goto(workspacePath(workspace.id, "/search?q=대기해제"));
  await expect(link).toHaveCount(0);
});

test("색인 대기: 문제 목록이 비어도 오래 갱신되지 않은 준비 상태와 점검 안내를 표시하고 새로고침으로 해제한다", async ({ page }) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
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
  await page.goto(workspacePath(workspace.id, "/status"));
  const waiting = page.getByRole("status").filter({ hasText: "준비 상태 갱신" });
  await expect(
    waiting.locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: /^갱신 지연 기준$/ }) }).locator(
      "dd",
    ),
  ).toHaveText("15분");
  await expect(
    waiting.locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: /^오래 갱신되지 않은 기록$/ }) })
      .locator("dd"),
  ).toHaveText("23개");
  await expect(waiting).toContainText("실패로 확정된 상태는 아닙니다");
  await expect(waiting).toContainText("관리자에게 색인 서비스 점검");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  prolonged = false;
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(waiting).toHaveCount(0);
});

test("상태: 실제 인증 HTTP·OAuth MCP 집계와 lazy 기본 접힘, 차트 키보드 선택과 정확한 값·색인 문제 탐색", async ({ page }) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  let issuesRequests = 0;
  page.on("request", (r) => {
    if (r.url().includes("/status/indexing/issues")) issuesRequests++;
  });
  try {
    await page.goto(workspacePath(workspace.id, "/status"));
    await expect(page.getByRole("heading", { name: "상태", level: 1 })).toBeVisible();
    await expect(page.getByRole("heading", { name: "현재 자료·최근 활동", exact: true })).toBeVisible();
    expect(issuesRequests).toBe(0);
    const toggle = page.getByRole("button", { name: /^색인 문제/ });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const response = await mcp.call("get_status", {});
    await expect(page.getByRole("region", { name: "기록 색인 현황", exact: true })).toContainText(
      `전체 기록 ${response.indexing.total.toLocaleString("ko-KR")}개`,
    );
    await expect(page.getByText("집계 기준과 날짜별 값", { exact: true })).toHaveCount(0);
    const originalViewport = page.viewportSize()!;
    const refresh = page.getByRole("button", { name: "새로고침", exact: true });
    await expect(refresh).toHaveText("");
    await expect(refresh.locator("svg")).toBeVisible();
    const refreshSize = (await refresh.boundingBox())!;
    expect(refreshSize.width).toBeGreaterThanOrEqual(44);
    expect(refreshSize.height).toBeGreaterThanOrEqual(44);
    await expect(page.getByRole("slider")).toHaveCount(0);
    const charts = page.getByRole("group", { name: /그래프: 막대를 누르거나 방향키로 날짜 선택/ });
    await expect(charts).toHaveCount(5);
    const metrics = [
      (day: typeof response.daily[number]) => ({ 등록: `${day.entities_created}건` }),
      (day: typeof response.daily[number]) => ({
        생성: `${day.tasks_created}건`,
        "일회성 완료": `${day.once_completed}건`,
      }),
      (day: typeof response.daily[number]) => ({ 작성: `${day.records_created}건` }),
      (day: typeof response.daily[number]) => ({
        완료: `${day.indexing.indexed}건`,
        "준비 중": `${day.indexing.preparing}건`,
        "확인 필요": `${day.indexing.attention}건`,
        "대상 제외": `${day.indexing.excluded}건`,
      }),
    ];
    metrics.push((day) => ({
      완료: `${day.entity_indexing.indexed}건`, "준비 중": `${day.entity_indexing.preparing}건`,
      "확인 필요": `${day.entity_indexing.attention}건`, "대상 제외": `${day.entity_indexing.excluded}건`,
    }));
    const titles = ["일별 등록", "일별 생성·완료", "일별 작성", "작성일별 현재 색인 상태", "등록일별 현재 자료 색인 상태"];
    for (let i = 0; i < metrics.length; i++) {
      const chart = charts.nth(i);
      const region = page.getByRole("region", { name: titles[i], exact: true });
      const detail = region.getByRole("table", { name: `${titles[i]} 날짜별 수치`, exact: true });
      for (const [key, dayIndex] of [["Home", 0], ["End", response.daily.length - 1]] as const) {
        await chart.press(key);
        const chosen = response.daily[dayIndex];
        await expect(region.locator("time")).toHaveText(chosen.date);
        for (const [label, value] of Object.entries(metrics[i](chosen))) {
          const row = detail.getByRole("row").filter({
            has: page.getByRole("rowheader", { name: label, exact: true }),
          });
          await expect(row.getByRole("cell")).toHaveText(
            value.replace(/(\d+)건/, (_, n) => `${Number(n).toLocaleString("ko-KR")}건`),
          );
        }
      }
      await chart.press("Home");
      await chart.press("ArrowRight");
      await expect(region.locator("time")).toHaveText(response.daily[1].date);
      await chart.press("ArrowLeft");
      await chart.press("ArrowLeft");
      await expect(region.locator("time")).toHaveText(response.daily[0].date);
    }
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect.poll(() => issuesRequests).toBe(1);
    await expect(page.getByText("색인 문제 조회 중…")).toHaveCount(0);
    await expect(page.getByRole("navigation", { name: "색인 문제 페이지", exact: true })).toBeVisible();
    const mcpIssues = await mcp.call("list_indexing_issues", {});
    expect(mcpIssues.items.length).toBeLessThanOrEqual(5);
    expect(await page.getByRole("table", { name: "색인 문제 항목", exact: true }).getByRole("heading").count())
      .toBeLessThanOrEqual(5);
    await page.getByRole("button", { name: "새로고침", exact: true }).click();
    await expect(page.getByRole("button", { name: /^색인 문제/ })).toHaveAttribute("aria-expanded", "false");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const width of [320, 639, 640, 1440]) {
      await page.setViewportSize({ width, height: originalViewport.height });
      await expect(page.getByRole("region", { name: "자료 현황", exact: true })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    await page.setViewportSize(originalViewport);
  } finally {
    await mcp.close();
  }
});

test("색인 문제: 실제 상태 화면에서 다수·마지막 페이지·이전·오류 재시도·긴 제목", async ({ page }) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  let calls = 0, fail = true;
  const item = (n: number) => ({
    kind: "record",
    path: `/records/20261011-ABCDEF${n}${n}`,
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
  await page.goto(workspacePath(workspace.id, "/status"));
  await expect(page.getByRole("heading", { name: "현재 자료·최근 활동", exact: true })).toBeVisible();
  expect(calls).toBe(0);
  const toggle = page.getByRole("button", { name: /^색인 문제/ });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("색인 문제를 조회하지 못했습니다");
  await page.getByRole("button", { name: "다시 시도" }).click();
  await expect(page.getByRole("link", { name: /^(문제\d|새 조회의 문제)/ })).toHaveCount(5);
  await expect(page.getByRole("button", { name: "이전", exact: true })).toBeDisabled();
  const detail = page.getByRole("button", { name: /^열기: 문제0 / }).first();
  await detail.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByText("실패나 성공으로 확정할 수 없습니다", { exact: false }).first()).toBeVisible();
  await expect(
    page.locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: /^현재 구간 전송 시도$/ }) }).locator(
      "dd",
    ).first(),
  ).toHaveText("5회");
  await expect(
    page.locator("dl > div").filter({ has: page.locator("dt").filter({ hasText: /^본문 구간$/ }) }).locator("dd")
      .first(),
  ).toHaveText("1/2 완료");
  await page.getByRole("button", { name: "다음", exact: true }).click();
  await expect(page.getByRole("link", { name: /^(문제\d|새 조회의 문제)/ })).toHaveCount(1);
  await expect(page.getByRole("button", { name: "다음", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "이전", exact: true }).click();
  await expect(page.getByRole("link", { name: /^(문제\d|새 조회의 문제)/ })).toHaveCount(5);
  const size = await page.getByRole("button", { name: "다음", exact: true }).boundingBox();
  expect(size!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("button", { name: "새로고침", exact: true }).click();
  await expect(page.getByRole("button", { name: /^색인 문제/ })).toHaveAttribute("aria-expanded", "false");
});

test("색인 문제: 접기와 새로고침은 오래된 요청을 취소하고 늦은 결과를 표시하지 않는다", async ({ page }) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  let calls = 0;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const item = {
    kind: "record",
    path: "/records/20261011-ABCDEF00",
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
  await page.goto(workspacePath(workspace.id, "/status"));
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
