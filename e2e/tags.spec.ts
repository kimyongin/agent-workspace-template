import { businessRows } from "./table-actions.ts";
import { openMainNavigation } from "./ui-actions.ts";
import { detailDialog, executionDialog, openDialogs } from "./ui-actions.ts";
import { chooseTag, applyTabFilters } from "./ui-actions.ts";
import { scalarFixtureType, fixtureEntityList } from "./entity-schema-support.ts";
import { fillChangeMemo } from "./ui-actions.ts";
import { saveOnce, beginTabAction, openDetailEditor, openListDetail, openTabFilters, closeDetail } from "./ui-actions.ts";
import { expect, type Page } from "@playwright/test";
import { test, devLogin,mcpClient,mcpTokenViaConsent,unique , ownedWorkspace, workspacePath} from "./support.ts";
async function connectBrowserTag(page: Page, name: string, checked = true) {
  const region=detailDialog(page).getByRole("region", {name:"태그 연결",exact:true});
  await region.getByRole("button", {name:"태그 연결",exact:true}).click();
  await chooseTag(page,region,name,checked);
  await saveOnce(page,region,"연결 적용");
  await expect(region.getByRole("button", {name:"태그 연결",exact:true})).toBeVisible();
}
// Exercise modal history; retained desktop tabs have a dedicated suite.
test.beforeEach(async({page,isMobile})=>{if(!isMobile)await page.setViewportSize({width:1024,height:720});});

test("서버 날짜 ID의 태그 단축 URL은 해당 태그 편집기를 연다",async({page})=>{
  await devLogin(page);
  const workspace = await ownedWorkspace(page);const mcp=await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try{
    const tag=await mcp.call("create_tag",{scope:"record",name:unique("단축 경로").slice(0,30)});
    expect(tag.id).toMatch(/^[0-9]{8}-[0-9A-Z]{8}$/);
    await page.goto(workspacePath(workspace.id, `/tags/${tag.id}?edit=1&view=${tag.id}`));
    await expect(page).toHaveURL(new RegExp(`/tags/record\\?edit=${tag.id}$`));
    await expect(page.getByRole("textbox",{name:/태그 이름/})).toHaveValue(tag.name);
  }finally{await mcp.close();}
});

test("더 보기 응답이 늦어도 새 태그 필터 목록에 섞이지 않는다",async({page})=>{
  await devLogin(page);
  const workspace = await ownedWorkspace(page);const mcp=await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  let release=()=>{};
  try{
    for(const [kind,path] of [["task","tasks"],["record","records"]]){
      const tag=await mcp.call("create_tag",{scope:kind,name:unique("동시 필터").slice(0,30)});
      const create = async (title: string) => {
        const task=await mcp.call("create_task", {kind:"once",title,body:title});
        if(kind==="task") return task;
        return (await mcp.call("complete_task", {id:task.id,expected_version:task.version,body:title})).record;
      };
      const title=unique("태그 결과"), target=await create(title);
      await mcp.call("set_tag_connections", {target_kind:kind,target_id:target.id,expected_version:target.version,tag_ids:[tag.id]});
      for(let i=0;i<21;i++) await create(unique("필터 밖"));
      await page.goto(workspacePath(workspace.id, `/${path}${kind==="record"?"?record_kind=result":""}`));await expect(page.locator(`#activity-${path}-page-control`)).toBeVisible();
      let arrived!:()=>void,finished!:()=>void;
      const waiting=new Promise<void>(r=>{arrived=r;}),done=new Promise<void>(r=>{finished=r;}),hold=new Promise<void>(r=>{release=r;});
      await page.route(`**/api/${path}?**`,async route=>{
        if(!new URL(route.request().url()).searchParams.has("cursor")){await route.continue();return;}
        const response=await route.fetch();arrived();await hold;await route.fulfill({response});finished();
      });
      await page.locator(`#activity-${path}-page-control`).click();await waiting;
      await openTabFilters(page);await chooseTag(page, page, tag.name);await applyTabFilters(page);await expect(page.getByRole("button",{name:title,exact:true})).toBeVisible();
      // Changing the filter aborts the superseded read, so no browser response event is required.
      release();await done;
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      await expect(page.getByRole("region", { name: / 목록$/ }).locator("[data-list-anchor]")).toHaveCount(1);await page.unroute(`**/api/${path}?**`);
    }
  }finally{release();await mcp.close();}
});


