import { expect } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, ownedWorkspace, test, workspacePath } from "./support.ts";
import { detailDialog } from "./ui-actions.ts";

test(
  "actual task viewer: READ conceals all mutations for live and deleted tasks; WRITE restores correct actions",
  async ({ page }, info) => {
    await devLogin(page);
    const workspace = await ownedWorkspace(page);
    const client = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
    const today = new Date().toISOString().slice(0, 10);
    const tasks = [];
    for (const kind of ["once", "recurring", "deleted"] as const) {
      const task = await client.call("create_task", {
        kind: kind === "recurring" ? "recurring" : "once",
        title: `읽기 권한 검수 ${kind}`,
        body: `읽을 수 있는 보존 본문 ${kind}`,
        ...(kind === "recurring" ? { recurrence: { freq: "daily", starts_on: today }, timezone: "UTC" } : {}),
      });
      if (kind === "deleted") await client.call("delete_task", { id: task.id, expected_version: task.version });
      tasks.push({ kind, task });
    }
    const writes: string[] = [];
    page.on("request", (request) => {
      if (
        !/^(GET|HEAD|OPTIONS)$/.test(request.method()) &&
        /\/api\/(tasks|records|tag-connections)(\/|$)/.test(new URL(request.url()).pathname)
      ) {
        writes.push(request.method() + " " + new URL(request.url()).pathname);
      }
    });
    await workspace.setTaskAccess("read");
    for (const { kind, task } of tasks) {
      await page.goto(workspacePath(workspace.id, `/tasks/${task.id}`));
      const surface = detailDialog(page);
      await expect(surface.getByRole("heading", { name: task.title, exact: true })).toBeVisible();
      await expect(surface.getByText(task.body, { exact: true })).toBeVisible();
      for (const name of ["편집", "완료하고 기록", "복원", "중단", "재개", "자료 연결", "태그 연결"]) {
        await expect(surface.getByRole("button", { name, exact: true })).toHaveCount(0);
      }
      await expect(surface.getByRole("button", { name: /회차 기록$/ })).toHaveCount(0);
      if (kind === "deleted") await expect(surface.getByText("삭제된 할 일입니다.", { exact: false })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      if (kind === "deleted") {
        await expect(surface.getByText(/불러오는 중…$/).filter({ visible: true })).toHaveCount(0);
        await expect(surface.locator('[aria-busy="true"]').filter({ visible: true })).toHaveCount(0);
        await page.evaluate(() => document.fonts.ready);
        const path = info.outputPath("deleted-task-readonly.png");
        await page.screenshot({ path, animations: "disabled", caret: "hide" });
        await info.attach("deleted-task-readonly", { path, contentType: "image/png" });
      }
    }
    expect(writes).toEqual([]);
    await workspace.setTaskAccess("write");
    for (const { kind, task } of tasks) {
      await page.goto(workspacePath(workspace.id, `/tasks/${task.id}`));
      const surface = detailDialog(page);
      await expect(surface.getByRole("heading", { name: task.title, exact: true })).toBeVisible();
      const action = kind === "deleted" ? "복원" : kind === "recurring" ? "중단" : "완료하고 기록";
      await expect(surface.getByRole("button", { name: action, exact: true })).toBeEnabled();
      if (kind === "deleted") await expect(surface.getByRole("button", { name: "편집", exact: true })).toHaveCount(0);
      else await expect(surface.getByRole("button", { name: "편집", exact: true })).toBeEnabled();
    }
    expect(writes).toEqual([]);
  },
);
