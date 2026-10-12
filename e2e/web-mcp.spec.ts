import { saveOnce, beginTabAction, openDetailEditor, openListDetail } from "./ui-actions.ts";
// T02-2 완료 조건: 웹 작성 → MCP 조회·완료 → 웹 결과 확인, 그리고 반대 방향.
import { expect } from "@playwright/test";
import { test, devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";

test("웹에서 만든 할 일을 에이전트가 MCP로 완료하고 웹에서 결과를 본다", async ({ page }) => {
  await devLogin(page);
  const title = unique("보고서 초안");

  // 1. 웹에서 일회성 할 일 작성
  await beginTabAction(page,"할 일 추가");
  const dialog = page.getByRole("dialog", { name: "할 일 추가" });
  await dialog.getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill(title);
  await dialog.getByLabel("본문").fill("다음 주 회의용 초안 3쪽");
  await saveOnce(page,dialog,"추가");
  await expect(page.locator("dialog.modal:not(.modal-confirm)[open]").getByRole("heading", { name: title, exact:true })).toBeVisible();
  const taskUrl = page.url();

  // 2. 에이전트 연결: 브라우저 동의 화면에서 승인
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    // 3. MCP로 조회·완료
    const open = await mcp.call("list_tasks", { status: "open", limit: 100 });
    const task = open.items.find((t: { title: string }) => t.title === title);
    expect(task).toBeTruthy();
    const done = await mcp.call("complete_task", {
      id: task.id,
      expected_version: task.version,
      body: "초안 공유 완료",
    });
    expect(done.task.status).toBe("done");
  } finally {
    await mcp.close();
  }

  // 4. 웹에서 결과 확인
  await page.goto(taskUrl);
  await expect(page.locator("dialog.modal:not(.modal-confirm)[open]").getByText("완료", { exact: true })).toBeVisible();
  const result=page.getByRole("button", { name: "초안 공유 완료", exact:true });await result.click();
  await expect(result).toHaveAttribute("aria-expanded","true");await expect(page).toHaveURL(taskUrl);
  await expect(page.locator(".related-preview .markdown")).toContainText("초안 공유 완료");
});

test("에이전트가 MCP로 만든 기록·반복 회차를 웹에서 보고 고치면 MCP가 바뀐 값을 본다", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const title = unique("MCP 기록");
    const rec = await mcp.call("create_record", { body: title });

    const timezone = "Asia/Seoul";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
    const taskTitle = unique("스트레칭");
    const task = await mcp.call("create_task", {
      kind: "recurring",
      title: taskTitle,
      body: "매일 5분",
      recurrence: { freq: "daily", starts_on: today },
      timezone,
    });
    await mcp.call("record_occurrence", { task_id: task.id, date: today, body: "스트레칭 함 5분" });

    // 웹: 기록 목록에서 찾아 편집
    await page.goto("/records");
    await openListDetail(page,title);
    await openDetailEditor(page);
    const dialog = page.getByRole("dialog", { name: "기록 편집" });
    await dialog.getByLabel("본문").fill("웹에서 고친 본문");
    await expect(dialog.getByLabel("편집 메모")).toHaveCount(0);
    await dialog.getByRole("button", { name: "저장" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("dialog.modal:not(.modal-confirm)[open] .dialog-title")).toHaveText("기록");

    // 웹: 반복 할 일의 오늘 회차가 기록함
    await page.goto(`/tasks/${task.id}`);
    const todayRow = page.getByRole("listitem").filter({ hasText: `${today} (오늘)` });
    await expect(todayRow.getByText("기록함")).toBeVisible();

    // MCP가 웹의 수정을 본다
    const again = await mcp.call("get_record", { id: rec.id });
    expect(again.body).toBe("웹에서 고친 본문");
    expect(again.version).toBe(2);
    expect(again.occurred_at).toBe(rec.occurred_at);
  } finally {
    await mcp.close();
  }
});

test("다른 사용자는 URL을 알아도 남의 할 일을 볼 수 없다", async ({ page, browser }) => {
  await devLogin(page, "A");
  await beginTabAction(page,"할 일 추가");
  const dialog = page.getByRole("dialog", { name: "할 일 추가" });
  const title = unique("A의 비밀 할 일");
  await dialog.getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill(title);
  await dialog.getByLabel("본문").fill("B에게 보이면 안 됨");
  await saveOnce(page,dialog,"추가");
  await expect(page.locator("dialog.modal:not(.modal-confirm)[open]").getByRole("heading", { name: title, exact:true })).toBeVisible();
  const path = new URL(page.url()).pathname;

  const other = await browser.newContext();
  const pageB = await other.newPage();
  await devLogin(pageB, "B");
  await pageB.goto(path);
  await expect(pageB.getByText("할 일을 찾을 수 없습니다.")).toBeVisible();
  await expect(pageB.getByText(title)).toHaveCount(0);
  await other.close();
});
