import { ownedWorkspace, workspacePath } from "./support.ts";
import { expect } from "@playwright/test";
import {
  devLogin,
  mcpClient,
  mcpTokenViaConsent,
  test,
  unique,
} from "./support.ts";
import { detailDialog, saveOnce } from "./ui-actions.ts";

for (const kind of ["once", "recurring"] as const) {
  test(`date picker actual ${kind}: task date and record clock survive explicit save and reload`, async ({ page }) => {
    await devLogin(page);
    const workspace = await ownedWorkspace(page);
    const mcp = await mcpClient(await mcpTokenViaConsent(page), {
      workspaceId: workspace.id,
    });
    try {
      const task = await mcp.call("create_task", {
        kind,
        title: unique(`날짜 선택 ${kind}`),
        ...(kind === "once" ? { due_on: "2024-02-29" } : {
          recurrence: { freq: "daily", starts_on: "2024-02-29" },
          timezone: "Asia/Seoul",
        }),
      });
      await page.goto(workspacePath(workspace.id, `/tasks/${task.id}`));
      const surface = detailDialog(page);
      await surface.getByRole("button", { name: "편집", exact: true }).click();
      const label = kind === "once" ? "기한" : "시작일";
      const date = surface.getByRole("textbox", {
        name: label,
        exact: kind === "once",
      });
      await expect(date).toHaveValue("2024-02-29");
      await surface.getByRole("button", {
        name: `${label} 달력 열기`,
        exact: true,
      }).click();
      const calendar = page.getByRole("dialog", {
        name: `${label} 달력`,
        exact: true,
      });
      await calendar.getByRole("gridcell", { selected: true }).getByRole(
        "button",
      ).press("ArrowRight");
      await page.keyboard.press("Enter");
      await expect(date).toHaveValue("2024-03-01");
      const before = await mcp.call("get_task", { id: task.id });
      expect(kind === "once" ? before.due_on : before.recurrence.starts_on)
        .toBe("2024-02-29");
      await saveOnce(page, surface);
      const saved = await mcp.call("get_task", { id: task.id });
      expect(kind === "once" ? saved.due_on : saved.recurrence.starts_on).toBe(
        "2024-03-01",
      );
      await page.reload();
      await surface.getByRole("button", { name: "편집", exact: true }).click();
      await expect(date).toHaveValue("2024-03-01");
      await surface.getByRole("button", { name: "취소", exact: true }).click();

      const original = "2024-02-29T14:58:37.123Z";
      const resultTask = await mcp.call("create_task", {
        kind: "once",
        title: unique("날짜 결과"),
      });
      const { record } = await mcp.call("complete_task", {
        id: resultTask.id,
        expected_version: resultTask.version,
        body: unique("날짜와 시간"),
        occurred_at: original,
      });
      await page.goto(workspacePath(workspace.id, `/records/${record.id}`));
      await surface.getByRole("button", { name: "편집", exact: true }).click();
      const clock = surface.getByLabel("수행 시각 시간", { exact: true });
      const originalClock = await clock.inputValue();
      await surface.getByRole("button", {
        name: "수행 시각 날짜 달력 열기",
        exact: true,
      }).click();
      await page.getByRole("dialog", {
        name: "수행 시각 날짜 달력",
        exact: true,
      })
        .getByRole("gridcell", { selected: true }).getByRole("button").press(
          "ArrowRight",
        );
      await page.keyboard.press("Enter");
      await expect(clock).toHaveValue(originalClock);
      expect((await mcp.call("get_record", { id: record.id })).occurred_at)
        .toBe(original);
      await saveOnce(page, surface);
      expect((await mcp.call("get_record", { id: record.id })).occurred_at)
        .toBe("2024-03-01T14:58:00.000Z");
      await page.reload();
      await surface.getByRole("button", { name: "편집", exact: true }).click();
      await expect(clock).toHaveValue(originalClock);
    } finally {
      await mcp.close();
    }
  });
}
