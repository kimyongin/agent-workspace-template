import { expect, test } from "@playwright/test";
import { fixtures, form, go } from "./support/workspace-screens.ts";
import { id } from "./support/workspace-data.ts";

test("회차 조회 실패: 로딩을 끝내고 같은 기간에서 다시 조회한다", async ({ page }, info) => {
  const state = await fixtures(page);
  Object.assign(state.rows.tasks[0], {
    kind: "recurring",
    status: "active",
    timezone: "Asia/Seoul",
    recurrence: { freq: "daily", starts_on: "2026-10-01", ends_on: null },
  });
  const reads: URL[] = [];
  let fail = true;
  await page.route("**/api/tasks/*/occurrences?**", (route) => {
    reads.push(new URL(route.request().url()));
    return fail ? route.fulfill({ status: 503, json: { code: "internal", message: "일시 실패" } }) : route.fulfill({
      json: { today: "2026-10-07", items: [{ date: "2026-10-07", status: "due", record_ids: [], in_rule: true }] },
    });
  });
  await go(page, `/tasks/${id(2)}`);
  await expect.poll(() => reads.length).toBe(1);
  const section = form(page).getByRole("heading", { name: "회차", exact: true }).locator("..").locator("..");
  await expect(form(page)).toContainText("회차를 불러오지 못했습니다.");
  await page.screenshot({ path: info.outputPath("occurrences-failed.png"), fullPage: true });
  await expect(section.getByRole("status")).toHaveCount(0);
  fail = false;
  await section.getByRole("button", { name: "회차 다시 조회", exact: true }).click();
  await expect(section.getByRole("button", { name: "2026-10-07 회차 기록", exact: true })).toBeVisible();
  expect(reads.map((url) => url.search)).toEqual([reads[0].search, reads[0].search]);
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("기록 편집: 소속 할 일 조회 실패를 본문 초안과 같은 화면에서 복구한다", async ({ page }, info) => {
  const state = await fixtures(page);
  Object.assign(state.rows.records[0], { task_id: id(2), entity_id: null });
  let fail = true;
  await page.route(
    `**/api/tasks/${id(2)}`,
    (route) =>
      fail
        ? route.fulfill({ status: 503, json: { code: "internal", message: "일시 실패" } })
        : route.fulfill({ json: state.rows.tasks[0] }),
  );
  await go(page, `/records/${id(3)}?edit=1`);
  const editor = form(page), target = editor.getByRole("region", { name: "할 일 (1개)", exact: true });
  const body = editor.getByRole("textbox", { name: /^본문/ });
  await body.fill("조회 중에도 유지할 초안");
  await expect(target).toContainText("연결된 할 일을 불러오지 못했습니다.");
  const url = page.url();
  await target.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("record-parent-failed.png"), fullPage: true });
  fail = false;
  await target.getByRole("button", { name: "할 일 다시 조회", exact: true }).click();
  await expect(target).toContainText("할 일");
  await expect(target).toContainText("진행 중");
  await expect(body).toHaveValue("조회 중에도 유지할 초안");
  await expect(page).toHaveURL(url);
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

for (const width of [320, 1440]) {
  test(`회차 ${width}px: 과거 기간 재실패·키보드 재조회는 편집 초안과 기간을 유지한다`, async ({ page }, info) => {
    const state = await fixtures(page);
    Object.assign(state.rows.tasks[0], {
      kind: "recurring",
      status: "active",
      timezone: "Asia/Seoul",
      recurrence: { freq: "daily", starts_on: "2026-10-01", ends_on: null },
    });
    await page.setViewportSize({ width, height: 900 });
    const reads: string[] = [];
    let fail = false, release = () => {}, started = () => {}, hold = false;
    const held = new Promise<void>((resolve) => release = resolve),
      pending = new Promise<void>((resolve) => started = resolve);
    await page.route("**/api/tasks/*/occurrences?**", async (route) => {
      const url = new URL(route.request().url());
      reads.push(url.search);
      if (hold) {
        started();
        await held;
      }
      return fail ? route.fulfill({ status: 503, json: { code: "internal", message: "일시 실패" } }) : route.fulfill({
        json: {
          today: "2026-10-07",
          items: [{
            date: reads.length === 1 ? "2026-10-07" : url.searchParams.get("to"),
            status: "due",
            record_ids: [],
            in_rule: true,
          }],
        },
      });
    });
    await go(page, `/tasks/${id(2)}`);
    const section = () => form(page).getByRole("heading", { name: "회차", exact: true }).locator("..").locator("..");
    await expect(section().getByRole("table")).toBeVisible();
    fail = true;
    await section().getByRole("button", { name: "이전 기간", exact: true }).click();
    await expect(section().getByRole("alert")).toContainText("회차를 불러오지 못했습니다.");
    await form(page).getByRole("button", { name: "편집", exact: true }).click();
    const body = form(page).getByRole("textbox", { name: /^본문/ });
    await body.fill("회차 조회와 독립적인 본문 초안");
    const url = page.url(), retry = section().getByRole("button", { name: "회차 다시 조회", exact: true });
    await expect(retry).toHaveAttribute("aria-disabled", "false");
    const beforeRetry = reads.length;
    await retry.focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => reads.length).toBe(beforeRetry + 1);
    await expect(section().getByRole("alert")).toBeVisible();
    hold = true;
    fail = false;
    await retry.focus();
    await page.keyboard.press("Enter");
    await pending;
    await expect(retry).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    await expect(section().getByRole("status")).toHaveText("불러오는 중…");
    expect(reads).toHaveLength(beforeRetry + 2);
    release();
    await expect(section().getByRole("table")).toContainText("2026-10-06");
    await expect(retry).toBeFocused();
    await expect(section().getByRole("button", { name: /회차 기록$/ })).toHaveCount(0);
    await expect(body).toHaveValue("회차 조회와 독립적인 본문 초안");
    await expect(page).toHaveURL(url);
    expect(reads.slice(1).every((query) => query === reads[1])).toBe(true);
    if (width === 320) await page.evaluate(() => document.documentElement.style.fontSize = "200%");
    await retry.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`occurrence-recovered-edit-${width}.png`), fullPage: true });
    await form(page).getByRole("button", { name: "취소", exact: true }).click();
    await page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true }).getByRole("button", {
      name: "취소",
      exact: true,
    }).click();
    await expect(body).toHaveValue("회차 조회와 독립적인 본문 초안");
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

