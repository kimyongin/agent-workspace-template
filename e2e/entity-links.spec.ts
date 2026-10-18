import { businessRows, entryDetails } from "./table-actions.ts";
import { createFixtureEntity, scalarFixtureType, fixtureEntityList } from "./entity-schema-support.ts";
import { expect } from "@playwright/test";
import { test, devLogin, mcpClient, mcpTokenViaConsent, unique , ownedWorkspace, workspacePath} from "./support.ts";
import { beginTabAction, openDetailEditor } from "./ui-actions.ts";

test("회차 결과의 단일 할 일 소속은 두 자료 연결을 복사하거나 변경하지 않는다", async ({ page }) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  const label = unique("회차 다중 대상"), targets = [await createFixtureEntity(mcp, workspace, { prop_1: label + " 첫째" }), await createFixtureEntity(mcp, workspace, { prop_1: label + " 둘째" })];
  const ids = targets.map(target => target.id).sort(), date = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let taskId = "", recordId = "";
  try {
    const task = await mcp.call("create_task", { kind: "recurring", title: label, body: "두 대상의 회차", entity_ids: ids, recurrence: { freq: "daily", starts_on: date }, timezone: "UTC" }); taskId = task.id;
    await page.goto(workspacePath(workspace.id, `/tasks/${task.id}`));
    await page.getByRole("button", { name: `${date} 회차 기록`, exact: true }).click();
    const form = page.getByRole("dialog", { name: `${date} 회차 기록`, exact: true });
    await expect(form.getByRole("button", { name: "자료 연결", exact: true })).toHaveCount(0);
    for (const target of targets) await expect(form.getByRole("button", { name: target.title+" 해제", exact: true })).toHaveCount(0);
    await form.getByLabel("본문",{exact:false}).fill("두 대상의 회차 수행 결과");
    await form.getByRole("button", { name: "기록 저장", exact: true }).click();
    await expect(form).not.toBeVisible();
    const schedule = await mcp.call("list_occurrences", { id: task.id, from: date, to: date });
    recordId = schedule.items[0].record_ids[0]; expect(recordId).toBeTruthy();
    const read = await mcp.call("get_record", { id: recordId });
    expect(read.entity_id).toBeNull();
    expect(read).not.toHaveProperty("entity_ids");
    expect((await mcp.call("get_task", { id: task.id })).entity_ids).toEqual(ids);
    expect([read.record_kind, read.task_id, read.occurrence_on]).toEqual(["result", task.id, date]);
  } finally {
    if (recordId) { const row = await mcp.call("get_record", { id: recordId }); await mcp.call("delete_record", { id: recordId, expected_version: row.version }); }
    if (taskId) { const row = await mcp.call("get_task", { id: taskId }); await mcp.call("delete_task", { id: taskId, expected_version: row.version }); }
    for (const target of targets) await mcp.call("delete_entity", { id: target.id, expected_version: target.version });
    await mcp.close();
  }
});
