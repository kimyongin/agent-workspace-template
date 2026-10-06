import { saveWithMemo } from "./ui-actions.ts";
import { test, expect } from "@playwright/test";
import { beginTabAction } from "./ui-actions.ts";
const id = (n:number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
test.beforeEach(async({page})=>{await page.route("http://127.0.0.1:55580/**",async route=>{if(route.request().isNavigationRequest()){const response=await route.fetch({url:"http://127.0.0.1:55580/e2e/fixtures/activity.html"});await route.fulfill({response});}else await route.continue();});});
const record = (n:number, occurred_at="2026-10-03T16:00:00Z") => ({id:id(n),title:`기록 ${n}`,summary:"요약 먼저",body:"본문 근거",occurred_at,task_id:null,occurrence_on:null,tag_ids:[],entity_ids:[],entity_context:[],record_kind:"user",change_note:null,change:null,applied_principle_snapshots:[],version:1,created_at:occurred_at,updated_at:occurred_at});

for (const kind of ["tasks", "records"] as const) test(`${kind} 탭은 자기 목록만 조회하고 검색 필터를 같은 업무에 보낸다`, async ({page}) => {
  const reads:string[]=[],searches:Record<string,unknown>[]=[],writes:string[]=[];
  await page.route("http://127.0.0.1:55581/api/**", async route => {
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path.endsWith("/search")){searches.push(request.postDataJSON());await route.fulfill({json:{items:[],next_cursor:null,search_state:"keyword_fallback",semantic_coverage:{pending:2,excluded:1}}});return;}
    if(request.method()!=="GET")writes.push(path);
    if(path.endsWith("/tasks")||path.endsWith("/records"))reads.push(path);
    await route.fulfill({json:{items:[],next_cursor:null}});
  });
  await page.goto(`/e2e/fixtures/activity.html?route=/${kind}?mode=keyword`);
  await expect(page.getByRole("heading",{name:kind==="tasks"?"할 일":"기록",level:1})).toBeVisible();
  await expect.poll(()=>reads).toEqual([`/api/${kind}`]);
  await expect(page.locator(kind==="tasks"?".records":".tasks")).toHaveCount(0);
  await expect(page.getByText(`아직 ${kind==="tasks"?"할 일":"기록"}이 없습니다.`,{exact:true})).toBeVisible();
  await page.getByLabel(kind==="tasks"?"할 일 상태":"기록 종류",{exact:true}).selectOption(kind==="tasks"?"stopped":"change");
  await page.getByLabel("검색어",{exact:true}).fill("과거 근거");
  await expect.poll(()=>searches.length).toBe(1);
  expect(searches[0].kinds).toEqual([kind==="tasks"?"task":"record"]);
  expect(searches[0].mode).toBe("auto");
  await expect(page.getByLabel("검색 방식",{exact:true})).toHaveCount(0);
  expect(searches[0][kind==="tasks"?"task_status":"record_kind"]).toBe(kind==="tasks"?"stopped":"change");
  await expect(page.getByText("의미 검색을 사용할 수 없어 키워드 검색 결과를 표시합니다.")).toBeVisible();
  await expect(page.getByText("의미 색인 대기 2개 · 제외 1개")).toBeVisible();
  expect(writes).toEqual([]);
});

for(const [kind,condition] of [["tasks","kind=once"],["tasks","status=done"],["records","record_kind=change"],["records",`entity_id=${id(8)}`]] as const) test(`${kind} 종류·상태·대상 필터 ${condition}의 빈 결과는 계정에 자료가 없다는 안내와 구분한다`,async({page})=>{
  await page.route("http://127.0.0.1:55581/api/**",route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith(`/entities/${id(8)}`)?{id:id(8),prop1:"조건 대상",prop2:null,prop3:null,prop4:"a",version:1}:{items:[],next_cursor:null}}));
  await page.goto(`/e2e/fixtures/activity.html?route=`+encodeURIComponent(`/${kind}?${condition}`));
  await expect(page.getByText(`조건에 맞는 ${kind==="tasks"?"할 일":"기록"}이 없습니다.`,{exact:true})).toBeVisible();
  await expect(page.getByText(`아직 ${kind==="tasks"?"할 일":"기록"}이 없습니다.`,{exact:true})).toHaveCount(0);
});

