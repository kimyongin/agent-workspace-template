import { detailDialog } from "./ui-actions.ts";
import { expect } from "@playwright/test";
import {
  devLogin,
  env,
  mcpClient,
  mcpTokenViaConsent,
  ownedWorkspace,
  test,
  unique,
  workspacePath,
} from "./support.ts";

for (const kind of ["once", "recurring"] as const) {
  test(`#515 실제 MCP/웹 ${kind}: 명시적 수행 결과 저장·작성 URL 종료·새로고침·취소`, async ({ page }) => {
    await devLogin(page);
    const workspace = await ownedWorkspace(page);
    const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
    const title = unique(`결과 작성 종료 ${kind}`);
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    let taskId = "";
    try {
      const task = await mcp.call("create_task", {
        kind,
        title,
        body: "저장할 결과와 구별되는 원래 할 일의 지시입니다.",
        ...(kind === "recurring" ? { recurrence: { freq: "daily", starts_on: today }, timezone: "Asia/Seoul" } : {}),
      });
      taskId = task.id;
      const action = kind === "once" ? "완료하고 기록" : `${today} 회차 기록`;
      await page.goto(workspacePath(workspace.id, `/tasks/${taskId}`));
      const surface = detailDialog(page);
      await expect(surface.getByRole("button", { name: "기록 작성", exact: true })).toHaveCount(0);
      await surface.getByRole("button", { name: action, exact: true }).click();
      await surface.getByRole("button", { name: "취소", exact: true }).click();
      await expect(page).not.toHaveURL(/action=|occurrence=/);
      expect((await mcp.call("list_records", { task_id: taskId, record_kind: "result" })).items).toHaveLength(0);
      await surface.getByRole("button", { name: action, exact: true }).click();
      await surface.getByRole("textbox", { name: /^본문/ }).fill(`${title} 수행 결과`);
      const context = surface.getByRole("region", { name: "기록할 할 일", exact: true });
      await expect(context.getByText(title, { exact: true })).toBeVisible();
      if (kind === "recurring") await expect(context).toContainText(`${today} · Asia/Seoul`);
      const instruction = context.getByRole("button", { name: "할 일 내용 확인", exact: true });
      await instruction.click();
      await expect(context.getByText(task.body, { exact: true })).toBeVisible();
      const changeAccess = async (access: "read" | "write") => {
        await workspace.setTaskAccess(access);
        const refreshed = page.waitForResponse((response) =>
          response.request().method() === "GET" &&
          new URL(response.url()).pathname.endsWith(`/workspaces/${workspace.id}`)
        );
        await page.evaluate(() => window.dispatchEvent(new Event("focus")));
        expect((await refreshed).ok()).toBeTruthy();
      };
      await changeAccess("read");
      await expect(
        surface.getByRole("button", { name: kind === "once" ? "완료하고 기록 저장" : "기록 저장", exact: true }),
      ).toBeDisabled();
      await expect(instruction).toBeEnabled();
      await instruction.click();
      await instruction.click();
      await expect(context.getByText(task.body, { exact: true })).toBeVisible();
      await expect(surface.getByRole("textbox", { name: /^본문/ })).toHaveValue(`${title} 수행 결과`);
      expect((await mcp.call("list_records", { task_id: taskId, record_kind: "result" })).items).toHaveLength(0);
      await changeAccess("write");
      await instruction.click();
      await expect(surface.getByRole("button", { name: "자료 연결", exact: true })).toHaveCount(0);
      await expect(surface.getByRole("button", { name: "태그 연결", exact: true })).toHaveCount(0);
      const path = kind === "once" ? `/tasks/${taskId}/complete` : `/tasks/${taskId}/occurrences/${today}/records`;
      const saved = page.waitForResponse((response) =>
        response.request().method() === "POST" && response.url() === `${env.VITE_API_URL}${path}`
      );
      await surface.getByRole("button", { name: kind === "once" ? "완료하고 기록 저장" : "기록 저장", exact: true })
        .click();
      const response = await saved;
      expect(response.ok()).toBe(true);
      const input = response.request().postDataJSON();
      expect(input).not.toHaveProperty("entity_ids");
      expect(input).not.toHaveProperty("tag_ids");
      expect(input).not.toHaveProperty("task_id");
      await expect(surface.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(page).not.toHaveURL(/action=|occurrence=/);
      await page.reload();
      await expect(surface.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(surface.getByRole("textbox", { name: /^본문/ })).toHaveCount(0);
      const records = await mcp.call("list_records", { task_id: taskId, record_kind: "result" });
      expect(records.items.map((record: { body: string }) => record.body)).toEqual([`${title} 수행 결과`]);
      expect(records.items[0].task_id).toBe(taskId);
      expect(records.items[0].entity_id).toBeNull();
      expect((await mcp.call("get_task", { id: taskId })).status).toBe(kind === "once" ? "done" : "active");
    } finally {
      await workspace.setTaskAccess("write");
      if (taskId) {
        const records = await mcp.call("list_records", { task_id: taskId, record_kind: "result" });
        for (const record of records.items) {
          await mcp.call("delete_record", { id: record.id, expected_version: record.version });
        }
        const latest = await mcp.call("get_task", { id: taskId });
        await mcp.call("delete_task", { id: taskId, expected_version: latest.version });
      }
      await mcp.close();
    }
  });
}
