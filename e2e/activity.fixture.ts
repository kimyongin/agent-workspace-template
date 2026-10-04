import { test, expect } from "@playwright/test";
const id = (n:number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const record = (n:number, occurred_at="2026-10-03T16:00:00Z") => ({id:id(n),title:`기록 ${n}`,summary:"요약 먼저",body:"본문 근거",occurred_at,task_id:null,occurrence_on:null,tag_ids:[],entity_id:null,applied_principle_ids:[],applied_principles:[],version:1,created_at:occurred_at,updated_at:occurred_at});

test("날짜 병합·접힘과 직접 편집 취소/저장이 목록을 복원한다", async ({page}) => {
  let changed = record(2);
  await page.route("**/fixture-api/**", async route => {
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
  const older = page.getByRole("button",{name:"2026-10-03 기록",exact:true});
  await older.click();
  await expect(page.getByRole("link",{name:"기록 3",exact:true})).toBeHidden();
  await page.getByRole("button",{name:"더 보기",exact:true}).click();
  await expect(page.locator(".record-date-group")).toHaveCount(2);
  await expect(page.getByRole("link",{name:"기록 1",exact:true})).toHaveCount(1);
  await expect(older).toHaveAttribute("aria-expanded","false");
  await page.getByRole("link",{name:"기록 2 편집",exact:true}).click();
  await expect(page.getByRole("dialog",{name:"기록 편집",exact:true})).toBeVisible();
  await page.getByRole("button",{name:"취소",exact:true}).click();
  await expect(page).toHaveURL(/\/records\?/);
  await expect(older).toHaveAttribute("aria-expanded","false");
  await expect(page.locator(`#activity-records-${id(2)}`)).toBeFocused();
  await page.getByRole("link",{name:"기록 2 편집",exact:true}).click();
  await page.getByRole("textbox",{name:"제목 (필수)",exact:true}).fill("정정 기록");
  await page.getByRole("button",{name:"저장",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("link",{name:"정정 기록",exact:true})).toBeFocused();
  await page.getByRole("link",{name:"정정 기록 보기",exact:true}).click();
  const summary = page.locator(".document-summary");
  await expect(summary).toHaveText("요약 먼저");
  await page.getByRole("button",{name:"편집",exact:true}).click();
  await page.getByRole("button",{name:"취소",exact:true}).click();
  await expect(summary).toBeVisible();
  const overflow = await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  expect(overflow).toBe(false);
});

test("할 일 저장 성공 후 조회 실패는 초안 재저장을 요구하지 않는다", async ({page}) => {
  let version=1, fail=false, patches=0;
  const task = () => ({...record(1),kind:"once",status:"open",due_on:null,recurrence:null,timezone:null,result_record:null,version});
  await page.route("**/fixture-api/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith(`/tasks/${id(1)}`)) {
      if(route.request().method()==="PATCH"){patches++;version++;fail=true;await route.fulfill({json:task()});return;}
      if(fail){await route.fulfill({status:503,json:{code:"internal",message:"fixture read failure"}});return;}
      await route.fulfill({json:task()});return;
    }
    await route.fulfill({json:{items:[],next_cursor:null}});
  });
  await page.goto(`/e2e/fixtures/activity.html?route=/tasks/${id(1)}`);
  await page.getByRole("button",{name:"편집",exact:true}).click();
  await page.getByRole("textbox",{name:"제목 (필수)",exact:true}).fill("정정한 할 일");
  await page.getByRole("button",{name:"저장",exact:true}).click();
  await expect(page.getByText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.")).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  fail=false;
  await page.getByRole("button",{name:"조회 다시 시도",exact:true}).click();
  await expect(page.getByText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.")).toHaveCount(0);
  expect(patches).toBe(1);
});

test("직접 편집의 실패·Escape·확인 취소는 초안을 유지한다", async ({page}) => {
  await page.route("**/fixture-api/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith(`/records/${id(1)}`)) {
      if(route.request().method()==="PATCH") {await route.fulfill({status:409,json:{code:"conflict",message:"다른 곳에서 수정했습니다."}});return;}
      await route.fulfill({json:record(1)});return;
    }
    await route.fulfill({json:{items:[record(1)],next_cursor:null}});
  });
  await page.goto("/e2e/fixtures/activity.html");
  await page.getByRole("link",{name:"기록 1 편집",exact:true}).click();
  const title=page.getByRole("textbox",{name:"제목 (필수)",exact:true});
  await title.fill("보존할 초안");
  await page.getByRole("button",{name:"저장",exact:true}).click();
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

test("원칙 추가 페이지 직접 편집 취소는 필터·페이지·초점을 보존한다", async ({page}) => {
  const p=(n:number)=>({...record(n),title:`원칙 ${n}`,status:"active",applies_when:"판단할 때",replaced_by_id:null});
  await page.route("**/fixture-api/**",async route=>{
    const url=new URL(route.request().url());
    let data:unknown={items:[],next_cursor:null};
    if(url.pathname.endsWith("/principles"))data=url.searchParams.has("cursor")?{items:[p(1),p(2)],next_cursor:null}:{items:[p(1)],next_cursor:"next"};
    if(url.pathname.endsWith(`/principles/${id(2)}`))data=p(2);
    await route.fulfill({json:data});
  });
  await page.goto("/e2e/fixtures/activity.html?route=/principles");
  await page.getByRole("button",{name:"더 보기",exact:true}).click();
  await expect(page.getByRole("link",{name:"원칙 1",exact:true})).toHaveCount(1);
  await page.getByRole("link",{name:"원칙 2 편집",exact:true}).click();
  await page.getByRole("button",{name:"취소",exact:true}).click();
  await expect(page).toHaveURL(/\/principles\?pages=2/);
  await expect(page.locator(`#principle-${id(2)}`)).toBeFocused();
});

test("긴 제목·태그와 편집 조작은 대표 폭에서 읽기 순서와 누름 영역을 유지한다", async ({page},testInfo) => {
  const r={...record(1),title:"긴 제목 ".repeat(16).trim(),summary:"긴 요약 ".repeat(40),tag_ids:[id(8)]};
  await page.route("**/fixture-api/**",async route=>{
    const path=new URL(route.request().url()).pathname;
    const data=path.endsWith("/tags")?{items:[{id:id(8),name:"공백없는긴태그이름을선택하고읽는표현을확인"}],next_cursor:null}:path.endsWith("/records")?{items:[r],next_cursor:null}:path.endsWith(`/records/${id(1)}`)?r:{items:[],next_cursor:null};
    await route.fulfill({json:data});
  });
  await page.goto("/e2e/fixtures/activity.html");
  for(const width of [360,390,768,1024,1440]) {
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
    await page.route("**/fixture-api/**",async route=>{
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
    await expect(page.locator(".tag-read")).toHaveText(name);
    hold();
    await page.getByRole("link",{name:"← 기록 목록",exact:true}).click();
    await expect(page.getByText("태그 이름을 불러오는 중…",{exact:true})).toBeVisible();
    await expect(row).toHaveCount(0);
    release();
    await expect(row).toBeFocused();
    expect((await row.boundingBox())!.y).toBeCloseTo(before,1);
    expect(await page.evaluate(()=>scrollY)).toBe(scroll);
    await expect(page.locator(".tag-read").last()).toHaveText(name);
  });
}
