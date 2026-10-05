import { openDetailEditor } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";
import { savePrinciple } from "./principle-support.ts";

for(const kind of ["entity","task","record","principle"] as const)test(`삭제된 ${kind}: 이전 변경 기록은 원문 링크 없이 당시 metadata 보존`,async({page})=>{
  await devLogin(page);
  const mcp=await mcpClient(await mcpTokenViaConsent(page));
  let target:{id:string;version:number}|undefined,deleted=false;
  try{
    const title=unique(`삭제 대상 ${kind}`);
    target=(kind==="principle"?await savePrinciple(mcp,{title,summary:"삭제 뒤 역사 확인",body:"당시 본문"}):await mcp.call(`create_${kind}`,kind==="entity"?{prop1:title,prop2:10,prop4:"a"}:kind==="task"?{kind:"once",title,summary:"삭제 뒤 역사 확인"}:{title,summary:"삭제 뒤 역사 확인"})) as {id:string;version:number};
    const events=await mcp.call("list_records",{record_kind:"change",limit:50});
    const historical=events.items.find((r:{change?:{target_kind:string;target_id:string;action:string}})=>r.change?.target_kind===kind&&r.change.target_id===target!.id&&r.change.action!=="delete");
    expect(historical).toBeTruthy();expect(historical.change.path).toBeTruthy();
    const metadata=structuredClone(historical.change);
    await mcp.call(`delete_${kind}`,{id:target!.id,expected_version:target!.version,change_note:"삭제 문맥 검증",request_id:crypto.randomUUID()});deleted=true;
    await page.goto(`/records/${historical.id}?edit=1`);
    const detail=page.locator("dialog.modal:not(.modal-confirm)[open]");
    await expect(detail).toContainText("삭제된 대상 또는 접근할 수 없는 대상");
    await expect(detail.getByRole("link",{name:"대상 원문 보기",exact:true})).toHaveCount(0);
    await expect(detail).toContainText(title);await expect(detail).toContainText("에이전트");
    expect((await mcp.call("get_record",{id:historical.id})).change).toEqual(metadata);
  }finally{
    try{if(target&&!deleted)await mcp.call(`delete_${kind}`,{id:target.id,expected_version:target.version,request_id:crypto.randomUUID()});}
    finally{await mcp.close();}
  }
});
