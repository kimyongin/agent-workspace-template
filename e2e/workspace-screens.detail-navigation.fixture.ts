import { entityKey } from "./support/workspace-data.ts";
import { openDetailEditor, openListDetail, openListEditor } from "./ui-actions.ts";
import { recordDisplayText } from "../supabase/functions/_shared/contracts/record-display.ts";
import { saveOnce } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { id, record, stamp } from "./support/workspace-data.ts";
import { connectedTarget, fillText, fixtures, form, go, linkedFixture } from "./support/workspace-screens.ts";

for (
  const [kind, title] of [["entities", "엔터티 편집"], ["tasks", "할 일 편집"], ["records", "기록 편집"], [
    "principles",
    "현재 원칙 편집",
  ]]
) {
  test(`${kind}: 목록 편집 닫기는 한 번에 목록·초점으로 복귀`, async ({ page }) => {
    const state = await fixtures(page);
    await go(page, `/${kind}`);
    await openListEditor(
      page,
      kind === "entities" ? "엔터티" : kind === "tasks" ? "할 일" : kind === "records" ? "기록" : "현재 기준",
    );
    await expect(form(page).getByRole("button", { name: "저장", exact: true })).toBeVisible();
    await form(page).getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page).toHaveURL(kind === "principles" ? /\/principles#principles-title$/ : new RegExp(`/${kind}\\?`));
    await expect(form(page)).toHaveCount(0);
    await expect(page.locator(
      kind === "principles"
        ? "#principles-title"
        : kind === "entities"
        ? `[id="entity-${entityKey(1)}"]`
        : `#activity-${kind}-${id(kind === "tasks" ? 2 : 3)}`,
    )).toBeFocused();
    expect(state.errors).toEqual([]);
  });
}

for (const [kind, title] of [["entities", "엔터티"], ["tasks", "할 일"], ["records", "기록"]] as const) {
  for (const exit of ["cancel", "close", "escape", "direct", "back"] as const) {
    test(`#203 ${kind} ${exit}: 상세 버튼은 보기·편집은 모드 전환·한 dialog`, async ({ page }) => {
      const state = await fixtures(page);
      await go(page, `/${kind}?pages=1`);
      const row = page.locator(".list .related-item").first();
      await row.getByRole("button", { name: title, exact: true }).click();
      await expect(row.getByRole("link", { name: title + " 편집", exact: true })).toHaveCount(0);
      await expect(row.getByRole("link", { name: title + " 상세", exact: true })).toHaveText("상세");
      await row.getByRole("link", { name: title + " 상세", exact: true }).click();
      await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
      expect(new URL(page.url()).searchParams.has("edit")).toBe(false);
      await form(page).evaluate((el) => el.dataset.sameDialog = "yes");
      if (exit === "cancel") {
        await openDetailEditor(page);
        await expect(form(page)).toHaveAttribute("data-same-dialog", "yes");
        await form(page).getByRole("button", { name: "취소", exact: true }).click();
        await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
        await expect(form(page)).toHaveAttribute("data-same-dialog", "yes");
      }
      if (exit === "back") await page.goBack();
      else if (exit === "escape") await page.keyboard.press("Escape");
      else {
        if (exit === "direct") await expect(form(page).getByRole("button", { name: /^이전:/ })).toHaveCount(0);
        await form(page).getByRole("button", { name: "닫기", exact: true }).click();
      }
      await expect(page).toHaveURL(new RegExp(`/${kind}\\?`));
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(row.getByRole("button", { name: title, exact: true })).toHaveAttribute("aria-expanded", "true");
      expect(new URL(page.url()).searchParams.get("pages")).toBe("1");
      expect(state.writes).toHaveLength(0);
      expect(state.errors).toEqual([]);
    });
  }
}

