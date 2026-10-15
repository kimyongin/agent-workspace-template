import { setEntityCategory } from "./ui-actions.ts";
import { entityKey } from "./support/workspace-data.ts";
import { fillChangeMemo, openListEditor, openTabFilters } from "./ui-actions.ts";
import { recordDisplayText } from "../supabase/functions/_shared/contracts/record-display.ts";
import { discardEditor } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { id, stamp } from "./support/workspace-data.ts";
import { compatibleEdit, fixtures, form, go, linkedFixture } from "./support/workspace-screens.ts";

for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
  test(`시각 위계 ${width}px: 제목·보조 정보·편집 정렬과 검색·가이드`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixtures(page);
    state.rows.tasks[0].title = "긴 제목 ".repeat(8);
    Object.assign(state.rows.tasks[0], { change_note: "강조하지 않을 보충 메모" });
    const typography = async (selector: string) =>
      page.locator(selector).first().evaluate((el) => {
        const s = getComputedStyle(el);
        return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight), color: s.color };
      });
    for (
      const path of [
        "/entities",
        "/tasks",
        "/records",
        "/principles",
        "/tags/entity",
        "/tags/record",
        "/search",
        "/guide",
      ]
    ) {
      await go(page, path);
      await expect(
        page.locator(path.startsWith("/tags") ? "dialog[open]:not(.modal-confirm) .dialog-title" : ".page-title"),
      ).toBeVisible();
      if (!["/search", "/guide"].includes(path)) {
        await expect(page.locator(".item-title").first()).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
      if (await page.locator(".item-title").count()) {
        const title = await typography(".item-title"),
          pageTitle = await typography(path.startsWith("/tags") ? ".dialog-title" : ".page-title");
        expect(pageTitle.size).toBeGreaterThan(title.size);
        expect(title.weight).toBe(600);
        if (await page.locator(".secondary").count()) {
          const secondary = await typography(".secondary");
          expect(title.size).toBeGreaterThan(secondary.size);
          expect(title.weight).toBeGreaterThan(secondary.weight);
          expect(title.color).not.toBe(secondary.color);
        }
      }
      if (path === "/tasks") {
        const heading = page.locator(".related-item-title").first(),
          title = heading.locator(".item-title"),
          edit = heading.locator(".activity-item-actions a");
        const t = (await title.boundingBox())!;
        await expect(edit).toHaveCount(0);
        expect(t.height).toBeGreaterThanOrEqual(44);
        await expect(page.locator(".memo-text")).toHaveCount(0);
      }
      if (width === 390 && ["/tasks", "/guide", "/tags/entity", "/search"].includes(path)) {
        await page.screenshot({
          path: info.outputPath(`hierarchy-${path.slice(1).replaceAll("/", "-")}-${width}.png`),
        });
      }
    }
    Object.assign(state.rows.records[0], { body: "", tag_ids: [] });
    await go(page, `/records/${id(3)}`);
    await expect(form(page).locator(".document-summary,.markdown")).toHaveCount(0);
    await expect(form(page).getByRole("heading", { name: "태그", exact: true })).toHaveCount(0);
    await expect(form(page).getByRole("heading", { name: "기록", exact: true })).toHaveCount(1);
    await form(page).getByRole("button", { name: "편집", exact: true }).click();
    await expect(form(page).getByRole("textbox", { name: /^본문/ })).toHaveValue("");
    await expect(form(page).getByRole("heading", { name: "메모", exact: true })).toHaveCount(0);
    const head = await form(page).locator(".modal-head").boundingBox(),
      body = await form(page).locator(":scope > .modal-inner > .modal-body").boundingBox(),
      foot = await form(page).locator(".modal-foot").boundingBox();
    expect(head!.y + head!.height).toBeLessThanOrEqual(body!.y);
    expect(body!.y + body!.height).toBeLessThanOrEqual(foot!.y + 1);
    await go(page, `/records/${id(3)}`);
    Object.assign(state.rows.records[0], {
      record_kind: "change",
      body: "변경에 대한 보충 메모",
      entity_ids: [entityKey(1)],
      entity_context: [{ id: entityKey(1), title: "연결된 엔터티", source: "selection", captured_at: stamp }],
    });
    await page.reload();
    const memo = form(page).locator(".record-content .markdown");
    await expect(memo).toBeVisible();
    expect(await memo.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeLessThan(
      await form(page).locator(".dialog-title").evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
    );
    await expect(form(page).getByRole("button", { name: "연결된 엔터티", exact: true })).toBeVisible();
    await expect(form(page).getByText("연결 당시 정보", { exact: true })).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

for (const width of [390, 1440]) {
  test(`기능/목록 구획 ${width}px: 엔터티 편집만·독립 구획·할 일 여백`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.setViewportSize({ width, height: 900 });
    await go(page, "/entities");
    await page.screenshot({ path: info.outputPath(`tab-entities-${width}.png`) });
    const top = page.locator(".app-main > .panel"),
      bottom = page.getByRole("region", { name: "검사 자료 목록", exact: true });
    expect((await bottom.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await top.boundingBox())!.y + (await top.boundingBox())!.height,
    );
    const inset = 24,
      topBox = (await top.boundingBox())!,
      listBox = (await bottom.locator(".collection-list").boundingBox())!;
    expect((await top.getByRole("heading", { name: "검사 자료", exact: true }).boundingBox())!.x - topBox.x).toBeCloseTo(
      0,
    );
    expect((await top.getByLabel("자료 제목 검색", { exact: false }).boundingBox())!.x - topBox.x).toBeCloseTo(0);
    expect((await bottom.locator(".item-title").first().boundingBox())!.x - listBox.x).toBeGreaterThanOrEqual(inset);
    await expect(bottom.getByRole("link", { name: "자료 상세", exact: true })).toHaveCount(0);
    await openListEditor(page, "자료", bottom);
    await expect(form(page).getByLabel("제목", { exact: false })).toHaveValue("자료");
    await expect(form(page).getByRole("button", { name: "할 일 작성", exact: true })).toHaveCount(0);
    await expect(form(page).getByRole("link", { name: /목록/ })).toHaveCount(0);
    await expect(form(page).getByRole("button", { name: "취소", exact: true })).toHaveCount(1);
    await form(page).getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page.locator(`[id="entity-${entityKey(1)}"]`)).toBeFocused();
    await go(page, "/principles");
    const current = page.getByRole("region", { name: "현재 원칙", exact: true });
    expect((await current.boundingBox())!.y).toBeGreaterThanOrEqual(
      (await top.boundingBox())!.y + (await top.boundingBox())!.height,
    );
    await expect(top.getByRole("link", { name: "전체 기록 보기" })).toHaveAttribute("href", "/records");
    await expect(top.getByLabel("검색어", { exact: true })).toHaveCount(0);
    await expect(top.locator(".current-document,.record-date-group")).toHaveCount(0);
    await page.screenshot({ path: info.outputPath(`principles-sections-${width}.png`) });
    await go(page, "/tasks");
    expect(
      await page.getByRole("region", { name: "할 일 목록", exact: true }).locator(".collection-list .related-item")
        .first().evaluate((el) => parseFloat(getComputedStyle(el).paddingLeft)),
    ).toBeGreaterThanOrEqual(12);
    await page.screenshot({ path: info.outputPath(`tab-activity-${width}.png`) });
    await openListEditor(page, "할 일");
    await expect(form(page).getByRole("textbox", { name: /^제목(?: \(필수\))?$/ })).toHaveValue("할 일");
    await page.screenshot({ path: info.outputPath(`edit-task-${width}.png`) });
    const head = form(page).locator(".modal-head"), body = form(page).locator(":scope > .modal-inner > .modal-body");
    expect(
      await head.evaluate((el) => getComputedStyle(el).paddingLeft),
    ).toBe(width < 640 ? "16px" : "24px");
    expect(await body.evaluate((el) => getComputedStyle(el).paddingLeft)).toBe(width < 640 ? "16px" : "24px");
    expect(state.errors).toEqual([]);
  });
}

