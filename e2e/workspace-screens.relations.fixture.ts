import { detailDialog, executionDialog, openDialogs } from "./ui-actions.ts";
import { chooseTag, applyTabFilters } from "./ui-actions.ts";
import { entityKey } from "./support/workspace-data.ts";
import { openDetailEditor, openListDetail, openTabFilters } from "./ui-actions.ts";
import { saveOnce } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { entity, id, stamp, task } from "./support/workspace-data.ts";
import { fixtures, form, go } from "./support/workspace-screens.ts";

for (const width of [320, 390, 1024]) {
  test(`자료 연결 목록 ${width}px: 본문 대표 문구·오른쪽 행동과 간결한 상세`, async ({ page }, info) => {
    const state = await fixtures(page), title = "memo-edd743a2-2a0c-455b-b3ad-312e05d47d4e 등록";
    Object.assign(state.rows.entities[0], {
      records: {
        count: 2,
        items: [{ id: id(3), body: "상담 판단 정리", record_kind: "user", occurred_at: stamp, updated_at: stamp }, {
          id: id(30),
          body: title,
          record_kind: "change",
          occurred_at: stamp,
          updated_at: stamp,
        }],
      },
    });
    await page.setViewportSize({ width, height: 900 });
    await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
    const section = form(page).getByRole("region", { name: "기록 (2개)", exact: true }),
      rows = section.locator("[data-slot='item']");
    await expect(rows).toHaveCount(2);
    await expect(rows.first()).toContainText("상담 판단 정리");
    await expect(rows.last().getByRole("button", { name: title, exact: true })).toHaveCount(1);
    await expect(rows.locator("time, [data-slot='badge']")).toHaveCount(0);
    await expect(form(page).getByRole("link", { name: "전체 할 일 보기", exact: true })).toHaveCount(0);
    await expect(section.getByRole("link", { name: "전체 기록 보기", exact: true })).toHaveCount(0);
    await expect(form(page).getByRole("button", { name: "할 일 작성", exact: true })).toBeVisible();
    const related = form(page).getByRole("region", { name: /^(할 일|기록) \(\d+개\)$/ });
    await expect(related).toHaveCount(2);
    for (const region of await related.all()) await expect(region.getByRole("heading").first()).toBeVisible();
    for (const row of await rows.all()) expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await section.screenshot({ path: info.outputPath(`entity-related-${width}.png`) });
    await rows.first().getByRole("button", { name: "상담 판단 정리", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/entities/${encodeURIComponent(entityKey(1))}$`));
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

test("연결 엔터티 범위: 각 탭 조회·검색 조건·본문 왕복·해제", async ({ page }) => {
  const state = await fixtures(page);
  for (const kind of ["tasks", "records"] as const) {
    state.rows[kind as "tasks" | "records"][0].entity_ids = [entityKey(1)];
    state.rows[kind as "tasks" | "records"][0].entity_context = [{
      id: entityKey(1),
      title: "자료",
      source: "selection",
      captured_at: stamp,
    }];
  }
  state.rows.entities[0].tasks = { count: 1, items: [{ id: id(2), title: "할 일", updated_at: stamp }] };
  const reads: { kind: string; params: URLSearchParams }[] = [];
  for (const kind of ["tasks", "records"] as const) {
    await page.route(`**/api/${kind}?**`, (route) => {
      const params = new URL(route.request().url()).searchParams;
      reads.push({ kind, params });
      return route.fulfill({
        json: {
          items: state.rows[kind as "tasks" | "records"].filter((row) =>
            !params.has("entity_id") || (row.entity_ids as string[]).includes(params.get("entity_id")!)
          ),
          next_cursor: null,
        },
      });
    });
  }
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
  await expect(form(page).getByRole("link", { name: "전체 할 일 보기", exact: true })).toHaveCount(0);
  await go(page, `/tasks?entity_id=${encodeURIComponent(entityKey(1))}`);
  await openTabFilters(page);
  await expect(page.getByText("연결된 자료: 검사 자료: 자료", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("entity_id")).toBe(entityKey(1));
  await expect.poll(() => reads.length).toBe(1);
  expect(reads[0].kind).toBe("tasks");
  expect(reads[0].params.get("entity_id")).toBe(entityKey(1));
  await chooseTag(page, page, "같은 이름");
  await applyTabFilters(page);
  await page.getByLabel("검색어", { exact: true }).fill("할");
  await expect.poll(() => state.searches.length).toBe(1);
  expect(state.searches[0].entity_id).toBe(entityKey(1));
  expect(state.searches[0].tag_ids).toEqual([id(12)]);
  expect(state.searches[0]).not.toHaveProperty("from");
  await openListDetail(page, "할 일");
  await form(page).getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page.getByText("연결된 자료: 검사 자료: 자료", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.get("entity_id")).toBe(entityKey(1));
  await page.getByRole("button", { name: "자료 범위 해제", exact: true }).click();
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect(page).not.toHaveURL(/entity_id=/);
  await expect.poll(() => state.searches.length).toBe(3);
  expect(state.searches.at(-1)).not.toHaveProperty("entity_id");
  expect(new URL(page.url()).searchParams.get("q")).toBe("할");
  await go(page, `/records?entity_id=${encodeURIComponent(entityKey(1))}&from=2026-10-01&q=기록`);
  await expect(page.locator("[data-list-anchor]")).toBeVisible();
  expect(state.searches.at(-1)?.kinds).toEqual(["record"]);
  expect(state.searches.at(-1)?.from).toBeTruthy();
  expect(state.searches.at(-1)?.entity_id).toBe(entityKey(1));
  expect(state.errors).toEqual([]);
});

for (const kind of ["tasks", "records"] as const) {
  test(`${kind} 보기의 연결 대상은44px 펼침으로 엔터티 내용을 읽는다`, async ({ page }) => {
    const state = await fixtures(page), row = state.rows[kind][0];
    row.entity_ids = [entityKey(1)];
    row.entity_context = [{ id: entityKey(1), title: "함", source: "selection", captured_at: stamp }];
    for (const width of [320, 390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await go(page, `/${kind}/${row.id}`);
      const link = form(page).getByRole("region", { name: /^연결된 자료/ }).getByRole("button", { name: "함", exact: true });
      const box = (await link.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      await link.focus();
      await page.keyboard.press("Enter");
      await expect(link).toHaveAttribute("aria-expanded", "true");
      expect(new URL(page.url()).pathname).toBe(`/${kind}/${row.id}`);
      await expect(form(page).getByLabel("제목", { exact: false })).toHaveCount(0);
      await expect(form(page).getByRole("link", { name: "함 상세", exact: true })).toBeVisible();
    }
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

test("연결 범위 해제 뒤 늦은 scoped 페이지는 전체 행·cursor를 덮지 않는다", async ({ page }) => {
  const state = await fixtures(page);
  state.listPages("tasks", [Array.from({ length: 20 }, (_, i) => ({ ...task(100 + i), title: "연결 업무 " + i })), [{
    ...task(60),
    title: "오래된 범위 추가",
  }]], { entityId: entityKey(1) });
  state.listPages("tasks", [[{ ...task(), title: "전체 업무" }]]);
  const held = state.holdRead({ kind: "tasks", page: 2, entityId: entityKey(1) });
  await go(page, `/tasks?entity_id=${encodeURIComponent(entityKey(1))}`);
  await openTabFilters(page);
  await page.getByRole("region", { name: "할 일", exact: true }).getByRole("button", { name: "할 일 더 보기", exact: true }).click();
  await held.started;
  await page.getByRole("button", { name: "자료 범위 해제", exact: true }).click();
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect(page.getByRole("region", { name: "할 일 목록", exact: true }).locator("[data-list-anchor]")).toHaveText(["전체 업무"]);
  held.release();
  await held.finished;
  await expect(page.getByRole("region", { name: "할 일 목록", exact: true }).locator("[data-list-anchor]")).toHaveText(["전체 업무"]);
  await expect(page.getByRole("region", { name: "할 일", exact: true }).getByText("오래된 범위 추가", { exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/entity_id=|tasks_pages=/);
  expect(state.errors).toEqual([]);
});

for (const scope of ["invalid", entityKey(99)]) {
  test(`연결 범위 ${scope}: owner 조회 실패·URL 이름 불신·명시 해제`, async ({ page }) => {
    const state = await fixtures(page);
    let reads = 0;
    await page.route("**/api/entities/*", (route) => {
      reads++;
      return route.fulfill({ status: 404, json: { code: "not_found", message: "항목을 찾을 수 없습니다" } });
    });
    await go(page, `/tasks?entity_id=${scope}&entity_name=믿지않을이름`);
    await openTabFilters(page);
    await expect(
      page.getByText(
        scope === "invalid" ? "자료 범위 ID가 올바르지 않습니다." : "연결된 자료를 조회할 수 없습니다.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(reads).toBe(scope === "invalid" ? 0 : 1);
    await expect(page.getByText("연결된 자료: 믿지않을이름", { exact: true })).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get("entity_id")).toBe(scope);
    await page.getByRole("button", { name: "자료 범위 해제", exact: true }).click();
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
    await expect(page).not.toHaveURL(/entity_id=/);
    expect(state.errors).toEqual([]);
  });
}

for (const kind of ["tasks", "records"] as const) {
  test(`엔터티 제목 연결 검색 ${kind}: 빈 검색·부분 일치·선택 보존·해제·저장`, async ({ page }) => {
    const state = await fixtures(page), reads: URLSearchParams[] = [];
    const targets = [entity(81, { prop_1: "Alpha 고객" }), entity(82, { prop_1: "Beta 고객" })];
    await page.route("**/api/entities?**", (route) => {
      const params = new URL(route.request().url()).searchParams;
      reads.push(params);
      return route.fulfill({
        json: {
          items: targets.filter((item) =>
            item.title.toLowerCase().includes((params.get("keyword") ?? "").toLowerCase())
          ),
          next_cursor: null,
        },
      });
    });
    await go(page, `/${kind}?create=1`);
    if (kind === "tasks") {
      await form(page).getByRole("textbox", { name: "제목 (필수)", exact: true }).fill("새 관계 업무");
    } else await form(page).getByLabel("본문", { exact: false }).fill("새 관계 기록");
    await form(page).getByRole("button", { name: "자료 연결", exact: true }).click();
    const search = form(page).getByRole("searchbox", { name: "자료 제목 검색", exact: true });
    await expect(search).toBeVisible();
    expect(reads).toHaveLength(0);
    await search.fill("aLpHa");
    await form(page).getByRole("button", { name: "Alpha 고객 연결", exact: true }).focus();
    await page.keyboard.press("Space");
    await expect(form(page).getByRole("button", { name: "Alpha 고객 해제", exact: true })).toBeFocused();
    expect(reads[0].get("keyword")).toBe("aLpHa");
    expect(reads[0].get("limit")).toBe("20");
    await search.fill("Beta");
    await form(page).getByRole("button", { name: "Beta 고객 연결", exact: true }).click();
    await search.clear();
    await expect(form(page).getByRole("button", { name: "Alpha 고객 해제", exact: true })).toBeVisible();
    await expect(form(page).getByRole("button", { name: "Beta 고객 해제", exact: true })).toBeVisible();
    await form(page).getByRole("button", { name: "Alpha 고객 해제", exact: true }).click();
    await expect(form(page).getByRole("button", { name: "Alpha 고객 해제", exact: true })).toHaveCount(0);
    await expect(search).toBeFocused();
    await saveOnce(page, form(page), kind === "tasks" ? "추가" : "저장");
    await expect.poll(() => state.writes.at(-1)?.body.entity_ids).toEqual([entityKey(82)]);
    expect(reads).toHaveLength(2);
    expect(state.errors).toEqual([]);
  });
}

test("엔터티 제목 연결 검색: IME·늦은 응답 격리·페이지 실패 동일 cursor 재시도", async ({ page }) => {
  const state = await fixtures(page), reads: URLSearchParams[] = [];
  let release = () => {}, arrived = () => {}, failPage = true;
  const held = new Promise<void>((resolve) => release = resolve),
    started = new Promise<void>((resolve) => arrived = resolve);
  await page.route("**/api/entities?**", async (route) => {
    const params = new URL(route.request().url()).searchParams;
    reads.push(params);
    const word = params.get("keyword");
    if (word === "느림") {
      arrived();
      await held;
      return route.fulfill({ json: { items: [entity(91, { prop_1: "오래된 결과" })], next_cursor: null } }).catch(
        () => {},
      );
    }
    if (params.has("cursor")) {
      if (failPage) {
        failPage = false;
        return route.fulfill({ status: 503, json: { code: "internal", message: "검색 실패" } });
      }
      return route.fulfill({
        json: {
          items: [entity(92, { prop_1: "최신 결과" }), entity(93, { prop_1: "추가 결과" })],
          next_cursor: null,
        },
      });
    }
    return route.fulfill({ json: { items: [entity(92, { prop_1: "최신 결과" })], next_cursor: "page-two" } });
  });
  await go(page, "/tasks?create=1");
  await form(page).getByRole("button", { name: "자료 연결", exact: true }).click();
  const search = form(page).getByRole("searchbox", { name: "자료 제목 검색", exact: true });
  await expect(search).toBeVisible();
  await search.dispatchEvent("compositionstart");
  await search.fill("느");
  await page.waitForTimeout(350);
  expect(reads).toHaveLength(0);
  await search.fill("느림");
  await search.dispatchEvent("compositionend");
  await started;
  await search.fill("최신%_");
  await expect(form(page).getByRole("button", { name: "최신 결과 연결", exact: true })).toBeVisible();
  release();
  await expect(form(page).getByRole("button", { name: "오래된 결과 연결", exact: true })).toHaveCount(0);
  expect(reads.at(-1)?.get("keyword")).toBe("최신%_");
  await form(page).getByRole("button", { name: "검색 결과 더 보기", exact: true }).click();
  await expect(form(page).getByRole("alert")).toBeVisible();
  await expect(form(page).getByRole("button", { name: "최신 결과 연결", exact: true })).toBeVisible();
  await form(page).getByRole("button", { name: "검색 다시 시도", exact: true }).click();
  await expect(form(page).getByRole("button", { name: "추가 결과 연결", exact: true })).toBeVisible();
  await expect(form(page).getByRole("button", { name: "최신 결과 연결", exact: true })).toHaveCount(1);
  expect(reads.slice(-2).map((params) => params.get("cursor"))).toEqual(["page-two", "page-two"]);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const choices = form(page).getByRole("group", { name: "자료 검색 결과", exact: true }).getByRole("button", { name: / 연결$/ });
    await expect(choices).toHaveCount(2);
    for (const choice of await choices.all()) expect((await choice.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

for (const kind of ["tasks", "records"] as const) {
  test(`#185 ${kind}: 검색 Enter는 저장하지 않고 검색·선택은 아래 표준 카드`, async ({ page }, info) => {
    const state = await fixtures(page);
    Object.assign(state.rows.entities[0], entity(1, { prop_1: "검색 대상" }));
    await go(page, `/${kind}?create=1`);
    await form(page).getByRole("button", { name: "자료 연결", exact: true }).click();
    const search = form(page).getByRole("searchbox", { name: "자료 제목 검색", exact: true });
    await search.dispatchEvent("compositionstart");
    await search.fill("검");
    await search.press("Enter");
    await expect(executionDialog(page)).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
    await search.fill("검색");
    await search.dispatchEvent("compositionend");
    await search.press("Enter");
    const result = form(page).getByRole("group", { name: "자료 검색 결과" });
    await result.getByRole("button", { name: "검색 대상 연결", exact: true }).click();
    const selected = form(page).getByRole("list", { name: "선택한 자료", exact: true });
    await expect(selected.locator("[data-slot='item']")).toHaveCount(1);
    expect((await selected.boundingBox())!.y).toBeGreaterThan((await search.boundingBox())!.y);
    await expect(executionDialog(page)).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
    if (kind === "tasks") {
      await expect(form(page).getByRole("heading", { name: "일정", exact: true })).toHaveCount(0);
      await expect(form(page).getByLabel("기한", { exact: true })).toHaveCount(1);
    }
    await page.screenshot({ path: info.outputPath(`entity-picker-${kind}.png`) });
    expect(state.errors).toEqual([]);
  });
}

test("#185 빈 연결 개수만 표시·관계 카드 빈 공간은 이동하지 않음", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, `/tasks/${id(2)}`);
  await expect(form(page).getByRole("heading", { name: "기록 (0개)", exact: true })).toBeVisible();
  await expect(form(page).getByText("연결된 기록이 없습니다.", { exact: true })).toHaveCount(0);
  Object.assign(state.rows.tasks[0], {
    entity_ids: [entityKey(1)],
    entity_context: [{ id: entityKey(1), title: "자료", source: "selection", captured_at: stamp }],
  });
  await page.reload();
  const link = form(page).getByRole("button", { name: "자료", exact: true }),
    card = link.locator("xpath=ancestor::div[contains(@class,'related-item')][last()]");
  const t = (await link.boundingBox())!;
  await page.mouse.click(t.x + t.width + 12, t.y + t.height / 2);
  await expect(page).toHaveURL(new RegExp(`/tasks/${id(2)}$`));
  await link.click();
  await expect(link).toHaveAttribute("aria-expanded", "true");
  await expect(page).toHaveURL(new RegExp(`/tasks/${id(2)}$`));
  expect(state.errors).toEqual([]);
});