for (const kind of ["entities", "tasks", "records"] as const) {
  test(`#203 ${kind}: 보기에서 저장·미저장 취소 후 같은 보기·목록 복원`, async ({ page }) => {
    const state = await fixtures(page), title = kind === "entities" ? "엔터티" : kind === "tasks" ? "할 일" : "기록";
    await go(page, `/${kind}?pages=1`);
    await openListDetail(page, title);
    await openDetailEditor(page);
    const input = form(page).getByRole("textbox", {
      name: kind === "entities" ? /^속성 1/ : kind === "tasks" ? /^제목/ : /^본문/,
    });
    await input.fill("저장한 새 내용");
    await saveOnce(page, form(page));
    await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
    expect(state.writes).toHaveLength(1);
    await openDetailEditor(page);
    await input.fill("버릴 초안");
    await form(page).getByRole("button", { name: "취소", exact: true }).click();
    const discard = page.getByRole("dialog", { name: "변경을 버릴까요?" });
    await discard.getByRole("button", { name: "취소", exact: true }).click();
    await expect(input).toHaveValue("버릴 초안");
    await form(page).getByRole("button", { name: "취소", exact: true }).click();
    await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
    await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
    await form(page).getByRole("button", { name: "닫기", exact: true }).click();
    const toggle = page.getByRole("button", { name: "저장한 새 내용", exact: true });
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toBeFocused();
    expect(state.writes).toHaveLength(1);
    expect(state.errors).toEqual([]);
  });
}

