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
    const title = unique(`${label} 복원 대상`);
    const create = async (title: string) => {
      const item = await mcp.call(`create_${kind}`, {
        ...(kind === "task" ? { kind: "once" } : {}),
        title,
        summary: "추가 페이지에서 진입하는 대상",
        tag_ids: [tag.id],
      });
      ids.add(item.id);
      return item;
    };
    try {
      const target = await create(title);
      for (let i = 0; i < 21; i++) await create(unique("앞선 항목"));
      await page.goto(`/${path}?tag_id=${tag.id}${kind === "task" ? "&kind=once&status=open" : ""}`);
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
      // Keep a row focused while invoking retry, so clearing/replaying the list
      // would expose lost DOM focus and scroll before the held response returns.
      const retained = page.locator(".list .item-title").last();
      await retained.focus();
      const scrollBefore = await page.evaluate(() => window.scrollY);
      await retry.evaluate((button: HTMLButtonElement) => button.click());
      await expect.poll(() => requests.length).toBe(2);
      expect(requests).toEqual([failedCursor, failedCursor]);
      expect(failedCursor).toBeTruthy();
      await expect(page.locator(".list .item-title")).toHaveCount(20);
      await expect(retained).toBeFocused();
      expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);
      releaseRetry();
      await expect(page.locator(".list .item-title")).toHaveCount(22);
      await expect(retained).toBeFocused();
      await page.unroute(`**/api/${path}?**`);
      const link = page.getByRole("link", { name: title, exact: true });
      await link.scrollIntoViewIfNeeded();
      await link.focus();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
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
      } finally {
        await mcp.close();
      }
    }
  });
}