for (const side of ["tasks", "entities"] as const) {
  for (const width of [390, 1440]) {
    test(`#187 ${side} ${width}px: 보기에서 기존 연결·취소·해제·제목 링크·기록`, async ({ page }, info) => {
      const state = await fixtures(page), taskRow = state.rows.tasks[0], entityRow = state.rows.entities[0];
      await page.route(`**/api/entities/${encodeURIComponent(entityKey(1))}`, (route) =>
        route.fulfill({
          json: {
            ...entityRow,
            tasks: {
              count: taskRow.entity_ids.includes(entityKey(1)) ? 1 : 0,
              items: taskRow.entity_ids.includes(entityKey(1)) ? [taskRow] : [],
            },
          },
        }));
      await page.setViewportSize({ width, height: 900 });
      await go(page, `/${side}/${side === "tasks" ? id(2) : encodeURIComponent(entityKey(1))}`);
      await form(page).evaluate((el) => el.setAttribute("data-original", "yes"));
      await form(page).getByRole("button", { name: side === "tasks" ? "자료 연결" : "할 일 연결", exact: true })
        .click();
      const search = form(page).getByRole("searchbox", {
        name: side === "tasks" ? "자료 제목 검색" : "할 일 제목 검색",
      });
      await search.fill(side === "tasks" ? "자료" : "할 일");
      await search.press("Enter");
      expect(state.writes).toHaveLength(0);
      await expect(executionDialog(page)).toHaveCount(0);
      const connect = form(page).getByRole("button", {
        name: side === "tasks" ? "자료 연결" : "할 일 연결",
        exact: true,
      }).last();
      await connect.click();
      await expect(form(page).getByLabel("기록 메모", { exact: true })).toHaveValue("할 일 수정");
      await expect(detailDialog(page)).toHaveAttribute("data-original", "yes");
      await expect(openDialogs(page)).toHaveCount(2);
      await form(page).getByRole("button", { name: "취소", exact: true }).click();
      expect(state.writes).toHaveLength(0);
      await connect.click();
      await form(page).getByRole("button", { name: "연결하고 저장", exact: true }).click();
      const title = side === "tasks" ? "자료" : "할 일",
        unlink = form(page).getByRole("button", { name: `${title} 해제`, exact: true });
      await form(page).getByRole("button", { name: title, exact: true }).click();
      await expect(unlink).toBeVisible();
      expect(state.writes[0].body.entity_ids).toEqual([entityKey(1)]);
      expect(state.writes[0].body.expected_version).toBe(1);
      await expect(form(page).getByRole("button", { name: title, exact: true })).toBeVisible();
      if (side === "tasks") {
        await openDetailEditor(page);
        await expect(form(page).getByRole("searchbox", { name: "자료 제목 검색" })).toHaveCount(0);
        await form(page).getByRole("button", { name: "취소", exact: true }).click();
        await form(page).getByRole("button", { name: "기록 작성", exact: true }).click();
        await form(page).getByLabel("본문", { exact: false }).fill("완료 전 진행 메모");
        await form(page).getByRole("button", { name: "저장", exact: true }).click();
        await expect(form(page).getByRole("button", { name: "완료 전 진행 메모", exact: true })).toBeVisible();
        await expect(form(page).getByRole("button", { name: "기록 작성", exact: true })).toBeFocused();
        expect(taskRow.status).toBe("open");
        expect(state.writes.at(-1)?.body.task_id).toBe(id(2));
      }
      await page.screenshot({ path: info.outputPath(`relations-${side}-${width}.png`) });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      await unlink.click();
      await form(page).getByRole("button", { name: "해제하고 저장", exact: true }).click();
      await expect(executionDialog(page)).toHaveCount(0);
      await expect(unlink).toHaveCount(0);
      expect(state.writes.at(-1)?.body.entity_ids).toEqual([]);
      expect(state.rows.tasks).toHaveLength(1);
      expect(state.rows.entities).toHaveLength(1);
      expect(state.errors).toEqual([]);
    });
  }
}

