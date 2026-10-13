import { scalarFixtureType, fixtureEntityList } from "./entity-schema-support.ts";
import { fillChangeMemo } from "./ui-actions.ts";
import { saveOnce, beginTabAction, openDetailEditor, openListDetail, openTabFilters, closeDetail } from "./ui-actions.ts";
import {expect } from "@playwright/test";
import { test, devLogin,mcpClient,mcpTokenViaConsent,unique } from "./support.ts";
// Exercise native-dialog history; retained desktop tabs have a dedicated suite.
test.beforeEach(async({page,isMobile})=>{if(!isMobile)await page.setViewportSize({width:1024,height:720});});

test("서버 날짜 ID의 태그 단축 URL은 해당 태그 편집기를 연다",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const tag=await mcp.call("create_tag",{scope:"record",name:unique("단축 경로").slice(0,30)});
    expect(tag.id).toMatch(/^[0-9]{8}-[0-9A-Z]{8}$/);
    await page.goto(`/tags/${tag.id}?edit=1&view=${tag.id}`);
    await expect(page).toHaveURL(new RegExp(`/tags/record\\?edit=${tag.id}$`));
    await expect(page.getByRole("textbox",{name:/태그 이름/})).toHaveValue(tag.name);
  }finally{await mcp.close();}
});

test("더 보기 응답이 늦어도 새 태그 필터 목록에 섞이지 않는다",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  let release=()=>{};
  try{
    for(const [kind,path] of [["task","tasks"],["record","records"]]){
      const tag=await mcp.call("create_tag",{scope:kind,name:unique("동시 필터").slice(0,30)});
      const title=unique("태그 결과");await mcp.call(`create_${kind}`,{...(kind==="task"?{kind:"once",title}:{}),body:title,tag_ids:[tag.id]});
      for(let i=0;i<21;i++)await mcp.call(`create_${kind}`,{...(kind==="task"?{kind:"once",title:unique("다른 항목")}:{}),body:unique("필터 밖")});
      await page.goto(`/${path}`);await expect(page.locator(`#activity-${path}-page-control`)).toBeVisible();
      let arrived!:()=>void,finished!:()=>void;
      const waiting=new Promise<void>(r=>{arrived=r;}),done=new Promise<void>(r=>{finished=r;}),hold=new Promise<void>(r=>{release=r;});
      await page.route(`**/api/${path}?**`,async route=>{
        if(!new URL(route.request().url()).searchParams.has("cursor")){await route.continue();return;}
        const response=await route.fetch();arrived();await hold;await route.fulfill({response});finished();
      });
      await page.locator(`#activity-${path}-page-control`).click();await waiting;
      await openTabFilters(page);await page.getByRole("button",{name:tag.name,exact:true}).click();await expect(page.getByRole("button",{name:title,exact:true})).toBeVisible();
      // Changing the filter aborts the superseded read, so no browser response event is required.
      release();await done;
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      await expect(page.locator(`.${path} .list .item-title`)).toHaveCount(1);await page.unroute(`**/api/${path}?**`);
    }
  }finally{release();await mcp.close();}
});


