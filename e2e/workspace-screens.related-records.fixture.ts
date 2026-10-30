import { businessRows } from "./table-actions.ts";
import { entityKey, fixtureType } from "./support/workspace-data.ts";
import { openListDetail } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { id, record, stamp, task } from "./support/workspace-data.ts";
import { fixtures, form, go } from "./support/workspace-screens.ts";

test("결과 작성 320px·200%: 긴 지시를 키보드로 읽고 같은 결과 초안으로 돌아온다", async ({ page }, info) => {
  const state = await fixtures(page);
  state.rows.tasks[0].title = "장비별 냉장 보관 온도를 점검하고 측정 결과를 기록합니다.";
  state.rows.tasks[0].body = `${"장비 번호와 측정값을 대조합니다.\n\n".repeat(80)}지시 마지막`;
  await page.setViewportSize({ width: 320, height: 568 });
  await go(page, `/tasks/${id(2)}?action=complete`);
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  const result = form(page), context = result.getByRole("region", { name: "기록할 할 일", exact: true });
  const body = result.getByRole("textbox", { name: /^본문/ });
  await body.fill("유지할 결과 초안");
  await context.getByRole("button", { name: "할 일 내용 확인", exact: true }).click();
  const instruction = context.getByRole("region", { name: "할 일 본문", exact: true });
  await instruction.focus();
  await page.keyboard.press("End");
  await expect.poll(() => instruction.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await expect(instruction.getByText("지시 마지막", { exact: true })).toBeInViewport();
  await page.keyboard.press("Tab");
  await expect(body).toBeFocused();
  await expect(body).toBeInViewport({ ratio: 0.99 });
  await expect(body).toHaveValue("유지할 결과 초안");
  const save = result.getByRole("button", { name: "완료하고 기록 저장", exact: true });
  await expect(save).toBeInViewport({ ratio: 0.99 });
  await page.screenshot({ path: info.outputPath("task-context-keyboard-200.png"), fullPage: true });
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

for (const width of [320, 1440]) {
  for (const kind of ["once", "recurring"] as const) {
    test(
      `결과 작성 ${kind} ${width}px: 할 일 내용 확인은 초안·시각·회차와 저장 경계를 유지한다`,
      async ({ page }, info) => {
        const state = await fixtures(page);
        const title = "냉장 보관 온도 점검", instruction = "오전 측정값과 장비 번호를 확인하세요.";
        Object.assign(state.rows.tasks[0], {
          title,
          body: instruction,
          ...(kind === "recurring"
            ? {
              kind,
              status: "active",
              timezone: "Asia/Seoul",
              recurrence: { freq: "daily", starts_on: "2026-10-01", ends_on: null },
            }
            : {}),
        });
        await page.setViewportSize({ width, height: 900 });
        const action = kind === "once" ? "action=complete" : "occurrence=2026-10-07";
        await go(page, `/tasks/${id(2)}?${action}`);
        const result = form(page), context = result.getByRole("region", { name: "기록할 할 일", exact: true });
        await expect(context.getByText(title, { exact: true })).toBeVisible();
        if (kind === "recurring") await expect(context).toContainText("2026-10-07 · Asia/Seoul");
        const url = page.url(), body = result.getByRole("textbox", { name: /^본문/ });
        await body.fill("온도 4도, 작성 중인 결과");
        const date = result.getByLabel("수행 시각 날짜", { exact: true });
        await date.fill("2026-10-07");
        await result.getByLabel("수행 시각 시간", { exact: true }).fill("09:30");
        const toggle = context.getByRole("button", { name: "할 일 내용 확인", exact: true });
        await toggle.focus();
        await page.keyboard.press("Enter");
        await expect(context.getByText(instruction, { exact: true })).toBeVisible();
        await page.screenshot({ path: info.outputPath(`task-context-${kind}-${width}.png`), fullPage: true });
        await page.keyboard.press("Enter");
        await expect(toggle).toBeFocused();
        await expect(context.getByText(instruction, { exact: true })).toBeHidden();
        await expect(body).toHaveValue("온도 4도, 작성 중인 결과");
        await expect(date).toHaveValue("2026-10-07");
        await expect(page).toHaveURL(url);
        expect(state.writes).toEqual([]);
        await result.getByRole("button", { name: "취소", exact: true }).click();
        const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
        await discard.getByRole("button", { name: "취소", exact: true }).click();
        await expect(body).toHaveValue("온도 4도, 작성 중인 결과");
        await result.getByRole("button", { name: kind === "once" ? "완료하고 기록 저장" : "기록 저장", exact: true })
          .click();
        await expect(page).not.toHaveURL(/action=|occurrence=/);
        const write = state.writes.find((write) =>
          write.path.endsWith(kind === "once" ? "/complete" : "/occurrences/2026-10-07/records")
        );
        expect(write?.body.body).toBe("온도 4도, 작성 중인 결과");
        expect(write?.body).not.toHaveProperty("task_id");
        expect(state.errors).toEqual([]);
      },
    );
  }
}

test("할 일 연결 기록: 결과와 전체 기간 회차·페이지 오류 동일 cursor 재시도", async ({ page }) => {
  const state = await fixtures(page);
  const first = { ...record(20), body: "최근 수행 결과", record_kind: "result" as const, task_id: id(2) },
    old = { ...record(21), body: "오래된 회차 기록", task_id: id(2), occurrence_on: "2025-01-01" };
  state.listPages("records", [[first], [first, old]]);
  state.failRead({ kind: "records", page: 2 }, { message: "페이지 실패" });
  Object.assign(state.rows.tasks[0], {
    kind: "recurring",
    status: "active",
    timezone: "Asia/Seoul",
    recurrence: { freq: "daily", starts_on: "2026-10-01", ends_on: null },
  });
  await page.route(
    "**/api/tasks/*/occurrences?**",
    (route) => route.fulfill({ json: { today: "2026-10-07", items: [] } }),
  );
  await go(page, `/tasks/${id(2)}`);
  const related = form(page).getByRole("region", { name: /^기록 \(/ });
  await expect(related.getByRole("button", { name: first.body, exact: true })).toBeVisible();
  await related.getByRole("button", { name: "기록 더 보기" }).click();
  await expect(related.getByRole("alert")).toBeVisible();
  await expect(related.getByRole("button", { name: first.body, exact: true })).toBeVisible();
  await related.getByRole("button", { name: "기록 다시 시도" }).click();
  await expect(related.getByRole("button", { name: old.body, exact: true })).toBeVisible();
  await expect(businessRows(related.getByRole("table"))).toHaveCount(2);
  state.rows.records.push(old);
  await related.getByRole("button", { name: old.body, exact: true }).click();
  await form(page).getByRole("link", { name: old.body + " 상세", exact: true }).click();
  await form(page).getByRole("button", { name: /^이전: 할 일/ }).click();
  await expect(related.getByRole("link", { name: old.body + " 상세", exact: true })).toBeFocused();
  await expect(page).toHaveURL(/related_record_pages=2/);
  const reads = state.reads.filter((url) => new URL(url).pathname === "/api/records").map((url) =>
    new URL(url).searchParams
  );
  expect(reads[0].get("cursor")).toBeNull();
  expect(reads[1].get("cursor")).toBeTruthy();
  expect(reads[2].get("cursor")).toBe(reads[1].get("cursor"));
  for (const params of reads) {
    expect(params.get("task_id")).toBe(id(2));
    expect(params.get("limit")).toBe("20");
    expect(params.has("occurred_from")).toBe(false);
  }
  expect(state.errors).toEqual([]);
});

test("기록 연결 할 일: 제목 조회 실패 재시도와 삭제 상태", async ({ page }) => {
  const state = await fixtures(page);
  state.rows.records[0].task_id = id(2);
  let failed = true, missing = false;
  await page.route(
    `**/api/tasks/${id(2)}`,
    (route) =>
      failed
        ? route.fulfill({ status: 503, json: { code: "internal", message: "임시 실패" } })
        : missing
        ? route.fulfill({ status: 404, json: { code: "not_found", message: "없음" } })
        : route.fulfill({ json: state.rows.tasks[0] }),
  );
  await go(page, `/records/${id(3)}`);
  const section = form(page).getByRole("region", { name: "할 일 (1개)" });
  await expect(section).toContainText("불러오지 못했습니다");
  failed = false;
  await section.getByRole("button", { name: "할 일 다시 조회" }).click();
  await expect(section.getByRole("button", { name: "할 일", exact: true })).toBeVisible();
  missing = true;
  await page.reload();
  await expect(section).toContainText("삭제된 할 일 또는 접근할 수 없는 할 일");
  await expect(section.getByRole("link")).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("연결 조회 늦은 응답은 다음 할 일·기록에 섞이지 않는다", async ({ page }) => {
  const state = await fixtures(page);
  state.rows.tasks.push({ ...task(40), title: "다음 할 일" });
  state.rows.records.push({ ...record(41), body: "다음 기록", task_id: id(40) });
  state.rows.records[0].task_id = id(2);
  let release = () => {}, arrive = () => {};
  const held = new Promise<void>((resolve) => release = resolve),
    started = new Promise<void>((resolve) => arrive = resolve);
  await page.route("**/api/records?**", async (route) => {
    if (!new URL(route.request().url()).searchParams.has("task_id")) return route.fallback();
    if (new URL(route.request().url()).searchParams.get("task_id") == id(2)) {
      arrive();
      await held;
      return route.fulfill({ json: { items: [{ ...record(42), body: "오래된 조회" }], next_cursor: null } }).catch(
        () => {},
      );
    }
    return route.fulfill({ json: { items: [], next_cursor: null } });
  });
  await go(page, `/tasks/${id(2)}`);
  await started;
  await page.getByRole("link", { name: "할 일 fixture", exact: true, includeHidden: true }).evaluate((el: HTMLAnchorElement) => el.click());
  await openListDetail(page, "다음 할 일");
  await expect(form(page)).toContainText("기록 (0개)");
  release();
  await expect(form(page)).not.toContainText("오래된 조회");
  let releaseTask = () => {}, arriveTask = () => {};
  const heldTask = new Promise<void>((resolve) => releaseTask = resolve),
    startedTask = new Promise<void>((resolve) => arriveTask = resolve);
  await page.route(`**/api/tasks/${id(2)}`, async (route) => {
    arriveTask();
    await heldTask;
    return route.fulfill({ json: { ...state.rows.tasks[0], title: "오래된 할 일" } }).catch(() => {});
  });
  await go(page, `/records/${id(3)}`);
  await startedTask;
  await page.getByRole("link", { name: "기록 fixture", exact: true, includeHidden: true }).evaluate((el: HTMLAnchorElement) => el.click());
  await openListDetail(page, "다음 기록");
  await expect(form(page).getByRole("button", { name: "다음 할 일", exact: true })).toBeVisible();
  releaseTask();
  await expect(form(page)).not.toContainText("오래된 할 일");
  expect(state.errors).toEqual([]);
});

test("연결 기록 자동 복원 상한 뒤에도 수동 더 보기는 다음 cursor를 읽는다", async ({ page }) => {
  const state = await fixtures(page), cursors: number[] = [];
  await page.route("**/api/records?**", (route) => {
    const n = Number(new URL(route.request().url()).searchParams.get("cursor") ?? 0);
    cursors.push(n);
    return route.fulfill({
      json: {
        items: [{ ...record(1000 + n), body: `기록 ${n}`, task_id: id(2) }],
        next_cursor: n < 250 ? String(n + 1) : null,
      },
    });
  });
  await go(page, `/tasks/${id(2)}?related_record_pages=250`);
  const section = form(page).getByRole("region", { name: /^기록 \(/ });
  await expect(section.getByRole("button", { name: "기록 더 보기" })).toBeEnabled();
  expect(cursors).toHaveLength(250);
  await section.getByRole("button", { name: "기록 더 보기" }).click();
  await expect(section.getByRole("button", { name: "기록 250", exact: true })).toBeVisible();
  expect(cursors.at(-1)).toBe(250);
  expect(cursors).toHaveLength(251);
  expect(state.errors).toEqual([]);
});

for (const width of [320, 1440]) {
  test(`#191 수행 결과 ${width}px: 불변 할 일 귀속과 결과 본문`, async ({ page }, info) => {
    const state = await fixtures(page), t = state.rows.tasks[0];
    Object.assign(t, { entity_ids: [entityKey(1)], entity_context: [{ id: entityKey(1), title: "자료", type: fixtureType, schema_version: 1, source: "selection", captured_at: stamp }] });
    await page.setViewportSize({ width, height: 900 });
    await go(page, `/tasks/${t.id}`);
    await form(page).getByRole("button", { name: "완료하고 기록", exact: true }).click();
    const draft = form(page);
    await draft.getByRole("textbox", { name: /^본문/ }).fill("상담 내역");
    await expect(draft.getByRole("group", { name: "기록 태그", exact: true })).toHaveCount(0);
    await expect(draft.getByRole("button", { name: /^(할 일|자료) 연결$/ })).toHaveCount(0);
    await expect(draft.getByRole("searchbox")).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`record-relationships-${width}.png`) });
    await draft.getByRole("button", { name: "완료하고 기록 저장", exact: true }).click();
    await expect.poll(() => state.writes.length).toBe(1);
    expect(state.writes[0].path).toBe(`/api/tasks/${t.id}/complete`);
    expect(state.writes[0].body).toMatchObject({ body: "상담 내역", expected_version: 1 });
    for (const key of ["task_id", "entity_id", "entity_ids", "tag_ids", "change_tag_ids"]) expect(state.writes[0].body).not.toHaveProperty(key);
    const result = state.rows.records.find(row => row.id === t.result_record_id)!;
    expect(result.task_id).toBe(t.id);
    expect(result.entity_id).toBeNull();
    expect(t.entity_ids).toEqual([entityKey(1)]);
    expect(t.status).toBe("done");
    expect(state.errors).toEqual([]);
  });
}

test("#191 일반 기록 작성 URL은 불변 귀속을 우회하지 않는다", async ({ page }) => {
  const state = await fixtures(page);
  for (const path of ["/records?create=1", `/tasks/${id(2)}?action=record`, `/entities/${encodeURIComponent(entityKey(1))}?create=record`]) {
    await go(page, path);
    if (path.startsWith("/records?")) {
      await expect(page.getByRole("region", { name: "기록 목록", exact: true })).toBeVisible();
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "자료 연결", exact: true })).toHaveCount(0);
      await expect(page.getByRole("searchbox", { name: "자료 제목 검색", exact: true })).toHaveCount(0);
    }
    await expect(page.getByRole("dialog", { name: "기록 작성", exact: true })).toHaveCount(0);
    await expect(form(page).getByRole("button", { name: "기록 작성", exact: true })).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
  }
  expect(state.errors).toEqual([]);
});

test("#227 엔터티 할 일: 5건 미리보기 뒤 첫 페이지·중복 제거·같은 cursor 재시도", async ({ page }, info) => {
  const state = await fixtures(page),
    rows = Array.from({ length: 25 }, (_, i) => ({ ...task(100 + i), title: `배치 업무 ${i}` }));
  const reads: (string | null)[] = [];
  let failed = false;
  await page.route(
    `**/api/entities/${encodeURIComponent(entityKey(1))}`,
    (route) => route.fulfill({ json: { ...state.rows.entities[0], tasks: { count: 25, items: rows.slice(0, 5) } } }),
  );
  await page.route("**/api/tasks?**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    reads.push(cursor);
    if (cursor && !failed) {
      failed = true;
      return route.fulfill({ status: 503, json: { code: "internal", message: "retry" } });
    }
    return route.fulfill({
      json: cursor ? { items: rows.slice(20), next_cursor: null } : { items: rows.slice(0, 20), next_cursor: "next" },
    });
  });
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
  const section = form(page).getByRole("heading", { name: "할 일 (25개)", exact: true }).locator(
    "xpath=ancestor::section[1]",
  );
  await expect(businessRows(section.getByRole("table")).filter({ visible: true })).toHaveCount(5);
  expect(reads).toEqual([]);
  await section.getByRole("button", { name: "할 일 더 보기", exact: true }).click();
  await expect(businessRows(section.getByRole("table")).filter({ visible: true })).toHaveCount(20);
  await form(page).getByRole("button", { name: "편집", exact: true }).click();
  await expect(form(page).getByRole("textbox", { name: /^제목/ })).toBeVisible();
  await expect(businessRows(section.getByRole("table")).filter({ visible: true })).toHaveCount(20);
  await expect(section.getByRole("button", { name: /연결|작성|해제/ })).toHaveCount(0);
  await expect(section.getByRole("button", { name: "할 일 더 보기", exact: true })).toBeVisible();
  await section.getByRole("button", { name: "할 일 더 보기", exact: true }).click();
  await expect(section.getByRole("alert")).toBeVisible();
  await expect(businessRows(section.getByRole("table")).filter({ visible: true })).toHaveCount(20);
  await section.getByRole("button", { name: "할 일 다시 시도", exact: true }).click();
  await expect(businessRows(section.getByRole("table")).filter({ visible: true })).toHaveCount(25);
  await section.getByText("배치 업무 24", { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("readonly-tasks-late-page.png") });
  await form(page).getByRole("button", { name: "취소", exact: true }).click();
  await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
  await expect(businessRows(section.getByRole("table")).filter({ visible: true })).toHaveCount(25);
  expect(reads).toEqual([null, "next", "next"]);
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("반복 회차 표는 좁은 화면에서도 날짜·상태·기록 조작을 보존한다", async ({ page }, info) => {
  const state = await fixtures(page);
  Object.assign(state.rows.tasks[0], { kind: "recurring", status: "active", timezone: "Asia/Seoul", recurrence: { freq: "daily", starts_on: "2026-10-01", ends_on: null } });
  await page.route("**/api/tasks/*/occurrences?**", route => route.fulfill({ json: { today: "2026-10-07", items: [
    { date: "2026-10-07", status: "due", record_ids: [], in_rule: true },
    { date: "2026-10-06", status: "done", record_ids: [id(3)], in_rule: false },
    { date: "2026-10-08", status: "upcoming", record_ids: [], in_rule: true },
  ] } }));
  await go(page, `/tasks/${id(2)}`);
  const table = form(page).getByRole("table", { name: "반복 할 일 회차 목록", exact: true });
  await expect(table).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(4);
  await expect(table).toContainText("규칙 밖 기록");
  await expect(table).toContainText("기록 1개");
  await expect(table.getByRole("button", { name: "2026-10-08 회차 기록", exact: true })).toHaveCount(0);
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(table.getByRole("button", { name: "2026-10-07 회차 기록", exact: true })).toBeVisible();
    expect(await table.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  }
  await table.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("occurrences-320.png"), fullPage: true });
  await table.getByRole("button", { name: "2026-10-07 회차 기록", exact: true }).click();
  await expect(form(page)).toHaveAccessibleName("2026-10-07 회차 기록");
  await form(page).getByRole("button", { name: "취소", exact: true }).click();
  await expect(table.getByRole("button", { name: "2026-10-07 회차 기록", exact: true })).toBeFocused();
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});
