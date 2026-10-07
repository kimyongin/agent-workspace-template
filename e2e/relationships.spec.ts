import { test, expect } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";
import { openDetailEditor, saveOnce } from "./ui-actions.ts";

test("상세 보기의 양방향 연결·해제와 일반 메모가 웹/MCP에서 일치한다",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  const label=unique("관계"),entity=await mcp.call("create_entity",{prop1:label+" 고객"}),task=await mcp.call("create_task",{kind:"once",title:label+" 상담"});
  let recordId="";
  const dialog=()=>page.locator("dialog.modal:not(.modal-confirm)[open]");
  try {
    await page.goto(`/tasks/${task.id}`);await dialog().getByRole("button",{name:"엔터티 연결",exact:true}).click();await dialog().getByRole("searchbox",{name:"엔터티 제목 검색"}).fill(label);
    await dialog().getByRole("button",{name:entity.prop1+" 연결",exact:true}).click();await expect(page.locator("dialog[open]")).toHaveCount(1);await dialog().getByRole("button",{name:"연결하고 저장"}).click();
    await expect(dialog().getByRole("button",{name:entity.prop1+" 연결 해제"})).toBeVisible();expect((await mcp.call("get_task",{id:task.id})).entity_ids).toEqual([entity.id]);
    await openDetailEditor(page);await expect(dialog().getByRole("searchbox",{name:"엔터티 제목 검색"})).toHaveCount(0);await dialog().getByLabel("본문",{exact:false}).fill("상담 업무 내용");await saveOnce(page,dialog());
    await dialog().getByRole("button",{name:"기록 작성",exact:true}).click();await dialog().getByLabel("본문",{exact:false}).fill(label+" 진행 메모");await dialog().getByRole("button",{name:"저장",exact:true}).click();
    await expect(dialog().getByRole("link",{name:label+" 진행 메모",exact:true})).toBeVisible();const records=await mcp.call("list_records",{task_id:task.id});const note=records.items.find((r:{body:string})=>r.body===label+" 진행 메모");recordId=note.id;
    expect([note.record_kind,note.task_id,note.occurrence_on]).toEqual(["user",task.id,null]);expect(note.entity_ids).toEqual([entity.id]);expect((await mcp.call("get_task",{id:task.id})).status).toBe("open");
    await dialog().getByRole("button",{name:entity.prop1+" 연결 해제"}).click();await dialog().getByRole("button",{name:"연결 해제하고 저장"}).click();await expect(page.locator("dialog.modal-action[open]")).toHaveCount(0);await expect(dialog().getByRole("button",{name:entity.prop1+" 연결 해제"})).toHaveCount(0);expect((await mcp.call("get_record",{id:recordId})).entity_ids).toEqual([entity.id]);
    await page.goto(`/entities/${entity.id}`);await dialog().getByRole("button",{name:"할 일 연결",exact:true}).click();await dialog().getByRole("searchbox",{name:"할 일 제목 검색"}).fill(label);
    await dialog().getByRole("button",{name:task.title+" 연결",exact:true}).click();await dialog().getByRole("button",{name:"연결하고 저장"}).click();await expect(dialog().getByRole("button",{name:task.title+" 연결 해제"})).toBeVisible();
    expect((await mcp.call("get_task",{id:task.id})).entity_ids).toEqual([entity.id]);await dialog().getByRole("button",{name:task.title+" 연결 해제"}).click();await dialog().getByRole("button",{name:"연결 해제하고 저장"}).click();await expect(page.locator("dialog.modal-action[open]")).toHaveCount(0);await expect(dialog().getByRole("button",{name:task.title+" 연결 해제"})).toHaveCount(0);expect((await mcp.call("get_task",{id:task.id})).entity_ids).toEqual([]);
  } finally {
    if(recordId){const row=await mcp.call("get_record",{id:recordId});await mcp.call("delete_record",{id:recordId,expected_version:row.version});}
    const row=await mcp.call("get_task",{id:task.id});await mcp.call("delete_task",{id:task.id,expected_version:row.version});await mcp.call("delete_entity",{id:entity.id,expected_version:entity.version});await mcp.close();
  }
});