for (const kind of ["result", "task-change", "entity-change"] as const) {
  test(`기록 ${kind}: 편집 중 재실패·pending·현재 결과 조회는 귀속과 초점을 유지한다`, async ({ page }, info) => {
    const state = await fixtures(page), record = state.rows.records[0], entity = state.rows.entities[0];
    const isEntity = kind === "entity-change", parent = isEntity ? entity : state.rows.tasks[0];
    Object.assign(record, {
      entity_id: isEntity ? entity.id : null,
      task_id: isEntity ? null : id(2),
      occurrence_on: isEntity ? null : "2026-10-07",
    });
    if (kind !== "result") {
      Object.assign(record, {
        record_kind: "change",
        change: {
          event_id: id(30),
          target_kind: isEntity ? "entity" : "task",
          target_id: parent.id,
          target_title: "당시 소속 이름",
          action: "update",
          source: "http",
          before: null,
          after: null,
          path: null,
        },
      });
    }
    const original = structuredClone(record),
      path = `/api/${isEntity ? "entities" : "tasks"}/${encodeURIComponent(parent.id)}`;
    let fail = false, hold = false, release = () => {}, started = () => {}, reads = 0;
    const held = new Promise<void>((resolve) => release = resolve),
      pending = new Promise<void>((resolve) => started = resolve);
    await page.route(`**${path}`, async (route) => {
      reads++;
      if (hold) {
        started();
        await held;
      }
      return fail
        ? route.fulfill({ status: 503, json: { code: "internal", message: "일시 실패" } })
        : route.fulfill({ json: parent });
    });
    await page.setViewportSize({ width: 320, height: 900 });
    await go(page, `/records/${record.id}`);
    await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
    fail = true;
    await form(page).getByRole("button", { name: "편집", exact: true }).click();
    const editor = form(page), body = editor.getByRole("textbox", { name: /^본문/ });
    await body.fill("유지할 본문 초안");
    const section = editor.getByRole("region", { name: `${isEntity ? "자료" : "할 일"} (1개)`, exact: true });
    await expect(section).toContainText("불러오지 못했습니다.");
    const retry = section.getByRole("button", {
      name: kind === "result" ? "할 일 다시 조회" : "현재 대상 다시 조회",
      exact: true,
    });
    const url = page.url(), beforeRetry = reads;
    await retry.click();
    await expect.poll(() => reads).toBe(beforeRetry + 1);
    await expect(retry).toHaveAttribute("aria-disabled", "false");
    hold = true;
    fail = false;
    await retry.focus();
    await page.keyboard.press("Enter");
    await pending;
    await expect(retry).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Enter");
    expect(reads).toBe(beforeRetry + 2);
    release();
    await expect(section.getByRole("status")).toHaveCount(0);
    await expect(section).not.toContainText("불러오지 못했습니다.");
    await expect(retry).toBeFocused();
    if (kind === "result") await expect(section).toContainText("진행 중");
    else await expect(section).toContainText("당시 소속 이름");
    await expect(section.getByRole("link")).toHaveCount(0);
    await expect(section.getByRole("button", { name: /연결|해제|상세/ })).toHaveCount(0);
    await expect(body).toHaveValue("유지할 본문 초안");
    await expect(page).toHaveURL(url);
    expect(record).toEqual(original);
    await page.evaluate(() => document.documentElement.style.fontSize = "200%");
    await retry.scrollIntoViewIfNeeded();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath(`record-recovery-${kind}-320-200.png`), fullPage: true });
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

for (const outcome of ["success", "failure"] as const) {
  test(`회차 늦은 ${outcome}: 다른 할 일에 이전 결과·오류를 섞지 않는다`, async ({ page }) => {
    const state = await fixtures(page);
    const recurring = {
      kind: "recurring",
      status: "active",
      timezone: "Asia/Seoul",
      recurrence: { freq: "daily", starts_on: "2026-10-01", ends_on: null },
    };
    Object.assign(state.rows.tasks[0], recurring);
    state.rows.tasks.push({ ...state.rows.tasks[0], id: id(40), title: "다음 반복 할 일" });
    let release = () => {}, start = () => {};
    const held = new Promise<void>((resolve) => release = resolve),
      pending = new Promise<void>((resolve) => start = resolve);
    await page.route("**/api/tasks/*/occurrences?**", async (route) => {
      if (new URL(route.request().url()).pathname.includes(id(40))) {
        return route.fulfill({ json: { today: "2026-10-07", items: [] } });
      }
      start();
      await held;
      return (outcome === "success"
        ? route.fulfill({
          json: { today: "2026-10-07", items: [{ date: "2026-10-04", status: "done", record_ids: [], in_rule: true }] },
        })
        : route.fulfill({ status: 503, json: { code: "internal", message: "늦은 실패" } })).catch(() => {});
    });
    await go(page, `/tasks/${id(2)}`);
    await pending;
    await page.getByRole("link", { name: "할 일 fixture", exact: true, includeHidden: true }).evaluate((
      node: HTMLAnchorElement,
    ) => node.click());
    await page.getByRole("link", { name: "다음 반복 할 일 상세", exact: true }).click();
    const section = form(page).getByRole("heading", { name: "회차", exact: true }).locator("..").locator("..");
    await expect(section).toContainText("이 기간에는 회차가 없습니다.");
    await expect(section.getByRole("status")).toHaveCount(0);
    release();
    await expect(section).not.toContainText("2026-10-04");
    await expect(section.getByRole("alert")).toHaveCount(0);
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  });
}

test("기록 편집: 재조회 중 취소한 뒤 늦은 결과가 다음 편집의 초점을 옮기지 않는다", async ({ page }) => {
  const state = await fixtures(page);
  Object.assign(state.rows.records[0], { task_id: id(2), entity_id: null });
  let hold = false, release = () => {}, start = () => {};
  const held = new Promise<void>((resolve) => release = resolve),
    pending = new Promise<void>((resolve) => start = resolve);
  await page.route(`**/api/tasks/${id(2)}`, async (route) => {
    if (!hold) return route.fulfill({ status: 503, json: { code: "internal", message: "일시 실패" } });
    start();
    await held;
    return route.fulfill({ json: { ...state.rows.tasks[0], title: "늦은 현재 제목" } }).catch(() => {});
  });
  await go(page, `/records/${id(3)}?edit=1`);
  const section = form(page).getByRole("region", { name: "할 일 (1개)", exact: true });
  await expect(section).toContainText("불러오지 못했습니다.");
  hold = true;
  await section.getByRole("button", { name: "할 일 다시 조회", exact: true }).click();
  await pending;
  const body = form(page).getByRole("textbox", { name: /^본문/ });
  await body.fill("독립 초안");
  await form(page).getByRole("button", { name: "취소", exact: true }).click();
  const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true });
  await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
  const edit = form(page).getByRole("button", { name: "편집", exact: true });
  await edit.focus();
  release();
  await expect(edit).toBeFocused();
  await expect(form(page).getByRole("textbox", { name: /^본문/ })).toHaveCount(0);
  expect(state.rows.records[0].body).not.toBe("독립 초안");
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

for (const status of [403, 404]) {
  test(`회차 ${status}: 일시 실패와 구분하고 오래된 회차를 표시하지 않는다`, async ({ page }) => {
    const state = await fixtures(page);
    Object.assign(state.rows.tasks[0], {
      kind: "recurring",
      status: "active",
      timezone: "Asia/Seoul",
      recurrence: { freq: "daily", starts_on: "2026-10-01", ends_on: null },
    });
    await page.route(
      "**/api/tasks/*/occurrences?**",
      (route) =>
        route.fulfill({
          status,
          json: { code: status === 404 ? "not_found" : "forbidden", message: "현재 조회 불가" },
        }),
    );
    await go(page, `/tasks/${id(2)}`);
    const section = form(page).getByRole("heading", { name: "회차", exact: true }).locator("..").locator("..");
    await expect(section.getByRole("alert")).toContainText("현재 할 일의 접근 권한과 상태를 확인하세요.");
    await expect(section.getByRole("status")).toHaveCount(0);
    await expect(section.getByRole("table")).toHaveCount(0);
    expect(state.writes).toEqual([]);
  });
}

test("회차 재조회: 할 일 시간대 자정을 지나도 실패한 기간을 그대로 읽는다", async ({ page }) => {
  const state = await fixtures(page);
  Object.assign(state.rows.tasks[0], {
    kind: "recurring",
    status: "active",
    timezone: "Asia/Seoul",
    recurrence: { freq: "daily", starts_on: "2026-10-01", ends_on: null },
  });
  await page.clock.setFixedTime(new Date("2026-10-07T14:59:00Z"));
  const queries: string[] = [];
  await page.route("**/api/tasks/*/occurrences?**", (route) => {
    queries.push(new URL(route.request().url()).search);
    return queries.length === 1
      ? route.fulfill({ status: 503, json: { code: "internal", message: "실패" } })
      : route.fulfill({ json: { today: "2026-10-08", items: [] } });
  });
  await go(page, `/tasks/${id(2)}`);
  const section = form(page).getByRole("heading", { name: "회차", exact: true }).locator("..").locator("..");
  await expect(section.getByRole("alert")).toBeVisible();
  await page.clock.setFixedTime(new Date("2026-10-07T15:01:00Z"));
  await section.getByRole("button", { name: "회차 다시 조회", exact: true }).click();
  await expect(section).toContainText("이 기간에는 회차가 없습니다.");
  expect(queries).toEqual(["?from=2026-09-24&to=2026-10-14", "?from=2026-09-24&to=2026-10-14"]);
  expect(state.writes).toEqual([]);
});
