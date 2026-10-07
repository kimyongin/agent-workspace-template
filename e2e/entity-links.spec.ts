import { test, expect } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";
import { beginTabAction, openDetailEditor } from "./ui-actions.ts";

test("general record selects two entities in web; MCP, both related views and deletion retain context", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  const label = unique("공동 대상"), first = await mcp.call("create_entity", { prop1: label + " 첫째" }),
    second = await mcp.call("create_entity", { prop1: label + " 둘째" });
  let recordId = "", firstDeleted = false;
  try {
    await page.goto("/records");
    await beginTabAction(page, "기록 작성");
    const form = page.getByRole("dialog", { name: "기록 작성", exact: true });
    await form.getByRole("textbox", { name: /^본문/ }).fill(label + " 자료");
    await form.getByRole("searchbox", { name: "엔터티 제목 검색", exact: true }).fill(label);
    await form.getByRole("button", { name: first.prop1+" 연결", exact: true }).click();
    await form.getByRole("button", { name: second.prop1+" 연결", exact: true }).click();
    await form.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page).toHaveURL(/\/records\/[0-9a-f-]{36}/);
    recordId = new URL(page.url()).pathname.split("/").at(-1)!;
    const read = await mcp.call("get_record", { id: recordId });
    expect(read.entity_ids).toEqual([first.id, second.id].sort());
    for (const target of [first, second]) {
      const related = await mcp.call("get_entity", { id: target.id });
      expect(related.records.items.some((item: { id: string }) => item.id === recordId)).toBe(true);
      await page.goto(`/records?entity_id=${target.id}`);
      await expect(page.getByRole("button", { name: label + " 자료", exact: true })).toBeVisible();
    }
    await mcp.call("delete_entity", { id: first.id, expected_version: first.version }); firstDeleted = true;
    await page.goto(`/records/${recordId}`); await openDetailEditor(page);
    const edit = page.getByRole("dialog", { name: "기록 편집", exact: true });
    await expect(edit.getByRole("button", { name: first.prop1+" 해제", exact: true })).toBeVisible();
    await edit.getByRole("textbox", { name: /^본문/ }).fill("대상 삭제 후에도 자료를 보존");
    await edit.getByRole("button", { name: "저장", exact: true }).click();
    await expect(edit).not.toBeVisible();
    const edited = await mcp.call("get_record", { id: recordId });
    expect(edited.body).toBe("대상 삭제 후에도 자료를 보존");
    expect(edited.entity_context).toEqual(read.entity_context);
    expect(edited.task_id).toBeNull();
  } finally {
    if (recordId) { const row = await mcp.call("get_record", { id: recordId }); await mcp.call("delete_record", { id: recordId, expected_version: row.version }); }
    if (!firstDeleted) await mcp.call("delete_entity", { id: first.id, expected_version: first.version });
    await mcp.call("delete_entity", { id: second.id, expected_version: second.version });
    await mcp.close();
  }
});


test("web occurrence defaults preserve both task targets rather than the legacy first-target alias", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  const label = unique("회차 다중 대상"), targets = [await mcp.call("create_entity", { prop1: label + " 첫째" }), await mcp.call("create_entity", { prop1: label + " 둘째" })];
  const ids = targets.map(target => target.id).sort(), date = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let taskId = "", recordId = "";
  try {
    const task = await mcp.call("create_task", { kind: "recurring", title: label, body: "두 대상의 회차", entity_ids: ids, recurrence: { freq: "daily", starts_on: date }, timezone: "UTC" }); taskId = task.id;
    await page.goto(`/tasks/${task.id}`);
    await page.getByRole("button", { name: `${date} 회차 기록`, exact: true }).click();
    const form = page.getByRole("dialog", { name: `${date} 회차 기록`, exact: true });
    for (const target of targets) await expect(form.getByRole("button", { name: target.prop1+" 해제", exact: true })).toBeVisible();
    await form.getByLabel("본문",{exact:false}).fill("두 대상의 회차 수행 결과");
    await form.getByRole("button", { name: "기록 저장", exact: true }).click();
    await expect(form).not.toBeVisible();
    const schedule = await mcp.call("list_occurrences", { id: task.id, from: date, to: date });
    recordId = schedule.items[0].record_ids[0]; expect(recordId).toBeTruthy();
    const read = await mcp.call("get_record", { id: recordId });
    expect(read.entity_ids).toEqual(ids);
    expect([read.record_kind, read.task_id, read.occurrence_on]).toEqual(["result", task.id, date]);
  } finally {
    if (recordId) { const row = await mcp.call("get_record", { id: recordId }); await mcp.call("delete_record", { id: recordId, expected_version: row.version }); }
    if (taskId) { const row = await mcp.call("get_task", { id: taskId }); await mcp.call("delete_task", { id: taskId, expected_version: row.version }); }
    for (const target of targets) await mcp.call("delete_entity", { id: target.id, expected_version: target.version });
    await mcp.close();
  }
});