test("#187 연결 미확정 재시도는 같은 버전·내용을 유지하고 취소는 최신 보기를 조회한다", async ({ page }) => {
  const state = await fixtures(page, { failWrite: "unknown" });
  await go(page, `/tasks/${id(2)}`);
  await form(page).getByRole("button", { name: "자료 연결", exact: true }).click();
  await form(page).getByRole("searchbox", { name: "자료 제목 검색" }).fill("자료");
  await form(page).getByRole("button", { name: "자료 연결", exact: true }).last().click();
  await form(page).getByRole("button", { name: "연결하고 저장" }).click();
  await expect(form(page).getByRole("button", { name: "같은 내용 다시 시도" })).toBeVisible();
  await expect(form(page).getByLabel("기록 메모")).toBeDisabled();
  await form(page).getByRole("button", { name: "같은 내용 다시 시도" }).click();
  await form(page).getByRole("button", { name: "자료", exact: true }).click();
  await expect(form(page).getByRole("button", { name: "자료 해제" })).toBeVisible();
  expect(state.writes[0].body).toEqual(state.writes[1].body);
  expect(state.errors).toEqual([]);
});

test("#187 연결 검색 IME·늦은 추가 페이지 격리와 다른 편집 중 준비 응답 무시", async ({ page }) => {
  const state = await fixtures(page), reads: URLSearchParams[] = [];
  let releasePage = () => {}, releaseTask = () => {}, arrivePage = () => {}, arriveTask = () => {};
  const heldPage = new Promise<void>((resolve) => releasePage = resolve),
    startedPage = new Promise<void>((resolve) => arrivePage = resolve),
    heldTask = new Promise<void>((resolve) => releaseTask = resolve),
    startedTask = new Promise<void>((resolve) => arriveTask = resolve);
  await page.route("**/api/entities?**", async (route) => {
    const q = new URL(route.request().url()).searchParams;
    reads.push(q);
    if (q.has("cursor")) {
      arrivePage();
      await heldPage;
      return route.fulfill({ json: { items: [entity(81, { prop_1: "오래된 후보" })], next_cursor: null } }).catch(
        () => {},
      );
    }
    return route.fulfill({
      json: {
        items: [entity(1, { prop_1: q.get("keyword") })],
        next_cursor: q.get("keyword") === "이전" ? "more" : null,
      },
    });
  });
  await go(page, `/tasks/${id(2)}`);
  await form(page).getByRole("button", { name: "자료 연결", exact: true }).click();
  const search = form(page).getByRole("searchbox", { name: "자료 제목 검색" });
  await search.dispatchEvent("compositionstart");
  await search.fill("이");
  await search.press("Enter");
  await page.waitForTimeout(350);
  expect(reads).toHaveLength(0);
  await search.fill("이전");
  await search.dispatchEvent("compositionend");
  await form(page).getByRole("button", { name: "검색 결과 더 보기" }).click();
  await startedPage;
  await search.fill("최신");
  await search.press("Enter");
  await expect(form(page).getByRole("button", { name: "최신 연결" })).toBeVisible();
  releasePage();
  await expect(form(page)).not.toContainText("오래된 후보");
  await page.route(`**/api/tasks/${id(2)}`, async (route) => {
    arriveTask();
    await heldTask;
    return route.fulfill({ json: state.rows.tasks[0] }).catch(() => {});
  });
  await form(page).getByRole("button", { name: "최신 연결" }).click();
  await startedTask;
  await form(page).getByRole("button", { name: "편집", exact: true }).click();
  releaseTask();
  await form(page).getByRole("textbox", { name: "제목 (필수)" }).fill("보존할 편집");
  await page.waitForTimeout(100);
  await expect(executionDialog(page)).toHaveCount(0);
  await expect(form(page).getByRole("textbox", { name: "제목 (필수)" })).toHaveValue("보존할 편집");
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

for (const side of ["tasks", "entities"] as const) {
  test(`#187 ${side}: 두 번째 검색 페이지 후보를 보고 돌아오면 검색·초점 복원`, async ({ page }) => {
    const state = await fixtures(page),
      kind = side === "tasks" ? "entities" : "tasks",
      label = side === "tasks" ? "자료" : "할 일";
    const a = kind === "entities" ? entity(81, { prop_1: "후보 첫째" }) : { ...task(81), title: "후보 첫째" },
      b = kind === "entities" ? entity(82, { prop_1: "후보 둘째" }) : { ...task(82), title: "후보 둘째" };
    if (kind === "entities") state.rows.entities.push(a as ReturnType<typeof entity>, b as ReturnType<typeof entity>);
    else state.rows.tasks.push(a as ReturnType<typeof task>, b as ReturnType<typeof task>);
    await page.route(
      `**/api/${kind}?**`,
      (route) =>
        route.fulfill({
          json: new URL(route.request().url()).searchParams.has("cursor")
            ? { items: [b], next_cursor: null }
            : { items: [a], next_cursor: "more" },
        }),
    );
    await go(page, `/${side}/${side === "tasks" ? id(2) : encodeURIComponent(entityKey(1))}`);
    await form(page).getByRole("button", { name: `${label} 연결`, exact: true }).click();
    await form(page).getByRole("searchbox", { name: `${label} 제목 검색` }).fill("후보");
    await form(page).getByRole("button", { name: "검색 결과 더 보기" }).click();
    const candidate = form(page).getByRole("group", { name: `${label} 검색 결과` }).getByRole("link", {
      name: "후보 둘째",
      exact: true,
    });
    await candidate.click();
    await expect(page).toHaveURL(
      new RegExp(`/${kind}/${kind === "entities" ? encodeURIComponent(entityKey(82)) : id(82)}$`),
    );
    await expect(openDialogs(page)).toHaveCount(1);
    await form(page).getByRole("button", { name: /^이전:/ }).click();
    await expect(form(page).getByRole("searchbox", { name: `${label} 제목 검색` })).toHaveValue("후보");
    await expect(candidate).toBeFocused();
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

for (const side of ["tasks", "entities"] as const) {
  test(`#187 ${side}: 연결 저장 뒤 조회 실패는 확정 연결을 유지하고 조회만 재시도`, async ({ page }) => {
    const state = await fixtures(page),
      taskRow = state.rows.tasks[0],
      entityRow = state.rows.entities[0],
      label = side === "tasks" ? "자료" : "할 일";
    let fail = true;
    await page.route(`**/api/${side}/${side === "tasks" ? id(2) : encodeURIComponent(entityKey(1))}`, (route) => {
      if (route.request().method() !== "GET") return route.fallback();
      if (state.writes.length && fail) {
        return route.fulfill({ status: 503, json: { code: "internal", message: "조회 실패" } });
      }
      return route.fulfill({
        json: side === "tasks" ? taskRow : {
          ...entityRow,
          tasks: { count: taskRow.entity_ids.length, items: taskRow.entity_ids.length ? [taskRow] : [] },
        },
      });
    });
    await go(page, `/${side}/${side === "tasks" ? id(2) : encodeURIComponent(entityKey(1))}`);
    await form(page).getByRole("button", { name: `${label} 연결`, exact: true }).click();
    await form(page).getByRole("searchbox", { name: `${label} 제목 검색` }).fill(label);
    await form(page).getByRole("group", { name: `${label} 검색 결과` }).getByRole("button", {
      name: `${label} 연결`,
      exact: true,
    }).click();
    await form(page).getByRole("button", { name: "연결하고 저장", exact: true }).click();
    await expect(form(page).getByRole("alert")).toContainText("연결은 저장했습니다. 최신 내용을 불러오지 못했습니다.");
    await form(page).getByRole("button", { name: label, exact: true }).click();
    await expect(form(page).getByRole("button", { name: `${label} 해제` })).toBeVisible();
    expect(state.writes).toHaveLength(1);
    fail = false;
    await form(page).getByRole("button", { name: side === "tasks" ? "조회 다시 시도" : "다시 시도", exact: true })
      .click();
    await expect(form(page).getByRole("alert")).toHaveCount(0);
    expect(state.writes).toHaveLength(1);
    expect(state.errors).toEqual([]);
  });
}

test("#187 엔터티: 확인 취소 후 외부 연결·해제 결과가 검색 후보에도 반영된다", async ({ page }) => {
  const state = await fixtures(page), taskRow = state.rows.tasks[0];
  await page.route(
    `**/api/entities/${encodeURIComponent(entityKey(1))}`,
    (route) =>
      route.fulfill({
        json: {
          ...state.rows.entities[0],
          tasks: { count: taskRow.entity_ids.length, items: taskRow.entity_ids.length ? [taskRow] : [] },
        },
      }),
  );
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
  await form(page).getByRole("button", { name: "할 일 연결", exact: true }).click();
  await form(page).getByRole("searchbox", { name: "할 일 제목 검색" }).fill("할 일");
  const results = form(page).getByRole("group", { name: "할 일 검색 결과" });
  await results.getByRole("button", { name: "할 일 연결", exact: true }).click();
  taskRow.entity_ids = [entityKey(1)];
  taskRow.version++;
  await form(page).getByRole("button", { name: "취소", exact: true }).click();
  await form(page).getByRole("button", { name: "할 일", exact: true }).click();
  await expect(form(page).getByRole("button", { name: "할 일 해제" })).toBeVisible();
  await expect(results.getByRole("button", { name: "할 일 연결", exact: true })).toHaveCount(0);
  await form(page).getByRole("button", { name: "할 일 해제" }).click();
  taskRow.entity_ids = [];
  taskRow.version++;
  await form(page).getByRole("button", { name: "취소", exact: true }).click();
  await expect(form(page).getByRole("heading", { name: "할 일 (0개)", exact: true })).toBeVisible();
  await expect(results.getByRole("button", { name: "할 일 연결", exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

for (const side of ["tasks", "entities"] as const) {
  test(`#227 ${side}: 관계 검색의 반복 cursor 거부는 이미 읽은 후보를 보존`, async ({ page }) => {
    const state = await fixtures(page),
      kind = side === "tasks" ? "entities" : "tasks",
      label = side === "tasks" ? "자료" : "할 일";
    const a = kind === "entities" ? entity(181, { prop_1: "첫 후보" }) : { ...task(181), title: "첫 후보" };
    const b = kind === "entities" ? entity(182, { prop_1: "거부 후보" }) : { ...task(182), title: "거부 후보" };
    const c = kind === "entities" ? entity(183, { prop_1: "재시도 후보" }) : { ...task(183), title: "재시도 후보" };
    let repeats = 0;
    const reads: (string | null)[] = [];
    await page.route(`**/api/${kind}?**`, (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      reads.push(cursor);
      return route.fulfill({
        json: !cursor
          ? { items: [a], next_cursor: "repeat" }
          : ++repeats === 1
          ? { items: [b], next_cursor: "repeat" }
          : { items: [c], next_cursor: null },
      });
    });
    await go(page, `/${side}/${side === "tasks" ? id(2) : encodeURIComponent(entityKey(1))}`);
    await form(page).getByRole("button", { name: `${label} 연결`, exact: true }).click();
    await form(page).getByRole("searchbox", { name: `${label} 제목 검색` }).fill("후보");
    await form(page).getByRole("button", { name: "검색 결과 더 보기", exact: true }).click();
    await expect(form(page).getByRole("alert")).toBeVisible();
    await expect(form(page).getByRole("button", { name: "첫 후보 연결", exact: true })).toBeVisible();
    await expect(form(page).getByRole("button", { name: "거부 후보 연결", exact: true })).toHaveCount(0);
    await form(page).getByRole("button", { name: "검색 다시 시도", exact: true }).click();
    await expect(form(page).getByRole("button", { name: "재시도 후보 연결", exact: true })).toBeVisible();
    expect(reads).toEqual([null, "repeat", "repeat"]);
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}