test("태그 실제 DELETE pending은 Back을 막고 응답 뒤 정상 복귀한다",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));let release=()=>{};
  try{
    const tag=await mcp.call("create_tag",{scope:"record",name:unique("지연 삭제").slice(0,30)});
    await page.goto("/entities");
    await page.getByRole("button",{name:/^내 프로필(?: · .+)?$/,exact:true}).click();
    await page.getByRole("link",{name:"설정",exact:true}).click();
    await expect(page.getByRole("link",{name:"자료 설정",exact:true})).toBeVisible();
    await page.getByRole("link",{name:"기록 태그",exact:true}).click();
    await expect(page).toHaveURL(/tags\/record$/);
    let arrived!:()=>void,finished!:()=>void,deletes=0;
    const waiting=new Promise<void>(resolve=>{arrived=resolve;}),done=new Promise<void>(resolve=>{finished=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
    await page.route(`**/api/tags/${tag.id}?**`,async route=>{
      if(route.request().method()!=="DELETE") return route.continue();
      deletes++;arrived();await hold;const response=await route.fetch();await route.fulfill({response});finished();
    });
    await page.getByRole("button",{name:`${tag.name} 삭제`,exact:true}).click();
    const confirm=page.locator("dialog.modal-action[open]");
    await confirm.getByRole("button",{name:"삭제하고 기록",exact:true}).click();await waiting;
    await page.goBack();await expect(page).toHaveURL(/tags\/record$/);await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("button",{name:"삭제 중…"})).toBeDisabled();
    await page.keyboard.press("Escape");await expect(confirm).toBeVisible();
    release();await done;await expect(confirm).toHaveCount(0);
    await expect(page.getByRole("button",{name:`${tag.name} 삭제`,exact:true})).toHaveCount(0);
    expect(deletes).toBe(1);expect((await mcp.call("list_tags",{scope:"record",limit:100})).items.some((value:{id:string})=>value.id===tag.id)).toBe(false);
    await page.goBack();await expect(page).toHaveURL(/settings$/);
  }finally{release();await mcp.close();}
});
test("엔터티·기록 태그 같은 이름·웹 선택 정정·삭제 뒤 원문 보존",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const name=unique("범위 태그").slice(0,30),activity=await mcp.call("create_tag",{scope:"record",name}),entity=await mcp.call("create_tag",{scope:"entity",name});
    expect(activity.id).not.toBe(entity.id);
    for(const [path,action,kind,tag] of [["/records","기록 작성","record",activity],["/entities","검사 자료 추가","entity",entity]] as const){
      await page.goto(kind==="entity"?fixtureEntityList((await scalarFixtureType(mcp)).id):path);await beginTabAction(page,action);
      const form=page.getByRole("dialog",{name:kind==="entity"?/^검사 자료.* 추가$/:action,exact:true}),title=unique("분류 원문");
      if(kind==="entity")await form.getByLabel("제목").fill(title);else{await form.getByLabel("본문").fill(title);}
      await form.getByRole("button",{name,exact:true}).click();await saveOnce(page,form);
      await expect(form).not.toBeVisible();await expect(page).toHaveURL(/\/(?:entities\/[^/?]+%3A|records\/)[0-9]{8}-[0-9A-Z]{8}(?:\?|$)/);
      if(kind==="entity")await expect(page.locator("dialog.modal:not(.modal-confirm)[open]").getByRole("heading",{name:title,exact:true})).toBeVisible();else await expect(page.getByRole("heading",{name:"기록",level:1})).toBeVisible();const id=decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
      expect((await mcp.call(`get_${kind}`,{id})).tag_ids).toEqual([tag.id]);
      await openDetailEditor(page);const edit=page.getByRole("dialog",{name:kind==="entity"?/^검사 자료.* 편집$/:"기록 편집"});
      await edit.getByRole("button",{name,exact:true}).click();if(kind==="entity")await fillChangeMemo(page,edit,"태그 분류 정정");await saveOnce(page,edit);
      await expect(edit).not.toBeVisible();expect((await mcp.call(`get_${kind}`,{id})).tag_ids).toEqual([]);
      await mcp.call(`update_${kind}`,{id,expected_version:2,tag_ids:[tag.id],...(kind==="entity"?{schema_version:(await scalarFixtureType(mcp)).schema_version,change_note:"분류 복구"}:{})});
      const filtered=await mcp.call(kind==="entity"?"list_entities":"list_records",{tag_id:tag.id});
      expect(filtered.items.map((x:{id:string})=>x.id)).toEqual([id]);
      await page.goto(`${path}?tag_id=${tag.id}`);await openListDetail(page,title);await openDetailEditor(page);
      const revisit=page.getByRole("dialog",{name:kind==="entity"?/^검사 자료.* 편집$/:"기록 편집"});await revisit.getByLabel(kind==="entity"?"수량":"본문").fill(kind==="entity"?"10":"원문 보존");if(kind==="entity")await fillChangeMemo(page,revisit,"분류 상태에서 원문 정정");await saveOnce(page,revisit);await expect(revisit).not.toBeVisible();
      await page.getByRole("button",{name:"닫기",exact:true}).click();await openTabFilters(page);await expect(page.getByRole("button",{name:tag.name,exact:true})).toHaveAttribute("aria-pressed","true");await expect(page.locator(kind==="entity"?".list .item-title":".records .list .item-title")).toHaveCount(1);
      await mcp.call("delete_tag",{id:tag.id,expected_version:1});await page.goto(`${path}/${id}`);
      expect((await mcp.call(`get_${kind}`,{id})).tag_ids).toEqual([]);
      if(kind==="entity")await expect(page.locator("dialog.modal:not(.modal-confirm)[open]").getByRole("heading",{name:title,exact:true})).toBeVisible();else await expect(page.getByText("원문 보존",{exact:true})).toBeVisible();
    }
  }finally{await mcp.close();}
});
test("웹 태그 생성→MCP 중복·이름 변경→웹 삭제",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    await page.goto("/tags/record");
    const title=unique("태그").slice(0,30),form=page.getByRole("form",{name:"태그 추가"});
    await form.getByRole("textbox",{name:/태그 이름/}).fill(title);await form.getByRole("button",{name:"추가",exact:true}).click();
    await expect(page.getByRole("button",{name:`${title} 이름 변경`,exact:true})).toBeVisible();
    const list=await mcp.call("list_tags",{limit:100});const tag=list.items.find((t:{name:string})=>t.name===title);
    const renamed=unique("정정").slice(0,30);await mcp.call("rename_tag",{id:tag.id,expected_version:1,name:renamed});
    await page.reload();await page.getByRole("button",{name:`${renamed} 삭제`,exact:true}).click();
    await page.locator("dialog.modal-action[open]").getByRole("button",{name:"삭제하고 기록",exact:true}).click();
    await expect(page.getByRole("button",{name:`${renamed} 삭제`,exact:true})).toHaveCount(0);
    const focusTargets = page.getByRole("heading", { name: "기록 태그 관리", exact: true })
      .or(page.getByRole("button", { name: / 이름 변경$/ }));
    await expect.poll(() => focusTargets.evaluateAll(elements => elements.some(element => element === document.activeElement))).toBe(true);
  }finally{await mcp.close();}
});

