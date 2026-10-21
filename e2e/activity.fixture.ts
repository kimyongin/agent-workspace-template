import { businessRows, disclosureContent } from "./table-actions.ts";
import { detailDialog, executionDialog } from "./ui-actions.ts";
import { entity as makeEntity, fixtureType, fixtureSchema, entityKey } from "./support/workspace-data.ts";
import { fulfillPreparation } from "./support/preparation-api.ts";
import { openListEditor, openDetailEditor, openListDetail, openTabFilters } from "./ui-actions.ts";
import { fillChangeMemo } from "./ui-actions.ts";
import { recordDisplayText } from "../supabase/functions/_shared/contracts/record-display.ts";
import { saveOnce } from "./ui-actions.ts";
import { test, expect } from "@playwright/test";
import { beginTabAction } from "./ui-actions.ts";
const id = (n:number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
test.beforeEach(async({page})=>{await page.route("http://127.0.0.1:55580/**",async route=>{if(route.request().isNavigationRequest()){const response=await route.fetch({url:"http://127.0.0.1:55580/e2e/fixtures/activity.html"});await route.fulfill({response});}else await route.continue();});});
const record = (n:number, occurred_at="2026-10-03T16:00:00Z") => ({id:id(n),created_by:null,created_by_name:null,body:`기록 ${n}`,occurred_at,task_id:id(100),entity_id:null,occurrence_on:null,tag_ids:[],record_kind:"result",change:null,version:1,created_at:occurred_at,updated_at:occurred_at});

for(const width of [390,1024])test(`변경 기록 metadata ${width}px: 종류·출처·시각·대상은 이름과 값으로 정렬되고 긴 값도 읽힌다`,async({page},info)=>{
  const items=["수정","삭제"].map((action,i)=>({...record(i+1),task_id:id(20+i),body:`할 일 ${action}`,record_kind:"change",change:{event_id:id(10+i),target_kind:"task",target_id:id(20+i),target_title:i?"긴 할 일 이름 ".repeat(20):"할 일",action:i?"delete":"update",source:"mcp",before:null,after:null,path:"/tasks/example"}}));
  await page.route("http://127.0.0.1:55581/api/**",async route => {if(await fulfillPreparation(route))return;const path=new URL(route.request().url()).pathname;return route.fulfill({json:path.endsWith("/records")?{items,next_cursor:null}:items.find(item=>path.endsWith("/"+item.id))??{items:[],next_cursor:null}});});
  await page.setViewportSize({width,height:900});await page.goto("/e2e/fixtures/activity.html?route=/records");
  const rows=businessRows(page.getByRole("region", {name:"기록 목록",exact:true}).getByRole("table"));await expect(rows).toHaveCount(2);
  for(const [index, row] of (await rows.all()).entries()){
    await row.getByRole("button",{name:/^할 일 (수정|삭제)$/,exact:true}).click();
    const preview = await disclosureContent(page, row.getByRole("button", { name: /^할 일 (수정|삭제)$/, exact: true }));
    const properties = preview.locator("dl").filter({has:page.getByRole("term").filter({hasText:/^(종류|출처|수행 시각|변경 대상|행동)$/})});
    await expect(properties.locator("dt")).toHaveText(["종류", "출처", "수행 시각", "변경 대상", "행동"]);
    await expect(properties.locator("dd").nth(0)).toHaveText("변경 기록");
    await expect(properties.locator("dd").nth(1)).toHaveText("에이전트");
    await expect(properties.locator("time")).toHaveAttribute("datetime", items[0].occurred_at);
    await expect(properties.locator("dt", { hasText: /^변경 대상$/ }).locator("../dd")).toContainText(
      `할 일 「${items[index].change.target_title}」`,
    );
    await expect(properties.locator("dt", { hasText: /^행동$/ }).locator("../dd")).toHaveText(index ? "삭제" : "수정");
    const pairs = properties;
    await expect(pairs).toHaveCount(5);
    for (const property of await pairs.all()) {
      await expect(property.getByRole("term")).toBeVisible();
      await expect(property.getByRole("definition")).toBeVisible();
      const box = (await property.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
    }
  }
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`change-record-${width}.png`)});
});

