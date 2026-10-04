// T02-2 완료 조건: 웹 작성 → MCP 조회·완료 → 웹 결과 확인, 그리고 반대 방향.
import { expect, test } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";

test("웹에서 만든 할 일을 에이전트가 MCP로 완료하고 웹에서 결과를 본다", async ({ page }) => {
  await devLogin(page);
  const title = unique("보고서 초안");

  // 1. 웹에서 일회성 할 일 작성
  await page.getByRole("button", { name: "할 일 추가" }).click();
  const dialog = page.getByRole("dialog", { name: "할 일 추가" });
  await dialog.getByLabel("제목").fill(title);
  await dialog.getByLabel("요약").fill("다음 주 회의용 초안 3쪽");
  await dialog.getByRole("button", { name: "추가" }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
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
      title: "초안 공유 완료",
      summary: "3쪽 초안을 팀 문서함에 올림",
      body: "## 결과\n- 문서함에 공유",
      request_id: crypto.randomUUID(),
    });
    expect(done.task.status).toBe("done");
  } finally {
    await mcp.close();
  }

  // 4. 웹에서 결과 확인
  await page.goto(taskUrl);
  await expect(page.getByText("완료", { exact: true }).first()).toBeVisible();
  await page.getByRole("link", { name: "초안 공유 완료" }).click();
  await expect(page.getByRole("heading", { name: "초안 공유 완료", level: 1 })).toBeVisible();
  await expect(page.getByText("문서함에 공유")).toBeVisible();
});

test("에이전트가 MCP로 만든 기록·반복 회차를 웹에서 보고 고치면 MCP가 바뀐 값을 본다", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const title = unique("MCP 기록");
    const rec = await mcp.call("create_record", { title, summary: "에이전트가 남긴 기록" });

    const timezone = "Asia/Seoul";
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(new Date());
    const taskTitle = unique("스트레칭");
    const task = await mcp.call("create_task", {
      kind: "recurring",
      title: taskTitle,
      summary: "매일 5분",
      recurrence: { freq: "daily", starts_on: today },
      timezone,
    });
    await mcp.call("record_occurrence", { id: task.id, date: today, title: "스트레칭 함", summary: "5분" });

    // 웹: 기록 목록에서 찾아 편집
    await page.goto("/records");
    await page.getByRole("link", { name: `${title} 보기`, exact: true }).click();
    await page.getByRole("button", { name: "편집" }).click();
    const dialog = page.getByRole("dialog", { name: "기록 편집" });
    await dialog.getByLabel("요약").fill("웹에서 고친 요약");
    await dialog.getByRole("button", { name: "저장" }).click();
    await expect(page.getByText("저장했습니다.")).toBeVisible();

    // 웹: 반복 할 일의 오늘 회차가 기록함
    await page.goto(`/tasks/${task.id}`);
    const todayRow = page.getByRole("listitem").filter({ hasText: `${today} (오늘)` });
    await expect(todayRow.getByText("기록함")).toBeVisible();

    // MCP가 웹의 수정을 본다
    const again = await mcp.call("get_record", { id: rec.id });
    expect(again.summary).toBe("웹에서 고친 요약");
    expect(again.version).toBe(2);
  } finally {
    await mcp.close();
  }
});

test("다른 사용자는 URL을 알아도 남의 할 일을 볼 수 없다", async ({ page, browser }) => {
  await devLogin(page, "A");
  await page.getByRole("button", { name: "할 일 추가" }).click();
  const dialog = page.getByRole("dialog", { name: "할 일 추가" });
  const title = unique("A의 비밀 할 일");
  await dialog.getByLabel("제목").fill(title);
  await dialog.getByLabel("요약").fill("B에게 보이면 안 됨");
  await dialog.getByRole("button", { name: "추가" }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  const path = new URL(page.url()).pathname;

  const other = await browser.newContext();
  const pageB = await other.newPage();
  await devLogin(pageB, "B");
  await pageB.goto(path);
  await expect(pageB.getByText("할 일을 찾을 수 없습니다.")).toBeVisible();
  await expect(pageB.getByText(title)).toHaveCount(0);
  await other.close();
});
