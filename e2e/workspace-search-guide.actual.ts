import { expect } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, ownedWorkspace, test, unique, workspacePath } from "./support.ts";
import { openTabFilters } from "./ui-actions.ts";

test(
  "actual search draft clear preserves applied results and guide copy reports its configured address",
  async ({ page }, info) => {
    await page.addInitScript(() =>
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (value: string) => {
            (globalThis as typeof globalThis & { copiedAddress?: string }).copiedAddress = value;
          },
        },
      })
    );
    await devLogin(page);
    const workspace = await ownedWorkspace(page);
    const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
    try {
      const title = unique("검색 초안 보존");
      await mcp.call("create_task", { kind: "once", title, body: "검색어 지우기로 보존할 원문" });
      const params = new URLSearchParams({ q: title, kind: "task", mode: "keyword" });
      await page.goto(workspacePath(workspace.id, `/search?${params}`));
      const result = page.getByRole("link", { name: title, exact: true });
      await expect(result).toBeVisible();
      await expect(page.getByLabel("적용된 필터", { exact: true })).toContainText("대상: 할 일");
      await openTabFilters(page);
      await page.getByLabel("검색 대상", { exact: true }).selectOption("record");
      const reads: string[] = [];
      const observe = (request: { url(): string; method(): string }) => {
        if (new URL(request.url()).pathname.endsWith("/api/search") && request.method() === "POST") {
          reads.push(
            "search",
          );
        }
      };
      page.on("request", observe);
      await page.getByRole("button", { name: "입력한 검색어 지우기", exact: true }).click();
      await expect(page.getByRole("textbox", { name: "검색어", exact: false })).toBeFocused();
      await expect(page.getByRole("textbox", { name: "검색어", exact: false })).toHaveValue("");
      await expect(result).toBeVisible();
      expect(new URL(page.url()).searchParams.get("q")).toBe(title);
      expect(new URL(page.url()).searchParams.get("kind")).toBe("task");
      await expect(page.getByLabel("검색 대상", { exact: true })).toHaveValue("record");
      expect(reads).toHaveLength(0);
      page.off("request", observe);
      await page.screenshot({ path: info.outputPath("actual-search-draft-cleared.png"), fullPage: true });

      await page.goto(workspacePath(workspace.id, "/guide"));
      await page.getByRole("button", { name: "설치·연결 정보", exact: true }).click();
      const guide = page.getByRole("region", { name: "사용 가이드", exact: true });
      const feedback = guide.getByRole("status");
      expect((await feedback.boundingBox())?.height ?? 0).toBeLessThanOrEqual(1);
      const address = await guide.getByRole("textbox", { name: "이 앱의 MCP 연결 주소", exact: true }).inputValue();
      await guide.getByRole("button", { name: "연결 주소 복사", exact: true }).click();
      await expect(feedback).toHaveText("연결 주소를 복사했습니다.");
      expect(await page.evaluate(() => (globalThis as typeof globalThis & { copiedAddress?: string }).copiedAddress))
        .toBe(address);
      await feedback.scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath("actual-guide-copy.png"), fullPage: true });
    } finally {
      await mcp.close();
    }
  },
);
