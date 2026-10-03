// 유료 실제 공급자 E2E: RUN_PINECONE_E2E=1로 명시적으로 실행한다. CI 기본 실행에는 포함하지 않는다.
import {expect,test} from "@playwright/test";
import {devLogin,env,mcpClient,mcpTokenViaConsent,unique} from "./support.ts";
test("실제 의미 검색→원칙 원문→필터와 초점 복귀",async({page})=>{
  test.skip(process.env.RUN_PINECONE_E2E!=="1","실제 Pinecone 호출은 명시적으로 실행");
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  let tag:{id:string}|undefined,item:{id:string;version:number}|undefined;
  try{
    tag=await mcp.call("create_tag",{name:unique("실모델").slice(0,30)});
    item=await mcp.call("create_principle",{title:"긴 책 읽기 원칙",summary:"300쪽을 넘는 책은 평일에 시작하지 않고 휴가 때 읽는다. 집중할 시간이 확보된 경우에만 긴 책을 고른다.",body:"관리 코드는 오로라-731이다.",tag_ids:[tag.id]});
    const response=await fetch(`${env.VITE_SUPABASE_URL}/functions/v1/index-worker`,{method:"POST",headers:{authorization:`Bearer ${env.INDEX_WORKER_TOKEN}`,"content-type":"application/json"},body:JSON.stringify({limit:1,kind:"principle",id:item!.id})});
    expect(response.status).toBe(200);expect((await response.json()).indexed).toBe(1);
    const query="두꺼운 책은 언제 읽기로 했지?";
    await page.goto(`/search?q=${encodeURIComponent(query)}&tag_id=${tag.id}`);
    const link=page.getByRole("link",{name:"긴 책 읽기 원칙",exact:true});await expect(link).toBeVisible();
    await expect(page.getByText("의미 · 색인 완료",{exact:false})).toBeVisible();
    await expect(page.getByText("현재 키워드 검색 결과를 표시합니다.",{exact:false})).toHaveCount(0);
    expect((await mcp.call("search",{query,tag_id:tag.id})).items[0].id).toBe(item!.id);
    await link.click();await expect(page.getByText("관리 코드는 오로라-731이다.",{exact:true})).toBeVisible();
    await page.getByRole("link",{name:"← 검색 결과",exact:true}).click();
    await expect(page.getByLabel("태그 필터")).toHaveValue(tag.id);await expect(link).toBeFocused();
  }finally{
    if(item)await mcp.call("delete_principle",{id:item.id,expected_version:item.version});
    if(tag)await mcp.call("delete_tag",{id:tag.id,expected_version:1});
    await mcp.close();
  }
});