test("웹 할 일 태그 선택→MCP 필터·정정→태그 삭제 후 본문 유지",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const tag=await mcp.call("create_tag",{scope:"task",name:unique("업무 태그").slice(0,30)});
    await page.goto("/tasks");await beginTabAction(page,"할 일 추가");
    const form=page.getByRole("dialog",{name:"할 일 추가"});await form.getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill(unique("태그 업무"));await form.getByLabel("본문").fill("분류 검증");await form.getByLabel("본문").fill("삭제 후에도 보존");
    await form.getByRole("button",{name:tag.name,exact:true}).click();await saveOnce(page,form,"추가");
    await expect(form).not.toBeVisible();const id=decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);expect((await mcp.call("get_task",{id})).tag_ids).toEqual([tag.id]);
    await openDetailEditor(page);const edit=page.getByRole("dialog",{name:"할 일 편집"});
    await edit.getByRole("button",{name:tag.name,exact:true}).click();await fillChangeMemo(page,edit,"분류 정정");await saveOnce(page,edit);
    await expect(edit).not.toBeVisible();expect((await mcp.call("get_task",{id})).tag_ids).toEqual([]);
    await mcp.call("update_task",{id,expected_version:2,tag_ids:[tag.id],change_note:"분류 복구"});
    const items=await mcp.call("list_tasks",{tag_id:tag.id});expect(items.items.map((t:{id:string})=>t.id)).toEqual([id]);
    await page.goto(`/tasks?tag_id=${tag.id}`);await openTabFilters(page);await expect(page.getByRole("button",{name:tag.name,exact:true})).toHaveAttribute("aria-pressed","true");
    await mcp.call("delete_tag",{id:tag.id,expected_version:1});await page.goto(`/tasks/${id}`);
    await expect(page.getByText("삭제 후에도 보존",{exact:true})).toBeVisible();expect((await mcp.call("get_task",{id})).tag_ids).toEqual([]);
  }finally{await mcp.close();}
});