for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
  test(`#203 ${width}px: 목록·모달 공통 펼침과 전체 높이 표시선`, async ({ page }, info) => {
    const state = await fixtures(page);
    linkedFixture(state);
    await page.setViewportSize({ width, height: 900 });
    state.rows.records[0].body = "긴 한국어 기록😀".repeat(40) + "\n\n원문 마지막 부분";
    for (
      const [kind, n, title] of [["entities", 1, "자료"], ["tasks", 2, "할 일"], [
        "records",
        3,
        recordDisplayText(state.rows.records[0].body),
      ]] as const
    ) {
      await go(page, `/${kind}`);
      const row = page.locator(".list .related-item").first(),
        toggle = row.getByRole("button", { name: title, exact: true });
      await expect(toggle).toBeVisible();
      await expect(row.getByRole("link")).toHaveCount(0);
      await expect(row.locator(".related-preview")).toBeHidden();
      const marker = () =>
        row.evaluate((el) => {
          const s = getComputedStyle(el, "::before");
          return {
            left: s.left,
            width: s.width,
            color: s.backgroundColor,
            height: el.getBoundingClientRect().height - parseFloat(s.top) - parseFloat(s.bottom),
          };
        });
      const closed = await marker();
      await toggle.focus();
      await toggle.press("Enter");
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(row.getByRole("link", { name: title + " 상세", exact: true })).toBeVisible();
      const opened = await marker();
      expect(opened.left).toBe(closed.left);
      expect(opened.width).toBe(closed.width);
      expect(opened.color).not.toBe(closed.color);
      expect(opened.height).toBeGreaterThan(closed.height);
      if (kind === "records") {
        await expect(row.locator(".markdown")).toContainText("원문 마지막 부분");
      }
      for (const icon of await row.locator(".item-icon, .body-action").all()) {
        const box = (await icon.boundingBox())!;
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`${kind}-${width}.png`) });
      await row.getByRole("button", { name: title + " 접기", exact: true }).click();
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
    }
    await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
    const row = form(page).getByRole("region", { name: "할 일 (1개)" }).locator(".related-item");
    await expect(row.getByRole("link", { name: "할 일 상세", exact: true })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "할 일 해제", exact: true })).toHaveCount(0);
    await row.getByRole("button", { name: "할 일 열기", exact: true }).click();
    await expect(row.getByRole("link", { name: "할 일 상세", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name: "할 일 해제", exact: true })).toBeVisible();
    for (const action of await form(page).locator(".body-action").all()) {
      const box = (await action.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
      const face = action.locator(".body-action-face");
      expect((await face.boundingBox())!.height).toBe(24);
      expect(await face.evaluate((el) => getComputedStyle(el).fontSize)).toBe("13px");
      expect(await face.evaluate((el) => getComputedStyle(el).fontWeight)).toBe("400");
    }
    await row.getByRole("button", { name: "할 일 접기", exact: true }).click();
    await expect(row.getByRole("link", { name: "할 일 상세", exact: true })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "할 일 해제", exact: true })).toHaveCount(0);
    await row.getByRole("button", { name: "할 일 열기", exact: true }).click();
    await page.screenshot({ path: info.outputPath(`modal-${width}.png`) });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await go(page, "/principles");
    await expect(page.locator(".current-document .related-item")).toHaveCount(0);
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

