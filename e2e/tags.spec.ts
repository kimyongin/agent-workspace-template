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
    await expect.poll(()=>page.evaluate(()=>document.activeElement?.id)).toMatch(/^(tag-|tags-title)/);
  }finally{await mcp.close();}
});

test("추가 페이지 태그의 편집 취소·충돌·저장 뒤 목록과 초점 유지",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const tags=[];
    for(let i=0;i<21;i++)tags.push(await mcp.call("create_tag",{name:unique(`보존 ${i}`).slice(0,30)}));
    const oldest=tags[0];await page.goto("/tags");
    const trigger=page.getByRole("button",{name:`${oldest.name} 이름 변경`,exact:true});
    while(await trigger.count()===0){await page.getByRole("button",{name:"더 보기",exact:true}).click();await expect(page.getByRole("button",{name:"불러오는 중…"})).toHaveCount(0);}
    await trigger.click();let form=page.getByRole("dialog",{name:"태그 이름 변경"});
    await form.getByRole("button",{name:"취소",exact:true}).click();await expect(trigger).toBeFocused();
    await trigger.click();const draft=unique("초안").slice(0,30);await form.getByLabel("태그 이름").fill(draft);
    const server=unique("서버").slice(0,30);await mcp.call("rename_tag",{id:oldest.id,expected_version:1,name:server});
    await form.getByRole("button",{name:"저장",exact:true}).click();await expect(form.getByText(/다른 변경이 저장/)).toBeVisible();
    await expect(form.getByLabel("태그 이름")).toHaveValue(draft);await form.getByRole("button",{name:"취소",exact:true}).click();
    await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();
    const fresh=page.getByRole("button",{name:`${server} 이름 변경`,exact:true});await expect(fresh).toBeFocused();
    await expect(trigger).toHaveCount(0);await fresh.click();form=page.getByRole("dialog",{name:"태그 이름 변경"});
    await form.getByLabel("태그 이름").fill(draft);await form.getByRole("button",{name:"저장",exact:true}).click();
    await expect(page.getByRole("button",{name:`${draft} 이름 변경`,exact:true})).toBeFocused();
    await expect(page.getByRole("button",{name:`${tags[1].name} 이름 변경`,exact:true})).toBeVisible();
  }finally{await mcp.close();}
});
