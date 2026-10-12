import { openListDetail, closeDetail } from "./ui-actions.ts";
import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";

// Actual OAuth/owner API evidence. Run serially with the other DEV_USER_A tests.
test("읽기·검색·네 탭 이동·상세 닫기는 계정 기록 원문과 개수를 바꾸지 않는다", async ({ page }, info) => {
  test.setTimeout(300_000);
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  let fixtureId = "";
  try {
    const title = unique("읽기 무기록 확인");
    const fixture = await mcp.call("create_record", {
      body: title,
    });
    fixtureId = fixture.id;
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
    await expect(navigation.getByRole("link")).toHaveCount(4);
    for (const [name, path] of [["전체 자료", "/entities"], ["할 일", "/tasks"], ["기록", "/records"], ["원칙", "/principles/current"]]) {
      const response = page.waitForResponse(response => response.request().method() === "GET" && new URL(response.url()).pathname.endsWith(path));
      await navigation.getByRole("link", { name, exact: true }).click();
      const read = await response;
      expect(read.ok()).toBe(true);await read.finished();
      await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    }
    await navigation.getByRole("link", { name: "기록", exact: true }).click();
    await expect(page.getByLabel("검색 방식", { exact: true })).toHaveCount(0);
    const search = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/search"));
    await page.getByLabel("검색어", { exact: true }).fill(title);
    const searched = await search;expect(searched.ok()).toBe(true);
    expect(searched.request().postDataJSON().mode).toBe("auto");
    expect((await searched.json()).items.some((item: { id: string }) => item.id === fixtureId)).toBe(true);
    await openListDetail(page,title);
    await expect(page.getByRole("heading", { name: "기록", level: 1, exact: true })).toBeVisible();
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
    } finally { await mcp.close(); }
  }
});
