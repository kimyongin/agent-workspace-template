import { expect } from "@playwright/test";
import { test, devLogin, ownedWorkspace, workspacePath, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";
import { createFixtureEntity } from "./entity-schema-support.ts";
import { closeDetail, detailDialog } from "./ui-actions.ts";
import { disclosureContent } from "./table-actions.ts";

test("실제 API: 자료·할 일·기록 제목 직접 상세와 독립 미리보기·관련 복귀", async ({ page }, info) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const client = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try {
    const entity = await createFixtureEntity(client, workspace, { prop_1: unique("제목 탐색 자료"), prop_2: 0 });
    const date = new Date().toISOString().slice(0, 10);
    const task = await client.call("create_task", {
      kind: "recurring", title: unique("제목 탐색 할 일"), body: "제목은 상세, 화살표는 미리보기입니다.",
      entity_ids: [entity.id], recurrence: { freq: "daily", starts_on: date }, timezone: "Asia/Seoul",
    });
    const record = await client.call("record_occurrence", { task_id: task.id, date, body: unique("제목 탐색 기록") });
    for (const [kind, title, label] of [
      ["entities", entity.title, "전체 자료"], ["tasks", task.title, "할 일"], ["records", record.body, "기록"],
    ] as const) {
      for (const view of ["테이블", "카드"]) {
        await page.goto(workspacePath(workspace.id, `/${kind}`));
        const list = page.getByRole("region", { name: `${label} 목록`, exact: true });
        await list.getByRole("radio", { name: view, exact: true }).click();
        const link = list.getByRole("link", { name: `${title} 상세`, exact: true });
        const arrow = list.getByRole("button", { name: title, exact: true });
        await expect(link).toBeVisible();
        await expect(arrow).toHaveAttribute("aria-expanded", "false");
        await link.click();
        await expect(detailDialog(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
        await closeDetail(page, title);
        await expect(link).toBeFocused();
        await expect(arrow).toHaveAttribute("aria-expanded", "false");
        await arrow.click();
        await expect(arrow).toHaveAttribute("aria-expanded", "true");
        await expect(page.getByRole("dialog")).toHaveCount(0);
        const preview = await disclosureContent(page, arrow);
        await expect(preview.locator('[aria-busy="true"]')).toHaveCount(0);
        await expect(preview.getByRole("status")).toHaveCount(0);
        await page.screenshot({ path: info.outputPath(`${kind}-${view}.png`), fullPage: true });
        await link.click();
        await closeDetail(page, title);
        await expect(link).toBeFocused();
        await expect(arrow).toHaveAttribute("aria-expanded", "true");
      }
    }
    await page.goto(workspacePath(workspace.id, `/entities/${encodeURIComponent(entity.id)}`));
    const tasks = detailDialog(page).getByRole("region", { name: /^할 일 \(/ });
    const related = tasks.getByRole("link", { name: `${task.title} 상세`, exact: true });
    await related.click();
    await expect(detailDialog(page).getByRole("heading", { name: task.title, exact: true })).toBeVisible();
    await detailDialog(page).getByRole("button", { name: /^이전:/ }).click();
    await expect(related).toBeFocused();
  } finally {
    await client.close();
  }
});