for (const width of [320, 1440]) {
  test(`#193 ${width}px: 연결 상세 버튼·보기/편집 모드·원래 펼침 복귀`, async ({ page }, info) => {
    const state = await fixtures(page);
    linkedFixture(state);
    await page.setViewportSize({ width, height: 900 });
    await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
    const root = page.url(), toggle = form(page).getByRole("button", { name: "할 일", exact: true });
    await toggle.click();
    const view = form(page).getByRole("link", { name: "할 일 상세", exact: true });
    await expect(form(page).getByRole("link", { name: "할 일 편집", exact: true })).toHaveCount(0);
    const viewBox = (await view.boundingBox())!,
      chevronBox = (await form(page).getByRole("button", { name: "할 일 접기", exact: true }).boundingBox())!;
    expect(viewBox.x + viewBox.width).toBeLessThanOrEqual(chevronBox.x);
    await view.click();
    await expect(page).toHaveURL(new RegExp(`/tasks/${id(2)}$`));
    await expect(page.locator("dialog[open]")).toHaveCount(1);
    await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
    await expect(form(page).locator(".detail-title")).toHaveText("할 일");
    await form(page).evaluate((el) => el.dataset.sameDialog = "yes");
    await openDetailEditor(page);
    await expect(form(page)).toHaveAttribute("data-same-dialog", "yes");
    await form(page).getByRole("button", { name: "취소", exact: true }).click();
    await expect(form(page)).toHaveAttribute("data-same-dialog", "yes");
    await form(page).getByRole("button", { name: /^이전:/ }).click();
    await expect(page).toHaveURL(root);
    await expect(view).toBeFocused();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.screenshot({ path: info.outputPath(`inline-relations-${width}.png`) });
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

test("#203 연결 보기 순환 뒤 처음 대상·목록 조건·펼침을 유지", async ({ page }) => {
  const state = await fixtures(page);
  linkedFixture(state);
  await go(page, "/entities?keyword=" + encodeURIComponent("엔터티") + "&pages=1");
  await openListDetail(page, "엔터티");
  const root = page.url(), source = new URL(root).searchParams.get("list")!;
  for (const title of ["할 일", "기록", "엔터티"]) {
    await form(page).getByRole("button", { name: title, exact: true }).click();
    await form(page).getByRole("link", { name: title + " 상세", exact: true }).click();
  }
  await expect(page).toHaveURL(root);
  await expect.poll(() => page.evaluate(() => history.state.usr.detailTrail.length)).toBe(0);
  await form(page).getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page).toHaveURL(new URL(source, page.url()).href);
  await expect(page.getByRole("button", { name: "엔터티", exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.goForward();
  await expect(form(page)).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

test("#193 관련 보기에서 저장은 같은 보기·삭제는 처음 엔터티·반복 이동은 이력 제한", async ({ page }) => {
  const state = await fixtures(page);
  linkedFixture(state);
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
  const root = page.url();
  await form(page).getByRole("button", { name: "할 일", exact: true }).click();
  await form(page).getByRole("link", { name: "할 일 상세", exact: true }).click();
  await openDetailEditor(page);
  await form(page).getByLabel("본문").fill("바뀐 본문");
  await saveOnce(page);
  await expect(page).toHaveURL(new RegExp(`/tasks/${id(2)}$`));
  await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
  await form(page).getByRole("button", { name: /^이전:/ }).click();
  await expect(page).toHaveURL(root);
  await expect(form(page).getByText("바뀐 본문", { exact: true })).toBeVisible();
  for (let n = 0; n < 3; n++) {
    await form(page).getByRole("link", { name: "할 일 상세", exact: true }).click();
    await expect.poll(() =>
      page.evaluate(() =>
        history.state.usr.detailTrail.filter((f: { path: string }) => f.path.startsWith("/entities/")).length
      )
    ).toBe(1);
    await page.goBack();
    await expect(page).toHaveURL(root);
  }
  await form(page).getByRole("link", { name: "할 일 상세", exact: true }).click();
  await openDetailEditor(page);
  await form(page).getByRole("button", { name: "삭제", exact: true }).click();
  await form(page).getByRole("button", { name: "삭제하고 기록", exact: true }).click();
  await expect(page).toHaveURL(root);
  expect(state.rows.tasks).toHaveLength(0);
  expect(state.errors).toEqual([]);
});

for (const exit of ["close", "escape", "back", "cancel"] as const) {
  test(`#193 ${exit}: 보기의 편집 초안 보호·탐색 종료·왕복 이력 없음`, async ({ page }) => {
    const state = await fixtures(page);
    linkedFixture(state);
    await go(page, "/entities");
    await openListDetail(page, "엔터티");
    const root = page.url();
    await form(page).getByRole("button", { name: "할 일", exact: true }).click();
    await form(page).getByRole("link", { name: "할 일 상세", exact: true }).click();
    await openDetailEditor(page);
    await form(page).getByLabel("본문").fill("유지할 초안");
    const attempt = async () => {
      if (exit === "close") await form(page).getByRole("button", { name: "닫기", exact: true }).click();
      else if (exit === "escape") await page.keyboard.press("Escape");
      else if (exit === "cancel") await form(page).getByRole("button", { name: "취소", exact: true }).click();
      else await page.goBack();
    };
    await attempt();
    const discard = page.getByRole("dialog", { name: "변경을 버릴까요?", exact: true });
    await discard.getByRole("button", { name: "취소", exact: true }).click();
    await expect(form(page).getByLabel("본문")).toHaveValue("유지할 초안");
    await attempt();
    await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
    if (exit === "cancel") {
      await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await form(page).getByRole("button", { name: /^이전:/ }).click();
    }
    if (exit === "back" || exit === "cancel") {
      await expect(page).toHaveURL(root);
      await expect(form(page).getByRole("button", { name: "할 일", exact: true })).toHaveAttribute(
        "aria-expanded",
        "true",
      );
    } else {
      await expect(page).toHaveURL(/\/entities\?/);
      await expect(form(page)).toHaveCount(0);
      await page.goBack();
      await expect(page).not.toHaveURL(/\/tasks\//);
      await expect(page).not.toHaveURL(/\/entities\/[^?]+/);
      await page.goForward();
      await page.goForward();
      await expect(form(page)).toHaveCount(0);
      await expect(page).toHaveURL(/\/entities\?/);
    }
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

test("#193 기록과 할 일에서 엔터티 펼침·편집, 실패 재시도·삭제 대상 편집 없음", async ({ page }) => {
  const state = await fixtures(page);
  linkedFixture(state);
  let failed = true;
  await page.route(
    `**/api/entities/${encodeURIComponent(entityKey(1))}`,
    (route) =>
      failed ? route.fulfill({ status: 503, json: { code: "internal", message: "조회 실패" } }) : route.fallback(),
  );
  await go(page, `/tasks/${id(2)}`);
  const url = page.url();
  await form(page).getByRole("button", { name: "엔터티", exact: true }).click();
  await expect(form(page).getByText("내용을 불러오지 못했습니다.")).toBeVisible();
  failed = false;
  await form(page).getByRole("button", { name: "다시 시도", exact: true }).click();
  await form(page).getByRole("link", { name: "엔터티 상세", exact: true }).click();
  await form(page).getByRole("button", { name: /^이전:/ }).click();
  await expect(page).toHaveURL(url);
  await go(page, `/records/${id(3)}`);
  await form(page).getByRole("button", { name: "엔터티", exact: true }).click();
  await form(page).getByRole("link", { name: "엔터티 상세", exact: true }).click();
  await form(page).getByRole("button", { name: /^이전:/ }).click();
  await expect(page).toHaveURL(new RegExp(`/records/${id(3)}$`));
  state.rows.entities = [];
  await form(page).getByRole("button", { name: "엔터티", exact: true }).click();
  await form(page).getByRole("button", { name: "엔터티", exact: true }).click();
  await expect(form(page).getByText("삭제된 대상 또는 접근할 수 없는 대상입니다.")).toBeVisible();
  await expect(form(page).getByRole("link", { name: "엔터티 상세", exact: true })).toHaveCount(0);
  expect(state.errors).toEqual([]);
  expect(state.writes).toHaveLength(0);
});

test("엔터티 상세: 편집·할 일 작성·기록 작성 뒤 성공 알림과 수정 시각 없음", async ({ page }, info) => {
  const state = await fixtures(page);
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
  await form(page).getByRole("button", { name: "편집", exact: true }).click();
  await form(page).getByLabel("속성 2", { exact: false }).fill("25");
  await saveOnce(page, form(page));
  await expect(form(page).getByLabel("속성 2", { exact: false })).toHaveCount(0);
  for (const [label, body, submit] of [["할 일 작성", "새 업무", "추가"], ["기록 작성", "새 상담", "저장"]]) {
    await form(page).getByRole("button", { name: label, exact: true }).click();
    await fillText(page, body);
    await saveOnce(page, form(page), submit);
    await expect(form(page).getByRole("button", { name: label, exact: true })).toBeVisible();
  }
  await expect(form(page).locator(".notice")).toHaveCount(0);
  await expect(form(page).getByText(/^수정 /)).toHaveCount(0);
  await expect(form(page).getByRole("link", { name: /전체 (할 일|기록) 보기/ })).toHaveCount(0);
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({ path: info.outputPath(`entity171-detail-${width}.png`) });
  }
  expect(state.writes).toHaveLength(3);
  expect(state.errors).toEqual([]);
});

// Multi-level recursive relation navigation was replaced by the #193 disclosure/editor cases above.
test("상세 탐색: 같은 엔터티는 한 행으로 합치고 역사 제목을 유지한다", async ({ page }) => {
  const state = await fixtures(page);
  Object.assign(state.rows.records[0], {
    record_kind: "change",
    entity_ids: [entityKey(1)],
    entity_context: [{ id: entityKey(1), title: "연결 제목", source: "selection", captured_at: stamp }],
    change: {
      event_id: id(30),
      target_kind: "entity",
      target_id: entityKey(1),
      target_title: "당시 엔터티",
      action: "update",
      source: "http",
      before: { prop2: 0 },
      after: { prop2: 1 },
    },
  });
  await go(page, `/records/${id(3)}`);
  const group = connectedTarget(page, "entity");
  await expect(group.locator(".related-item")).toHaveCount(1);
  const toggle = group.getByRole("button", { name: "당시 엔터티", exact: true });
  await toggle.click();
  await expect(group.getByRole("button", { name: "연결 제목", exact: true })).toHaveCount(0);
  await group.getByRole("link", { name: "당시 엔터티 상세", exact: true }).click();
  await form(page).getByRole("button", { name: /^이전: 기록/ }).click();
  await expect(group.getByRole("link", { name: "당시 엔터티 상세", exact: true })).toBeFocused();
  expect(state.errors).toEqual([]);
});

test("상세 탐색: 계정 전환 뒤 이전 계정의 편집 문맥을 무시", async ({ page }) => {
  const state = await fixtures(page);
  linkedFixture(state);
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
  await form(page).getByRole("button", { name: "기록", exact: true }).click();
  await form(page).getByRole("link", { name: "기록 상세", exact: true }).click();
  await openDetailEditor(page);
  await form(page).getByRole("button", { name: "취소", exact: true }).click();
  await form(page).getByRole("button", { name: "닫기", exact: true }).click();
  await page.getByRole("button", { name: "계정 전환 fixture", exact: true }).click();
  await page.goForward();
  await expect(form(page).getByRole("button", { name: /^이전:/ })).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("상세 탐색: 관련 편집 닫기도 처음 기록 목록 조건 복원", async ({ page }) => {
  const state = await fixtures(page);
  linkedFixture(state);
  await go(page, "/records?record_kind=user");
  await openListDetail(page, "기록");
  await form(page).getByRole("button", { name: "할 일", exact: true }).click();
  await form(page).getByRole("link", { name: "할 일 상세", exact: true }).click();
  await form(page).getByRole("button", { name: "닫기", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("record_kind")).toBe("user");
  await expect(page.locator(`#activity-records-${id(3)}`)).toBeFocused();
  expect(state.errors).toEqual([]);
});

test("상세 탐색 검색: 동시 추가 뒤 깊은 anchor와 reload 초점 복원", async ({ page }) => {
  const state = await fixtures(page);
  state.rows.records = Array.from(
    { length: 45 },
    (_, index) => ({ ...record(100 + index), body: `검색 기록 ${index}` }),
  );
  await page.route("**/api/search", (route) => {
    const input = route.request().postDataJSON(),
      start = Number(input.cursor ?? 0),
      items = state.rows.records.slice(start, start + 20);
    const anchor = input.anchor ? state.rows.records.findIndex((row) => row.id === input.anchor.id) : -1;
    return route.fulfill({
      json: {
        items: items.map((row) => ({
          id: row.id,
          kind: "record",
          title: recordDisplayText(row.body),
          snippet: row.body,
          snippet_start: 0,
          snippet_end: Array.from(row.body).length,
          at: stamp,
          path: `/records/${row.id}`,
          match: "keyword",
          index_state: "pending",
        })),
        next_cursor: start + 20 < state.rows.records.length ? String(start + 20) : null,
        anchor_page: anchor < 0 ? null : Math.floor(anchor / 20) + 1,
        search_state: "ok",
        semantic_coverage: { pending: 0, excluded: 0 },
      },
    });
  });
  await go(page, "/search?q=자료&kind=record");
  await page.getByRole("button", { name: "더 보기", exact: true }).click();
  const target = page.getByRole("link", { name: "검색 기록 35", exact: true });
  await target.click();
  await expect(form(page).getByRole("heading", { name: "기록", exact: true })).toBeVisible();
  state.rows.records.unshift(
    ...Array.from({ length: 21 }, (_, index) => ({ ...record(200 + index), body: `새 검색 기록 ${index}` })),
  );
  await form(page).getByRole("button", { name: /^이전: 검색/ }).click();
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  await expect(page.locator(".list .item-title")).toHaveCount(60);
  await page.reload();
  await expect(target).toBeFocused();
  await expect(target).toBeInViewport();
  expect(state.errors).toEqual([]);
});

for (const [kind, label] of [["tasks", "할 일"], ["records", "기록"], ["principles", "현재 기준"]]) {
  test(`상세 탐색 검색 ${kind}: 이전과 닫기는 검색·직접 링크`, async ({ page }) => {
    const state = await fixtures(page);
    await go(page, `/search?q=자료&kind=${kind.slice(0, -1)}`);
    await page.getByRole("link", { name: label, exact: true }).click();
    await form(page).getByRole("button", { name: /^이전: 검색/ }).click();
    await expect(page).toHaveURL(/\/search\?/);
    await expect(page.getByRole("link", { name: label, exact: true })).toBeFocused();
    await page.getByRole("link", { name: label, exact: true }).click();
    await form(page).getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page).toHaveURL(/\/search\?/);
    await go(page, `/${kind}/${state.rows[kind as "entities" | "tasks" | "records" | "principles"][0].id}`);
    await expect(form(page)).toHaveCount(1);
    await expect(form(page).getByRole("button", { name: /^이전:/ })).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });
}

for (const [kind, title] of [["entities", "엔터티"], ["tasks", "할 일"], ["records", "기록"]] as const) {
  test(`${kind}: 제목은 보기, 편집 저장은 보기와 목록 초점으로 복귀`, async ({ page }, info) => {
    const state = await fixtures(page);
    await go(page, `/${kind}`);
    await expect(page.getByRole("link", { name: `${title} 상세`, exact: true })).toHaveCount(0);
    await openListDetail(page, title);
    await expect(form(page).getByRole("textbox")).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
    await page.screenshot({ path: info.outputPath(`${kind}-read.png`) });
    await form(page).getByRole("button", { name: "편집", exact: true }).click();
    const footer = form(page).locator(".modal-foot");
    await expect(footer.getByRole("button", { name: "삭제", exact: true })).toBeVisible();
    await expect(form(page).locator(".modal-body").getByRole("button", { name: "삭제", exact: true })).toHaveCount(0);
    if (kind === "entities") {
      await form(page).getByLabel("속성 1", { exact: false }).fill("수정한 제목");
    } else await form(page).getByRole("textbox", { name: kind === "records" ? /^본문/ : /^제목/ }).fill("수정한 제목");
    await page.screenshot({ path: info.outputPath(`${kind}-edit.png`) });
    await saveOnce(page, form(page));
    await expect(form(page).getByRole("heading", { name: kind === "records" ? "기록" : "수정한 제목", exact: true }))
      .toBeVisible();
    await expect(form(page).getByRole("textbox")).toHaveCount(0);
    await form(page).getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page.getByRole("button", { name: "수정한 제목", exact: true })).toBeFocused();
    expect(state.writes.filter((w) => w.method === "PATCH")).toHaveLength(1);
    expect(state.errors).toEqual([]);
  });
}

for (
  const [kind, n, title] of [["entities", 1, "엔터티"], ["tasks", 2, "할 일"], ["records", 3, "기록"], [
    "principles",
    4,
    "현재 기준",
  ]] as const
) {
  for (const width of [390, 1440]) {
    test(`#185 ${kind} ${width}px: 제목만 클릭·동일 dialog 편집/취소·한 번 닫기`, async ({ page }, info) => {
      const state = await fixtures(page);
      await page.setViewportSize({ width, height: 900 });
      await go(page, `/${kind}`);
      await expect(page.getByRole("link", { name: title + " 상세", exact: true })).toHaveCount(0);
      const titleLink = page.getByRole(kind === "principles" ? "link" : "button", { name: title, exact: true }),
        row = titleLink.locator(
          "xpath=ancestor::section[contains(@class,'current-document')] | ancestor::li[contains(@class,'list-item')]",
        ).first();
      const t = (await titleLink.boundingBox())!, r = (await row.boundingBox())!;
      expect(t.width).toBeLessThan(r.width - 40);
      await page.mouse.click(t.x + t.width + 12, t.y + t.height / 2);
      await expect(form(page)).toHaveCount(0);
      await titleLink.click();
      if (kind !== "principles") await page.getByRole("link", { name: title + " 상세", exact: true }).click();
      await expect(form(page)).toHaveCount(1);
      await form(page).evaluate((el) => el.setAttribute("data-same-dialog", "yes"));
      await openDetailEditor(page);
      await expect(form(page)).toHaveAttribute("data-same-dialog", "yes");
      await expect(page.locator("dialog[open]")).toHaveCount(1);
      await form(page).getByRole("button", { name: "취소", exact: true }).click();
      await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(form(page)).toHaveAttribute("data-same-dialog", "yes");
      await openDetailEditor(page);
      await form(page).getByRole("textbox", {
        name: kind === "entities" ? /^속성 1/ : kind === "records" ? /^본문/ : /^제목/,
      }).fill("버릴 초안");
      await form(page).getByRole("button", { name: "닫기", exact: true }).click();
      const discard = page.getByRole("dialog", { name: "변경을 버릴까요?", exact: true });
      await expect(discard).toBeVisible();
      const b = (await discard.boundingBox())!;
      expect(b.height).toBeLessThan(450);
      expect(Math.abs(b.y + b.height / 2 - 450)).toBeLessThanOrEqual(2);
      await page.screenshot({ path: info.outputPath(`discard-${kind}-${width}.png`) });
      await discard.getByRole("button", { name: "취소", exact: true }).click();
      await expect(
        form(page).getByRole("textbox", {
          name: kind === "entities" ? /^속성 1/ : kind === "records" ? /^본문/ : /^제목/,
        }),
      ).toHaveValue("버릴 초안");
      await form(page).getByRole("button", { name: "닫기", exact: true }).click();
      await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
      await expect(page.locator("dialog[open]")).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`/${kind}[?#]`));
      expect(state.writes).toHaveLength(0);
      expect(state.errors).toEqual([]);
    });
  }
}

for (const [kind, n] of [["entities", 1], ["tasks", 2], ["records", 3], ["principles", 4]] as const) {
  test(`#185 ${kind}: 직접 편집 취소의 폐기 확인은 같은 보기로 복귀`, async ({ page }) => {
    const state = await fixtures(page);
    await go(page, `/${kind}/${kind === "entities" ? encodeURIComponent(entityKey(n)) : id(n)}?edit=1`);
    const input = form(page).getByRole("textbox", {
      name: kind === "entities" ? /^속성 1/ : kind === "records" ? /^본문/ : /^제목/,
    });
    await input.fill("취소할 편집");
    await form(page).getByRole("button", { name: "취소", exact: true }).click();
    const discard = page.getByRole("dialog", { name: "변경을 버릴까요?" });
    await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
    await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
    await expect(page).not.toHaveURL(/[?&]edit=/);
    expect(new URL(page.url()).pathname).toBe(
      `/${kind}/${kind === "entities" ? encodeURIComponent(entityKey(n)) : id(n)}`,
    );
    await expect(page.locator("dialog[open]")).toHaveCount(1);
    await expect(form(page).getByRole("textbox")).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}
