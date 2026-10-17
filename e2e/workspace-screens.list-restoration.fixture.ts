import { listHeader } from "./ui-actions.ts";
import { chooseTag, applyTabFilters } from "./ui-actions.ts";
import { setEntityCategory } from "./ui-actions.ts";
import { openDetailEditor, openListDetail, openListEditor, openTabFilters } from "./ui-actions.ts";
import { saveOnce } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { base, entity, fixtureSchema, id, record, stamp, task } from "./support/workspace-data.ts";
import { fixtures, form, go } from "./support/workspace-screens.ts";

for (const kind of ["entities", "records"] as const) {
  test(`${kind}: 긴 복원 중 실패는 미표시 batch까지 유효한23행을 보존`, async ({ page }) => {
    const state = await fixtures(page);
    if (kind === "entities") {
      state.listPages(
        kind,
        Array.from({ length: 250 }, (_, index) => [entity(100 + index, { prop_1: "부분 행 " + index })]),
      );
    } else {state.listPages(
        kind,
        Array.from({ length: 250 }, (_, index) => [{ ...record(100 + index), body: "부분 행 " + index }]),
      );}
    state.failRead({ kind, page: 24 }, { message: "partial restoration failure" });
    await go(page, `/${kind}?pages=250`);
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page.locator(kind === "entities" ? ".list .item-title" : `.${kind} .list .item-title`)).toHaveCount(
      23,
    );
    await expect(page.locator(kind === "entities" ? ".list .item-title" : `.${kind} .list .item-title`).last())
      .toHaveText("부분 행 22");
    expect(state.reads.filter((url) => new URL(url).pathname === "/api/" + kind)).toHaveLength(24);
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
  test(`#203 ${width}px: 검색만 상시 표시·모든 조건은 필터 열기/닫기`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.setViewportSize({ width, height: 900 });
    let reads = 0;
    page.on("request", (request) => {
      if (/\/api\/(entities|tasks|records)(\?|$)/.test(request.url())) {
        reads++;
      }
    });
    for (
      const [kind, label, value] of [["entities", "분류 필터", "b"], ["tasks", "할 일 상태", "open"], [
        "records",
        "기록 종류",
        "user",
      ]]
    ) {
      await go(page, "/" + kind);
      const filters = page.locator(".tab-filters"),
        summary = filters.getByRole("button", { name: /^필터 (열기|닫기)/ }),
        input = page.getByLabel(kind === "entities" ? "자료 제목 검색" : "검색어", { exact: true });
      await expect(input).toBeVisible();
      await expect(summary).toHaveAccessibleName("필터 열기");
      await expect(page.getByLabel(kind === "entities" ? "조건 1 값" : label, { exact: true })).toBeHidden();
      await expect(filters.getByRole("group", { name: kind === "entities" ? "자료 태그" : kind === "tasks" ? "할 일 태그" : "기록 태그", exact: true })).toBeHidden();
      await expect(filters.getByRole("combobox")).toHaveCount(0);
      if (kind === "entities") await expect(listHeader(page).getByLabel("자료 종류", { exact: true })).toBeVisible();
      await expect(page.locator(".list .related-item").first()).toBeVisible();
      const beforeReads = reads;
      await summary.focus();
      await summary.press("Enter");
      await expect(summary).toHaveAccessibleName("필터 닫기");
      await expect(summary).toHaveAttribute("aria-expanded", "true");
      expect(new URL(page.url()).searchParams.get("filters")).toBe("1");
      expect(reads).toBe(beforeReads);
      await expect(filters.getByRole("group", { name: kind === "entities" ? "자료 태그" : kind === "tasks" ? "할 일 태그" : "기록 태그", exact: true })).toBeVisible();
      const changedRead = page.waitForResponse((response) => new URL(response.url()).pathname === `/api/${kind}`);
      if (kind === "entities") await setEntityCategory(page, value);
      else { await page.getByLabel(label, { exact: true }).selectOption(value); await applyTabFilters(page); }
      await changedRead;
      await expect(summary).toHaveAccessibleName(/적용 중/);
      const applied = page.url(), appliedReads = reads;
      await summary.click();
      await expect(summary).toHaveAccessibleName("필터 열기 · 적용 중");
      const closed = new URL(page.url()), prior = new URL(applied);
      prior.searchParams.delete("filters");
      expect(closed.href).toBe(prior.href);
      expect(reads).toBe(appliedReads);
      await expect(page.getByLabel(kind === "entities" ? "조건 1 값" : label, { exact: true })).toBeHidden();
      await expect(input).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 390) await page.screenshot({ path: info.outputPath(kind + "-filters-390.png") });
    }
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

test("#203 목록은 여러 항목을 독립적으로 펼침·필터 변경은 초기화·실패 GET은 편집 없음", async ({ page }) => {
  const state = await fixtures(page);
  state.rows.tasks.push({ ...task(50), title: "두 번째 할 일" });
  await go(page, "/tasks");
  const first = page.getByRole("button", { name: "할 일", exact: true }),
    second = page.getByRole("button", { name: "두 번째 할 일", exact: true });
  await first.click();
  await second.click();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(second).toHaveAttribute("aria-expanded", "true");
  expect(new URL(page.url()).searchParams.getAll("open")).toHaveLength(2);
  await page.reload();
  await expect(first).toHaveAttribute("aria-expanded", "true");
  await expect(second).toHaveAttribute("aria-expanded", "true");
  await first.click();
  await expect(first).toHaveAttribute("aria-expanded", "false");
  await expect(second).toHaveAttribute("aria-expanded", "true");
  await openTabFilters(page);
  await page.getByLabel("할 일 상태", { exact: true }).selectOption("open");
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect(second).toHaveAttribute("aria-expanded", "false");
  expect(new URL(page.url()).searchParams.has("open")).toBe(false);
  await page.route(
    `**/api/tasks/${id(50)}`,
    (route) => route.fulfill({ status: 503, json: { code: "internal", message: "조회 실패" } }),
  );
  await second.click();
  await expect(page.getByText("내용을 불러오지 못했습니다.")).toBeVisible();
  await expect(page.getByRole("link", { name: "두 번째 할 일 상세", exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("#203 긴 펼침 GET 뒤에 목록 scroll·초점을 복원", async ({ page }) => {
  const state = await fixtures(page);
  state.rows.tasks[0].body = "긴 본문 문단\n\n".repeat(180);
  await page.setViewportSize({ width: 390, height: 800 });
  await go(page, "/tasks");
  const toggle = page.getByRole("button", { name: "할 일", exact: true });
  await toggle.click();
  await expect(page.getByRole("link", { name: "할 일 상세", exact: true })).toBeVisible();
  await toggle.evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + scrollY - 20));
  const scroll = await page.evaluate(() => scrollY);
  expect(scroll).toBeGreaterThan(100);
  await page.getByRole("link", { name: "할 일 상세", exact: true }).click();
  await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
  let release = () => {};
  const held = new Promise<void>((resolve) => release = resolve);
  await page.route(`**/api/tasks/${id(2)}`, async (route) => {
    await held;
    return route.fulfill({ json: state.rows.tasks[0] });
  });
  await form(page).getByRole("button", { name: "닫기", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  release();
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(scroll);
  await expect(toggle).toBeFocused();
  expect(state.errors).toEqual([]);
  expect(state.writes).toHaveLength(0);
});

test("검색: IME·300ms·옛 keyword URL도 auto·할 일 scope·clear 초점", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, "/tasks?kind=once&status=open&mode=keyword");
  const input = page.getByLabel("검색어", { exact: true });
  await input.dispatchEvent("compositionstart");
  await input.fill("한글");
  await input.press("Enter");
  await page.waitForTimeout(350);
  expect(state.searches).toHaveLength(0);
  await input.dispatchEvent("compositionend");
  await expect.poll(() => state.searches.length).toBe(1);
  expect(state.searches[0].kinds).toEqual(["task"]);
  expect(state.searches[0].mode).toBe("auto");
  expect(state.searches[0].task_kind).toBe("once");
  expect(state.searches[0].task_status).toBe("open");
  await expect(page.getByLabel("검색 방식", { exact: true })).toHaveCount(0);
  await expect(page.getByText("의미 검색을 사용할 수 없어 키워드 검색 결과를 표시합니다.")).toHaveCount(1);
  await expect(page.getByText("의미 색인 대기 1개 · 제외 0개")).toBeVisible();
  await page.getByRole("button", { name: "검색어 지우기" }).click();
  await expect(page).not.toHaveURL(/q=/);
  await expect(input).toBeFocused();
  expect(state.errors).toEqual([]);
});

test("검색 대기 중 필터 병합·IME 시작 취소·즉시 clear는 오래된 검색을 되살리지 않는다", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, "/tasks");
  const input = page.getByLabel("검색어", { exact: true });
  await input.fill("아직 대기");
  await input.dispatchEvent("compositionstart");
  await page.waitForTimeout(350);
  expect(state.searches).toHaveLength(0);
  await input.fill("최신 초안");
  await openTabFilters(page);
  await chooseTag(page, page, "같은 이름");
  await applyTabFilters(page);
  await expect(input).toHaveValue("최신 초안");
  await input.dispatchEvent("compositionend");
  await expect.poll(() => state.searches.length).toBe(1);
  expect(state.searches.every((s) => s.query === "최신 초안" && (s.tag_ids as string[]).includes(id(12)))).toBe(true);
  await input.fill("되살아나면 안 됨");
  await page.getByRole("button", { name: "검색어 지우기" }).click();
  await expect(page).not.toHaveURL(/q=/);
  await page.waitForTimeout(350);
  expect(state.searches).toHaveLength(1);
  await expect(input).toHaveValue("");
  await expect(input).toBeFocused();
});

test("기록 기간 변경과 잘못된 범위는 할 일을 재조회하지 않고 이전 기록을 유지한다", async ({ page }) => {
  await fixtures(page);
  const reads: string[] = [];
  await page.route("**/api/records?**", (route) => {
    reads.push(new URL(route.request().url()).search);
    return route.fulfill({ json: { items: [record(3)], next_cursor: null } });
  });
  let tasks = 0;
  await page.route("**/api/tasks?**", (route) => {
    tasks++;
    return route.fulfill({ json: { items: [task(2)], next_cursor: null } });
  });
  await go(page, "/records");
  await expect(page.locator("[data-list-anchor]")).toBeVisible();
  expect(tasks).toBe(0);
  await openTabFilters(page);
  await page.getByLabel("기록 종료일", { exact: true }).fill("2026-10-05");
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect.poll(() => reads.length).toBe(2);
  expect(reads[1]).toContain("occurred_to=");
  await page.getByLabel("기록 시작일", { exact: true }).fill("2026-10-06");
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("이전 유효 기간");
  await expect(page.locator("[data-list-anchor]")).toHaveText("기록");
  await expect(page.locator(".tasks")).toHaveCount(0);
  expect(reads).toHaveLength(2);
  expect(tasks).toBe(0);
});

test("늦은 다른 탭 페이지는 기록 날짜·페이지·검색 초안과 초점을 덮지 않는다", async ({ page }) => {
  const state = await fixtures(page);
  let release = () => {}, started = () => {};
  const held = new Promise<void>((r) => release = r), pending = new Promise<void>((r) => started = r);
  await page.route("**/api/tasks?**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor) {
      started();
      await held;
    }
    await route.fulfill({ json: { items: [task(cursor ? 102 : 101)], next_cursor: cursor ? null : "next" } }).catch(
      () => {},
    );
  });
  await page.route("**/api/records?**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({ json: { items: [record(cursor ? 104 : 103)], next_cursor: cursor ? null : "next" } });
  });
  await go(page, "/tasks");
  await page.locator("#activity-tasks-page-control").click();
  await pending;
  await page.getByRole("link", { name: "기록 fixture", exact: true }).click();
  await openTabFilters(page);
  const date = page.getByLabel("기록 시작일", { exact: true });
  await date.fill("2026-10-01");
  await applyTabFilters(page);
  await page.locator("#activity-records-page-control").click();
  await expect(page).toHaveURL(/pages=2/);
  const input = page.getByLabel("검색어", { exact: true });
  await input.dispatchEvent("compositionstart");
  await input.fill("아직 조합 중인 초안");
  await date.focus();
  release();
  await page.waitForTimeout(100);
  const params = new URL(page.url()).searchParams;
  expect(params.get("from")).toBe("2026-10-01");
  expect(params.get("pages")).toBe("2");
  await expect(date).toHaveValue("2026-10-01");
  await expect(date).toBeFocused();
  await expect(input).toHaveValue("아직 조합 중인 초안");
  await expect(page.locator("[data-list-anchor]")).toHaveCount(2);
  await expect(page.locator(".tasks")).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

for (const overLimit of [false, true]) {
  test(`할 일 태그 10개 한도: ${overLimit ? "기존 URL 정규화" : "선택 제한과 해제"}`, async ({ page }) => {
    const state = await fixtures(page),
      tags = Array.from(
        { length: 11 },
        (_, i) => ({ ...base(200 + i, ""), name: `분류 ${i + 1}`, scope: "task" as const }),
      );
    state.rows.tags = tags;
    const requests: number[] = [];
    await page.route(/\/api\/(tasks|records)\?/, (route) => {
      const count = new URL(route.request().url()).searchParams.get("tag_ids")?.split(",").filter(Boolean).length ?? 0;
      requests.push(count);
      return route.fulfill({
        status: count > 10 ? 400 : 200,
        json: count > 10 ? { code: "invalid_input", message: "tag_ids max10" } : { items: [], next_cursor: null },
      });
    });
    await go(page, overLimit ? `/tasks?tag_ids=${tags.map((tag) => tag.id).join(",")}` : "/tasks");
    await openTabFilters(page);
    if (overLimit) {
      await expect(page.getByRole("status").filter({ hasText: "기존 조건의 앞 10개만 적용" })).toContainText("기존 조건의 앞 10개만 적용");
      expect(new URL(page.url()).searchParams.get("tag_ids")?.split(",")).toHaveLength(10);
    }
    const appliedReads = requests.length;
    await page.getByRole("button", { name: "태그 선택", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "할 일 태그 선택", exact: true });
    if (!overLimit) for (const tag of tags.slice(0, 10)) await picker.getByRole("checkbox", { name: tag.name, exact: true }).check();
    const eleventh = picker.getByRole("checkbox", { name: tags[10].name, exact: true });
    await expect(eleventh).toBeDisabled();
    await expect(picker.getByRole("checkbox", { checked: true })).toHaveCount(10);
    await picker.getByRole("checkbox", { name: tags[0].name, exact: true }).uncheck();
    await expect(eleventh).toBeEnabled();
    await eleventh.check();
    await expect(eleventh).toBeChecked();
    await picker.getByRole("button", { name: "선택 완료", exact: true }).click();
    expect(requests).toHaveLength(appliedReads);
    await applyTabFilters(page);
    await expect.poll(() => requests.at(-1)).toBe(10);
    expect(Math.max(...requests)).toBeLessThanOrEqual(10);
    await expect(page.getByRole("alert")).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });
}

for (const kind of ["tasks"] as const) {
  test(`${kind}: 무시한 이전 검색 페이지는 최신 행·대체 상태·coverage를 덮지 않는다`, async ({ page }) => {
    const state = await fixtures(page);
    let release = () => {}, started = () => {};
    const held = new Promise<void>((r) => release = r), pending = new Promise<void>((r) => started = r);
    await page.route("**/api/search", async (route) => {
      const input = route.request().postDataJSON(), target = (input.kinds as string[])[0];
      const stale = input.query === "old" && input.cursor && target === kind.slice(0, -1);
      if (stale) {
        started();
        await held;
      }
      await route.fulfill({
        json: {
          items: [{
            id: id(input.query === "old" ? 101 : 102),
            kind: target,
            title: input.query === "old" ? "old hit" : "new hit",
            snippet: "본문",
            snippet_start: 0,
            snippet_end: 2,
            at: stamp,
            tag_ids: [],
            path: `/${target}s/${id(102)}`,
            match: "keyword",
            index_state: "pending",
          }],
          next_cursor: input.query === "old" && !input.cursor ? "next" : null,
          search_state: stale ? "keyword_fallback" : "ok",
          semantic_coverage: { pending: stale ? 99 : 1, excluded: 0 },
        },
      }).catch((error) => {
        if (!route.request().failure()) throw error;
      });
    });
    await go(page, `/${kind}?q=old`);
    const section = kind === "tasks" ? page.locator(".tasks") : page.locator("main");
    await section.getByRole("button", { name: kind === "tasks" ? "할 일 더 보기" : "더 보기", exact: true }).click();
    await pending;
    const canceled = page.waitForEvent(
      "requestfailed",
      (request) =>
        request.url().endsWith("/api/search") && request.postDataJSON().query === "old" &&
        !!request.postDataJSON().cursor,
    );
    await page.getByLabel("검색어", { exact: true }).fill("new");
    await expect(section.getByRole("button", { name: "new hit", exact: true })).toBeVisible();
    await canceled;
    release();
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
    await expect(section.getByText(/색인 대기 1개/)).toBeVisible();
    await expect(section.getByText(/의미 검색을 사용할 수 없어/)).toHaveCount(0);
    await expect(section.getByText(/대기 99개/)).toHaveCount(0);
    await expect(section.getByRole("button", { name: "old hit", exact: true })).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });
}

test("검색 복원의 마지막 요청 페이지가 cursor를 반복하면 이전 행·coverage만 보존한다", async ({ page }) => {
  const state = await fixtures(page);
  await page.route("**/api/search", (route) => {
    const input = route.request().postDataJSON();
    return route.fulfill({
      json: {
        items: [{
          id: id(input.cursor ? 102 : 101),
          kind: "task",
          title: input.cursor ? "거절할 결과" : "보존할 결과",
          snippet: "본문",
          snippet_start: 0,
          snippet_end: 2,
          at: stamp,
          tag_ids: [],
          path: `/tasks/${id(101)}`,
          match: "keyword",
          index_state: "pending",
        }],
        next_cursor: "next",
        search_state: input.cursor ? "keyword_fallback" : "ok",
        semantic_coverage: { pending: input.cursor ? 99 : 1, excluded: 0 },
      },
    });
  });
  await go(page, "/tasks?q=검색&pages=2");
  const section = page.locator(".tasks");
  await expect(section.getByRole("button", { name: "다시 시도", exact: true })).toBeVisible();
  await expect(section.getByRole("button", { name: "보존할 결과", exact: true })).toBeVisible();
  await expect(section.getByRole("button", { name: "거절할 결과", exact: true })).toHaveCount(0);
  await expect(section.getByText(/색인 대기 1개/)).toBeVisible();
  await expect(section.getByText(/대기 99개|의미 검색을 사용할 수 없어/)).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("검색의 반복 cursor 실패는 기존 행·coverage를 보존하고 같은 페이지를 재시도한다", async ({ page }) => {
  const state = await fixtures(page);
  let failed = false;
  await page.route("**/api/search", (route) => {
    const input = route.request().postDataJSON(), bad = !!input.cursor && !failed;
    if (bad) failed = true;
    return route.fulfill({
      json: {
        items: [{
          id: id(input.cursor ? 102 : 101),
          kind: "task",
          title: input.cursor ? "추가 결과" : "첫 결과",
          snippet: "본문",
          snippet_start: 0,
          snippet_end: 2,
          at: stamp,
          tag_ids: [],
          path: `/tasks/${id(101)}`,
          match: "keyword",
          index_state: "pending",
        }],
        next_cursor: !input.cursor || bad ? "next" : null,
        search_state: bad ? "keyword_fallback" : "ok",
        semantic_coverage: { pending: bad ? 99 : 1, excluded: 0 },
      },
    });
  });
  await go(page, "/tasks?q=검색");
  const section = page.locator(".tasks");
  await expect(section.getByText(/색인 대기 1개/)).toBeVisible();
  await section.getByRole("button", { name: "할 일 더 보기", exact: true }).click();
  await expect(section.getByRole("button", { name: "다시 시도", exact: true })).toBeVisible();
  await expect(section.getByRole("button", { name: "첫 결과", exact: true })).toBeVisible();
  await expect(section.getByRole("button", { name: "추가 결과", exact: true })).toHaveCount(0);
  await expect(section.getByText(/색인 대기 1개/)).toBeVisible();
  await expect(section.getByText(/대기 99개|의미 검색을 사용할 수 없어/)).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has("pages")).toBe(false);
  await section.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(section.getByRole("button", { name: "추가 결과", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/pages=2/);
  expect(state.errors).toEqual([]);
});

test("목록 페이지·조건·scroll/focus 왕복과 검색 anchor 재조회", async ({ page }) => {
  const state = await fixtures(page);
  const many = Array.from({ length: 21 }, (_, i) => ({ ...task(100 + i), title: `행 ${i}` }));
  await page.route("**/api/tasks**", (route) => {
    const url = new URL(route.request().url()), key = url.pathname.split("/").at(-1);
    if (key !== "tasks") {
      return route.fulfill({ json: many.find((t) => t.id === key) ?? state.rows.tasks.find((t) => t.id === key) });
    }
    return route.fulfill({
      json: url.searchParams.get("cursor")
        ? { items: many.slice(20), next_cursor: null }
        : { items: many.slice(0, 20), next_cursor: "page2" },
    });
  });
  await go(page, "/tasks?kind=once");
  await page.locator("#activity-tasks-page-control").click();
  await openListEditor(page, "행 20");
  await form(page).getByRole("button", { name: "닫기", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("pages")).toBe("2");
  expect(new URL(page.url()).searchParams.has("scroll")).toBe(true);
  await expect(page.locator(`#activity-tasks-${many[20].id}`)).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.reload();
  await expect(page.locator(`#activity-tasks-${many[20].id}`)).toBeFocused();
  await go(page, "/tasks?q=행&kind=once");
  await openListDetail(page, "할 일");
  await form(page).getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page).toHaveURL(/q=행|q=%ED%96%89/);
  await expect(page.locator(`#activity-tasks-${id(2)}`)).toBeFocused();
  expect(state.searches.filter((s) => (s.kinds as string[])[0] === "task").at(-1)?.anchor).toEqual({
    kind: "task",
    id: id(2),
  });
  expect(state.errors).toEqual([]);
});

test("#211 기록 필터·날짜 그룹·표시·편집은 계정 시간대로 일치하고 필터 안내는 없다", async ({ page }) => {
  const state = await fixtures(page), reads: URL[] = [];
  const user = {
    id: id(77),
    aud: "authenticated",
    email: "timezone@example.test",
    app_metadata: {},
    user_metadata: { workspace_timezone: "America/New_York" },
  };
  await page.addInitScript(
    (user) =>
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: "fixture-access",
          refresh_token: "fixture-refresh",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          token_type: "bearer",
          user,
        }),
      ),
    user,
  );
  await page.route("**/auth/v1/user", (route) => route.fulfill({ json: user }));
  Object.assign(state.rows.records[0], { occurred_at: "2026-10-07T23:15:22.123Z" });
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname === "/api/records") reads.push(url);
  });
  await go(page, "/records?filters=1&from=2026-10-07&to=2026-10-07");
  await expect(page.getByText("날짜와 시각 기준:", { exact: false })).toHaveCount(0);
  await expect.poll(() =>
    reads.some((url) =>
      url.searchParams.get("occurred_from") === "2026-10-07T04:00:00.000Z" &&
      url.searchParams.get("occurred_to") === "2026-10-08T03:59:59.999Z"
    )
  ).toBe(true);
  await expect(page.getByRole("region", { name: "2026-10-07 기록", exact: true })).toBeVisible();
  await openListDetail(page, "기록");
  const displayed = await page.evaluate(() =>
    new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York" }).format(
      new Date("2026-10-07T23:15:22.123Z"),
    )
  );
  await expect(form(page).locator("time")).toHaveText(displayed);
  await openDetailEditor(page);
  await expect(form(page).locator('input[type="datetime-local"]')).toHaveValue("2026-10-07T19:15");
  await form(page).getByLabel("본문", { exact: false }).fill("시각을 유지하는 편집");
  await saveOnce(page, form(page));
  await expect.poll(() => state.writes[0]?.body.occurred_at).toBe("2026-10-07T23:15:22.123Z");
  await go(page, "/tasks");
  await expect(page.locator("[data-list-anchor]").first()).toBeVisible();
  await page.getByRole("button", { name: "할 일 등록", exact: true }).click();
  await form(page).getByRole("radio", { name: "반복", exact: true }).click();
  await expect(form(page).getByLabel("시간대", { exact: false })).toHaveValue("America/New_York");
  expect(state.errors).toEqual([]);
});