test("#203 320px·200% 펼친 연결 조작과 메인 목록이 넘치지 않음", async ({ page }, info) => {
  const state = await fixtures(page);
  linkedFixture(state);
  await page.setViewportSize({ width: 320, height: 900 });
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
  await page.evaluate(() => document.documentElement.style.zoom = "2");
  await form(page).getByRole("button", { name: "할 일", exact: true }).click();
  await expect(form(page).getByRole("link", { name: "할 일 상세", exact: true })).toBeVisible();
  expect(await form(page).locator(".modal-body").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  for (const button of await form(page).locator(".related-item-actions :is(button,a)").all()) {
    const rect = (await button.boundingBox())!;
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(320);
  }
  await page.screenshot({ path: info.outputPath("expanded-zoom-200.png") });
  await go(page, "/tasks");
  await page.evaluate(() => document.documentElement.style.zoom = "2");
  await page.getByRole("button", { name: "할 일", exact: true }).click();
  await expect(page.getByRole("link", { name: "할 일 상세", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.errors).toEqual([]);
  expect(state.writes).toHaveLength(0);
});

for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
  test(`shell ${width}px: 긴 제목·본문 스크롤·키보드·단일 surface`, async ({ page }, info) => {
    const state = await fixtures(page, { long: true });
    await page.setViewportSize({ width, height: 800 });
    await go(page, `/tasks/${id(2)}`);
    await expect(form(page)).toBeVisible();
    const dimensions = await form(page).evaluate((d) => {
      const r = d.getBoundingClientRect();
      return { width: r.width, height: r.height, scroll: document.documentElement.scrollWidth, viewport: innerWidth };
    });
    expect(dimensions.scroll).toBeLessThanOrEqual(width);
    expect(dimensions.width).toBeLessThanOrEqual(width < 640 ? width : 672);
    if (width < 640) {
      expect(dimensions.width).toBe(width);
    }
    await form(page).locator(":scope > .modal-inner > .modal-body").evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });
    await expect(form(page).getByRole("button", { name: "닫기", exact: true })).toBeInViewport();
    await expect(form(page).getByRole("button", { name: "닫기", exact: true })).toBeInViewport();
    await form(page).locator(":scope > .modal-inner > .modal-body").evaluate((el) => {
      el.scrollTop = 0;
    });
    await compatibleEdit(page);
    await expect(form(page)).toHaveCount(1);
    await fillChangeMemo(page, form(page), "길이 검수");
    await page.keyboard.press("Tab");
    await page.screenshot({ path: info.outputPath(`surface-${width}.png`) });
    await discardEditor(page);
    await expect(page.getByRole("dialog", { name: "변경을 버릴까요?" })).toBeVisible();
    expect(state.errors).toEqual([]);
  });
}

