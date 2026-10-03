import { expect, test } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";

for (
  const [kind, path, label, editLabel] of [
    ["task", "tasks", "할 일", "할 일 편집"],
    ["record", "records", "기록", "기록 편집"],
  ] as const
) {
  test(`${label} 추가 페이지의 상세·편집·뒤로가기·새로고침·삭제가 목록 문맥과 초점을 복원한다`, async ({ page }) => {
    await devLogin(page);
    const mcp = await mcpClient(await mcpTokenViaConsent(page));
    const ids = new Set<string>();
    const tag = await mcp.call("create_tag", { name: unique("활동 왕복").slice(0, 30) });
    const emptyTag = await mcp.call("create_tag", { name: unique("빈 활동 조건").slice(0, 30) });
    const entity = await mcp.call("create_entity", { prop1: unique("활동 문맥"), prop2: 0 });
    const title = unique(`${label} 복원 대상`);
    const create = async (title: string) => {
      const item = await mcp.call(`create_${kind}`, {
        ...(kind === "task" ? { kind: "once" } : {}),
        title,
        summary: "추가 페이지에서 진입하는 대상",
        tag_ids: [tag.id],
        entity_id: entity.id,
      });
      ids.add(item.id);
      return item;
    };
    try {
      const target = await create(title);
      for (let i = 0; i < 21; i++) await create(unique("앞선 항목"));
      const listPath = `/${path}?tag_id=${tag.id}&entity_id=${entity.id}${
        kind === "task" ? "&kind=once&status=open" : ""
      }`;
      await page.goto(listPath);
      await expect(page.locator(".list .item-title")).toHaveCount(20);
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
      const more = page.getByRole("button", { name: "더 보기", exact: true });
      await more.click();
      const retry = page.getByRole("button", { name: "다시 시도", exact: true });
      await expect(retry).toBeVisible();
      await expect(page.locator(".list .item-title")).toHaveCount(20);
      await retry.scrollIntoViewIfNeeded();
      await retry.focus();
      const scrollBefore = await page.evaluate(() => window.scrollY);
      if (kind === "task") await page.keyboard.press("Enter");
      else await retry.click();
      const control = page.locator(`#activity-${path}-page-control`);
      await expect.poll(() => requests.length).toBe(2);
      expect(requests).toEqual([failedCursor, failedCursor]);
      expect(failedCursor).toBeTruthy();
      await expect(page.locator(".list .item-title")).toHaveCount(20);
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BUTTON");
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
      await page.keyboard.press("Enter");
      expect(requests).toHaveLength(2);
      releaseRetry();
      await expect(page.locator(".list .item-title")).toHaveCount(22);
      await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe("BUTTON");
      await expect(control).toBeFocused();
      await expect(control).toHaveAttribute("aria-disabled", "true");
      await expect(control).toBeInViewport();
      await page.keyboard.press("Enter");
      expect(requests).toHaveLength(2);
      await page.unroute(`**/api/${path}?**`);
      const link = page.getByRole("link", { name: title, exact: true });
      await link.scrollIntoViewIfNeeded();
      await link.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "엔터티 보기", exact: true })).toHaveAttribute(
        "href",
        `/entities/${entity.id}`,
      );
      await page.getByRole("button", { name: "편집", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: editLabel, exact: true });
      await dialog.getByRole("button", { name: "취소", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await expect(page.getByRole("button", { name: "편집", exact: true })).toBeFocused();
      for (let i = 0; i < 21; i++) await create(unique("상세 중 추가"));
      await page.goBack();
      await expect(page.locator(".list .item-title")).toHaveCount(43);
      await expect(link).toBeFocused();
      await expect(link).toBeInViewport();
      await expect(page.getByLabel("태그 필터")).toHaveValue(tag.id);
      await expect(page.getByLabel("엔터티 필터")).toHaveValue(entity.id);
      await page.reload();
      await expect(page.locator(".list .item-title")).toHaveCount(43);
      await expect(link).toBeFocused();
      await link.click();
      await page.getByRole("button", { name: "편집", exact: true }).click();
      await dialog.getByLabel("요약").fill("수정한 근거");
      await dialog.getByRole("button", { name: "저장", exact: true }).click();
      await expect(dialog).not.toBeVisible();
      await page.getByRole("link", { name: `← ${label} 목록`, exact: true }).click();
      await expect(link).toBeFocused();
      await expect(link).toBeInViewport();
      await link.click();
      await page.getByRole("button", { name: "삭제", exact: true }).click();
      await page.getByRole("dialog", { name: `${label}을 삭제할까요?`, exact: true }).getByRole("button", {
        name: "삭제",
        exact: true,
      }).click();
      await expect(link).toHaveCount(0);
      await expect(page.locator(".list .item-title")).toHaveCount(42);
      ids.delete(target.id);
      await expect(page.getByRole("heading", { name: label, exact: true })).toBeFocused();
      await expect(page.getByRole("button", { name: "더 보기", exact: true })).toHaveCount(0);
      await page.getByLabel("태그 필터").selectOption(emptyTag.id);
      await expect(page.locator(".list .item-title")).toHaveCount(0);
      expect(new URL(page.url()).hash).toBe("");
      expect(new URL(page.url()).searchParams.has("pages")).toBe(false);
      expect(new URL(page.url()).searchParams.has("scroll")).toBe(false);
      // An edited item that leaves the entity filter also restores a valid
      // fallback focus, without widening the filter to include detached items.
      const leaving = await create(unique("연결 조건 이탈"));
      await page.goto(listPath);
      const leavingLink = page.getByRole("link", { name: leaving.title, exact: true });
      await leavingLink.click();
      await mcp.call(`update_${kind}`, { id: leaving.id, expected_version: leaving.version, entity_id: null });
      await page.goBack();
      await expect(leavingLink).toHaveCount(0);
      await expect(page.getByRole("heading", { name: label, exact: true })).toBeFocused();
      await expect(page.getByLabel("엔터티 필터")).toHaveValue(entity.id);
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
  test(`${label} 수동 250→251페이지는 누적 행을 보존하고 자동 복원만 250페이지로 제한한다`, async ({ page }) => {
    await devLogin(page);
    const reads: number[] = [];
    let failNext = true;
    await page.route(`**/api/${path}?**`, async (route) => {
      const index = Number(new URL(route.request().url()).searchParams.get("cursor") ?? 0);
      reads.push(index);
      if (index === 250 && failNext) {
        failNext = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ code: "internal", message: "temporary boundary failure" }),
        });
        return;
      }
      await route.fulfill({
        json: {
          items: [{
            id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
            title: `${label} 경계 ${index}`,
            summary: "manual page",
            kind: "once",
            status: "open",
            occurred_at: "2026-10-04T00:00:00Z",
          }],
          next_cursor: String(index + 1),
        },
      });
    });
    await page.goto(`/${path}?pages=250`);
    await expect(page.locator(".list .item-title")).toHaveCount(250, { timeout: 20_000 });
    const first = page.getByRole("link", { name: `${label} 경계 0`, exact: true });
    await page.getByRole("button", { name: "더 보기", exact: true }).click();
    await expect(page.getByRole("button", { name: "다시 시도", exact: true })).toBeVisible();
    await expect(page.locator(".list .item-title")).toHaveCount(250);
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    await expect(page.locator(".list .item-title")).toHaveCount(251);
    await expect(first).toHaveCount(1);
    await expect(page.getByRole("button", { name: "더 보기", exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: "더 보기", exact: true })).toBeInViewport();
    expect(new URL(page.url()).searchParams.get("pages")).toBe("251");
    expect(reads).toEqual([...Array.from({ length: 250 }, (_, index) => index), 250, 250]);
    await page.getByRole("button", { name: "더 보기", exact: true }).click();
    await expect(page.locator(".list .item-title")).toHaveCount(252);
    expect(reads.at(-1)).toBe(251);
    reads.length = 0;
    await page.reload();
    await expect(page.locator(".list .item-title")).toHaveCount(250, { timeout: 20_000 });
    expect(reads).toEqual(Array.from({ length: 250 }, (_, index) => index));
  });
}
