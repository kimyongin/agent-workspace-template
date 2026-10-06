import { expect,test } from "@playwright/test";
const id="00000000-0000-4000-8000-000000000131", stamp="2026-10-06T01:00:00Z";
test("원칙 화면의 기록 이동 링크는 모든 대표 폭에서 44px 누름 영역을 유지한다",async({page})=>{
  await page.route("**/api/**",route=>route.fulfill({json:new URL(route.request().url()).pathname.endsWith("/current")?{current:null}:{items:[],next_cursor:null}}));
  await page.goto("/e2e/fixtures/workspace-screens.html?route=/principles");
  const link=page.getByRole("link",{name:"과거 근거는 통합 기록에서 보기"});
  for(const width of [320,360,390,639,640,768,1024,1440]){
    await page.setViewportSize({width,height:900});const box=await link.boundingBox();
    expect(box!.height,`${width}px 기록 링크 높이`).toBeGreaterThanOrEqual(44);expect(box!.width).toBeGreaterThanOrEqual(44);
  }
});

test("키보드 메모 확인이 끝나면 새 메모 입력칸으로 초점이 이동하고 저장 전 상태를 유지한다",async({page})=>{
  let writes=0;
  await page.route("**/api/**",async route=>{
    if(new URL(route.request().url()).pathname.endsWith("/preview")){
      await new Promise(resolve=>setTimeout(resolve,100));
      return route.fulfill({json:{memo:{title:"할 일 등록",summary:"기본 요약",body:"기본 사실"}}});
    }
    if(route.request().method()!=="GET")writes++;
    return route.fulfill({json:{items:[],next_cursor:null}});
  });
  await page.goto("/e2e/fixtures/workspace-screens.html?route=/tasks?create=1");
  const form=page.locator("dialog.modal:not(.modal-confirm)[open]");
  await form.getByLabel(/^제목/).fill("키보드 할 일");await form.getByLabel(/^요약/).fill("할 일 요약");
  await form.getByLabel(/^제목/).focus();await page.keyboard.press("Enter");
  await expect(form.getByRole("region",{name:"저장할 기록 메모"})).toBeVisible();
  await expect(form.getByLabel("기록 제목")).toBeFocused();
  expect(await page.evaluate(()=>!!document.activeElement?.closest("dialog[open]"))).toBe(true);
  expect(writes).toBe(0);await expect(form.getByRole("button",{name:"확인하고 저장",exact:true})).toBeEnabled();
});
test("현재 원칙의 메모 확인은 저장하지 않고 같은 문서를 갱신하며 삭제 뒤 과거를 승격하지 않는다",async({page})=>{
  let current:Record<string,unknown>|null={id,title:"현재 기준",summary:"현재 요약",body:"원문",is_current:true,version:1,saved_at:stamp,created_at:stamp,updated_at:stamp,origin:"saved"};
  const writes:Record<string,unknown>[]=[];
  await page.route("http://127.0.0.1:55586/**",async route=>{if(route.request().isNavigationRequest()){const response=await route.fetch({url:"http://127.0.0.1:55586/e2e/fixtures/workspace-screens.html"});return route.fulfill({response});}return route.continue();});
  await page.route("**/api/**",route=>{
    const req=route.request(),path=new URL(req.url()).pathname;
    if(path.endsWith("/principles/preview"))return route.fulfill({json:{memo:{title:"원칙 변경",summary:"확인한 사실",body:"기본 사실"},changed:true}});
    if(["POST","PATCH"].includes(req.method())){const input=req.postDataJSON();writes.push(input);current=path.endsWith("/delete")?null:{...current,...input,version:2};return path.endsWith("/delete")?route.fulfill({status:204}):route.fulfill({json:current});}
    return route.fulfill({json:path.endsWith("/current")?{current}:path.endsWith(id)?current:{items:[],next_cursor:null}});
  });
  await page.goto("/e2e/fixtures/workspace-screens.html?route=/principles");
  await expect(page.getByRole("link",{name:"과거 근거는 통합 기록에서 보기",exact:true})).toHaveAttribute("href","/records");
  await page.getByRole("button",{name:"원칙 작업 메뉴",exact:true}).click();await page.getByRole("link",{name:"현재 원칙 편집",exact:true}).click();
  const form=page.locator("dialog.modal:not(.modal-confirm)[open]");
  await form.getByRole("textbox",{name:/^본문$/}).fill("새 본문");await form.getByRole("button",{name:"기록 메모 확인",exact:true}).click();
  expect(writes).toHaveLength(0);await form.getByLabel("기록 요약",{exact:false}).fill("판단 근거를 보충");await form.getByRole("button",{name:"확인하고 저장",exact:true}).click();
  expect(writes[0].change_memo).toEqual({title:"원칙 변경",summary:"판단 근거를 보충",body:"기본 사실"});
  expect(current?.id).toBe(id);expect(current?.body).toBe("새 본문");
  await page.goto(`/principles/${id}?edit=1&edit_from=view`);await form.getByRole("button",{name:"삭제",exact:true}).click();
  const confirm=page.getByRole("dialog",{name:"원칙을 삭제할까요?",exact:true});await expect(confirm).toContainText("과거 원칙을 자동 승격하지 않습니다");
  await confirm.getByRole("button",{name:"기록 메모 확인",exact:true}).click();expect(writes).toHaveLength(1);await confirm.getByRole("button",{name:"삭제",exact:true}).click();
  await expect(page.getByText("현재 원칙이 없습니다.",{exact:false})).toBeVisible();expect(current).toBeNull();expect(writes).toHaveLength(2);
});

