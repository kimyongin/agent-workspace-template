import { ownedWorkspace, workspacePath } from "./support.ts";
// 유료 실제 공급자 E2E: RUN_PINECONE_E2E=1로 명시적으로 실행한다. CI 기본 실행에는 포함하지 않는다.
import { expect } from "@playwright/test";
import {
  devLogin,
  env,
  mcpClient,
  mcpTokenViaConsent,
  test,
} from "./support.ts";
test("실제 의미 검색→기록 원문→필터와 초점 복귀", async ({ page }) => {
  test.skip(
    process.env.RUN_PINECONE_E2E !== "1",
    "실제 Pinecone 호출은 명시적으로 실행",
  );
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page), {
    workspaceId: workspace.id,
  });
  let item: { id: string; version: number } | undefined;
  try {
    const task = await mcp.call("create_task", {
      kind: "once",
      title: "독서 계획 수행",
    });
    const { record: saved } = await mcp.call("complete_task", {
      id: task.id,
      expected_version: task.version,
      body: "두꺼운 책은 주말 아침에 읽는다. 관리 코드는 오로라-731이다.",
    });
    item = { id: saved.id, version: saved.version };
    const response = await fetch(
      `${env.VITE_SUPABASE_URL}/functions/v1/index-worker`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.PROCESSING_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ limit: 1, kind: "record", id: item!.id }),
      },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).indexed).toBe(1);
    const query = "두꺼운 책은 언제 읽기로 했지?";
    await page.goto(
      workspacePath(
        workspace.id,
        `/search?q=${encodeURIComponent(query)}&kind=record`,
      ),
    );
    const link = page.getByRole("link", {
      name: "두꺼운 책은 주말 아침에 읽는다. 관리 코드는 오로라-731이다.",
      exact: true,
    });
    await expect(link).toBeVisible();
    await expect(page.getByText("의미 · 색인 완료", { exact: false }))
      .toBeVisible();
    await expect(
      page.getByText("현재 키워드 검색 결과를 표시합니다.", { exact: false }),
    ).toHaveCount(0);
    expect((await mcp.call("search", { query, kinds: ["record"] })).items[0].id)
      .toBe(item!.id);
    await link.click();
    await expect(page.locator(".markdown")).toContainText(
      "관리 코드는 오로라-731이다.",
    );
    await page.getByRole("button", { name: "닫기", exact: true }).click();
    await expect(page.getByLabel("원칙 범위")).toHaveCount(0);
    await expect(link).toBeFocused();
  } finally {
    if (item) {
      await mcp.call("delete_record", {
        id: item.id,
        expected_version: item.version,
      });
    }
    await mcp.close();
  }
});