test("옛 반대 탭 생성 링크는 의도한 기록 폼으로 안내하고 저장하지 않는다",async({page})=>{
  const writes:string[]=[];
  await page.route("http://127.0.0.1:55581/api/**",route=>{if(route.request().method()!=="GET")writes.push(route.request().url());return route.fulfill({json:{items:[],next_cursor:null}});});
  await page.goto("/e2e/fixtures/activity.html?route="+encodeURIComponent("/tasks?create=record&tasks_pages=3&records_pages=2"));
  await expect(page).toHaveURL(/\/records\?/);
  await expect(page.getByRole("dialog",{name:"기록 작성",exact:true})).toBeVisible();
  await expect(page.getByText(/기록 탭으로 이동했습니다/)).toBeVisible();
  expect(new URL(page.url()).searchParams.get("pages")).toBe("2");
  expect(writes).toEqual([]);
});

test("옛 반대 목록 anchor는 같은 기록 ID와 초점으로 명시 변환한다",async({page})=>{
  const reads:string[]=[],writes:string[]=[];
  await page.route("http://127.0.0.1:55581/api/**",route=>{
    const request=route.request(),url=new URL(request.url());
    if(request.method()!=="GET")writes.push(url.pathname);
    if(url.pathname.endsWith("/tasks")||url.pathname.endsWith("/records"))reads.push(url.pathname);
    return route.fulfill({json:{items:url.pathname.endsWith("/records")?[record(9)]:[],next_cursor:null}});
  });
  await page.goto("/e2e/fixtures/activity.html?route="+encodeURIComponent(`/tasks?tasks_pages=4&records_pages=1#activity-records-${id(9)}`));
  await expect(page).toHaveURL(new RegExp(`/records\\?pages=1&legacy_activity=1#activity-records-${id(9)}$`));
  await expect(page.getByText(/기록 탭으로 이동했습니다/)).toBeVisible();
  await expect(page.getByRole("link",{name:"기록 9",exact:true})).toBeFocused();
  expect(reads).toEqual(["/api/records"]);expect(writes).toEqual([]);
});