test("추가 페이지 태그의 편집 취소·충돌·저장 뒤 목록과 초점 유지",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const tags=[];
    for(let i=0;i<21;i++)tags.push(await mcp.call("create_tag",{name:unique(`보존 ${i}`).slice(0,30)}));
    const oldest=tags[0];await page.goto("/tags/record");
    const trigger=page.getByRole("button",{name:`${oldest.name} 이름 변경`,exact:true});
    await expect(page.locator(".tag-management .list-item").first()).toBeVisible();
    while(await trigger.count()===0){
      const before=await page.locator(".tag-management .list-item").count();
      await page.getByRole("button",{name:"더 보기",exact:true}).click();
      await expect.poll(()=>page.locator(".tag-management .list-item").count()).toBeGreaterThan(before);
    }
    await trigger.click();let form=page.getByRole("form",{name:"태그 이름 변경"});
    await form.getByRole("button", {name:"취소",exact:true}).click();await expect(trigger).toBeFocused();
    await trigger.click();const draft=unique("초안").slice(0,30);await form.getByRole("textbox",{name:/태그 이름/}).fill(draft);
    const server=unique("서버").slice(0,30);await mcp.call("rename_tag",{id:oldest.id,expected_version:1,name:server});
    await saveOnce(page,form);await expect(form.getByText(/다른 변경이 저장/)).toBeVisible();
    await expect(form.getByRole("textbox",{name:/태그 이름/})).toHaveValue(draft);await form.getByRole("button", {name:"취소",exact:true}).click();
    await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();
    const fresh=page.getByRole("button",{name:`${server} 이름 변경`,exact:true});await expect(fresh).toBeFocused();
    await expect(trigger).toHaveCount(0);await fresh.click();form=page.getByRole("form",{name:"태그 이름 변경"});
    await form.getByRole("textbox",{name:/태그 이름/}).fill(draft);await saveOnce(page,form);
    await expect(page.getByRole("button",{name:`${draft} 이름 변경`,exact:true})).toBeFocused();
    await expect(page.getByRole("button",{name:`${tags[1].name} 이름 변경`,exact:true})).toBeVisible();
  }finally{await mcp.close();}
});


test("#370 MCP 태그 생성·정정 뒤 유지한 웹 목록과 상세가 최신 이름을 읽는다", async ({ page, isMobile }, info) => {
  if (!isMobile) await page.setViewportSize({ width: 1440, height: 900 });
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const type = await mcp.call("create_entity_type", {
      label: unique("태그 갱신 자료"),
      icon_id: "box",
      representative_label: "제목",
    });
    await page.goto(fixtureEntityList(type.id));
    await openTabFilters(page);
    await expect(page.getByText("자료 태그", { exact: true })).toBeVisible();
    // Complete the first dictionary read before the external MCP write.
    await expect(page.getByText("태그를 불러오는 중…", { exact: true })).toHaveCount(0);
    const name = unique("외부 태그").slice(0, 30);
    const tag = await mcp.call("create_tag", { scope: "entity", name });
    const title = unique("갱신 확인");
    await mcp.call("create_entity", {
      entity_type_id: type.id,
      schema_version: type.schema_version,
      properties: { prop_1: title },
      tag_ids: [tag.id],
    });
    // A filter navigation receives fresh rows without reloading the page.
    await page.getByRole("textbox", { name: "자료 제목 검색", exact: true }).fill(title);
    const list = page.getByRole("list", { name: `${type.label} 목록`, exact: true });
    await list.getByRole("button", { name: title, exact: true }).click();
    await expect(list.locator('[aria-label="태그"]').getByText(name, { exact: true })).toBeVisible();
    await expect(list.getByText("삭제된 태그", { exact: true })).toHaveCount(0);
    await openListDetail(page, title);
    await expect(page.locator("dialog.modal[open]").getByText(name, { exact: true })).toBeVisible();
    await closeDetail(page, title);
    const renamed = unique("외부 정정").slice(0, 30);
    await mcp.call("rename_tag", { id: tag.id, expected_version: 1, name: renamed });
    // Revisit the already-expanded item without changing filters or toggling its preview.
    await openListDetail(page, title);
    await expect(page.locator("dialog.modal[open]").getByText(renamed, { exact: true })).toBeVisible();
    if (!isMobile) await expect(list.locator('[aria-label="태그"]').getByText(renamed, { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("tag-refresh-fixed.png"), fullPage: true });
    await closeDetail(page, title);
    await mcp.call("delete_tag", { id: tag.id, expected_version: 2 });
    await page.getByRole("textbox", { name: "자료 제목 검색", exact: true }).fill("");
    await expect(list.getByRole("button", { name: title, exact: true })).toBeVisible();
    await expect(list.getByText(renamed, { exact: true })).toHaveCount(0);
    expect((await mcp.call("list_entities", { entity_type_id: type.id })).items[0].tag_ids).toEqual([]);
  } finally {
    await mcp.close();
  }
});