for (const outcome of ["success", "failed"] as const) {
  test(`자료 펼침 복원은 지연된 속성 정의의 ${outcome} 표시까지 초점을 기다린다`, async ({ page }) => {
    const state = await fixtures(page);
    await page.setViewportSize({ width: 390, height: 800 });
    const rows = Array.from({ length: 21 }, (_, n) => entity(100 + n, { prop_1: `정의 대기 자료 ${n}`, prop_2: 1234 }));
    state.rows.entities.splice(0, state.rows.entities.length, ...rows);
    const target = rows[19];
    let started!: () => void, release!: () => void;
    const arrived = new Promise<void>((resolve) => started = resolve);
    const held = new Promise<void>((resolve) => release = resolve);
    await page.route("**/api/entity-types/*/schema?schema_version=1", async (route) => {
      started();
      await held;
      await route.fulfill(outcome === "success"
        ? { json: fixtureSchema }
        : { status: 503, json: { code: "unavailable", message: "속성 정의 일시 실패" } });
    });
    const params = new URLSearchParams({ open: `/entities/${encodeURIComponent(target.id)}`, scroll: "650" });
    try {
      await go(page, `/entities?${params}#entity-${encodeURIComponent(target.id)}`);
      await arrived;
      const toggle = page.getByRole("button", { name: target.title, exact: true });
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(page.getByText("속성 정의를 불러오는 중…", { exact: true })).toBeVisible();
      // Flush the restoration animation frame while the schema request remains gated.
      await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
      await expect(toggle).not.toBeFocused();
      release();
      if (outcome === "success") await expect(page.locator(".related-preview .props")).toContainText("1234");
      else await expect(page.getByRole("button", { name: "속성 정의 다시 조회", exact: true })).toBeVisible();
      await expect(toggle).toBeFocused();
      await expect(toggle).toBeInViewport();
      expect(state.writes).toHaveLength(0);
      expect(state.errors).toEqual([]);
    } finally {
      release();
    }
  });
}
