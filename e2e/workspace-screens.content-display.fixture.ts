import { expect, test } from "@playwright/test";
import { entityKey, id, stamp } from "./support/workspace-data.ts";
import { connectedTarget, fixtures, form, go } from "./support/workspace-screens.ts";

for (const width of [390, 1440]) {
  for (const [kind, n] of [["tasks", 2], ["records", 3], ["principles", 4]] as const) {
    test(`문서 viewer ${kind} ${width}px: 정보 구획·편집과 안전한 markdown`, async ({ page }, info) => {
      const state = await fixtures(page), item = state.rows[kind][0];
      if ("tag_ids" in item) item.tag_ids = [id(11)];
      item.body =
        "검증 **본문**\n\n[위험 링크](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n![외부](https://example.invalid/never-load.png)\n\n- [x] 읽기 확인\n\n~~취소선~~\n\nhttps://example.com";
      const images: string[] = [];
      page.on("request", (r) => {
        if (r.url().includes("never-load.png")) images.push(r.url());
      });
      await page.setViewportSize({ width, height: 800 });
      await go(page, `/${kind}/${id(n)}`);
      await expect(
        form(page).locator(kind === "records" ? ".dialog-title" : ".detail-title").filter({
          hasText: "title" in item ? item.title : "기록",
        }),
      ).toBeVisible();
      await expect(form(page).locator(".markdown strong")).toHaveText("본문");
      await expect(form(page).locator(".document-summary")).toHaveCount(0);
      await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(form(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await expect(form(page).getByRole("button", { name: "닫기", exact: true })).toBeVisible();
      await expect(form(page).locator(".panel,img,script,a[href^='javascript:']")).toHaveCount(0);
      await expect(form(page).getByRole("link", { name: "이미지: 외부", exact: true })).toHaveAttribute(
        "rel",
        "noopener noreferrer nofollow",
      );
      await expect(form(page).getByRole("checkbox")).toBeDisabled();
      await expect(form(page).getByRole("checkbox")).toBeChecked();
      await expect(form(page).locator("del")).toHaveText("취소선");
      expect(images).toEqual([]);
      expect(state.writes).toHaveLength(0);
      expect(state.errors).toEqual([]);
      await page.screenshot({ path: info.outputPath(`viewer-${kind}-${width}.png`) });
    });
  }
}

for (const width of [390, 1440]) {
  test(`숨긴 scrollbar ${width}px: wheel·PageDown·긴 코드 가로 스크롤`, async ({ page }, info) => {
    const state = await fixtures(page, { long: true });
    state.rows.tasks[0].body = "```text\n" + "long_unbroken_code_".repeat(100) + "\n```\n\n" +
      "긴 본문 문단\n\n".repeat(200);
    await page.setViewportSize({ width, height: 800 });
    await go(page, `/tasks/${id(2)}`);
    const body = form(page).locator(":scope > .modal-inner > .modal-body"), code = form(page).locator("pre");
    await expect(code).toBeVisible();
    expect(
      await body.evaluate((el) => getComputedStyle(el).scrollbarWidth),
    ).toBe("none");
    expect(await code.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await code.hover();
    await page.mouse.wheel(240, 0);
    await expect.poll(() => code.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await body.hover();
    await page.mouse.wheel(0, 400);
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    const before = await body.evaluate((el) => el.scrollTop);
    await body.focus();
    await page.keyboard.press("PageDown");
    await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(before);
    await expect(form(page).getByRole("button", { name: "닫기", exact: true })).toBeInViewport();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`scroll-${width}.png`) });
    await page.keyboard.press("Escape");
    await expect(form(page)).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });
}

for (const width of [390, 1440]) {
  test(`긴 GFM 표 ${width}px: 표 안 가로 스크롤·안전 체크리스트`, async ({ page }, info) => {
    const state = await fixtures(page),
      cells = Array.from({ length: 40 }, (_, i) => `열${i} 긴값`),
      row = "|" + cells.join("|") + "|";
    state.rows.records[0].body = row + "\n|" + cells.map(() => "---").join("|") + "|\n" + row +
      "\n\n- [ ] 읽기 항목\n\n" + "아래 본문\n\n".repeat(30);
    await page.setViewportSize({ width, height: 800 });
    await go(page, `/records/${id(3)}`);
    const table = form(page).getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader")).toHaveCount(40);
    expect(await table.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await table.evaluate((el) => getComputedStyle(el).scrollbarWidth)).toBe("none");
    await table.hover();
    await page.mouse.wheel(300, 0);
    await expect.poll(() => table.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
    await expect(form(page).getByRole("checkbox")).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`table-${width}.png`) });
    expect(state.writes).toHaveLength(0);
    expect(state.errors).toEqual([]);
  });
}

for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
  test(`기록 정돈 ${width}px: 본문·변경 정보·연결 중심의 간결한 상세`, async ({ page }, info) => {
    const state = await fixtures(page);
    await page.setViewportSize({ width, height: 850 });
    Object.assign(state.rows.records[0], {
      body: "상담 준비 수정 (일정, 내용)",
      record_kind: "change",
      entity_ids: [entityKey(1)],
      entity_context: [{ id: entityKey(1), title: "테스트 속성1222", source: "selection", captured_at: stamp }],
      change: {
        event_id: id(30),
        target_kind: "task",
        target_id: id(2),
        target_title: "상담 준비 " + "긴제목".repeat(14),
        action: "update",
        source: "http",
        before: { title: "기존 할 일" },
        after: { title: "상담 준비" },
        path: `/tasks/${id(2)}`,
      },
    });
    await go(page, `/records/${id(3)}`);
    await expect(
      connectedTarget(page, "task").getByRole("button", {
        name: state.rows.records[0].change!.target_title,
        exact: true,
      }),
    ).toBeVisible();
    const text = form(page).locator(".record-content .markdown"),
      meta = form(page).locator(".record-context .props dt").first();
    const style = async (el: ReturnType<typeof form>) =>
      el.evaluate((n) => ({ size: parseFloat(getComputedStyle(n).fontSize), color: getComputedStyle(n).color }));
    expect((await style(text)).size).toBeGreaterThan((await style(meta)).size);
    expect((await style(text)).color).not.toBe((await style(meta)).color);
    await expect(form(page).getByText("저장 정보", { exact: true })).toHaveCount(0);
    await expect(form(page)).not.toContainText("만든 시각");
    await expect(form(page).getByRole("button", { name: "닫기", exact: true })).toHaveText("×");
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    const card = connectedTarget(page, "task").locator(".related-item");
    const entityCard = form(page).getByRole("region", { name: "연결된 자료 (1개)", exact: true }).locator(".related-item");
    const cardStyle = async (el: ReturnType<typeof form>) =>
      el.evaluate((n) => {
        const c = getComputedStyle(n);
        return [c.padding, c.borderRadius, c.backgroundColor, c.borderWidth].join("|");
      });
    expect(await cardStyle(card)).toBe(await cardStyle(entityCard));
    expect((await card.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath(`record-layout-${width}.png`) });
    expect(state.errors).toEqual([]);
  });
}
