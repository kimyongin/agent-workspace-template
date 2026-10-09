import {expect,test} from "@playwright/test";
import {devLogin,mcpClient,mcpTokenViaConsent,unique} from "./support.ts";
import {savePrinciple} from "./principle-support.ts";
// This suite checks native-dialog history restoration; retained wide panels are covered separately.
test.beforeEach(async({page,isMobile})=>{if(!isMobile)await page.setViewportSize({width:1024,height:720});});
test("웹 검색→태그 범위→MCP 결과 비교→본문 원문 확인",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const marker=unique("본문 검색"),title=marker, tag=await mcp.call("create_tag",{name:unique("검색").slice(0,30)});
    await mcp.call("create_record",{body:marker,tag_ids:[tag.id]});
    await mcp.call("create_record",{body:marker});
    await page.goto("/search?record_kind=user");await page.getByLabel("검색어").fill(marker);await page.getByRole("button",{name:"검색",exact:true}).click();
    await expect(page.locator(".list .item-title")).toHaveCount(2);
    await page.locator("summary").filter({hasText:"검색 조건"}).click();await page.getByLabel("태그 필터").selectOption(tag.id);await expect(page.locator(".list .item-title")).toHaveCount(1);
    await page.getByLabel("검색 방식").selectOption("keyword");await expect(page.getByText("현재 키워드 검색 결과를 표시합니다.",{exact:false})).toHaveCount(0);
    expect((await mcp.call("search",{query:marker,tag_id:tag.id,mode:"keyword"})).items[0].title).toBe(title);
    await page.getByRole("link",{name:title,exact:true}).click();await expect(page.getByText(marker,{exact:true})).toBeVisible();
    await page.getByRole("button",{name:/^이전: 검색/}).click();
    await page.locator("summary").filter({hasText:"검색 조건"}).click();await expect(page.getByLabel("태그 필터")).toHaveValue(tag.id);await expect(page.getByLabel("검색 방식")).toHaveValue("keyword");
    await expect(page.getByRole("link",{name:title,exact:true})).toBeFocused();
  }finally{await mcp.close();}
});

test("세 원문 종류의 검색 상세 왕복·뒤로 가기·새로고침이 추가 페이지와 초점을 복원한다",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const marker=unique("검색 복원"),titles:string[]=[];
    for(const kind of ["record","task","principle"]){const title=kind==="record"?`record ${marker}`:unique(kind);titles.push(title);if(kind==="principle")await savePrinciple(mcp,{title,body:marker});else await mcp.call(`create_${kind}`,{...(kind==="task"?{kind:"once",title}:{}),body:kind==="record"?title:marker});}
    for(let i=0;i<21;i++)await mcp.call("create_record",{body:`${unique("추가 결과")} ${marker}`});
    await page.goto(`/search?q=${encodeURIComponent(marker)}&mode=keyword&record_kind=user`);await expect(page.locator(".list .item-title")).toHaveCount(20);
    await page.getByRole("button",{name:"더 보기",exact:true}).click();await expect(page.locator(".list .item-title")).toHaveCount(24);
    for(const [index,title] of titles.entries()){
      const link=page.getByRole("link",{name:title,exact:true});await link.scrollIntoViewIfNeeded();await link.click();
      await expect(page.getByRole("heading",{name:index===0?"기록":title,exact:true})).toBeVisible();
      if(index===0)for(let i=0;i<21;i++)await mcp.call("create_record",{body:`${unique("동시 추가")} ${marker}`});
      if(index===0)await page.goBack();else await page.getByRole("button",{name:/^이전: 검색/}).click();
      await expect(page.locator(".list .item-title")).toHaveCount(45);await expect(link).toBeFocused();
      await page.reload();await expect(page.locator(".list .item-title")).toHaveCount(45);await expect(link).toBeFocused();
      await expect(link).toBeInViewport();expect(new URL(page.url()).searchParams.get("pages")).toBe("2");
    }
  }finally{await mcp.close();}
});

test("검색 대상 삭제·불일치 편집 후에는 저장한 페이지까지만 복원하고 제목에 초점을 돌린다",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const marker=unique("범위 복원"),targets:string[]=[];
    for(let i=0;i<45;i++){const title=`${unique("결과")} ${marker}`;await mcp.call("create_record",{body:title});if(i===20||i===21)targets.push(title);}
    await page.goto(`/search?q=${encodeURIComponent(marker)}&mode=keyword&record_kind=user`);await expect(page.locator(".list .item-title")).toHaveCount(20);
    await page.getByRole("button",{name:"더 보기",exact:true}).click();await expect(page.locator(".list .item-title")).toHaveCount(40);
    let requests=0;page.on("request",r=>{if(r.url().endsWith("/api/search")&&r.method()==="POST")requests++;});
    await page.getByRole("link",{name:targets[0],exact:true}).click();
    await page.getByRole("button",{name:"편집",exact:true}).click();await expect(page.getByRole("dialog",{name:"기록 편집"})).toBeVisible();await page.getByRole("button",{name:"삭제",exact:true}).click();requests=0;
    await page.locator("dialog.modal-action[open]").getByRole("button",{name:"삭제하고 기록",exact:true}).click();
    await expect(page).toHaveURL(/\/search\?/);await expect(page.locator(".list .item-title")).toHaveCount(40);await expect(page.getByRole("heading",{name:"검색",exact:true})).toBeFocused();expect(requests).toBe(2);
    await page.getByRole("link",{name:targets[1],exact:true}).click();await page.getByRole("button",{name:"편집",exact:true}).click();
    const form=page.getByRole("dialog",{name:"기록 편집"});await form.getByLabel("본문").fill("검색어 없음");await expect(form.getByLabel("편집 메모")).toHaveCount(0);await form.getByRole("button",{name:"저장",exact:true}).click();await expect(form).not.toBeVisible();
    requests=0;await page.getByRole("button",{name:/^이전: 검색/}).click();
    await expect(page.locator(".list .item-title")).toHaveCount(40);await expect(page.getByRole("heading",{name:"검색",exact:true})).toBeFocused();expect(requests).toBe(2);
  }finally{await mcp.close();}
});