for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
  test(`소비 화면 ${width}px: 목록·원칙·기록·엔터티·태그`, async ({ page }, info) => {
    const state = await fixtures(page, { long: true });
    state.rows.tags[0].name = "긴이름".repeat(10);
    await page.setViewportSize({ width, height: 800 });
    for (const path of ["/entities", "/tasks", "/records", "/principles", "/tags/entity", "/tags/record"]) {
      await go(page, path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        path,
      ).toBe(true);
    }
    for (const [kind, n] of [["entities", 1], ["records", 3], ["principles", 4]] as const) {
      await go(page, `/${kind}/${kind === "entities" ? encodeURIComponent(entityKey(n)) : id(n)}`);
      await expect(form(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), kind).toBe(true);
      await expect(form(page).getByRole("button", { name: "닫기", exact: true })).toBeInViewport();
      await page.screenshot({ path: info.outputPath(`${kind}-${width}.png`) });
    }
    await go(page, `/tags/entity?edit=${id(10)}`);
    await expect(form(page).getByRole("form", { name: "태그 이름 변경" })).toBeVisible();
    await expect(form(page)).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`tags-${width}.png`) });
    expect(state.errors).toEqual([]);
  });
}

test("200% reflow·축소 visual viewport·한 글자 제목", async ({ page }, info) => {
  const state = await fixtures(page);
  state.rows.tasks[0].title = "일";
  await page.setViewportSize({ width: 768, height: 800 });
  await go(page, `/tasks/${id(2)}?edit=1`);
  await page.evaluate(() => {
    document.documentElement.style.zoom = "2";
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(form(page).getByRole("button", { name: "닫기", exact: true })).toBeInViewport();
  await expect(form(page).getByRole("button", { name: "저장", exact: true })).toBeInViewport();
  await fillChangeMemo(page, form(page), "확대 확인");
  await page.setViewportSize({ width: 390, height: 360 });
  await expect(form(page).getByRole("button", { name: "수정하고 저장", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(form(page).getByRole("button", { name: "취소", exact: true })).toBeInViewport({ ratio: 1 });
  const actions = await form(page).locator(".modal-foot > .btn").evaluateAll(nodes => nodes.map(node => ({ width: node.getBoundingClientRect().width, height: node.getBoundingClientRect().height })));
  for (const action of actions) { expect(action.width).toBeGreaterThanOrEqual(44); expect(action.height).toBeGreaterThanOrEqual(44); }
  await page.screenshot({ path: info.outputPath("zoom-keyboard-viewport.png") });
  expect(state.errors).toEqual([]);
});

for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
  test(`공통 연결 목록 ${width}px: 엔터티·할 일·기록 카드 위계와 탐색`, async ({ page }, info) => {
    const state = await fixtures(page), r = state.rows.records[0], t = state.rows.tasks[0];
    Object.assign(r, {
      body: "상담 결과 " + "긴본문대표문구".repeat(18),
      record_kind: "result",
      task_id: t.id,
      entity_ids: [entityKey(1)],
      entity_context: [{
        id: entityKey(1),
        title: "고객 " + "긴이름".repeat(25),
        source: "selection",
        captured_at: stamp,
      }],
    });
    Object.assign(t, {
      entity_ids: r.entity_ids,
      entity_context: r.entity_context,
      status: "done",
      completed_at: stamp,
      result_record_id: r.id,
      result_record: { id: r.id, body: r.body },
    });
    Object.assign(state.rows.entities[0], { tasks: { count: 1, items: [t] }, records: { count: 1, items: [r] } });
    await page.setViewportSize({ width, height: 900 });
    const styles: string[] = [];
    for (const path of [`/entities/${encodeURIComponent(entityKey(1))}`, `/tasks/${t.id}`, `/records/${r.id}`]) {
      await go(page, path);
      const links = form(page).locator(".related-item");
      await expect(links).toHaveCount(2);
      for (const last of await form(page).locator(".related-items > li:last-child .related-item").all()) {
        expect(
          await last.evaluate((el) => getComputedStyle(el).borderBottomWidth),
        ).toBe("0px");
      }
      const first = links.first();
      styles.push(
        await first.evaluate((el) => {
          const c = getComputedStyle(el);
          return [c.padding, c.borderRadius, c.backgroundColor, c.borderWidth].join("|");
        }),
      );
      for (const link of await links.all()) {
        const box = (await link.boundingBox())!;
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.width).toBeGreaterThanOrEqual(44);
      }
      await expect(form(page).getByText("연결 당시 정보", { exact: true })).toHaveCount(0);
      await expect(form(page).getByText("저장 정보", { exact: true })).toHaveCount(0);
      await expect(form(page)).not.toContainText("만든 시각");
      if (path.startsWith("/tasks/")) {
        await expect(form(page).getByRole("heading", { name: "관련 정보", exact: true })).toHaveCount(0);
        await expect(form(page)).toContainText("완료 시각");
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
      if (width === 390) await page.screenshot({ path: info.outputPath(`related-${path.split("/")[1]}.png`) });
    }
    expect(new Set(styles).size).toBe(1);
    const linked = form(page).getByRole("region", { name: "할 일 (1개)" }).getByRole("button", {
      name: t.title,
      exact: true,
    });
    await linked.click();
    await expect(linked).toHaveAttribute("aria-expanded", "true");
    expect(new URL(page.url()).pathname).toBe(`/records/${r.id}`);
    await form(page).getByRole("link", { name: t.title + " 상세", exact: true }).click();
    expect(new URL(page.url()).pathname).toBe(`/tasks/${t.id}`);
    expect(new URL(page.url()).searchParams.has("edit")).toBe(false);
    await form(page).getByRole("button", { name: "이전: 기록", exact: true }).click();
    await expect(form(page).getByRole("link", { name: t.title + " 상세", exact: true })).toBeFocused();
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

// #205 verifies density without shrinking interaction targets, and catches layout drift across consumers.
for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
  test(`#205 ${width}px: 컴팩트 목록·정렬된 필터·초기화 문맥`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.setViewportSize({ width, height: 900 });
    for (
      const [kind, label, value] of [["entities", "분류 필터", "a"], ["tasks", "할 일 종류", "once"], [
        "records",
        "기록 종류",
        "user",
      ]]
    ) {
      await go(page, "/" + kind);
      const row = page.locator(".list .related-item").first();
      await expect(row).toBeVisible();
      const box = (await row.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeLessThanOrEqual(52);
      await expect(
        page.getByRole("button", {
          name: kind === "entities" ? "검사 자료 추가" : kind === "tasks" ? "할 일 등록" : "기록 작성",
          exact: true,
        }),
      ).toBeVisible();
      await openTabFilters(page);
      const grid = page.locator(".filter-grid");
      const inputs = await grid.locator("input,select").evaluateAll((nodes) =>
        nodes.map((el) => {
          const b = el.getBoundingClientRect();
          return { x: b.x, y: b.y, right: b.right, h: b.height };
        })
      );
      for (const field of inputs) {
        expect(field.h).toBeGreaterThanOrEqual(44);
        expect(field.right).toBeLessThanOrEqual(width);
      }
      if (kind !== "entities") expect(inputs[0].y).toBeCloseTo(inputs[1].y);
      else await expect(page.locator(".main-tab-header").getByLabel("자료 종류", { exact: true })).toBeVisible();
      const filterBottom = (await grid.boundingBox())!;
      expect((await page.getByRole("group", { name: kind === "entities" ? "자료 태그" : kind === "tasks" ? "할 일 태그" : "기록 태그", exact: true }).boundingBox())!.y).toBeGreaterThanOrEqual(
        filterBottom.y + filterBottom.height,
      );
      if (kind === "entities") await setEntityCategory(page, value);
      else { await page.getByLabel(label, { exact: true }).selectOption(value); await page.getByRole("button", { name: "필터 적용", exact: true }).click(); }
      const search = page.getByLabel(kind === "entities" ? "자료 제목 검색" : "검색어", { exact: true });
      await search.fill("조건 유지");
      await expect.poll(() => new URL(page.url()).searchParams.get(kind === "entities" ? "keyword" : "q")).toBe(
        "조건 유지",
      );
      const appliedBeforeReset = page.url();
      await page.getByRole("button", { name: "조건 초기화", exact: true }).click();
      expect(page.url()).toBe(appliedBeforeReset);
      await page.getByRole("button", { name: "필터 적용", exact: true }).click();
      const params = new URL(page.url()).searchParams;
      expect(params.get("filters")).toBe("1");
      expect(params.get(kind === "entities" ? "keyword" : "q")).toBe("조건 유지");
      expect(params.has(kind === "entities" ? "property_filters" : kind === "tasks" ? "kind" : "record_kind")).toBe(false);
      await expect(search).toHaveValue("조건 유지");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 390 || width === 1440) {
        await page.screenshot({ path: info.outputPath(`compact-filter-${kind}-${width}.png`) });
      }
    }
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

for (const width of [320, 1440]) {
  test(`#205 ${width}px: 태그 입력·본문 정렬과 확대된 열린 필터`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.setViewportSize({ width, height: 900 });
    await go(page, "/tags/entity");
    const body = form(page).locator(".modal-body"),
      editor = form(page).getByRole("form", { name: "태그 추가", exact: true }),
      input = editor.getByRole("textbox"),
      box = (await input.boundingBox())!,
      parent = (await editor.boundingBox())!;
    if (width >= 640) {
      expect((await form(page).boundingBox())!.height).toBeLessThan(500);
    }
    expect(box.x).toBeCloseTo(parent.x);
    expect(box.width).toBeGreaterThan(100);
    expect(box.x + box.width).toBeLessThanOrEqual(parent.x + parent.width + 1);
    expect(await body.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`compact-tags-${width}.png`) });
    await go(page, "/entities?filters=1");
    await page.evaluate(() => document.documentElement.style.fontSize = "200%");
    const reset = page.getByRole("button", { name: "조건 초기화", exact: true }),
      summary = page.getByRole("button", { name: /^필터 (열기|닫기)/ }),
      r = (await reset.boundingBox())!,
      s = (await summary.boundingBox())!;
    expect(r.y >= s.y + s.height || r.x >= s.x + s.width || r.x + r.width <= s.x).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => document.documentElement.style.fontSize = "");
    expect(state.errors).toEqual([]);
  });
}

for (const width of [320, 390, 639, 640]) {
  test(`mobile-entity-query ${width}px: type comes first and property filters fit the panel`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.setViewportSize({ width, height: 900 });
    await go(page, "/entities");
    const header = page.locator(".main-tab-header");
    const picker = header.getByLabel("자료 종류", { exact: true });
    const search = header.getByLabel("자료 제목 검색", { exact: true });
    expect((await picker.boundingBox())!.y + (await picker.boundingBox())!.height).toBeLessThan((await search.boundingBox())!.y);
    await expect(header.getByRole("link", { name: "자료 설정", exact: true })).toHaveCount(0);
    await expect(header.locator(".entity-type-picker .help")).toHaveCount(0);
    await expect(header.locator(".entity-type-picker label.label")).toHaveClass(/visually-hidden/);
    await openTabFilters(page);
    await page.getByRole("button", { name: "속성 조건 추가", exact: true }).click();
    for (const scale of ["100%", "200%"]) {
      await page.evaluate(value => { document.documentElement.style.fontSize = value; }, scale);
      const panel = header.locator(".tab-filters > .form");
      const condition = panel.locator(".entity-property-condition");
      await expect(condition).toHaveCount(1);
      const controls = condition.locator("input,select");
      await expect(controls).toHaveCount(3);
      const [property, comparison, value] = await controls.evaluateAll(elements => elements.map(el => {
        const box = el.getBoundingClientRect();
        return { x: box.x, y: box.y, right: box.right, bottom: box.bottom };
      }));
      const remove = (await condition.getByRole("button", { name: "조건 1 제거", exact: true }).boundingBox())!;
      expect(remove.y).toBeCloseTo(property.y);
      expect(remove.width).toBeGreaterThanOrEqual(44);
      expect(remove.height).toBeGreaterThanOrEqual(44);
      if (scale === "100%" || Math.abs(property.y - comparison.y) < 1) {
        expect(property.y).toBeCloseTo(comparison.y);
        expect(property.right).toBeLessThanOrEqual(comparison.x);
        expect(comparison.right).toBeLessThanOrEqual(remove.x);
      } else {
        // Enlarged text may give each field its own row while keeping the remove action beside the property.
        expect(property.right).toBeLessThanOrEqual(remove.x);
        expect(comparison.y).toBeGreaterThanOrEqual(Math.max(property.bottom, remove.y + remove.height));
        expect(comparison.x).toBeCloseTo(property.x);
        expect(comparison.right).toBeCloseTo(value.right);
      }
      expect(value.y).toBeGreaterThanOrEqual(Math.max(property.bottom, comparison.bottom));
      expect(value.x).toBeCloseTo(property.x);
      expect(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), scale).toBe(true);
      const boxes = await panel.locator("input,select,button").evaluateAll(elements => elements.map(el => {
        const box = el.getBoundingClientRect();
        return { left: box.left, right: box.right };
      }));
      const panelBox = (await panel.boundingBox())!;
      for (const box of boxes) {
        expect(box.left).toBeGreaterThanOrEqual(panelBox.x);
        expect(box.right).toBeLessThanOrEqual(panelBox.x + panelBox.width);
      }
      if (scale === "200%") await panel.screenshot({ path: info.outputPath(`property-filter-${width}-text200.png`) });
    }
    expect(state.writes).toHaveLength(0);
  });
}