test("원칙 삭제 응답이 끊기면 최종 메모와 같은 버전로 재시도한다",async({page})=>{
  const current={id,title:"현재 기준",summary:"현재 요약",body:"원문",is_current:true,version:1,saved_at:stamp,created_at:stamp,updated_at:stamp,origin:"saved"};
  const writes:Record<string,unknown>[]=[];
  await page.route("http://127.0.0.1:55586/**",async route=>{if(route.request().isNavigationRequest()){const response=await route.fetch({url:"http://127.0.0.1:55586/e2e/fixtures/workspace-screens.html"});return route.fulfill({response});}return route.continue();});
  await page.route("**/api/**",route=>{
    const path=new URL(route.request().url()).pathname;
    if(path.endsWith("/preview"))return route.fulfill({json:{memo:{title:"삭제 기록",summary:"확인 내용",body:"기본 근거"}}});
    if(path.endsWith("/delete")){writes.push(route.request().postDataJSON());return writes.length===1?route.abort("connectionreset"):route.fulfill({status:204});}
    return route.fulfill({json:path.endsWith("/current")?{current:writes.length>1?null:current}:path.endsWith(id)?current:{items:[],next_cursor:null}});
  });
  await page.goto(`/e2e/fixtures/workspace-screens.html?route=/principles/${id}?edit=1`);
  await page.getByRole("button",{name:"삭제",exact:true}).click();const confirm=page.getByRole("dialog",{name:"원칙을 삭제할까요?"});
  await confirm.getByRole("button",{name:"기록 메모 확인",exact:true}).click();await confirm.getByLabel("기록 본문").fill("확인한 최종 메모");
  await confirm.getByRole("button",{name:"삭제",exact:true}).click();await expect(confirm.getByRole("button",{name:"같은 내용 다시 시도",exact:true})).toBeVisible();
  await expect(confirm.getByLabel("기록 본문")).toHaveValue("확인한 최종 메모");await expect(confirm.getByLabel("기록 본문")).toBeDisabled();
  await confirm.getByRole("button",{name:"같은 내용 다시 시도",exact:true}).click();await expect(confirm).not.toBeVisible();
  expect(writes).toHaveLength(2);expect(writes[1]).toEqual(writes[0]);expect(writes[0].expected_version).toBe(1);
});