test("다중 대상의 label 전체는44px 누름 영역이고 클릭·키보드로 선택한다",async({page})=>{
  const entity={id:id(8),prop1:"함",prop2:null,prop3:null,prop4:"a",version:1};
  await page.route("http://127.0.0.1:55581/api/**",route=>route.fulfill({json:{items:new URL(route.request().url()).pathname.endsWith("/entities")?[entity]:[],next_cursor:null}}));
  await page.goto("/e2e/fixtures/activity.html?route=/records?create=1");
  const checkbox=page.getByRole("checkbox",{name:"함",exact:true});
  const label=checkbox.locator("..");
  for(const width of [320,360,390,639,640,768,1024,1440]){
    await page.setViewportSize({width,height:900});await expect(checkbox).toBeEnabled();
    const box=(await label.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
    await label.click({position:{x:box.width-6,y:box.height/2}});await expect(checkbox).toBeChecked();
    await expect(checkbox).toBeFocused();await page.keyboard.press("Space");await expect(checkbox).not.toBeChecked();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});

test("항상 펼친 날짜 병합과 직접 편집 취소/저장이 목록을 복원한다", async ({page}) => {
  let changed = record(2);
  await page.route("http://127.0.0.1:55581/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    let data:unknown = {items:[],next_cursor:null};
    if(path.endsWith("/records")) data = new URL(route.request().url()).searchParams.has("cursor") ? {items:[record(1),changed],next_cursor:null}:{items:[record(1),record(3,"2026-10-03T14:00:00Z")],next_cursor:"page2"};
    if(path.endsWith(`/records/${id(2)}`)) {
      if(route.request().method()==="PATCH")changed={...changed,...route.request().postDataJSON(),version:2};
      data=changed;
    }
    await route.fulfill({json:data});
  });
  await page.goto("/e2e/fixtures/activity.html");
  const older = page.getByRole("region",{name:"2026-10-03 기록",exact:true});
  await expect(page.getByRole("link",{name:"기록 3",exact:true})).toBeVisible();
  await page.locator("#activity-records-page-control").click();
  await expect(page.locator(".record-date-group")).toHaveCount(2);
  await expect(page.getByRole("link",{name:"기록 1",exact:true})).toHaveCount(1);
  await expect(older).toBeVisible();await expect(older.getByRole("button")).toHaveCount(0);
  await page.getByRole("link",{name:"기록 2 편집",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"기록 편집",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page).toHaveURL(/\/records\?/);
  await expect(older).toBeVisible();await expect(older.getByRole("button")).toHaveCount(0);
  await expect(page.locator(`#activity-records-${id(2)}`)).toBeFocused();
  await page.getByRole("link",{name:"기록 2 편집",exact:true}).click();
  await page.getByRole("textbox",{name:"제목 (필수)",exact:true}).fill("정정 기록");
  await expect(page.getByLabel("편집 메모",{exact:false})).toHaveValue("");
  await saveWithMemo(page, page);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link",{name:"정정 기록",exact:true})).toBeFocused();
  await page.getByRole("link",{name:"정정 기록 보기",exact:true}).click();
  await expect(page.locator(".markdown")).toHaveText("본문 근거");
  await expect(page.locator(".document-summary")).toHaveCount(0);
  await page.getByRole("button",{name:"닫기",exact:true}).click();
  await page.getByRole("link",{name:"정정 기록 편집",exact:true}).click();
  await page.getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page.locator(`#activity-records-${id(2)}`)).toBeFocused();
  const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  expect(overflow).toBe(false);
});

test("할 일 저장 성공 후 조회 실패는 초안 재저장을 요구하지 않는다", async ({page}) => {
  let version=1, fail=false, patches=0;
  const task = () => ({...record(1),kind:"once",status:"open",due_on:null,recurrence:null,timezone:null,result_record:null,version});
  await page.route("http://127.0.0.1:55581/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith("/tasks/preview")){await route.fulfill({json:{memo:{title:"할 일 수정",summary:"할 일 제목을 수정",body:"제목 수정"},changed:true}});return;}
    if(path.endsWith(`/tasks/${id(1)}`)) {
      if(route.request().method()==="PATCH"){patches++;version++;fail=true;await route.fulfill({json:task()});return;}
      if(fail){await route.fulfill({status:503,json:{code:"internal",message:"fixture read failure"}});return;}
      await route.fulfill({json:task()});return;
    }
    await route.fulfill({json:{items:[],next_cursor:null}});
  });
  await page.goto(`/e2e/fixtures/activity.html?route=${encodeURIComponent(`/tasks/${id(1)}?edit=1&edit_from=view`)}`);
  await page.getByRole("textbox",{name:"제목 (필수)",exact:true}).fill("정정한 할 일");
  await page.getByLabel("편집 메모",{exact:false}).fill("검증 정정 이유");
  await page.getByRole("button",{name:"기록 메모 확인",exact:true}).click();
  await expect(page.getByLabel("기록 제목",{exact:false})).toHaveValue("할 일 수정");
  expect(patches).toBe(0);
  await page.getByRole("button",{name:"확인하고 저장",exact:true}).click();
  await expect(page.getByText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.")).toBeVisible();
  await expect(page.locator("dialog.modal:not(.modal-confirm)[open]")).toHaveCount(1);
  fail=false;
  await page.getByRole("button",{name:"조회 다시 시도",exact:true}).click();
  await expect(page.getByText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.")).toHaveCount(0);
  expect(patches).toBe(1);
});

test("직접 편집의 실패·Escape·확인 취소는 초안을 유지한다", async ({page}) => {
  await page.route("http://127.0.0.1:55581/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith(`/records/${id(1)}`)) {
      if(route.request().method()==="PATCH") {await route.fulfill({status:409,json:{code:"conflict",message:"다른 곳에서 수정했습니다."}});return;}
      await route.fulfill({json:record(1)});return;
    }
    await route.fulfill({json:{items:[record(1)],next_cursor:null}});
  });
  await page.goto("/e2e/fixtures/activity.html");
  await page.locator(".records").getByRole("link",{name:"기록 1 편집",exact:true}).click();
  const title=page.getByRole("textbox",{name:"제목 (필수)",exact:true});
  await title.fill("보존할 초안");
  await page.getByLabel("편집 메모",{exact:false}).fill("검증 정정 이유");
  await saveWithMemo(page, page);
  await expect(page.getByRole("alert")).toContainText("다른 곳에서 수정했습니다.");
  await expect(title).toHaveValue("보존할 초안");
  await title.focus();
  await page.keyboard.press("Escape");
  const discard = page.getByRole("dialog",{name:"변경을 버릴까요?",exact:true});
  await expect(discard).toBeVisible();
  await discard.getByRole("button",{name:"취소",exact:true}).click();
  await expect(title).toHaveValue("보존할 초안");
  await expect(title).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"변경 버리기",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(`#activity-records-${id(1)}`)).toBeFocused();
});

