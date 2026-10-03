import {expect,test} from "@playwright/test";
import {devLogin,mcpClient,mcpTokenViaConsent,unique} from "./support.ts";
test("웹 검색→태그 범위→MCP 결과 비교→본문 원문 확인",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const title=unique("원문"),marker=unique("본문 검색"), tag=await mcp.call("create_tag",{name:unique("검색").slice(0,30)});
    await mcp.call("create_record",{title,summary:"검색할 근거",body:marker,tag_ids:[tag.id]});
    await mcp.call("create_record",{title:unique("다른 태그"),summary:"필터 밖",body:marker});
    await page.goto("/search");await page.getByLabel("검색어").fill(marker);await page.getByRole("button",{name:"검색",exact:true}).click();
    await expect(page.locator(".list .item-title")).toHaveCount(2);await expect(page.getByText("현재 키워드 검색 결과를 표시합니다.",{exact:false})).toBeVisible();
    await page.getByLabel("태그 필터").selectOption(tag.id);await expect(page.locator(".list .item-title")).toHaveCount(1);
    await page.getByLabel("검색 방식").selectOption("keyword");await expect(page.getByText("현재 키워드 검색 결과를 표시합니다.",{exact:false})).toHaveCount(0);
    expect((await mcp.call("search",{query:marker,tag_id:tag.id,mode:"keyword"})).items[0].title).toBe(title);
    await page.getByRole("link",{name:title,exact:true}).click();await expect(page.getByText(marker,{exact:true})).toBeVisible();
  }finally{await mcp.close();}
});
