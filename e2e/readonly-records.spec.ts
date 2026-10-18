import { detailDialog } from "./ui-actions.ts";
import { openMainNavigation } from "./ui-actions.ts";
import { openListDetail, closeDetail } from "./ui-actions.ts";
import { createHash } from "node:crypto";
import { expect } from "@playwright/test";
import { test, devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";

// Actual OAuth/owner API evidence. Run serially with the other DEV_USER_A tests.
test("읽기·검색·세 탭 이동·상세 닫기는 계정 기록 원문과 개수를 바꾸지 않는다", async ({ page }, info) => {
  test.setTimeout(300_000);
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  let fixtureId = "", taskId = "";
  try {
    const title = unique("읽기 무기록 확인");
    const task = await mcp.call("create_task", { kind: "once", title: `${title} 할 일` });
    taskId = task.id;
    const completed = await mcp.call("complete_task", { id: taskId, expected_version: task.version, body: title });
    fixtureId = completed.record.id;
    const snapshot = async () => {
      const listed: Record<string, unknown>[] = [], cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const result = await mcp.call("list_records", { limit: 100, ...(cursor ? { cursor } : {}) });
        listed.push(...result.items);
        cursor = result.next_cursor ?? undefined;
        if (cursor) {
          expect(cursors.has(cursor), "공개 목록의 cursor가 반복되지 않아야 합니다").toBe(false);
          cursors.add(cursor);
        }
      } while (cursor);
      listed.sort((a, b) => String(a.id).localeCompare(String(b.id)));
      const ids = listed.map(row => String(row.id));
      expect(new Set(ids).size).toBe(ids.length);
      // list_records returns the complete RecordResult, including body and historical metadata.
      // Check detail parity for the fixture without repeating every full row as an individual request.
      const fixtureDetail = await mcp.call("get_record", { id: fixtureId });
      expect(listed.find(row => row.id === fixtureId)).toEqual(fixtureDetail);
      return { ids, count: ids.length, digest: createHash("sha256").update(JSON.stringify({ listed, fixtureDetail })).digest("hex") };
    };
    // Fixture creation precedes the baseline; only our fixture is deleted afterwards.
    const before = await snapshot();
    expect(before.ids).toContain(fixtureId);
    const writes: string[] = [];
    page.on("request", request => {
      const path = new URL(request.url()).pathname;
      if (/\/api\//.test(path) && request.method() !== "GET" && !(request.method() === "POST" && path.endsWith("/search"))) {
        writes.push(`${request.method()} ${path}`);
      }
    });
    await page.goto("/tasks");
    await expect(page.getByRole("heading", { name: "할 일", level: 1 })).toBeVisible();
    const navigation = page.getByRole("navigation", { name: "주 메뉴" });
    const navigateBuiltin = async (path: string, label: string) => {
      await openMainNavigation(page);
      const link = navigation.getByRole("link", { name: label, exact: true });
      await expect(link).toHaveAttribute("href", path);
      await expect(link).toHaveAccessibleName(label);
      await expect(link).toBeVisible();
      await link.click();
    };
    for (const [name, path] of [["전체 자료", "/entities"], ["할 일", "/tasks"], ["기록", "/records"]]) {
      const response = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname.endsWith(path));
      await navigateBuiltin(path, name);
      const read = await response;
      expect(read.ok()).toBe(true);await read.finished();
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    }
    await navigateBuiltin("/records", "기록");
    await expect(page.getByRole("dialog", { name: "주 메뉴", exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.getByLabel("검색 방식", { exact: true })).toHaveCount(0);
    const search = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/search"));
    await page.getByLabel("검색어", { exact: true }).fill(title);
    const searched = await search;expect(searched.ok()).toBe(true);
    expect(searched.request().postDataJSON().mode).toBe("auto");
    expect((await searched.json()).items.some((item: { id: string }) => item.id === fixtureId)).toBe(true);
    await openListDetail(page,title);
    await expect(detailDialog(page).getByRole("heading", { name: "기록", exact: true })).toBeVisible();
    await closeDetail(page,title);
    await expect(page.getByRole("button", { name: title, exact: true })).toBeFocused();
    const after = await snapshot();
    expect(writes).toEqual([]);
    expect(after).toEqual(before);
    await info.attach("readonly-record-digest", {
      body: JSON.stringify({ before: { count: before.count, digest: before.digest }, after: { count: after.count, digest: after.digest } }),
      contentType: "application/json",
    });
  } finally {
    try {
      if (fixtureId) {
        const row = await mcp.call("get_record", { id: fixtureId });
        await mcp.call("delete_record", { id: fixtureId, expected_version: row.version });
      }
      if (taskId) {
        const task = await mcp.call("get_task", { id: taskId });
        await mcp.call("delete_task", { id: taskId, expected_version: task.version });
      }
    } finally { await mcp.close(); }
  }
});
