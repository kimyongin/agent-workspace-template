// Actual App and routing; remote Auth/API are isolated, with no DB or real-account writes.
import { expect, test, type Page } from "@playwright/test";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const stamp = "2026-10-08T03:00:00Z";
const base = (n: number) => ({ id: id(n), version: 1, created_at: stamp, updated_at: stamp, tag_ids: [] });
const task = { ...base(2), title: "다음 상담 준비", body: "필요한 자료를 준비합니다.", kind: "once", status: "open", due_on: "2026-10-12", timezone: null, recurrence: null, completed_at: null, result_record_id: null, pauses: [], occurrence: null, result_record: null, entity_ids: [id(1)], entity_context: [{ id: id(1), title: "김민수", source: "selection", captured_at: stamp }] };
const record = { ...base(3), body: "상담 내용을 정리하고 다음 방문 일정을 확인했습니다.", occurred_at: stamp, record_kind: "user", task_id: id(2), entity_ids: [id(1)], entity_context: task.entity_context, task_occurrence_on: null, change: null, source: "web" };
const entity = { ...base(1), prop1: "김민수", prop2: 0, prop3: "2026-10-08", prop4: "a", tasks: { count: 1, items: [task] }, records: { count: 1, items: [record] } };
const user = { id: id(100), aud: "authenticated", email: "fixture@example.test", app_metadata: {}, user_metadata: { workspace_timezone: "Asia/Seoul" } };

async function fixture(page: Page, records = [record]) {
  const reads: string[] = [], errors: string[] = [], writes: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(user => localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: "fixture", refresh_token: "fixture", expires_at: Math.floor(Date.now() / 1000) + 3600, user })), user);
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace(/^\/api/, "");
    if (url.pathname.startsWith("/api/")) {
      reads.push(request.url()); if (request.method() !== "GET") writes.push(request.method());
      if (path.startsWith("/tags")) return route.fulfill({ json: { items: [], next_cursor: null } });
      if (path === `/entities/${entity.id}`) return route.fulfill({ json: entity });
      if (path === `/tasks/${task.id}`) return route.fulfill({ json: task });
      if (path.startsWith("/records/")) return route.fulfill({ json: records.find(item => path.endsWith(item.id)) ?? record });
      const items = path === "/entities" ? [entity] : path === "/tasks" ? [task] : path === "/records" ? records : [];
      const offset = Number(url.searchParams.get("cursor") ?? 0);
      return route.fulfill({ json: { items: items.slice(offset, offset + 20), next_cursor: items.length > offset + 20 ? String(offset + 20) : null } });
    }
    if (url.pathname === "/auth/v1/user") return route.fulfill({ json: user });
    if (url.port === "55586") return route.continue();
    return route.abort();
  });
  return { reads, errors, writes };
}

