import { expect } from "@playwright/test";
import { test, devLogin, env, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";

for (const kind of ["once", "recurring"] as const) {
  test(`#341 실제 MCP/웹 ${kind}: 일반 기록 저장·작성 URL 종료·새로고침·취소`, async ({ page }) => {
    await devLogin(page);
    const mcp = await mcpClient(await mcpTokenViaConsent(page));
    const title = unique(`작성 종료 ${kind}`);
    let taskId = "";
    try {
      const task = await mcp.call("create_task", {
        kind,
        title,
        ...(kind === "recurring"
          ? { recurrence: { freq: "daily", starts_on: "2026-10-01" }, timezone: "Asia/Seoul" }
          : {}),
      });
      taskId = task.id;
      await page.goto(`/tasks/${taskId}`);
      const surface = page.locator("dialog.modal:not(.modal-confirm)[open]");
      await surface.getByRole("button", { name: "기록 작성", exact: true }).click();
      await surface.getByRole("textbox", { name: /^본문/ }).fill(`${title} 참고 메모`);
      const saved = page.waitForResponse(response => response.request().method() === "POST" && response.url() === `${env.VITE_API_URL}/records`);
      await surface.getByRole("button", { name: "저장", exact: true }).click();
      expect((await saved).status()).toBe(201);
      await expect(surface.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(page).not.toHaveURL(/action=record/);
      // Wait for the actual detail read before asserting its rendered viewer.
      const reloaded = page.waitForRequest(request => request.method() === "GET" && request.url() === `${env.VITE_API_URL}/tasks/${taskId}`);
      await page.reload();
      const loaded = await (await reloaded).response();
      expect(loaded?.status()).toBe(200);
      await loaded!.finished();
      await expect(surface.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(surface.getByRole("textbox", { name: /^본문/ })).toHaveCount(0);
      const records = await mcp.call("list_records", { task_id: taskId, record_kind: "user" });
      expect(records.items.map((r: { body: string }) => r.body)).toEqual([`${title} 참고 메모`]);
      expect((await mcp.call("get_task", { id: taskId })).status).toBe(kind === "once" ? "open" : "active");
      await surface.getByRole("button", { name: "기록 작성", exact: true }).click();
      await surface.getByRole("button", { name: "취소", exact: true }).click();
      await expect(page).not.toHaveURL(/action=record/);
      expect((await mcp.call("list_records", { task_id: taskId, record_kind: "user" })).items).toHaveLength(1);
    } finally {
      if (taskId) {
        const records = await mcp.call("list_records", { task_id: taskId, record_kind: "user" });
        for (const r of records.items) await mcp.call("delete_record", { id: r.id, expected_version: r.version });
        const latest = await mcp.call("get_task", { id: taskId });
        await mcp.call("delete_task", { id: taskId, expected_version: latest.version });
      }
      await mcp.close();
    }
  });
}
