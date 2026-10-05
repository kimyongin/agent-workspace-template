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
    await form.getByRole("textbox", { name: /^제목/ }).fill(label + " 자료");
    await form.getByRole("textbox", { name: /^요약/ }).fill("공동 업무의 참고 자료");
    await form.getByRole("checkbox", { name: first.prop1, exact: true }).check();
    await form.getByRole("checkbox", { name: second.prop1, exact: true }).check();
    await form.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page).toHaveURL(/\/records\/[0-9a-f-]{36}/);
    recordId = new URL(page.url()).pathname.split("/").at(-1)!;
    const read = await mcp.call("get_record", { id: recordId });
    expect(read.entity_ids).toEqual([first.id, second.id].sort());
    for (const target of [first, second]) {
      const related = await mcp.call("get_entity", { id: target.id });
      expect(related.records.items.some((item: { id: string }) => item.id === recordId)).toBe(true);
      await page.goto(`/records?entity_id=${target.id}`);
      await expect(page.getByRole("link", { name: label + " 자료", exact: true })).toBeVisible();
    }
    await mcp.call("delete_entity", { id: first.id, expected_version: first.version }); firstDeleted = true;
    await page.goto(`/records/${recordId}`); await openDetailEditor(page);
    const edit = page.getByRole("dialog", { name: "기록 편집", exact: true });
    await expect(edit.getByRole("checkbox", { name: first.prop1, exact: true })).toBeChecked();
    await edit.getByRole("textbox", { name: /^요약/ }).fill("대상 삭제 후에도 자료를 보존");
    await edit.getByRole("button", { name: "저장", exact: true }).click();
    const edited = await mcp.call("get_record", { id: recordId });
    expect(edited.entity_context).toEqual(read.entity_context);
    expect(edited.task_id).toBeNull();
  } finally {
    if (recordId) { const row = await mcp.call("get_record", { id: recordId }); await mcp.call("delete_record", { id: recordId, expected_version: row.version }); }
    if (!firstDeleted) await mcp.call("delete_entity", { id: first.id, expected_version: first.version });
    await mcp.call("delete_entity", { id: second.id, expected_version: second.version });
    await mcp.close();
  }
});
