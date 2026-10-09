import { expect, test } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";
import { savePrinciple } from "./principle-support.ts";

for(const kind of ["entity","task","principle"] as const)test(`삭제된 ${kind}: 이전 변경 기록의 삭제 상태·원문 접근·당시 metadata 보존`,async({page},info)=>{
  await devLogin(page);
  const mcp=await mcpClient(await mcpTokenViaConsent(page));
  let target:{id:string;version:number}|undefined,deleted=false;
  try{
    const title=unique(`삭제 대상 ${kind}`);
    target=(kind==="principle"?await savePrinciple(mcp,{title,body:"당시 본문"}):await mcp.call(`create_${kind}`,kind==="entity"?{prop1:title,prop2:10,prop4:"a"}:{kind:"once",title,body:"삭제 뒤 역사 확인"})) as {id:string;version:number};
    const events=await mcp.call("list_records",{record_kind:"change",limit:50});
    const historical=events.items.find((r:{change?:{target_kind:string;target_id:string;action:string}})=>r.change?.target_kind===kind&&r.change.target_id===target!.id&&r.change.action!=="delete");
    expect(historical).toBeTruthy();expect(historical.change.path).toBeTruthy();
    const metadata=structuredClone(historical.change);
    await mcp.call(`delete_${kind}`,{id:target!.id,expected_version:target!.version,change_note:"삭제 문맥 검증"});deleted=true;
    await page.goto(`/records/${historical.id}`);
    const detail=page.locator("dialog.modal:not(.modal-confirm)[open]").filter({visible:true});
    await expect(detail).toContainText(kind==="entity"?"삭제된 엔터티입니다. 당시의 기록은 그대로 보존됩니다.":"삭제된 대상 또는 접근할 수 없는 대상");
    if(kind!=="entity"){
      await expect(detail.getByRole("button",{name:title,exact:true})).toHaveCount(0);
      await expect(detail.getByRole("link",{name:title+" 상세",exact:true})).toHaveCount(0);
    }
    await expect(detail).toContainText(title);await expect(detail).toContainText("에이전트");
    expect((await mcp.call("get_record",{id:historical.id})).change).toEqual(metadata);
    if(kind==="entity"){
      const stored=await mcp.call("get_entity",{id:target.id});
      expect(stored.deleted_at).not.toBeNull();expect(stored.prop2).toBe(10);
      await detail.getByRole("button",{name:title,exact:true}).click();
      const link=detail.getByRole("link",{name:title+" 상세",exact:true});
      await expect(link).toHaveAttribute("href",`/entities/${encodeURIComponent(target.id)}`);
      await link.click();
      await expect.poll(()=>decodeURIComponent(new URL(page.url()).pathname)).toBe(`/entities/${target.id}`);
      await expect(detail.getByRole("heading",{name:title,level:info.project.name==="desktop"?3:2,exact:true})).toBeVisible();
      await expect(detail).toContainText("삭제됨");
      await expect(detail.getByRole("button",{name:"복원",exact:true})).toBeVisible();
      await expect(detail.getByRole("button",{name:"편집",exact:true})).toHaveCount(0);
      expect((await mcp.call("get_entity",{id:target.id})).deleted_at).toBe(stored.deleted_at);
      expect((await mcp.call("get_record",{id:historical.id})).change).toEqual(metadata);
    }
  }finally{
    try{if(target&&!deleted)await mcp.call(`delete_${kind}`,{id:target.id,expected_version:target.version});}
    finally{await mcp.close();}
  }
});