test("현재 원칙 편집 취소는 원칙 화면·초점을 복원하고 과거 근거는 기록에서 찾는다",async({page})=>{
  const item={...record(1),title:"현재 기준",is_current:true,saved_at:"2026-10-04T00:00:00Z",origin:"saved",legacy_context:null};
  await page.route("http://127.0.0.1:55581/api/**",route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith("/principles/current")?{current:item}:item}));
  await page.goto("/e2e/fixtures/activity.html?route=/principles");
  await page.getByRole("button",{name:"원칙 작업 메뉴"}).click();await page.getByRole("link",{name:"현재 원칙 편집",exact:true}).click();
  await page.getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page).toHaveURL(/principles#principles-title$/);await expect(page.locator("#principles-title")).toBeFocused();
  await expect(page.getByRole("link",{name:"과거 근거는 통합 기록에서 보기"})).toHaveAttribute("href","/records");
});

test("긴 제목·태그와 편집 조작은 대표 폭에서 읽기 순서와 누름 영역을 유지한다", async ({page},testInfo) => {
  const r={...record(1),title:"긴 제목 ".repeat(16).trim(),summary:"긴 요약 ".repeat(40),tag_ids:[id(8)]};
  await page.route("http://127.0.0.1:55581/api/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    const data=path.endsWith("/tags")?{items:[{id:id(8),name:"공백없는긴태그이름을선택하고읽는표현을확인"}],next_cursor:null}:path.endsWith("/records")?{items:[r],next_cursor:null}:path.endsWith(`/records/${id(1)}`)?r:{items:[],next_cursor:null};
    await route.fulfill({json:data});
  });
  await page.goto("/e2e/fixtures/activity.html");
  for(const width of [320,360,390,639,640,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await expect(page.locator(".tag-read")).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    for(const action of await page.locator(".activity-item-actions a").all()) {
      const box=(await action.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    if(width===390 || width===1440)await page.screenshot({path:testInfo.outputPath(`record-${width}.png`),fullPage:true});
  }
  await page.getByRole("link",{name:`${r.title} 편집`,exact:true}).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog",{name:"기록 편집",exact:true})).toBeVisible();
  const fieldOrder=await page.locator("form label").allTextContents();
  expect(fieldOrder.slice(0,3)).toEqual(["제목*(필수)","요약*(필수)","본문"]);
  await page.setViewportSize({width:360,height:900});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:testInfo.outputPath("record-edit-360.png"),fullPage:true});
});