for (const kind of ["tasks", "records"] as const) test(`${kind} 탭은 자기 목록만 조회하고 검색 필터를 같은 업무에 보낸다`, async ({page}) => {
  const reads:string[]=[],searches:Record<string,unknown>[]=[],writes:string[]=[];
  await page.route("http://127.0.0.1:55581/api/**",async route => {if(await fulfillPreparation(route))return;
    const request=route.request(),path=new URL(request.url()).pathname;
    if(path.endsWith("/search")){searches.push(request.postDataJSON());await route.fulfill({json:{items:[],next_cursor:null,search_state:"keyword_fallback",semantic_coverage:{pending:2,excluded:1, failed: 0}}});return;}
    if(request.method()!=="GET")writes.push(path);
    if(path.endsWith("/tasks")||path.endsWith("/records"))reads.push(path);
    await route.fulfill({json:{items:[],next_cursor:null}});
  });
  await page.goto(`/e2e/fixtures/activity.html?route=/${kind}?mode=keyword`);
  await expect(page.getByRole("heading",{name:kind==="tasks"?"할 일":"기록",level:1})).toBeVisible();
  await expect.poll(()=>reads).toEqual([`/api/${kind}`]);
  await expect(page.getByRole("region",{name:kind==="tasks"?"기록 목록":"할 일 목록",exact:true})).toHaveCount(0);
  await expect(page.getByText(`아직 ${kind==="tasks"?"할 일":"기록"}이 없습니다.`,{exact:true})).toBeVisible();
  await openTabFilters(page);await page.getByLabel(kind==="tasks"?"할 일 상태":"기록 종류",{exact:true}).selectOption(kind==="tasks"?"stopped":"change");
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
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
  await page.route("http://127.0.0.1:55581/api/**",route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith(`/entities/${entityKey(8)}`)?makeEntity(8, {prop_1:"조건 대상"}):{items:[],next_cursor:null}}));
  await page.goto(`/e2e/fixtures/activity.html?route=`+encodeURIComponent(`/${kind}?${condition}`));
  await expect(page.getByText(`조건에 맞는 ${kind==="tasks"?"할 일":"기록"}이 없습니다.`,{exact:true})).toBeVisible();
  await expect(page.getByText(`아직 ${kind==="tasks"?"할 일":"기록"}이 없습니다.`,{exact:true})).toHaveCount(0);
});

test("옛 기록 생성 링크는 기록 목록으로 안내하고 작성이나 저장을 허용하지 않는다",async({page})=>{
  const writes:string[]=[];
  await page.route("http://127.0.0.1:55581/api/**",async route => {if(await fulfillPreparation(route))return;if(route.request().method()!=="GET")writes.push(route.request().url());return route.fulfill({json:{items:[],next_cursor:null}});});
  await page.goto("/e2e/fixtures/activity.html?route="+encodeURIComponent("/tasks?create=record&tasks_pages=3&records_pages=2"));
  await expect(page).toHaveURL(/\/records\?/);
  await expect(page.getByRole("dialog",{name:"기록 작성",exact:true})).toHaveCount(0);
  await expect(page.getByText(/기록 탭으로 이동했습니다/)).toBeVisible();
  expect(new URL(page.url()).searchParams.get("pages")).toBe("2");
  expect(writes).toEqual([]);
});

test("옛 반대 목록 anchor는 같은 기록 ID와 초점으로 명시 변환한다",async({page})=>{
  const reads:string[]=[],writes:string[]=[];
  await page.route("http://127.0.0.1:55581/api/**",async route => {if(await fulfillPreparation(route))return;
    const request=route.request(),url=new URL(request.url());
    if(request.method()!=="GET")writes.push(url.pathname);
    if(url.pathname.endsWith("/tasks")||url.pathname.endsWith("/records"))reads.push(url.pathname);
    return route.fulfill({json:{items:url.pathname.endsWith("/records")?[record(9)]:[],next_cursor:null}});
  });
  await page.goto("/e2e/fixtures/activity.html?route="+encodeURIComponent(`/tasks?tasks_pages=4&records_pages=1#activity-records-${id(9)}`));
  await expect(page).toHaveURL(new RegExp(`/records\\?pages=1&legacy_activity=1#activity-records-${id(9)}$`));
  await expect(page.getByText(/기록 탭으로 이동했습니다/)).toBeVisible();
  await expect(page.getByRole("link",{name:"기록 9 상세",exact:true})).toBeFocused();
  expect(reads).toEqual(["/api/records"]);expect(writes).toEqual([]);
});

