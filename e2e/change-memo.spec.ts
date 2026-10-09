import { fillChangeMemo } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { beginTabAction, openDetailEditor, saveOnce } from "./ui-actions.ts";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";

test("엔터티 확인 후 한 번에 저장하고 입력 메모만 기록 본문으로 남긴다", async ({page}) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const name = unique("메모 고객"), note = "고객이 확인한 업무 내용\n".repeat(200);
    const requests:string[]=[];page.on("request",r=>{if(r.url().includes("/api/")&&r.method()!=="GET")requests.push(r.url());});
    await page.goto("/entities");await beginTabAction(page,"엔터티 추가");
    const form = page.getByRole("dialog",{name:"엔터티 추가",exact:true});
    await form.getByLabel("속성 1").fill(name);await form.getByLabel("속성 2").fill("10");
    await fillChangeMemo(page,form,note);
    await expect(form.getByLabel("요약")).toHaveCount(0);await expect(form.getByLabel("기록 제목")).toHaveCount(0);
    await saveOnce(page,form);
    await expect(page).toHaveURL(/\/entities\/[^/?]+%3A[0-9]{8}-[0-9A-Z]{8}(?:\?|$)/);
    const id = decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
    expect(requests.filter(path=>path.endsWith("/entities"))).toHaveLength(1);
    expect(requests.some(path=>path.endsWith("/preview"))).toBe(false);
    const records = await mcp.call("list_records",{record_kind:"change",limit:100});
    const record = records.items.find((r:{change:{target_id:string}})=>r.change?.target_id===id);
    expect(record.body).toBe(note);expect(record).not.toHaveProperty("title");expect(record).not.toHaveProperty("summary");expect(record).not.toHaveProperty("change_note");
    await openDetailEditor(page);const edit=page.getByRole("dialog",{name:"엔터티 편집",exact:true});
    await edit.getByLabel("속성 2").fill("30");await saveOnce(page,edit);
    await expect(page.locator("dialog.modal-action[open]")).toHaveCount(0);await expect(edit).not.toBeVisible();expect((await mcp.call("get_entity",{id})).prop2).toBe(30);
    const updated=await mcp.call("list_records",{record_kind:"change",limit:100});
    const changed=updated.items.find((r:{change:{target_id:string;action:string}})=>r.change?.target_id===id&&r.change.action==="update");
    expect(changed).toBeDefined();expect(changed.body).toContain(name);expect(changed.body).toContain("수정");
  } finally { await mcp.close(); }
});