for (const [kind, label, title] of [["entities", "엔터티", entity.prop1], ["tasks", "할 일", task.title], ["records", "기록", record.body]] as const) test(`${kind}: views keep filters, list reads and disclosure/detail return`, async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/${kind}`);
  const list = page.getByRole("region", { name: `${label} 목록`, exact: true });
  const modes = list.getByRole("radiogroup", { name: `${label} 보기 방식` });
  await expect(list.getByRole("heading", { name: `${label} (1개)`, exact: true })).toBeVisible();
  const readCount = state.reads.filter(url => new URL(url).pathname === `/api/${kind}`).length;
  for (const mode of ["카드", "테이블", "리스트"]) {
    await modes.getByRole("radio", { name: mode, exact: true }).click();
    await expect(modes.getByRole("radio", { name: mode, exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(list.getByRole("button", { name: title, exact: true })).toBeVisible();
  }
  expect(state.reads.filter(url => new URL(url).pathname === `/api/${kind}`).length).toBe(readCount);
  await modes.getByRole("radio", { name: "테이블", exact: true }).click();
  await list.getByRole("button", { name: title, exact: true }).click();
  await list.getByRole("link", { name: `${title} 상세`, exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page).toHaveURL(/view=table/);
  await expect(list.getByRole("button", { name: title, exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "필터 열기" }).click();
  await page.getByRole("button", { name: "조건 초기화" }).click();
  await expect(modes.getByRole("radio", { name: "테이블", exact: true })).toHaveAttribute("aria-checked", "true");
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test("related sections switch independently and return from a linked detail", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/entities/${entity.id}`);
  const dialog = page.getByRole("dialog"), tasks = dialog.getByRole("region", { name: "할 일 (1개)" }), records = dialog.getByRole("region", { name: "기록 (1개)" });
  await tasks.getByRole("radio", { name: "카드", exact: true }).click();
  await records.getByRole("radio", { name: "테이블", exact: true }).click();
  await tasks.getByRole("button", { name: task.title, exact: true }).click();
  await tasks.getByRole("link", { name: `${task.title} 상세`, exact: true }).click();
  await dialog.getByRole("button", { name: /^이전:/ }).click();
  await expect(tasks.getByRole("radio", { name: "카드", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(records.getByRole("radio", { name: "테이블", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.goto(`/records/${record.id}`);
  await expect(dialog.getByRole("radiogroup", { name: "엔터티 보기 방식" })).toBeVisible();
  await expect(dialog.getByRole("radiogroup", { name: "할 일 보기 방식" })).toBeVisible();
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test("empty and failed lists keep truthful counts and retry in every view", async ({ page }) => {
  const state = await fixture(page);
  let failed = true;
  await page.route("**/api/records?**", route => failed
    ? route.fulfill({ status: 503, json: { code: "internal", message: "fixture read failed" } })
    : route.fulfill({ json: { items: [], next_cursor: null } }));
  await page.goto("/records");
  await expect(page.getByRole("alert")).toContainText("기록을 불러오지 못했습니다");
  await expect(page.locator(".collection-heading h2")).toHaveText("기록");
  const before = state.reads.length;
  for (const mode of ["카드", "테이블", "캘린더"]) {
    await page.getByRole("radio", { name: mode, exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
  }
  expect(state.reads.length).toBe(before);
  failed = false; await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.locator(".collection-heading h2")).toHaveText("기록 (0개)");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test("calendar uses display dates, keyboard month edges, partial pages and saved selection", async ({ page }) => {
  const rows = Array.from({ length: 21 }, (_, n) => ({ ...record, ...base(200 + n), body: `기록 ${n}`, occurred_at: n === 0 ? "2026-10-07T15:30:00Z" : "2026-09-30T15:30:00Z" }));
  const state = await fixture(page, rows);
  await page.goto("/records?view=calendar");
  await expect(page.getByRole("heading", { name: "기록 (20개+)" })).toBeVisible();
  const day = page.getByRole("button", { name: "2026-10-08, 불러온 기록 1개", exact: true });
  await expect(day).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("불러온 기록만 표시합니다.", { exact: false })).toBeVisible();
  await day.press("ArrowLeft"); await expect(page.getByRole("button", { name: "2026-10-07, 불러온 기록 0개", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "2026-10-01, 불러온 기록 19개", exact: true }).click();
  await page.getByRole("button", { name: "2026-10-01, 불러온 기록 19개", exact: true }).press("ArrowLeft");
  await expect(page.getByRole("heading", { name: "2026년 9월", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "다음 달", exact: true }).click();
  await page.getByRole("button", { name: "2026-10-08, 불러온 기록 1개", exact: true }).click();
  await page.getByRole("button", { name: "기록 더 보기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "기록 (21개)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "2026-10-01, 불러온 기록 20개", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "기록 0", exact: true }).click();
  await page.getByRole("link", { name: "기록 0 상세", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page).toHaveURL(/calendar_day=2026-10-08/);
  await expect(day).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "2026-10-01, 불러온 기록 20개", exact: true }).click();
  await page.getByRole("radio", { name: "리스트", exact: true }).click();
  await page.getByRole("button", { name: "기록 0", exact: true }).click();
  await page.getByRole("radio", { name: "캘린더", exact: true }).click();
  await expect(day).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "기록 0", exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "2026-10-01, 불러온 기록 20개", exact: true }).click();
  await expect(page).not.toHaveURL(/open=/);
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test("all layouts fit narrow/wide screens and large text, with quiet icon controls", async ({ page }, info) => {
  const state = await fixture(page);
  for (const width of [320, 390, 640, 1440]) for (const kind of ["entities", "tasks", "records"]) {
    await page.setViewportSize({ width, height: 844 });
    for (const view of ["list", "cards", "table", ...(kind === "records" ? ["calendar"] : [])]) {
      await page.goto(`/${kind}?view=${view}`); await expect(page.locator(".collection-heading h2")).toContainText("1개");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (view === "calendar") {
        const target = await page.locator(".calendar-days button").first().boundingBox();
        expect(target!.width).toBeGreaterThanOrEqual(44); expect(target!.height).toBeGreaterThanOrEqual(44);
      }
      if (view === "table") for (const cell of await page.locator(".collection-numeric").all()) {
        expect(await cell.evaluate(el => getComputedStyle(el).textAlign)).toBe("right");
        expect(await cell.evaluate(el => getComputedStyle(el).fontVariantNumeric)).toBe("tabular-nums");
      }
      await page.screenshot({ path: info.outputPath(`${kind}-${view}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/tasks?view=table");
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const modes = page.getByRole("radiogroup", { name: "할 일 보기 방식" });
  await modes.getByRole("radio", { name: "테이블" }).press("Home");
  await expect(modes.getByRole("radio", { name: "리스트" })).toBeFocused();
  const style = await modes.getByRole("radio", { name: "리스트" }).evaluate(el => { const r = el.getBoundingClientRect(), face = el.querySelector("span")!.getBoundingClientRect(); return { width: r.width, height: r.height, face: face.width }; });
  expect(style.width).toBeGreaterThanOrEqual(44); expect(style.height).toBeGreaterThanOrEqual(44); expect(style.face).toBe(22);
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

test("table rows and headers share the same columns across wrapper types and viewports", async ({ page }) => {
  const rows = [record, { ...record, ...base(4), body: "짧은 기록" }, { ...record, ...base(5), body: "아주 긴 한국어 기록을 제목처럼 표시할 때에도 날짜와 종류의 열은 흔들리지 않아야 합니다." }];
  const state = await fixture(page, rows);
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) for (const kind of ["entities", "tasks", "records"]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(`/${kind}?view=table`);
    await expect(page.locator(".collection-table-head")).toBeVisible();
    const geometry = await page.locator(".collection-table").evaluate(table => {
      const header = table.querySelector(".collection-table-head")!;
      const box = (el: Element) => ({ left: el.getBoundingClientRect().left, width: el.getBoundingClientRect().width });
      return { head: box(header), columns: Array.from(header.children).map(box), rows: Array.from(table.querySelectorAll(".related-item-title")).map(row => ({ box: box(row), columns: Array.from(row.children).map(box) })) };
    });
    for (const row of geometry.rows) {
      expect(Math.abs(row.box.width - geometry.head.width)).toBeLessThan(1);
      for (const [index, cell] of row.columns.entries()) {
        expect(Math.abs(cell.left - geometry.columns[index].left)).toBeLessThan(1);
        expect(Math.abs(cell.width - geometry.columns[index].width)).toBeLessThan(1);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.goto(`/entities/${entity.id}`);
  const section = page.getByRole("dialog").getByRole("region", { name: "기록 (1개)", exact: true });
  await section.getByRole("radio", { name: "테이블", exact: true }).click();
  const widths = await section.evaluate(el => [el.querySelector(".collection-table-head")!.getBoundingClientRect().width, el.querySelector(".related-item-title")!.getBoundingClientRect().width]);
  expect(Math.abs(widths[0] - widths[1])).toBeLessThan(1);
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});
