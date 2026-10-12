import { createFixtureEntity, scalarFixtureType, fixtureEntityList } from "./entity-schema-support.ts";
import { fillChangeMemo } from "./ui-actions.ts";
import { saveOnce, openDetailEditor, openListDetail, openTabFilters } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";

for (
  const [kind, path, label, editLabel] of [
    ["task", "tasks", "할 일", "할 일 편집"],
    ["record", "records", "기록", "기록 편집"],
  ] as const
) {
  test(`${label} 추가 페이지의 상세·편집·뒤로가기·새로고침·삭제가 목록 문맥과 초점을 복원한다`, async ({ page, isMobile }) => {
    // Native-dialog list restoration; retained desktop panels have their own workspace suite.
    if (!isMobile) await page.setViewportSize({width:1024,height:720});
    await devLogin(page);
    const mcp = await mcpClient(await mcpTokenViaConsent(page));
    const ids = new Set<string>();
    const tag = await mcp.call("create_tag", { scope:kind, name: unique("활동 왕복").slice(0, 30) });
    const emptyTag = await mcp.call("create_tag", { scope:kind, name: unique("빈 활동 조건").slice(0, 30) });
    const entity = await createFixtureEntity(mcp, { prop_1: unique("활동 문맥"), prop_2: 0 });
    const title = unique(`${label} 복원 대상`);
    const create = async (title: string) => {
      const item = await mcp.call(`create_${kind}`, {
        ...(kind === "task" ? { kind: "once" } : {}),
        ...(kind === "task" ? {title} : {}),
        body: title,
        tag_ids: [tag.id],
        entity_ids: [entity.id],
      });
      ids.add(item.id);
      return item;
    };
    try {
      const target = await create(title);
      for (let i = 0; i < 41; i++) await create(unique("앞선 항목"));
      const listPath = `/${path}?tag_id=${tag.id}`;
      await page.goto(listPath);
      await expect(page.locator(`.${path} .list .item-title`)).toHaveCount(20);
      const requests: (string | null)[] = [];
      let failedCursor: string | null = null;
      let releaseRetry!: () => void;
      const retryHeld = new Promise<void>((resolve) => {
        releaseRetry = resolve;
      });
      await page.route(`**/api/${path}?**`, async (route) => {
        const cursor = new URL(route.request().url()).searchParams.get("cursor");
        requests.push(cursor);
        if (cursor && !failedCursor) {
          failedCursor = cursor;
          await route.fulfill({
            status: 503,
            contentType: "application/json",
            body: JSON.stringify({ code: "internal", message: "temporary list failure" }),
          });
        } else {
          if (cursor) await retryHeld;
          await route.continue();
        }
      });
      const more = page.locator(`#activity-${path}-page-control`);
      await more.click();
      const retry = page.getByRole("button", { name: "다시 시도", exact: true });
      await expect(retry).toBeVisible();
      await expect(page.locator(`.${path} .list .item-title`)).toHaveCount(20);
      await retry.scrollIntoViewIfNeeded();
      await retry.focus();
      const scrollBefore = await page.evaluate(() => window.scrollY);
      const readingRow = page.locator(`#${await page.locator(`.${path} .list .item-title`).last().getAttribute("id")}`);
      await expect(readingRow).toBeInViewport();
      const readingY = (await readingRow.boundingBox())!.y;
      if (kind === "task") await page.keyboard.press("Enter");
      else await retry.click();
      const control = page.locator(`#activity-${path}-page-control`);
      await expect.poll(() => requests.length).toBe(2);
      expect(requests).toEqual([failedCursor, failedCursor]);
      expect(failedCursor).toBeTruthy();
      await expect(page.locator(`.${path} .list .item-title`)).toHaveCount(20);
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BUTTON");
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
      expect((await readingRow.boundingBox())!.y).toBeCloseTo(readingY, 1);
      await page.keyboard.press("Enter");
      expect(requests).toHaveLength(2);
      releaseRetry();
      await expect(page.locator(`.${path} .list .item-title`)).toHaveCount(40);
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BUTTON");
      await expect(control).toBeFocused();
      await expect(control).toHaveAttribute("aria-disabled", "false");
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
      await expect(readingRow).toBeInViewport();
      expect((await readingRow.boundingBox())!.y).toBeCloseTo(readingY, 1);
      await control.scrollIntoViewIfNeeded();
      const lastRow = page.locator(`#${await page.locator(`.${path} .list .item-title`).last().getAttribute("id")}`);
      await expect(lastRow).toBeInViewport();
      const lastY = (await lastRow.boundingBox())!.y;
      const lastScroll = await page.evaluate(() => window.scrollY);
      await control.click();
      await expect(page.locator(`.${path} .list .item-title`)).toHaveCount(42);
      await expect(control).toBeFocused();
      await expect(control).toHaveAttribute("aria-disabled", "true");
      expect(await page.evaluate(() => window.scrollY)).toBe(lastScroll);
      await expect(lastRow).toBeInViewport();
      expect((await lastRow.boundingBox())!.y).toBeCloseTo(lastY, 1);
      await page.keyboard.press("Enter");
      expect(requests).toHaveLength(3);
      await page.unroute(`**/api/${path}?**`);
      let link = page.getByRole("button", { name: title, exact: true });
      await link.scrollIntoViewIfNeeded();
      await link.focus();
      await page.keyboard.press("Enter");
      await expect(link).toHaveAttribute("aria-expanded","true");
      await openListDetail(page,title);
      await expect(page.getByRole("heading", { name: kind === "record" ? "기록" : title, exact: true })).toBeVisible();
      const view=page.locator("dialog.modal:not(.modal-confirm)[open]");
      const initialDetail=page.url(),entityToggle=view.getByRole("region",{name:/^연결된 자료/}).getByRole("button",{name:entity.title,exact:true});
      await entityToggle.click();await expect(entityToggle).toHaveAttribute("aria-expanded","true");await expect(page).toHaveURL(initialDetail);
      const entityEdit=view.getByRole("link",{name:entity.title+" 상세",exact:true});await entityEdit.click();await openDetailEditor(page);
      await expect(view.getByLabel("제목",{exact:false})).toHaveValue(entity.title);await view.getByRole("button",{name:"취소",exact:true}).click();await view.getByRole("button",{name:/^이전:/}).click();
      await expect(page).toHaveURL(initialDetail);await expect(entityEdit).toBeFocused();
      await openDetailEditor(page);const dialog=page.getByRole("dialog",{name:editLabel,exact:true});
      await dialog.getByLabel("본문").fill("닫기 취소 뒤 보존할 초안");await dialog.getByRole("button",{name:"닫기",exact:true}).click();
      const discard=page.getByRole("dialog",{name:"변경을 버릴까요?",exact:true});await discard.getByRole("button",{name:"취소",exact:true}).click();await expect(dialog.getByLabel("본문")).toHaveValue("닫기 취소 뒤 보존할 초안");
      expect((await mcp.call(`get_${kind}`,{id:target.id})).body).toBe(target.body);await dialog.getByLabel("본문").fill(target.body);await dialog.getByRole("button",{name:"닫기",exact:true}).click();
      await expect(link).toBeFocused();await openListDetail(page,await link.innerText());
      for (let i = 0; i < 21; i++) await create(unique("상세 중 추가"));
      await page.goBack();
      await expect(page.locator(`.${path} .list .item-title`)).toHaveCount(63);
      await expect(link).toBeFocused();
      await expect(link).toBeInViewport();
      await openTabFilters(page);await expect(page.getByRole("button",{name:tag.name,exact:true})).toHaveAttribute("aria-pressed","true");
      await page.reload();
      await expect(page.locator(`.${path} .list .item-title`)).toHaveCount(63);
      await expect(link).toBeFocused();
      await openListDetail(page,await link.innerText());
      await openDetailEditor(page);
      await dialog.getByLabel("본문").fill("수정한 근거");
      if(kind==="task")await fillChangeMemo(page,dialog,"판단 근거 정정");
      await saveOnce(page, dialog);
      await expect(dialog).not.toBeVisible();
      if(kind==="record")link=page.getByRole("button",{name:"수정한 근거",exact:true});
      await page.getByRole("button", { name: "닫기", exact: true }).click();
      await expect(link).toBeFocused();
      await expect(link).toBeInViewport();
      await openListDetail(page,await link.innerText());
      await openDetailEditor(page);
      await page.getByRole("button", { name: "삭제", exact: true }).click();
      await saveOnce(page,page.locator("dialog.modal-action[open]"),"삭제 확인");
      await expect(link).toHaveCount(0);
      await expect(page.locator(`.${path} .list .item-title`)).toHaveCount(62);
      ids.delete(target.id);
      await expect(page.getByRole("heading", { name: label, level:1, exact: true })).toBeFocused();
      await expect(page.locator(`#activity-${path}-page-control`)).toHaveCount(0);
      await openTabFilters(page);await page.getByRole("button",{name:tag.name,exact:true}).click();await page.getByRole("button",{name:emptyTag.name,exact:true}).click();
      await expect(page.locator(`.${path} .list .item-title`)).toHaveCount(0);
      expect(new URL(page.url()).hash).toBe("");
      expect(new URL(page.url()).searchParams.has("pages")).toBe(false);
      expect(new URL(page.url()).searchParams.has("scroll")).toBe(false);
      // An edited item that leaves the entity filter also restores a valid
      // fallback focus, without widening the filter to include detached items.
      const leaving = await create(unique("연결 조건 이탈"));
      await page.goto(listPath);
      const leavingLink = page.getByRole("button", { name: kind === "record" ? leaving.body : leaving.title, exact: true });
      await openListDetail(page,await leavingLink.innerText());
      await mcp.call(`update_${kind}`, { id: leaving.id, expected_version: leaving.version, tag_ids: [], ...(kind === "task" ? {change_note:"태그 해제"} : {}) });
      await page.goBack();
      await expect(leavingLink).toHaveCount(0);
      await expect(page.getByRole("heading", { name: label, level:1, exact: true })).toBeFocused();
      await openTabFilters(page);await expect(page.getByRole("button",{name:tag.name,exact:true})).toHaveAttribute("aria-pressed","true");
    } finally {
      try {
        for (const id of ids) {
          try {
            const item = await mcp.call(`get_${kind}`, { id });
            await mcp.call(`delete_${kind}`, { id, expected_version: item.version });
          } catch (error) {
            if (!String(error).includes('"code":"not_found"')) throw error;
          }
        }
        await mcp.call("delete_tag", { id: tag.id, expected_version: 1 });
        await mcp.call("delete_tag", { id: emptyTag.id, expected_version: 1 });
        await mcp.call("delete_entity", { id: entity.id, expected_version: 1 });
      } finally {
        await mcp.close();
      }
    }
  });
}