test("태그 실제 DELETE pending은 Back을 막고 응답 뒤 정상 복귀한다",async({page})=>{
  await devLogin(page);
  const workspace = await ownedWorkspace(page);const mcp=await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });let release=()=>{};
  try{
    const tag=await mcp.call("create_tag",{scope:"record",name:unique("지연 삭제").slice(0,30)});
    await page.goto(workspacePath(workspace.id, "/entities"));
    await openMainNavigation(page);
    await page.getByRole("link", { name: "기본 설정",exact:true}).click();
    await openMainNavigation(page);
    await page.getByRole("navigation", { name: "주 메뉴", exact: true }).getByRole("link", { name: "태그 설정",exact:true}).click();
    await page.getByRole("radiogroup", {name:"관리 대상",exact:true}).getByRole("radio", {name:"기록",exact:true}).click();
    await expect(page).toHaveURL(/settings\/tags\?scope=record$/);
    let arrived!:()=>void,finished!:()=>void,deletes=0;
    const waiting=new Promise<void>(resolve=>{arrived=resolve;}),done=new Promise<void>(resolve=>{finished=resolve;}),hold=new Promise<void>(resolve=>{release=resolve;});
    await page.route(`**/api/tags/${tag.id}?**`,async route=>{
      if(route.request().method()!=="DELETE") return route.continue();
      deletes++;arrived();await hold;const response=await route.fetch();await route.fulfill({response});finished();
    });
    await page.getByRole("button",{name:`${tag.name} 삭제`,exact:true}).click();
    const confirm=executionDialog(page);
    await confirm.getByRole("button",{name:"삭제하고 기록",exact:true}).click();await waiting;
    await page.goBack();await expect(page).toHaveURL(/settings\/tags\?scope=record$/);await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("button",{name:"삭제 중…"})).toBeDisabled();
    await page.keyboard.press("Escape");await expect(confirm).toBeVisible();
    release();await done;await expect(confirm).toHaveCount(0);
    await expect(page.getByRole("button",{name:`${tag.name} 삭제`,exact:true})).toHaveCount(0);
    expect(deletes).toBe(1);expect((await mcp.call("list_tags",{scope:"record",limit:100})).items.some((value:{id:string})=>value.id===tag.id)).toBe(false);
    await page.goBack();await expect(page).toHaveURL(/settings\/tags$/);
    await expect(page.getByRole("radiogroup", {name:"관리 대상",exact:true}).getByRole("radio", {name:"자료",exact:true})).toBeChecked();
  }finally{release();await mcp.close();}
});
test("자료·수행 결과의 동명 태그 연결·해제와 내용 편집은 각각 저장된다",async({page})=>{
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const mcp=await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try {
    const name=unique("범위 태그").slice(0,30);
    const tags = {
      entity: await mcp.call("create_tag", { scope: "entity", name }),
      record: await mcp.call("create_tag", { scope: "record", name }),
    };
    expect(tags.entity.id).not.toBe(tags.record.id);
    const type = await scalarFixtureType(mcp, workspace);
    for (const kind of ["entity", "record"] as const) {
      const tag = tags[kind], title = unique("분류 원문");
      let id: string;
      if (kind === "entity") {
        await page.goto(fixtureEntityList(workspace.id, type.id));
        await beginTabAction(page, "검사 자료 추가");
        const form=page.getByRole("dialog", {name:/^검사 자료.* 추가$/});
        await form.getByLabel("제목").fill(title);
        await expect(form.getByRole("button", {name:"태그 선택",exact:true})).toHaveCount(0);
        await saveOnce(page, form);
        await expect(form).not.toBeVisible();
        id=decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);
      } else {
        const task=await mcp.call("create_task", {kind:"once",title});
        const completed=await mcp.call("complete_task", {id:task.id,expected_version:task.version,body:title});
        id=completed.record.id;
        await page.goto(workspacePath(workspace.id, `/records/${id}`));
      }
      expect((await mcp.call(`get_${kind}`, {id})).tag_ids).toEqual([]);
      await connectBrowserTag(page, name);
      expect((await mcp.call(`get_${kind}`, {id})).tag_ids).toEqual([tag.id]);
      await connectBrowserTag(page, name, false);
      expect((await mcp.call(`get_${kind}`, {id})).tag_ids).toEqual([]);
      await openDetailEditor(page);
      const edit=detailDialog(page);
      await expect(edit.getByRole("button", {name:"태그 선택",exact:true})).toHaveCount(0);
      await expect(edit.getByRole("term").filter({hasText:/^태그$/}).locator("..").getByRole("definition")).toHaveText("연결된 태그 없음");
      await edit.getByRole("button", {name:"취소",exact:true}).click();
      const original=await mcp.call(`get_${kind}`, {id});
      await mcp.call("set_tag_connections", {target_kind:kind,target_id:id,expected_version:original.version,tag_ids:[tag.id]});
      const filter=await mcp.call(kind==="entity"?"list_entities":"list_records", {tag_id:tag.id,...(kind==="entity"?{entity_type_id:type.id}:{record_kind:"result"})});
      expect(filter.items.map((item:{id:string})=>item.id)).toEqual([id]);
      await page.goto(kind==="entity" ? fixtureEntityList(workspace.id, type.id)+`&tag_id=${tag.id}` : workspacePath(workspace.id, `/records?record_kind=result&tag_id=${tag.id}`));
      await openListDetail(page, title);
      const beforeContentEdit = await mcp.call(`get_${kind}`, {id});
      await openDetailEditor(page);
      const revisit=detailDialog(page);
      await revisit.getByLabel(kind==="entity"?"수량":"본문").fill(kind==="entity"?"10":"원문 보존");
      if(kind==="entity") await fillChangeMemo(page,revisit,"분류 상태에서 원문 정정");
      await saveOnce(page,revisit);
      await expect(revisit).toBeVisible();
      await expect(revisit.getByRole("button", {name:"편집",exact:true})).toBeVisible();
      await expect(revisit.getByRole("button", {name:"저장",exact:true})).toHaveCount(0);
      await expect(revisit.getByLabel(kind==="entity"?"수량":"본문", {exact:true})).toHaveCount(0);
      await expect(revisit.getByRole("term").filter({hasText:kind==="entity"?/^수량$/:/^본문$/}).locator("..").getByRole("definition")).toHaveText(kind==="entity"?"10":"원문 보존");
      await expect(revisit.getByRole("region", {name:"태그 연결",exact:true}).getByText(name,{exact:true})).toBeVisible();
      const edited = await mcp.call(`get_${kind}`, {id});
      expect(edited.version).toBe(beforeContentEdit.version + 1);
      expect(edited.tag_ids).toEqual([tag.id]);
      expect(kind==="entity"?edited.properties.prop_2:edited.body).toBe(kind==="entity"?10:"원문 보존");
      await mcp.call("delete_tag", {id:tag.id,expected_version:tag.version});
      await page.goto(workspacePath(workspace.id, `/${kind==="entity"?"entities":"records"}/${encodeURIComponent(id)}`));
      const saved=await mcp.call(`get_${kind}`, {id});
      expect(saved.tag_ids).toEqual([]);
      expect(kind==="entity"?saved.properties.prop_2:saved.body).toBe(kind==="entity"?10:"원문 보존");
    }
  } finally { await mcp.close(); }
});
test("웹 태그 생성→MCP 중복·이름 변경→웹 삭제",async({page})=>{
  await devLogin(page);
  const workspace = await ownedWorkspace(page);const mcp=await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try{
    await page.goto(workspacePath(workspace.id, "/tags/record"));
    const title=unique("태그").slice(0,30),form=page.getByRole("form",{name:"태그 추가"});
    await form.getByRole("textbox",{name:/태그 이름/}).fill(title);
    const creation = page.waitForResponse(response => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/tags"));
    await form.getByRole("button",{name:"추가",exact:true}).click();
    const response = await creation;
    expect(response.status()).toBe(201);
    expect(response.request().headers()["x-workspace-id"]).toBe(workspace.id);
    const created = await response.json();
    expect(created).toMatchObject({name:title,scope:"record",version:1});
    expect(created.id).toMatch(/^[0-9]{8}-[0-9A-Z]{8}$/);
    await expect(page).toHaveURL(new URL(workspacePath(workspace.id, "/tags/record"), page.url()).href);
    await expect(page.getByRole("button",{name:`${title} 이름 변경`,exact:true})).toBeVisible();
    const list=await mcp.call("list_tags",{scope:"record",limit:100});const tag=list.items.find((t:{name:string})=>t.name===title);
    expect(tag).toMatchObject({id:created.id,name:title,scope:"record",version:1});
    const renamed=unique("정정").slice(0,30);await mcp.call("rename_tag",{id:tag.id,expected_version:1,name:renamed});
    await page.reload();await page.getByRole("button",{name:`${renamed} 삭제`,exact:true}).click();
    await executionDialog(page).getByRole("button",{name:"삭제하고 기록",exact:true}).click();
    await expect(page.getByRole("button",{name:`${renamed} 삭제`,exact:true})).toHaveCount(0);
    const focusTargets = page.getByRole("heading", { name: "기록 태그 관리", exact: true })
      .or(page.getByRole("button", { name: / 이름 변경$/ }));
    await expect.poll(() => focusTargets.evaluateAll(elements => elements.some(element => element === document.activeElement))).toBe(true);
  }finally{await mcp.close();}
});

test("웹 할 일 태그 선택→MCP 필터·정정→태그 삭제 후 본문 유지",async({page})=>{
  await devLogin(page);
  const workspace = await ownedWorkspace(page);const mcp=await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try{
    const tag=await mcp.call("create_tag",{scope:"task",name:unique("업무 태그").slice(0,30)});
    await page.goto(workspacePath(workspace.id, "/tasks"));await beginTabAction(page,"할 일 추가");
    const form=page.getByRole("dialog",{name:"할 일 추가"});await form.getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill(unique("태그 업무"));await form.getByLabel("본문").fill("분류 검증");await form.getByLabel("본문").fill("삭제 후에도 보존");
    await expect(form.getByRole("button", {name:"태그 선택",exact:true})).toHaveCount(0);await saveOnce(page,form,"추가");
    await expect(form).not.toBeVisible();const id=decodeURIComponent(new URL(page.url()).pathname.split("/").at(-1)!);expect((await mcp.call("get_task",{id})).tag_ids).toEqual([]);
    await connectBrowserTag(page, tag.name);
    const tagRegion=page.getByRole("region",{name:"태그 연결"});
    await tagRegion.getByRole("button",{name:`${tag.name} 연결 해제`,exact:true}).click();
    await saveOnce(page,tagRegion,"연결 적용");
    await expect(tagRegion.getByText("태그 연결을 저장했습니다.",{exact:true})).toBeVisible();
    expect((await mcp.call("get_task",{id})).tag_ids).toEqual([]);
    const beforeRestore=await mcp.call("get_task",{id});
    await mcp.call("set_tag_connections",{target_kind:"task",target_id:id,expected_version:beforeRestore.version,tag_ids:[tag.id]});
    await page.reload();await openDetailEditor(page);const edit=page.getByRole("dialog",{name:"할 일 편집"});
    await expect(edit.getByRole("button",{name:"태그 선택",exact:true})).toHaveCount(0);
    await expect(edit.getByRole("term").filter({hasText:/^태그$/}).locator("..").getByRole("definition")).toHaveText(tag.name);
    await edit.getByLabel("본문").fill("삭제 후에도 보존");await fillChangeMemo(page,edit,"원문 보존 확인");await saveOnce(page,edit);
    await expect(edit).not.toBeVisible();expect((await mcp.call("get_task",{id})).tag_ids).toEqual([tag.id]);
    const items=await mcp.call("list_tasks",{tag_id:tag.id});expect(items.items.map((t:{id:string})=>t.id)).toEqual([id]);
    await page.goto(workspacePath(workspace.id, `/tasks?tag_id=${tag.id}`));await openTabFilters(page);await expect(page.getByRole("button", { name: `${tag.name} 선택 해제`, exact: true })).toHaveCount(1);
    await mcp.call("delete_tag",{id:tag.id,expected_version:1});await page.goto(workspacePath(workspace.id, `/tasks/${id}`));
    await expect(page.getByText("삭제 후에도 보존",{exact:true})).toBeVisible();expect((await mcp.call("get_task",{id})).tag_ids).toEqual([]);
  }finally{await mcp.close();}
});

test("추가 페이지 태그의 편집 취소·충돌·저장 뒤 목록과 초점 유지",async({page})=>{
  await devLogin(page);
  const workspace = await ownedWorkspace(page);const mcp=await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try{
    const tags=[];
    for(let i=0;i<21;i++)tags.push(await mcp.call("create_tag",{scope:"record",name:unique(`보존 ${i}`).slice(0,30)}));
    const oldest=tags[0];await page.goto(workspacePath(workspace.id, "/tags/record"));
    const trigger=page.getByRole("button",{name:`${oldest.name} 이름 변경`,exact:true});
    await expect(businessRows(page.getByRole("table")).filter({ has: page.getByRole("button", { name: / 이름 변경$/ }) }).first()).toBeVisible();
    while(await trigger.count()===0){
      const before=await businessRows(page.getByRole("table")).filter({ has: page.getByRole("button", { name: / 이름 변경$/ }) }).count();
      await page.getByRole("button",{name:"더 보기",exact:true}).click();
      await expect.poll(()=>businessRows(page.getByRole("table")).filter({ has: page.getByRole("button", { name: / 이름 변경$/ }) }).count()).toBeGreaterThan(before);
    }
    await trigger.click();let form=page.getByRole("form",{name:"태그 이름 변경"});
    await form.getByRole("button", {name:"취소",exact:true}).click();await expect(trigger).toBeFocused();
    await trigger.click();const draft=unique("초안").slice(0,30);await form.getByRole("textbox",{name:/태그 이름/}).fill(draft);
    const server=unique("서버").slice(0,30);await mcp.call("rename_tag",{id:oldest.id,expected_version:1,name:server});
    await saveOnce(page,form);await expect(form.getByText(/다른 변경이 저장/)).toBeVisible();
    await expect(form.getByRole("textbox",{name:/태그 이름/})).toHaveValue(draft);await form.getByRole("button", {name:"취소",exact:true}).click();
    await page.getByRole("alertdialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();
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
  const workspace = await ownedWorkspace(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try {
    const type = await mcp.call("create_entity_type", {
      label: unique("태그 갱신 자료"),
      icon_id: "box",
      initial_property_label: "제목",
    });
    await workspace.grantKind(type.id);
    await page.goto(fixtureEntityList(workspace.id, type.id));
    await openTabFilters(page);
    await expect(page.getByText("자료 태그", { exact: true })).toBeVisible();
    // Complete the first dictionary read before the external MCP write.
    await expect(page.getByText("태그를 불러오는 중…", { exact: true })).toHaveCount(0);
    const name = unique("외부 태그").slice(0, 30);
    const tag = await mcp.call("create_tag", { scope: "entity", name });
    const title = unique("갱신 확인");
    const created = await mcp.call("create_entity", {
      entity_type_id: type.id,
      schema_version: type.schema_version,
      properties: { prop_1: title },
    });
    await mcp.call("set_tag_connections", { target_kind: "entity", target_id: created.id, expected_version: created.version, tag_ids: [tag.id] });
    // A filter navigation receives fresh rows without reloading the page.
    await page.getByRole("textbox", { name: "자료 제목 검색", exact: true }).fill(title);
    await expect(page).toHaveURL(url => url.searchParams.get("keyword") === title);
    const list = page.getByRole("table", { name: `${type.label} 목록`, exact: true });
    await list.getByRole("button", { name: title, exact: true }).click();
    await expect(list.locator('[aria-label="태그"]').getByText(name, { exact: true })).toBeVisible();
    await expect(list.getByText("삭제된 태그", { exact: true })).toHaveCount(0);
    await expect(list.getByRole("button", { name: title, exact: true }))
      .toHaveAttribute("aria-expanded", "true");
    await list.getByRole("link", { name: title + " 상세", exact: true }).click();
    await expect(openDialogs(page).getByText(name, { exact: true })).toBeVisible();
    await closeDetail(page, title);
    const renamed = unique("외부 정정").slice(0, 30);
    await mcp.call("rename_tag", { id: tag.id, expected_version: 1, name: renamed });
    // Revisit the already-expanded item without changing filters or toggling its preview.
    await expect(list.getByRole("button", { name: title, exact: true }))
      .toHaveAttribute("aria-expanded", "true");
    await list.getByRole("link", { name: title + " 상세", exact: true }).click();
    await expect(openDialogs(page).getByText(renamed, { exact: true })).toBeVisible();
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