test("연결 카드 행동은44px 누름 영역이고 클릭·키보드로 연결/해제한다",async({page})=>{
  const entity=makeEntity(8,{prop_1:"함"});
  await page.route("http://127.0.0.1:55581/api/**",route=>route.fulfill({json:{items:new URL(route.request().url()).pathname.endsWith("/entities")?[entity]:[],next_cursor:null}}));
  await page.goto("/e2e/fixtures/activity.html?route=/tasks?create=1");
  await page.getByRole("button",{name:"자료 연결",exact:true}).click();await page.getByRole("searchbox",{name:"자료 제목 검색",exact:true}).fill("함");
  for(const width of [320,360,390,639,640,768,1024,1440]){
    await page.setViewportSize({width,height:900});const connect=page.getByRole("button",{name:"함 연결",exact:true});await expect(connect).toBeEnabled();
    const box=(await connect.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
    await connect.click();const unlink=page.getByRole("button",{name:"함 해제",exact:true});await expect(unlink).toBeFocused();
    await page.keyboard.press("Space");await expect(unlink).toHaveCount(0);await expect(page.getByRole("searchbox",{name:"자료 제목 검색"})).toBeFocused();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
});

test("항상 펼친 날짜 병합과 직접 편집 취소/저장이 목록을 복원한다", async ({page}, info) => {
  let changed = record(2);
  await page.route("http://127.0.0.1:55581/api/**",async route => {if(await fulfillPreparation(route))return;
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
  await expect(page.getByRole("button",{name:"기록 3",exact:true})).toBeVisible();
  await page.locator("#activity-records-page-control").click();
  // 14:00Z and 16:00Z share a UTC day; only Seoul crosses midnight.
  const utc = info.project.use.timezoneId === "UTC";
  await expect(page.getByRole("region",{name:/^2026-10-\d{2} 기록$/})).toHaveCount(utc ? 1 : 2);
  await expect(businessRows(older.getByRole("table"))).toHaveCount(utc ? 3 : 1);
  await expect(page.getByRole("button",{name:"기록 1",exact:true})).toHaveCount(1);
  await expect(older).toBeVisible();await expect(older.getByRole("heading").getByRole("button")).toHaveCount(0);
  await openListEditor(page,"기록 2");
  await expect(page.getByRole("dialog",{name:"기록 편집",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page).toHaveURL(/\/records\?/);
  await expect(older).toBeVisible();await expect(older.getByRole("heading").getByRole("button")).toHaveCount(0);
  await expect(page.locator(`#activity-records-${id(2)}`)).toBeFocused();
  await openListEditor(page,"기록 2");
  await page.getByRole("textbox",{name:/^본문(?: \(필수\))?$/}).fill("정정 기록");
  await expect(page.getByLabel("편집 메모",{exact:false})).toHaveCount(0);
  await saveOnce(page, page);
  await page.getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link",{name:"정정 기록 상세",exact:true})).toBeFocused();
  await openListDetail(page,"정정 기록");
  const body = detailDialog(page).getByRole("term").filter({hasText:/^본문$/}).locator("../dd");
  await expect(body).toHaveCount(1);
  await expect(body).toHaveText("정정 기록");
  await page.getByRole("button",{name:"닫기",exact:true}).click();
  await openListEditor(page,"정정 기록");
  await page.getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page.locator(`#activity-records-${id(2)}`)).toBeFocused();
  const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  expect(overflow).toBe(false);
});

test("할 일 저장 성공 후 조회 실패는 초안 재저장을 요구하지 않는다", async ({page}) => {
  let version=1, fail=false, patches=0;
  const task = () => ({...record(1),entity_ids:[],entity_context:[],deleted_at:null,created_by:null,created_by_name:null,title:"할 일",kind:"once",status:"open",due_on:null,recurrence:null,timezone:null,pauses:[],result_record:null,version});
  await page.route("http://127.0.0.1:55581/api/**",async route => {if(await fulfillPreparation(route))return;
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith(`/tasks/${id(1)}`)) {
      if(route.request().method()==="PATCH"){patches++;version++;fail=true;await route.fulfill({json:task()});return;}
      if(fail){await route.fulfill({status:503,json:{code:"internal",message:"fixture read failure"}});return;}
      await route.fulfill({json:task()});return;
    }
    await route.fulfill({json:{items:[],next_cursor:null}});
  });
  await page.goto(`/e2e/fixtures/activity.html?route=${encodeURIComponent(`/tasks/${id(1)}?edit=1&edit_from=view`)}`);
  await page.getByRole("textbox",{name:"제목 (필수)",exact:true}).fill("정정한 할 일");
  await fillChangeMemo(page,page,"검증 정정 이유");
  expect(patches).toBe(0);
  await saveOnce(page,page);
  await expect(page.getByText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.")).toBeVisible();
  await expect(detailDialog(page)).toHaveCount(1);
  fail=false;
  await page.getByRole("button",{name:"조회 다시 시도",exact:true}).click();
  await expect(page.getByText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.")).toHaveCount(0);
  expect(patches).toBe(1);
});

test("직접 편집의 실패·Escape·확인 취소는 초안을 유지한다", async ({page}) => {
  await page.route("http://127.0.0.1:55581/api/**",async route => {if(await fulfillPreparation(route))return;
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith(`/records/${id(1)}`)) {
      if(route.request().method()==="PATCH") {await route.fulfill({status:409,json:{code:"conflict",message:"다른 곳에서 수정했습니다."}});return;}
      await route.fulfill({json:record(1)});return;
    }
    await route.fulfill({json:{items:path.endsWith("/tags")?[]:[record(1)],next_cursor:null}});
  });
  await page.goto("/e2e/fixtures/activity.html");
  await openListEditor(page,"기록 1");
  const title=page.getByRole("textbox",{name:/^본문(?: \(필수\))?$/});
  await title.fill("보존할 초안");
  await expect(page.getByLabel("편집 메모",{exact:false})).toHaveCount(0);
  await saveOnce(page, page);
  await expect(page.getByRole("alert")).toContainText("다른 곳에서 수정했습니다.");
  await expect(title).toHaveValue("보존할 초안");
  await title.focus();
  await page.keyboard.press("Escape");
  const discard = page.getByRole("alertdialog",{name:"변경을 버릴까요?",exact:true});
  await expect(discard).toBeVisible();
  await discard.getByRole("button",{name:"취소",exact:true}).click();
  await expect(title).toHaveValue("보존할 초안");
  await expect(title).toBeFocused();
  await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"변경 버리기",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.locator(`#activity-records-${id(1)}`)).toBeFocused();
});



test("긴 제목·태그와 편집 조작은 대표 폭에서 읽기 순서와 누름 영역을 유지한다", async ({page},testInfo) => {
  const r={...record(1),body:"긴 본문 ".repeat(300),tag_ids:[id(8)]};
  await page.route("http://127.0.0.1:55581/api/**",async route => {if(await fulfillPreparation(route))return;
    const path=new URL(route.request().url()).pathname;
    const data=path.endsWith("/tags")?{items:[{id:id(8),name:"공백없는긴태그이름을선택하고읽는표현을확인"}],next_cursor:null}:path.endsWith("/records")?{items:[r],next_cursor:null}:path.endsWith(`/records/${id(1)}`)?r:{items:[],next_cursor:null};
    await route.fulfill({json:data});
  });
  await page.goto("/e2e/fixtures/activity.html");await page.getByRole("button",{name:recordDisplayText(r.body),exact:true}).click();
  for(const width of [320,360,390,639,640,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await expect(page.locator('[aria-label="태그"]')).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const actions = page.getByRole("table").getByRole("link", { name: / 상세$/ });
    expect(await actions.count()).toBeGreaterThan(0);
    for(const action of await actions.all()) {
      const box=(await action.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    if(width===390 || width===1440)await page.screenshot({path:testInfo.outputPath(`record-${width}.png`),fullPage:true});
  }
  await page.getByRole("link",{name:recordDisplayText(r.body)+" 상세",exact:true}).focus();
  await page.keyboard.press("Enter");
  await openDetailEditor(page);
  await expect(page.getByRole("dialog",{name:"기록 편집",exact:true})).toBeVisible();
  const fieldOrder=await page.locator("form label").allTextContents();
  expect(fieldOrder[0]).toMatch(/^본문\s*\*?\s*\(필수\)$/);expect(fieldOrder.some(label=>/^제목/.test(label))).toBe(false);expect(fieldOrder.some(label=>/^요약/.test(label))).toBe(false);
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
    await page.route("http://127.0.0.1:55581/api/**",async route => {if(await fulfillPreparation(route))return;
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
    await openTabFilters(page);await expect(page.getByText("태그 이름을 불러오는 중…",{exact:true})).toBeVisible();
    await expect(row).toHaveCount(0);
    release();
    await page.getByRole("button", { name: "기록 20", exact: true }).click();
    await expect(page.locator('[aria-label="태그"]').last()).toHaveText(name);
    if (name.length === 30) {
      const tag = page.locator('[aria-label="태그"]').last();
      const bounds = (await tag.boundingBox())!;
      const lines = await tag.getByText(name, { exact: true }).evaluate(element => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return [...range.getClientRects()].map(rect => ({ x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }));
      });
      expect(lines.length).toBeGreaterThan(0);
      for (const line of lines) {
        expect(line.width).toBeGreaterThan(0);
        expect(line.height).toBeGreaterThan(0);
        expect(line.x).toBeGreaterThanOrEqual(bounds.x - 1);
        expect(line.right).toBeLessThanOrEqual(Math.min(bounds.x + bounds.width, 360) + 1);
        expect(line.y).toBeGreaterThanOrEqual(bounds.y - 1);
        expect(line.bottom).toBeLessThanOrEqual(bounds.y + bounds.height + 1);
      }
    }
    await row.scrollIntoViewIfNeeded();
    await row.focus();
    await page.getByRole("link",{name:"기록 20 상세",exact:true}).scrollIntoViewIfNeeded();
    const before=(await row.boundingBox())!.y;
    // This isolated feature fixture has no App shell: the document owns scrolling.
    const scroll=await page.evaluate(()=>document.scrollingElement!.scrollTop);
    expect(scroll).toBeGreaterThan(0);
    await openListDetail(page,"기록 20");
    await expect(page.getByRole("heading",{name:"기록",exact:true})).toBeVisible();
    await expect(detailDialog(page).locator('[aria-label="태그"]')).toHaveCount(1);
    hold();
    await page.getByRole("button",{name:"닫기",exact:true}).click();
    await expect(page.getByText("태그 이름을 불러오는 중…",{exact:true})).toBeVisible();
    await expect(row).toHaveCount(0);
    release();
    await expect(row).toBeFocused();
    expect((await row.boundingBox())!.y).toBeCloseTo(before,1);
    expect(await page.evaluate(()=>document.scrollingElement!.scrollTop)).toBe(scroll);
    await expect(page.locator('[aria-label="태그"]').last()).toHaveText(name);
  });
}
for (const [routePath, createLabel] of [["/tasks","할 일 추가"]]) {
  test(`같은 ${routePath} 조건 이동의 취소는 초안을 보존하고 버리기는 새 작성 상태로 닫는다`,async({page})=>{
    await page.route("http://127.0.0.1:55581/api/**",route=>route.fulfill({json:{items:[],next_cursor:null}}));
    await page.goto(`/e2e/fixtures/activity.html?route=${routePath}`);
    await beginTabAction(page,createLabel);
    const title=page.getByRole("textbox",{name:/^본문(?: \(필수\))?$/});
    await title.fill("이탈 확인 초안");
    // The fixture probe exercises real router navigation while the modal owns focus.
    await page.getByRole("link",{name:"fixture 같은 화면 조건 이동",includeHidden:true}).evaluate((el:HTMLAnchorElement)=>el.click());
    const confirm=page.getByRole("alertdialog",{name:"변경을 버릴까요?",exact:true});
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button",{name:"취소",exact:true}).click();
    await expect(title).toHaveValue("이탈 확인 초안");
    await expect(page).not.toHaveURL(/fixture=next/);
    await page.getByRole("link",{name:"fixture 같은 화면 조건 이동",includeHidden:true}).evaluate((el:HTMLAnchorElement)=>el.click());
    await page.getByRole("button",{name:"변경 버리기",exact:true}).click();
    await expect(page).toHaveURL(/fixture=next/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await beginTabAction(page,createLabel);
    await expect(page.getByRole("textbox",{name:/^본문(?: \(필수\))?$/})).toHaveValue("");
  });
}
for (const kind of ["records","tasks"]) {
  test(`직접 편집 ${kind} 라우트 버리기는 목록 복귀 대신 요청한 상세 조건으로 이동한다`,async({page})=>{
    const item={...record(1),...(kind!=="records"?{title:"기록 1"}:{}),...(kind === "tasks" ? { kind: "once", entity_ids: [], entity_context: [], pauses: [], deleted_at: null, created_by: null, created_by_name: null } : {}),status:"open",due_on:null,recurrence:null,timezone:null,result_record:null,change_note:"과거 메모"};
    await page.route("http://127.0.0.1:55581/api/**",route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith("/tags")?{items:[],next_cursor:null}:new URL(route.request().url()).pathname.endsWith(`/${kind}/${id(1)}`)?item:{items:[item],next_cursor:null}}));
    await page.goto(`/e2e/fixtures/activity.html?route=`+encodeURIComponent(`/${kind}/${id(1)}?edit=1`));
    const title=page.getByRole("textbox",{name:/^본문(?: \(필수\))?$/});
    await title.fill("상세 이동 초안");
    await page.getByRole("link",{name:"fixture 같은 화면 조건 이동",includeHidden:true}).evaluate((el:HTMLAnchorElement)=>el.click());
    const confirm=page.getByRole("alertdialog",{name:"변경을 버릴까요?",exact:true});
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button",{name:"취소",exact:true}).click();
    await expect(title).toHaveValue("상세 이동 초안");
    await page.getByRole("link",{name:"fixture 같은 화면 조건 이동",includeHidden:true}).evaluate((el:HTMLAnchorElement)=>el.click());
    await expect(confirm).toBeVisible();
    await page.getByRole("button",{name:"변경 버리기",exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`/${kind}/${id(1)}\\?fixture=next$`));
    await expect(detailDialog(page)).toHaveCount(1);
    await expect(detailDialog(page).getByRole("button",{name:"편집",exact:true})).toBeVisible();
    await expect(page.getByLabel("fixture 현재 경로",{exact:true})).toHaveText(`/${kind}/${id(1)}?fixture=next`);
    item.body="새 서버 원문";
    await page.goBack();
    await expect(page.getByRole("textbox",{name:/^본문(?: \(필수\))?$/})).toHaveValue("새 서버 원문");
    await page.goForward();
    await expect(page).toHaveURL(/fixture=next/);
    await expect(detailDialog(page)).toHaveCount(1);
  });
}
for(const kind of ["records","tasks"]){
  test(`${kind} 태그 사전 실패 재시도는 표시 행·읽던 위치·초점을 유지한다`,async({page})=>{
    let attempts=0,release:()=>void=()=>{};
    const held=new Promise<void>(resolve=>release=resolve);
    const items=Array.from({length:20},(_,i)=>({...record(i+1),...(kind==="tasks"?{title:`기록 ${i+1}`} : {}),tag_ids:[id(99)],...(kind === "tasks" ? { kind: "once", entity_ids: [], entity_context: [], pauses: [], deleted_at: null, created_by: null, created_by_name: null } : {}),status:"open",due_on:null,recurrence:null,timezone:null,result_record:null}));
    await page.route("http://127.0.0.1:55581/api/**",async route => {if(await fulfillPreparation(route))return;
      if(new URL(route.request().url()).pathname.endsWith("/tags")){
        if(!attempts++){await route.fulfill({status:503,json:{code:"internal",message:"태그 사전 실패"}});return;}
        await held;await route.fulfill({json:{items:[{id:id(99),name:"한".repeat(30)}],next_cursor:null}});return;
      }
      const path=new URL(route.request().url()).pathname;await route.fulfill({json:items.find(item=>path.endsWith("/"+item.id))??{items,next_cursor:null}});
    });
    await page.goto(`/e2e/fixtures/activity.html?route=${encodeURIComponent(`/${kind}?filters=1&open=/${kind}/${id(20)}`)}`);
    await openTabFilters(page);const section=page.getByRole("region",{name:kind==="records"?"기록 목록":"할 일 목록",exact:true});
    const title=section.getByRole("button",{name:"기록 20",exact:true});
    await expect(title).toBeVisible();await expect(title).toHaveAttribute("aria-expanded","true");
    await title.focus();await title.evaluate(el=>el.scrollIntoView({block:"center"}));
    const y=await title.evaluate(el=>el.getBoundingClientRect().top);
    await page.getByRole("button",{name:"태그 다시 시도",exact:true}).first().evaluate((el:HTMLButtonElement)=>el.click());
    await expect.poll(()=>attempts).toBe(2);
    await expect(businessRows(section.getByRole("table"))).toHaveCount(20);
    await expect(title).toBeFocused();
    expect(await title.evaluate(el=>el.getBoundingClientRect().top)).toBeCloseTo(y,0);
    release();
    await expect(page.locator('[aria-label="태그"]').first()).toHaveText("한".repeat(30));
    await expect(businessRows(section.getByRole("table"))).toHaveCount(20);
    await expect(title).toBeFocused();
    expect(await title.evaluate(el=>el.getBoundingClientRect().top)).toBeCloseTo(y,0);
  });
}
for(const kind of ["records","tasks"]){
  test(`${kind} 한 글자 제목도 모든 폭에서44px 조작 영역을 유지한다`,async({page})=>{
    const item={...record(1),...(kind!=="records"?{title:"함"}:{}),body:"함",...(kind === "tasks" ? { kind: "once", entity_ids: [], entity_context: [], pauses: [], deleted_at: null, created_by: null, created_by_name: null } : {}),status:"open",due_on:null,recurrence:null,timezone:null,result_record:null};
    await page.route("http://127.0.0.1:55581/api/**",route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith("/tags")?{items:[],next_cursor:null}:{items:[item],next_cursor:null}}));
    await page.goto(`/e2e/fixtures/activity.html?route=/${kind}`);
    const title=(page.getByRole("region",{name:kind==="records"?"기록 목록":"할 일 목록",exact:true})).getByRole("button",{name:"함",exact:true});
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

for (const kind of ["once", "recurring"] as const) {
  test(`task date picker ${kind} keeps the selected date draft through calendar close and discard cancellation`, async ({ page }) => {
    const writes: string[] = [];
    await page.route("http://127.0.0.1:55581/api/**", async (route) => {
      if (route.request().method() !== "GET") writes.push(new URL(route.request().url()).pathname);
      return route.fulfill({ json: { items: [], next_cursor: null } });
    });
    await page.goto("/e2e/fixtures/activity.html?route=/tasks?create=1");
    const form = page.getByRole("dialog", { name: "할 일 추가", exact: true });
    if (kind === "recurring") await form.getByRole("radio", { name: "반복", exact: true }).click();
    const label = kind === "once" ? "기한" : "시작일";
    const input = form.getByRole("textbox", { name: kind === "once" ? "기한" : /^시작일/ });
    await input.fill("2024-02-29");
    await form.getByRole("button", { name: `${label} 달력 열기`, exact: true }).click();
    const calendar = page.getByRole("dialog", { name: `${label} 달력`, exact: true });
    await calendar.getByRole("gridcell", { selected: true }).getByRole("button").press("ArrowRight");
    await page.keyboard.press("Enter");
    await expect(calendar).toHaveCount(0);
    await expect(input).toHaveValue("2024-03-01");
    await input.press("Escape");
    const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "취소", exact: true }).click();
    await expect(input).toHaveValue("2024-03-01");
    expect(writes).toEqual([]);
  });
}

test("record date picker preserves the clock and untouched timestamp precision across explicit saves", async ({ page }, info) => {
  const original = "2024-02-29T14:58:37.123Z";
  let current = record(71, original);
  const writes: Record<string, unknown>[] = [];
  await page.route("http://127.0.0.1:55581/api/**", async (route) => {
    if (await fulfillPreparation(route)) return;
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith(`/records/${id(71)}`)) {
      if (route.request().method() === "PATCH") {
        const input = route.request().postDataJSON();
        writes.push(input);
        current = { ...current, ...input, version: current.version + 1 };
      }
      return route.fulfill({ json: current });
    }
    return route.fulfill({ json: { items: [], next_cursor: null } });
  });
  await page.goto("/e2e/fixtures/activity.html?route=" + encodeURIComponent(`/records/${id(71)}`));
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const form = page.getByRole("dialog", { name: "기록 편집", exact: true });
  const date = form.getByLabel("수행 시각 날짜", { exact: true });
  const clock = form.getByLabel("수행 시각 시간", { exact: true });
  const expectedClock = info.project.use.timezoneId === "UTC" ? "14:58" : "23:58";
  await expect(date).toHaveValue("2024-02-29");
  await expect(clock).toHaveValue(expectedClock);
  await form.getByRole("textbox", { name: /^본문/ }).fill("본문만 정정");
  await saveOnce(page, form);
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0].occurred_at).toBe(original);
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await form.getByRole("button", { name: "수행 시각 날짜 달력 열기", exact: true }).click();
  const calendar = page.getByRole("dialog", { name: "수행 시각 날짜 달력", exact: true });
  await calendar.getByRole("gridcell", { selected: true }).getByRole("button").press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(date).toHaveValue("2024-03-01");
  await expect(clock).toHaveValue(expectedClock);
  expect(writes).toHaveLength(1);
  await saveOnce(page, form);
  await expect.poll(() => writes.length).toBe(2);
  expect(writes[1].occurred_at).toBe("2024-03-01T14:58:00.000Z");
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await expect(date).toHaveValue("2024-03-01");
  await expect(clock).toHaveValue(expectedClock);
});

test("task date picker rejects year zero beside the original draft before preparation", async ({ page }) => {
  const writes: string[] = [];
  await page.route("http://127.0.0.1:55581/api/**", async (route) => {
    if (route.request().method() !== "GET") writes.push(new URL(route.request().url()).pathname);
    if (await fulfillPreparation(route)) return;
    return route.fulfill({ json: { items: [], next_cursor: null } });
  });
  await page.goto("/e2e/fixtures/activity.html?route=/tasks?create=1");
  const form = page.getByRole("dialog", { name: "할 일 추가", exact: true });
  await form.getByRole("textbox", { name: /^제목/ }).fill("날짜 범위 검사");
  const input = form.getByRole("textbox", { name: "기한", exact: true });
  await input.fill("0000-01-01");
  await form.getByRole("button", { name: "추가", exact: true }).click();
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(input).toHaveValue("0000-01-01");
  await expect(form).toContainText("날짜");
  expect(writes).toEqual([]);
});

test("record date picker retains invalid and partial parent drafts while only two blank parts mean now", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  await page.route("http://127.0.0.1:55581/api/**", async (route) => {
    if (new URL(route.request().url()).pathname.endsWith(`/tasks/${id(100)}/complete`) && route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      writes.push(input);
      return route.fulfill({ json: { ...record(72), ...input } });
    }
    if (new URL(route.request().url()).pathname.endsWith(`/tasks/${id(100)}`)) return route.fulfill({ json: { id: id(100), title: "수행할 일", body: "", kind: "once", status: "open", due_on: null, recurrence: null, timezone: null, entity_ids: [], entity_context: [], tag_ids: [], result_record: null, version: 1, pauses: [], created_by: null, created_by_name: null, deleted_at: null } });
    if (await fulfillPreparation(route)) return;
    return route.fulfill({ json: { items: [], next_cursor: null } });
  });
  await page.goto("/e2e/fixtures/activity.html?route=" + encodeURIComponent(`/tasks/${id(100)}?action=complete`));
  const form = page.getByRole("dialog", { name: "할 일 완료", exact: true });
  await form.getByRole("textbox", { name: /^본문/ }).fill("미완성 시각 초안");
  const date = form.getByLabel("수행 시각 날짜", { exact: true });
  const clock = form.getByLabel("수행 시각 시간", { exact: true });
  await date.fill("0000-01-01");
  await clock.fill("12:30");
  await form.getByRole("button", { name: "완료하고 기록 저장", exact: true }).click();
  await expect(date).toHaveAttribute("aria-invalid", "true");
  await expect(date).toHaveValue("0000-01-01");
  expect(writes).toEqual([]);
  await date.fill("2024-T불완전");
  for (const width of [390, 1440, 320]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(date).toHaveValue("2024-T불완전");
    await expect(clock).toHaveValue("12:30");
  }
  await date.fill("");
  await form.getByRole("button", { name: "완료하고 기록 저장", exact: true }).click();
  await expect(date).toHaveAttribute("aria-invalid", "true");
  await expect(clock).toHaveValue("12:30");
  expect(writes).toEqual([]);
  await clock.fill("");
  await form.getByRole("button", { name: "완료하고 기록 저장", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).not.toHaveProperty("occurred_at");
});


test("deleted task retains its content and result, and restore retries the exact admitted version and request", async ({ page }) => {
  let task = { id: id(81), title: "복원할 할 일", body: "보관된 업무 본문", kind: "once", status: "done", due_on: null, recurrence: null, timezone: null, completed_at: "2026-10-03T16:00:00Z", result_record_id: id(82), result_record: { id: id(82), body: "보관된 수행 결과" }, entity_ids: [], entity_context: [], tag_ids: [], pauses: [], version: 5, deleted_at: "2026-10-04T00:00:00Z" as string | null, created_by: null, created_by_name: null, created_at: "2026-10-01T00:00:00Z", updated_at: "2026-10-04T00:00:00Z" };
  const writes: { key: string | undefined; body: Record<string, unknown> }[] = [];
  await page.route("http://127.0.0.1:55581/api/**", async route => {
    if (await fulfillPreparation(route)) return;
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith(`/tasks/${task.id}/restore`)) {
      writes.push({ key: request.headers()["idempotency-key"], body: request.postDataJSON() });
      if (writes.length === 1) return route.abort("failed");
      task = { ...task, deleted_at: null, version: 6 };
      return route.fulfill({ json: task });
    }
    if (url.pathname.endsWith(`/tasks/${task.id}`)) return route.fulfill({ json: task });
    if (url.pathname.endsWith("/records")) return route.fulfill({ json: { items: [{ ...record(82), task_id: task.id, body: "보관된 수행 결과" }], next_cursor: null } });
    return route.fulfill({ json: { items: [], next_cursor: null } });
  });
  await page.goto("/e2e/fixtures/activity.html?route=" + encodeURIComponent(`/tasks/${task.id}`));
  const surface = detailDialog(page);
  await expect(surface).toContainText("보관된 업무 본문");
  await expect(surface).toContainText("삭제됨");
  await expect(surface.getByRole("button", { name: "편집", exact: true })).toHaveCount(0);
  await expect(surface.getByRole("button", { name: "태그 연결", exact: true })).toHaveCount(0);
  await expect(surface.getByRole("button", { name: "자료 연결", exact: true })).toHaveCount(0);
  await expect(surface.getByRole("button", { name: "보관된 수행 결과", exact: true })).toBeVisible();
  await surface.getByRole("button", { name: "복원", exact: true }).click();
  const confirmation = executionDialog(page);
  await confirmation.getByLabel("기록 메모", { exact: true }).fill("보관한 업무 재개");
  await confirmation.getByRole("button", { name: "복원하고 저장", exact: true }).click();
  await expect(confirmation.getByRole("button", { name: "같은 내용 다시 시도", exact: true })).toBeVisible();
  await confirmation.getByRole("button", { name: "같은 내용 다시 시도", exact: true }).click();
  await expect(surface.getByRole("button", { name: "편집", exact: true })).toBeVisible();
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(writes[0].body.expected_version).toBe(5);
  expect(writes[0].body.change_note).toBe("보관한 업무 재개");
  expect(writes[0].key).toMatch(/^[0-9a-f-]{36}$/);
  await expect(page).not.toHaveURL(/action=restore/);
  await expect(surface.getByRole("button", { name: "보관된 수행 결과", exact: true })).toBeVisible();
});

test("deleted-only task lookup preserves its visibility filter with a keyword search", async ({ page }) => {
  const reads: URL[] = [], searches: string[] = [];
  await page.route("http://127.0.0.1:55581/api/**", async route => {
    if (await fulfillPreparation(route)) return;
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/tasks")) reads.push(url);
    if (url.pathname.endsWith("/search")) searches.push(url.pathname);
    return route.fulfill({ json: { items: [], next_cursor: null } });
  });
  await page.goto("/e2e/fixtures/activity.html?route=" + encodeURIComponent("/tasks?deleted=only&q=보관"));
  await expect.poll(() => reads.length).toBeGreaterThan(0);
  expect(reads.at(-1)!.searchParams.get("deleted")).toBe("only");
  expect(reads.at(-1)!.searchParams.get("keyword")).toBe("보관");
  expect(searches).toEqual([]);
  await openTabFilters(page);
  await expect(page.getByLabel("삭제 상태", { exact: true })).toHaveValue("only");
});
