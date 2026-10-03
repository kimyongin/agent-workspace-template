import {expect,test} from "@playwright/test";
import {devLogin,mcpClient,mcpTokenViaConsent,unique} from "./support.ts";
test("웹 태그 생성→MCP 중복·이름 변경→웹 삭제",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    await page.goto("/tags");await page.getByRole("button",{name:"태그 추가"}).click();
    const title=unique("태그").slice(0,30),form=page.getByRole("dialog",{name:"태그 추가"});
    await form.getByLabel("태그 이름").fill(title);await form.getByRole("button",{name:"저장"}).click();
    await expect(page.getByRole("button",{name:`${title} 이름 변경`,exact:true})).toBeVisible();
    const list=await mcp.call("list_tags",{limit:100});const tag=list.items.find((t:{name:string})=>t.name===title);
    const renamed=unique("정정").slice(0,30);await mcp.call("rename_tag",{id:tag.id,expected_version:1,name:renamed});
    await page.reload();await page.getByRole("button",{name:`${renamed} 삭제`,exact:true}).click();
    await page.getByRole("dialog",{name:"태그를 삭제할까요?"}).getByRole("button",{name:"삭제",exact:true}).click();
    await expect(page.getByRole("button",{name:`${renamed} 삭제`,exact:true})).toHaveCount(0);
  }finally{await mcp.close();}
});