for (const name of ["활동 왕복 태그", "한".repeat(30)]) {
  test(`늦은 태그 이름 ${name.length}자 응답 뒤에 목록 행·스크롤·초점을 복원한다`, async ({page}) => {
    let release!:()=>void;
    let held!:Promise<void>;
    const hold = () => {held = new Promise<void>(resolve=>{release=resolve;});};
    hold();
    const records=Array.from({length:20},(_,index)=>({...record(index+1),tag_ids:[id(8)]}));
    await page.route("http://127.0.0.1:55581/api/**",async route=>{
      const path=new URL(route.request().url()).pathname;
      if(path.endsWith("/tags")) {
        await held;
        await route.fulfill({json:{items:[{id:id(8),name}],next_cursor:null}});return;
      }
      const data=path.endsWith("/records")?{items:records,next_cursor:null}:path.endsWith(`/records/${id(20)}`)?records[19]:{items:[],next_cursor:null};
      await route.fulfill({json:data});
    });
    await page.setViewportSize({width:360,height:900});
    await page.goto("/e2e/fixtures/activity.html");
    const row=page.locator(`#activity-records-${id(20)}`);
    await expect(page.getByText("태그 이름을 불러오는 중…",{exact:true})).toBeVisible();
    await expect(row).toHaveCount(0);
    release();
    await expect(page.locator(".tag-read").last()).toHaveText(name);
    if(name.length===30)expect((await page.locator(".tag-read").last().boundingBox())!.height).toBeGreaterThan(30);
    await row.scrollIntoViewIfNeeded();
    await row.focus();
    const before=(await row.boundingBox())!.y;
    const scroll=await page.evaluate(()=>scrollY);
    await page.getByRole("link",{name:"기록 20 보기",exact:true}).click();
    await expect(page.getByRole("heading",{name:"기록 20",exact:true})).toBeVisible();
    await expect(page.locator(".tag-read")).toHaveCount(0);
    hold();
    await page.getByRole("button",{name:"닫기",exact:true}).click();
    await expect(page.getByText("태그 이름을 불러오는 중…",{exact:true})).toBeVisible();
    await expect(row).toHaveCount(0);
    release();
    await expect(row).toBeFocused();
    expect((await row.boundingBox())!.y).toBeCloseTo(before,1);
    expect(await page.evaluate(()=>scrollY)).toBe(scroll);
    await expect(page.locator(".tag-read").last()).toHaveText(name);
  });
}
for (const [routePath, createLabel] of [["/records","기록 작성"],["/tasks","할 일 추가"],["/principles","현재 원칙 등록"]]) {
  test(`같은 ${routePath} 조건 이동의 취소는 초안을 보존하고 버리기는 새 작성 상태로 닫는다`,async({page})=>{
    await page.route("http://127.0.0.1:55581/api/**",route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith("/principles/current")?{current:null}:{items:[],next_cursor:null}}));
    await page.goto(`/e2e/fixtures/activity.html?route=${routePath}`);
    await beginTabAction(page,createLabel);
    const title=page.getByRole("textbox",{name:"제목 (필수)",exact:true});
    await title.fill("이탈 확인 초안");
    // The fixture probe exercises real router navigation while the modal owns focus.
    await page.getByRole("link",{name:"fixture 같은 화면 조건 이동"}).evaluate((el:HTMLAnchorElement)=>el.click());
    const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?",exact:true});
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button",{name:"취소",exact:true}).click();
    await expect(title).toHaveValue("이탈 확인 초안");
    await expect(page).not.toHaveURL(/fixture=next/);
    await page.getByRole("link",{name:"fixture 같은 화면 조건 이동"}).evaluate((el:HTMLAnchorElement)=>el.click());
    await page.getByRole("button",{name:"변경 버리기",exact:true}).click();
    await expect(page).toHaveURL(/fixture=next/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await beginTabAction(page,createLabel);
    await expect(page.getByRole("textbox",{name:"제목 (필수)",exact:true})).toHaveValue("");
  });
}
for (const kind of ["records","tasks","principles"]) {
  test(`직접 편집 ${kind} 라우트 버리기는 목록 복귀 대신 요청한 상세 조건으로 이동한다`,async({page})=>{
    const item={...record(1),kind:"once",status:kind==="principles"?"active":"open",due_on:null,recurrence:null,timezone:null,result_record:null,is_current:true,saved_at:"2026-10-04T00:00:00Z",change_note:"과거 메모",origin:"saved",legacy_context:null};
    await page.route("http://127.0.0.1:55581/api/**",route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith("/principles/current")?{current:item}:new URL(route.request().url()).pathname.endsWith(`/${kind}/${id(1)}`)?item:{items:[item],next_cursor:null}}));
    await page.goto(`/e2e/fixtures/activity.html?route=/${kind}`);
    if(kind==="principles")await page.getByRole("button",{name:"원칙 작업 메뉴"}).click();
    await (kind==="principles"?page:page.locator(`.${kind}`)).getByRole("link",{name:kind==="principles"?"현재 원칙 편집":"기록 1 편집",exact:true}).click();
    const title=page.getByRole("textbox",{name:"제목 (필수)",exact:true});
    await title.fill("상세 이동 초안");
    await page.getByRole("link",{name:"fixture 같은 화면 조건 이동"}).evaluate((el:HTMLAnchorElement)=>el.click());
    const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?",exact:true});
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button",{name:"취소",exact:true}).click();
    await expect(title).toHaveValue("상세 이동 초안");
    await page.getByRole("link",{name:"fixture 같은 화면 조건 이동"}).evaluate((el:HTMLAnchorElement)=>el.click());
    await expect(confirm).toBeVisible();
    await page.getByRole("button",{name:"변경 버리기",exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`/${kind}/${id(1)}\\?fixture=next$`));
    await expect(page.locator("dialog.modal:not(.modal-confirm)[open]")).toHaveCount(1);
    item.title="새 서버 원문";
    await page.goBack();
    await expect(page.getByRole("textbox",{name:"제목 (필수)",exact:true})).toHaveValue("새 서버 원문");
    await page.goForward();
    await expect(page).toHaveURL(/fixture=next/);
    await expect(page.locator("dialog.modal:not(.modal-confirm)[open]")).toHaveCount(1);
  });
}
for(const kind of ["records","tasks"]){
  test(`${kind} 태그 사전 실패 재시도는 표시 행·읽던 위치·초점을 유지한다`,async({page})=>{
    let attempts=0,release:()=>void=()=>{};
    const held=new Promise<void>(resolve=>release=resolve);
    const items=Array.from({length:20},(_,i)=>({...record(i+1),tag_ids:[id(99)],kind:"once",status:kind==="principles"?"active":"open",due_on:null,recurrence:null,timezone:null,result_record:null,applies_when:"판단할 때",replaced_by_id:null}));
    await page.route("http://127.0.0.1:55581/api/**",async route=>{
      if(new URL(route.request().url()).pathname.endsWith("/tags")){
        if(!attempts++){await route.fulfill({status:503,json:{code:"internal",message:"태그 사전 실패"}});return;}
        await held;await route.fulfill({json:{items:[{id:id(99),name:"한".repeat(30)}],next_cursor:null}});return;
      }
      await route.fulfill({json:new URL(route.request().url()).pathname.endsWith("/principles/current")?{current:null}:{items,next_cursor:null}});
    });
    await page.goto(`/e2e/fixtures/activity.html?route=/${kind}`);
    const section=page.locator(`.${kind}`);
    const title=section.getByRole("link",{name:"기록 20",exact:true});
    await expect(title).toBeVisible();
    await title.focus();await title.evaluate(el=>el.scrollIntoView({block:"center"}));
    const y=await title.evaluate(el=>el.getBoundingClientRect().top);
    await page.getByRole("button",{name:"태그 다시 시도",exact:true}).first().evaluate((el:HTMLButtonElement)=>el.click());
    await expect.poll(()=>attempts).toBe(2);
    await expect(section.locator(".list-item")).toHaveCount(20);
    await expect(title).toBeFocused();
    expect(await title.evaluate(el=>el.getBoundingClientRect().top)).toBeCloseTo(y,0);
    release();
    await expect(page.locator(".tag-read").first()).toHaveText("한".repeat(30));
    await expect(section.locator(".list-item")).toHaveCount(20);
    await expect(title).toBeFocused();
    expect(await title.evaluate(el=>el.getBoundingClientRect().top)).toBeCloseTo(y,0);
  });
}
for(const kind of ["records","tasks","principles"]){
  test(`${kind} 한 글자 제목도 모든 폭에서44px 조작 영역을 유지한다`,async({page})=>{
    const item={...record(1),is_current:true,origin:"saved",legacy_context:null,saved_at:"2026-10-03T16:00:00Z",title:"함",kind:"once",status:kind==="principles"?"active":"open",due_on:null,recurrence:null,timezone:null,result_record:null,applies_when:"판단할 때",replaced_by_id:null};
    await page.route("http://127.0.0.1:55581/api/**",route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith("/principles/current")?{current:item}:{items:[item],next_cursor:null}}));
    await page.goto(`/e2e/fixtures/activity.html?route=/${kind}`);
    if(kind==="principles")await page.getByRole("button",{name:"원칙 작업 메뉴"}).click();
    const title=(kind==="principles"?page:page.locator(`.${kind}`)).getByRole("link",{name:kind==="principles"?"현재 원칙 보기":"함",exact:true});
    await expect(title).toBeVisible();
    for(const width of [320,360,390,639,640,768,1024,1440]){
      await page.setViewportSize({width,height:900});
      const box=await title.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
    }
  });
}
