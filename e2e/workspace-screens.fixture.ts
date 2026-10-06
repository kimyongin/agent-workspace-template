import { recordDisplayText } from "../supabase/functions/_shared/contracts/record-display.ts";
import { saveOnce, beginTabAction } from "./ui-actions.ts";
import { expect, test, type Page } from "@playwright/test";
for(const kind of ["entities","records"] as const)test(`${kind}: 긴 복원 중 실패는 미표시 batch까지 유효한23행을 보존`,async({page})=>{
  const state=await fixtures(page),reads:number[]=[];
  await page.route(`**/api/${kind}?**`,route=>{
    const index=Number(new URL(route.request().url()).searchParams.get("cursor")??0);reads.push(index);
    if(index===23)return route.fulfill({status:503,json:{code:"internal",message:"partial restoration failure"}});
    const item=kind==="entities"?{...entity(100+index),prop1:`부분 행 ${index}`}:{...record(100+index),body:`부분 행 ${index}`};
    return route.fulfill({json:{items:[item],next_cursor:String(index+1)}});
  });
  await go(page,`/${kind}?pages=250`);await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator(kind==="entities"?".list .item-title":`.${kind} .list .item-title`)).toHaveCount(23);await expect(page.locator(kind==="entities"?".list .item-title":`.${kind} .list .item-title`).last()).toHaveText("부분 행 22");
  expect(reads).toEqual(Array.from({length:24},(_,index)=>index));expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
const targetCases=[["entity","entities",1],["task","tasks",2],["record","records",31],["principle","principles",4]] as const;
for(const [kind,route,n] of targetCases) for(const outcome of ["exists","deleted","foreign","failed"] as const)test(`변경 대상 ${kind}: ${outcome} 현재 조회와 역사 metadata 분리`,async({page})=>{
  const state=await fixtures(page),r=state.rows.records[0];
  const change={event_id:id(30),target_kind:kind,target_id:id(n),target_title:"당시 대상 이름",action:"update",source:"mcp",before:{title:"수정 전"},after:{title:"수정 후"},path:`/${route}/${id(n)}`};
  Object.assign(r,{record_kind:"change",body:"당시 편집 근거",change});
  const original=JSON.stringify(r);let reads=0,fail=outcome==="failed";
  await page.route(`**/api/${route}/${id(n)}`,endpoint=>{reads++;return outcome==="deleted"||outcome==="foreign"?endpoint.fulfill({status:404,json:{code:"not_found",message:"항목을 찾을 수 없습니다"}}):fail?endpoint.fulfill({status:503,json:{code:"internal",message:"조회 실패"}}):endpoint.fulfill({json:{id:id(n)}});});
  await go(page,`/records/${r.id}?edit=1&edit_from=view`);
  const link=form(page).getByRole("link",{name:"대상 원문 보기",exact:true});
  if(outcome==="exists")await expect(link).toHaveAttribute("href",change.path);
  else if(outcome==="failed"){
    await expect(form(page)).toContainText("대상의 현재 상태를 확인하지 못했습니다.");
    await expect(form(page)).not.toContainText("삭제된 대상");await expect(link).toHaveCount(0);
    fail=false;await form(page).getByRole("button",{name:"대상 다시 조회",exact:true}).click();
    await expect(link).toHaveAttribute("href",change.path);expect(reads).toBe(2);
  }else{await expect(form(page)).toContainText("삭제된 대상 또는 접근할 수 없는 대상");await expect(link).toHaveCount(0);}
  await expect(form(page)).toContainText("당시 대상 이름");await expect(form(page)).toContainText("수정 전");await expect(form(page)).toContainText("수정 후");await expect(form(page)).toContainText("당시 편집 근거");await expect(form(page)).toContainText("에이전트");
  expect(JSON.stringify(r)).toBe(original);expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

for(const failure of [401,403,500,"network","other404"] as const)test(`변경 대상 조회 ${failure}: 삭제로 오인하지 않고 GET 재시도`,async({page})=>{
  const state=await fixtures(page),r=state.rows.records[0];Object.assign(r,{record_kind:"change",change:{event_id:id(30),target_kind:"entity",target_id:id(1),target_title:"당시 이름",action:"create",source:"http",before:null,after:{prop1:"당시 이름"},path:`/entities/${id(1)}`}});
  await page.route(`**/api/entities/${id(1)}`,endpoint=>failure==="network"?endpoint.abort("connectionreset"):endpoint.fulfill({status:failure==="other404"?404:failure,json:{code:failure===401?"unauthenticated":failure===403?"forbidden":"internal",message:"조회 실패"}}));
  await go(page,`/records/${r.id}?edit=1&edit_from=view`);await expect(form(page)).toContainText("대상의 현재 상태를 확인하지 못했습니다.");await expect(form(page)).not.toContainText("삭제된 대상");await expect(form(page).getByRole("link",{name:"대상 원문 보기",exact:true})).toHaveCount(0);
  await expect(form(page).getByRole("button",{name:"대상 다시 조회",exact:true})).toBeEnabled();expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

test("변경 대상 목록은 추가 조회 없이 당시 행동만 표시·늦은 상세 응답은 다음 대상에 반영하지 않는다",async({page})=>{
  const state=await fixtures(page),r=state.rows.records[0];
  const historical={event_id:id(30),target_kind:"entity",target_id:id(1),target_title:"첫 대상",action:"create",source:"http",before:null,after:{prop1:"첫 대상"},path:`/entities/${id(1)}`};
  Object.assign(r,{record_kind:"change",change:historical});const second={...record(32),record_kind:"change",change:{...historical,target_id:id(99),target_title:"다음 대상",path:`/entities/${id(99)}`}};state.rows.records.push(second);
  let reads=0,release=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/entities/${id(1)}`,async endpoint=>{reads++;await held;await endpoint.fulfill({json:state.rows.entities[0]}).catch(()=>{});});
  await go(page,"/records");await expect(page.locator(".records .list")).toContainText("첫 대상");expect(reads).toBe(0);await expect(page.locator(".records .list")).not.toContainText("삭제된 대상");
  await go(page,`/records/${r.id}?edit=1&edit_from=view`);await expect(form(page)).toContainText("대상의 현재 상태 확인 중");await expect.poll(()=>reads).toBe(1);
  await go(page,`/records/${second.id}?edit=1&edit_from=view`);await expect(form(page)).toContainText("삭제된 대상 또는 접근할 수 없는 대상");release();
  await expect(form(page)).toContainText("다음 대상");await expect(form(page).getByRole("link",{name:"대상 원문 보기",exact:true})).toHaveCount(0);expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

for(const [kind,label] of [["entities","엔터티"],["tasks","할 일"],["records","기록"],["principles","원칙"]])test(`${kind}: uncertain 생성 폐기 후 새 작성은 새로운 요청키`,async({page})=>{
  const state=await fixtures(page,{failWrite:"unknown",emptyPrinciple:true});await go(page,`/${kind}`);
  const begin=()=>beginTabAction(page,kind==="principles"?"현재 원칙 등록":kind==="records"?"기록 작성":`${label} 추가`);
  const fill=async(value:string)=>{if(kind==="entities")await form(page).getByLabel("속성 1",{exact:false}).fill(value);else await fillText(page,value);};
  const submit=()=>saveOnce(page, form(page), kind==="tasks"?"추가":"저장");
  await begin();await fill("첫 작성");await submit();await expect(form(page).getByRole("button",{name:"같은 내용 다시 시도"})).toBeVisible();
  await page.keyboard.press("Escape");await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();
  await expect(form(page)).toHaveCount(0);await begin();await fill("새 작성");await submit();await expect(state.writes).toHaveLength(2);
  expect(state.writes[1].body.id).not.toBe(state.writes[0].body.id);expect(state.errors).toEqual([]);
});

for(const [kind,n] of [["entities",1],["tasks",2],["records",3],["principles",4]] as const)test(`${kind}: uncertain 편집 폐기 후 새 편집은 같은 버전에 새 메모`,async({page})=>{
  const state=await fixtures(page,{failWrite:"unknown"});await go(page,`/${kind}/${id(n)}`);
  await compatibleEdit(page);await form(page).getByLabel(kind==="records"?"본문":"편집 메모",{exact:false}).fill("첫 수정");await saveOnce(page, form(page));
  await expect(form(page).getByRole("button",{name:"같은 내용 다시 시도"})).toBeVisible();await page.keyboard.press("Escape");
  await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();
  if(kind==="entities")await go(page,`/${kind}/${id(n)}`);
  await compatibleEdit(page);await form(page).getByLabel(kind==="records"?"본문":"편집 메모",{exact:false}).fill("새 수정");await saveOnce(page, form(page));
  await expect.poll(()=>state.writes.length).toBe(2);expect(state.writes[1].body.expected_version).toBe(state.writes[0].body.expected_version);expect(state.writes[1].body[kind==="records"?"body":"change_note"]).toBe("새 수정");expect(state.errors).toEqual([]);
});

test("dirty 작성 조건 이동 승인: create 유지 URL도 새 초안",async({page})=>{
  const state=await fixtures(page);await go(page,"/tasks?create=1");await fillText(page,"버릴 작성 초안");
  // Native dialog makes background links inert; trigger the route guard through the fixture router.
  await page.getByRole("link",{name:"작성 조건 변경 fixture"}).evaluate(el=>el.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true})));
  const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"변경 버리기"}).click();
  await expect(page).toHaveURL(/tasks\?create=1&kind=recurring$/);await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("");expect(state.errors).toEqual([]);
});

for(const [kind,label,submit] of [["task","관련 할 일 추가","추가"],["record","기록 작성","저장"]])test(`엔터티 관련 ${kind}: uncertain 폐기 후 새 작성은 새 요청키`,async({page})=>{
  const state=await fixtures(page,{failWrite:"unknown"});await go(page,`/entities/${id(1)}`);
  await form(page).getByRole("button",{name:label,exact:true}).click();await fillText(page,"첫 연결 작성");await saveOnce(page, form(page), submit);
  await expect(form(page).getByRole("button",{name:"같은 내용 다시 시도"})).toBeVisible();await page.keyboard.press("Escape");
  await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();await expect(page).not.toHaveURL(/create=/);
  await form(page).getByRole("button",{name:label,exact:true}).click();await fillText(page,"새 연결 작성");await saveOnce(page, form(page), submit);
  await expect.poll(()=>state.writes.length).toBe(2);expect(state.writes[1].body.id).not.toBe(state.writes[0].body.id);expect(state.errors).toEqual([]);
});

test("엔터티 create/edit 복합 직접 링크는 연결 작성 한 폼만 연다",async({page})=>{
  const state=await fixtures(page);await go(page,`/entities/${id(1)}?create=task&edit=1`);
  await expect(form(page)).toHaveCount(1);await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toBeVisible();await expect(form(page).getByLabel("속성 1",{exact:false})).toHaveCount(0);
  await fillText(page,"연결 작성 한 번");await saveOnce(page, form(page), "추가");await expect.poll(()=>state.writes.length).toBe(1);expect(state.writes[0].body.entity_ids).toEqual([id(1)]);expect(state.errors).toEqual([]);
});

for(const [kind,label] of [["task","관련 할 일 추가"],["record","기록 작성"]] as const) test(`엔터티 연결 ${kind}: 취소·폐기 승인은 작성 URL을 닫고 reload는 읽기`,async({page})=>{
  const state=await fixtures(page);await go(page,`/entities/${id(1)}?list=%2Fentities%3Fq%3D%EC%97%94%ED%84%B0%ED%8B%B0`);
  for(const dirty of [false,true]){
    await form(page).getByRole("button",{name:label,exact:true}).click();await expect(page).toHaveURL(new RegExp(`create=${kind}`));
    if(dirty) await fillText(page,"폐기할 연결 작성");
    await form(page).getByRole("button",{name:"닫기",exact:true}).click();
    if(dirty){
      const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();
      await expect(form(page).getByRole("textbox",{name:kind==="record"?/^본문/:/^제목/})).toHaveValue("폐기할 연결 작성");
      await form(page).getByRole("button",{name:"닫기",exact:true}).click();await confirm.getByRole("button",{name:"변경 버리기"}).click();
    }
    await expect(page).not.toHaveURL(/create=/);await expect(page).toHaveURL(/list=/);
    await expect(form(page).getByRole("button",{name:label,exact:true})).toBeFocused();
  }
  await page.reload();await expect(form(page).getByRole("button",{name:label,exact:true})).toBeVisible();
  await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveCount(0);expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

test("태그 DELETE pending: Back·경로 이동·reload 보호와 응답 뒤 복귀",async({page})=>{
  const state=await fixtures(page,{hold:true});await go(page,"/entities");
  await page.getByRole("link",{name:"활동 태그 fixture",exact:true}).click();
  await page.getByRole("button",{name:"같은 이름 삭제",exact:true}).click();
  const confirm=page.locator(".delete-action.is-armed");await saveOnce(page,confirm,"삭제 확인");await state.pending;
  await expect(confirm.getByRole("button",{name:"삭제 중…"})).toBeDisabled();await expect(confirm.getByRole("button",{name:"취소",exact:true})).toBeDisabled();
  await page.goBack();await expect(page).toHaveURL(/tags\/activity$/);await expect(confirm).toBeVisible();
  await page.getByRole("link",{name:"엔터티 fixture",exact:true}).evaluate(el=>el.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true})));
  await expect(page).toHaveURL(/tags\/activity$/);await expect(page.getByRole("dialog",{name:"변경을 버릴까요?"})).toHaveCount(0);
  expect(await page.evaluate(()=>{const event=new Event("beforeunload",{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);
  await page.keyboard.press("Escape");await expect(confirm).toBeVisible();state.release();
  await expect(confirm).toHaveCount(0);await expect(page.getByRole("button",{name:"같은 이름 삭제",exact:true})).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"활동 태그 관리",exact:true})).toBeFocused();
  await page.goBack();await expect(page).toHaveURL(/entities$/);expect(state.writes).toHaveLength(1);expect(state.errors).toEqual([]);
});

test("태그 scoped 상세/편집·legacy ID 직접 링크 호환",async({page})=>{
  const state=await fixtures(page);await go(page,`/tags/entity/${id(10)}`);await expect(page).toHaveURL(/tags\/entity\?view=/);await expect(form(page)).toContainText("엔터티에 사용하는 태그");
  await go(page,`/tags/entity/${id(10)}?edit=1`);await expect(form(page).getByRole("textbox",{name:/태그 이름/})).toHaveValue("같은 이름");
  await go(page,`/tags/${id(11)}`);await expect(page).toHaveURL(/tags\/activity\?view=/);await expect(form(page)).toContainText("할 일·기록에 사용하는 태그");expect(state.errors).toEqual([]);
});

test("원칙 삭제 실패는 메모를 보존하고 단일 요청으로 재시도한다",async({page})=>{
  const state=await fixtures(page);await go(page,`/principles/${id(4)}?edit=1`);let failed=true;const attempts:Record<string,unknown>[]=[];
  await page.route(`**/api/principles/${id(4)}/delete`,route=>{attempts.push(route.request().postDataJSON());if(failed)return route.fulfill({status:422,json:{code:"validation_failed",message:"저장 실패"}});state.rows.principles=state.rows.principles.filter(r=>r.id!==id(4));return route.fulfill({status:204});});
  await form(page).getByRole("button",{name:"삭제",exact:true}).click();const confirm=page.locator(".delete-action.is-armed");
  await confirm.getByLabel("이유 (선택)").fill("보존할 이유");await saveOnce(page,confirm,"삭제 확인");await expect(confirm).toContainText("저장 실패");
  await expect(confirm.getByLabel("이유 (선택)")).toHaveValue("보존할 이유");expect(attempts).toHaveLength(1);
  failed=false;await saveOnce(page,confirm,"삭제 확인");await expect(page).toHaveURL(/\/principles$/);expect(attempts[1]).toEqual(attempts[0]);expect(state.errors).toEqual([]);
});

test("폐기한 원칙 ID는 조회 오류를 알리고 편집·삭제를 제공하지 않는다",async({page})=>{
  const state=await fixtures(page);const current={...state.rows.principles[0]};await go(page,`/principles/${id(5)}?edit=1`);
  await expect(form(page)).toContainText("삭제된 자료");await expect(form(page).getByRole("button",{name:"삭제",exact:true})).toHaveCount(0);
  await expect(form(page).getByRole("textbox")).toHaveCount(0);expect(state.writes).toHaveLength(0);
  expect(state.rows.principles[0]).toEqual(current);expect(state.errors).toEqual([]);
});

for(const width of [320,640])test(`확인창 ${width}px: 긴 삭제 메모·줄어든 viewport·고정 footer`,async({page})=>{
  const state=await fixtures(page);state.rows.principles[1].body="승격될 긴 본문\n\n".repeat(300);
  await page.setViewportSize({width,height:360});await go(page,`/principles/${id(4)}?edit=1`);await form(page).getByRole("button",{name:"삭제",exact:true}).click();
  const confirm=page.locator(".delete-action.is-armed");await confirm.getByLabel("이유 (선택)").fill("긴 삭제 메모\\n".repeat(300));
  const bounds=await confirm.boundingBox();expect(bounds!.width).toBeLessThanOrEqual(width-32);expect(bounds!.height).toBeLessThanOrEqual(260);
  await confirm.locator(".delete-action-context").evaluate(el=>{el.scrollTop=el.scrollHeight;});await expect(confirm.getByRole("button",{name:"삭제 확인",exact:true})).toBeInViewport();
  await expect(confirm.getByRole("button",{name:"취소",exact:true})).toBeInViewport();expect(state.errors).toEqual([]);
});

for(const [kind,title] of [["entities","엔터티 편집"],["tasks","할 일 편집"],["records","기록 편집"],["principles","현재 원칙 편집"]])test(`${kind}: 목록 편집 닫기는 한 번에 목록·초점으로 복귀`,async({page})=>{
  const state=await fixtures(page);await go(page,`/${kind}`);if(kind==="principles")await page.getByRole("button",{name:"원칙 작업 메뉴"}).click();await (kind==="principles"?page:page.locator(".list")).getByRole("link",{name:title,exact:true}).click();
  await expect(form(page).getByRole("button",{name:"저장",exact:true})).toBeVisible();await form(page).getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page).toHaveURL(kind==="principles"?/\/principles#principles-title$/:new RegExp(`/${kind}\\?`));await expect(form(page)).toHaveCount(0);await expect(page.locator(kind==="principles"?"#principles-title":kind==="entities"?`#entity-${id(1)}`: `#activity-${kind}-${id(kind==="tasks"?2:3)}`)).toBeFocused();expect(state.errors).toEqual([]);
});

test("원칙 저장 결과는 같은 ID·확인된 본문을 보여준다",async({page})=>{
  const state=await fixtures(page);await go(page,`/principles/${id(4)}?list=%2Fprinciples`);
  await compatibleEdit(page);await form(page).getByRole("textbox",{name:"본문",exact:true}).fill("확인된 현재 원칙");
  await saveOnce(page,form(page));await expect(page).toHaveURL(new RegExp(id(4)));
  await expect(form(page)).toContainText("확인된 현재 원칙");
  expect(state.rows.principles[0].id).toBe(id(4));expect(state.writes).toHaveLength(1);expect(state.errors).toEqual([]);
});

test("엔터티 관련 작성은 URL·뒤로가기 초안 보호·reload·같은 surface 저장",async({page})=>{
  const state=await fixtures(page);await go(page,"/entities");await page.getByRole("link",{name:"엔터티",exact:true}).click();
  await form(page).getByRole("button",{name:"관련 할 일 추가",exact:true}).click();await expect(page).toHaveURL(/create=task/);await expect(form(page)).toHaveCount(1);
  await fillText(page,"연결 업무");await page.goBack();const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();
  await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("연결 업무");await saveOnce(page, form(page), "추가");
  await expect(page).not.toHaveURL(/create=/);expect(state.writes[0].body.entity_ids).toEqual([id(1)]);await expect(form(page)).toContainText("할 일을 추가했습니다.");
  await form(page).getByRole("button",{name:"기록 작성",exact:true}).click();await page.reload();await expect(form(page).getByLabel("본문")).toHaveValue("");
  expect(state.errors).toEqual([]);
});

test("반복 중단·재개 메모·결과 생성은 같은 surface",async({page})=>{
  const state=await fixtures(page);Object.assign(state.rows.tasks[0],{kind:"recurring",status:"active",timezone:"Asia/Seoul",recurrence:{freq:"daily",starts_on:"2026-10-04"}});
  await page.route("**/api/tasks/*/occurrences?**",route=>route.fulfill({json:{today:"2026-10-04",items:[]}}));
  for(const [action,status,label] of [["stop","stopped","중단"],["resume","active","재개"]]){
    await page.route("**/api/tasks/*/"+action,route=>{const body=route.request().postDataJSON();Object.assign(state.rows.tasks[0],{status,version:state.rows.tasks[0].version+1});state.writes.push({method:"POST",path:new URL(route.request().url()).pathname,body,params:new URLSearchParams()});return route.fulfill({json:state.rows.tasks[0]});});
    await go(page,`/tasks/${id(2)}`);await form(page).getByRole("button",{name:label,exact:true}).click();await expect(form(page)).toHaveCount(1);
    await expect(form(page).getByRole("button",{name:label,exact:true})).toBeVisible();
    await form(page).getByLabel("편집 메모",{exact:false}).fill(label+" 이유");await saveOnce(page,form(page),label);
    await expect(form(page).getByRole("button",{name:label==="중단"?"재개":"중단",exact:true})).toBeVisible();expect(state.writes.at(-1)?.body.change_note).toBe(label+" 이유");
  }
  Object.assign(state.rows.tasks[0],task());await go(page,`/tasks/${id(2)}`);
  await page.route("**/api/tasks/*/complete",route=>{const result={...record(40),...route.request().postDataJSON(),record_kind:"result"};state.rows.records.push(result);Object.assign(state.rows.tasks[0],{status:"done",result_record:{id:result.id,body:result.body}});return route.fulfill({json:state.rows.tasks[0]});});
  await form(page).getByRole("button",{name:"완료하고 기록",exact:true}).click();await expect(form(page).getByRole("heading",{name:"할 일 완료",exact:true})).toBeVisible();await fillText(page,"수행 결과");await form(page).getByRole("button",{name:"완료하고 기록 저장",exact:true}).click();
  await expect(form(page).getByRole("link",{name:"수행 결과",exact:true})).toBeVisible();expect(state.rows.records.at(-1)?.record_kind).toBe("result");expect(state.errors).toEqual([]);
});

const stamp="2026-10-04T03:00:00Z", id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

for(const width of [320,360,390,639,640,768,1024,1440])test(`시각 위계 ${width}px: 제목·보조 정보·편집 정렬과 검색·가이드`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const state=await fixtures(page);state.rows.tasks[0].title="긴 제목 ".repeat(8);state.rows.tasks[0].change_note="강조하지 않을 보충 메모";
  const typography=async(selector:string)=>page.locator(selector).first().evaluate(el=>{const s=getComputedStyle(el);return {size:parseFloat(s.fontSize),weight:Number(s.fontWeight),color:s.color};});
  for(const path of ["/entities","/tasks","/records","/principles","/tags/entity","/tags/activity","/search","/guide"]){
    await go(page,path);await expect(page.locator(".page-title")).toBeVisible();
    if(!["/search","/guide"].includes(path))await expect(page.locator(".item-title").first()).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path).toBe(true);
    if(await page.locator(".item-title").count()){
      const title=await typography(".item-title"),pageTitle=await typography(".page-title");expect(pageTitle.size).toBeGreaterThan(title.size);expect(title.weight).toBeGreaterThanOrEqual(600);
      if(await page.locator(".secondary").count()){const secondary=await typography(".secondary");expect(title.size).toBeGreaterThan(secondary.size);expect(title.weight).toBeGreaterThan(secondary.weight);expect(title.color).not.toBe(secondary.color);}
    }
    if(path==="/tasks"){
      const heading=page.locator(".activity-item-heading").first(),title=heading.locator(".item-title"),edit=heading.locator(".activity-item-actions a");
      const t=(await title.boundingBox())!,e=(await edit.boundingBox())!;expect(e.x).toBeGreaterThanOrEqual(t.x+t.width);expect(e.height).toBeGreaterThanOrEqual(44);expect(e.width).toBeGreaterThanOrEqual(44);
      await expect(page.locator(".memo-text")).toHaveCount(0);
    }
    if(width===390&&["/tasks","/guide","/tags/entity","/search"].includes(path))await page.screenshot({path:info.outputPath(`hierarchy-${path.slice(1).replaceAll("/","-")}-${width}.png`)});
  }
  Object.assign(state.rows.records[0],{body:"",tag_ids:[]});await go(page,`/records/${id(3)}`);
  await expect(form(page).locator(".document-summary,.markdown")).toHaveCount(0);await expect(form(page).getByRole("heading",{name:"태그",exact:true})).toHaveCount(0);await expect(form(page).getByRole("heading",{name:"기록",exact:true})).toHaveCount(1);
  await form(page).getByRole("button",{name:"편집",exact:true}).click();await expect(form(page).getByRole("textbox",{name:/^본문/})).toHaveValue("");await expect(form(page).getByRole("heading",{name:"메모",exact:true})).toHaveCount(0);
  const head=await form(page).locator(".modal-head").boundingBox(),body=await form(page).locator(":scope > .modal-inner > .modal-body").boundingBox(),foot=await form(page).locator(".modal-foot").boundingBox();expect(head!.y+head!.height).toBeLessThanOrEqual(body!.y);expect(body!.y+body!.height).toBeLessThanOrEqual(foot!.y+1);
  await go(page,`/records/${id(3)}`);Object.assign(state.rows.records[0],{record_kind:"change",body:"변경에 대한 보충 메모",entity_ids:[id(1)],entity_context:[{id:id(1),title:"연결된 엔터티",source:"selection",captured_at:stamp}]});await page.reload();
  const memo=form(page).locator(".record-content .markdown");await expect(memo).toBeVisible();expect(await memo.evaluate(el=>parseFloat(getComputedStyle(el).fontSize))).toBeLessThan(await form(page).locator(".dialog-title").evaluate(el=>parseFloat(getComputedStyle(el).fontSize)));
  const provenance=form(page).locator(".related-provenance");await expect(provenance).not.toHaveAttribute("open","");await provenance.locator("summary").click();await expect(provenance).toHaveAttribute("open","");await expect(provenance).toContainText("연결 선택 시 이름");
  expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

for(const width of [320,390,1024])test(`엔터티 연결 목록 ${width}px: 종류·본문 대표 문구·시각·행 구획과 전체 보기 위치`,async({page},info)=>{
  const state=await fixtures(page),title="memo-edd743a2-2a0c-455b-b3ad-312e05d47d4e 등록";
  Object.assign(state.rows.entities[0],{records:{count:2,items:[{id:id(3),body:"상담 판단 정리",record_kind:"user",occurred_at:stamp,updated_at:stamp},{id:id(30),body:title,record_kind:"change",occurred_at:stamp,updated_at:stamp}]}});
  await page.setViewportSize({width,height:900});await go(page,`/entities/${id(1)}`);
  const section=form(page).locator(".entity-related").filter({has:page.getByRole("heading",{name:"연결된 기록 (2개)",exact:true})}),rows=section.locator(".entity-related-item");
  await expect(rows).toHaveCount(2);await expect(rows.first()).toContainText("직접 작성");await expect(rows.first()).toContainText("상담 판단 정리");
  await expect(rows.last()).toContainText("변경 기록");await expect(rows.last().getByText(title,{exact:true})).toHaveCount(1);
  await expect(rows.locator("time")).toHaveCount(2);await expect(form(page).getByRole("link",{name:"전체 할 일 보기",exact:true})).toHaveCount(0);
  const all=section.getByRole("link",{name:"전체 기록 보기",exact:true});await expect(all).toHaveAttribute("href",`/records?entity_id=${id(1)}`);
  expect((await all.boundingBox())!.y).toBeGreaterThanOrEqual((await rows.last().boundingBox())!.y+(await rows.last().boundingBox())!.height);
  for(const row of await rows.all())expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await section.screenshot({path:info.outputPath(`entity-related-${width}.png`)});
  await rows.first().click();await expect(page).toHaveURL(new RegExp(`/records/${id(3)}$`));expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
test("연결 엔터티 범위: 각 탭 조회·검색 조건·본문 왕복·해제",async({page})=>{
  const state=await fixtures(page);for(const kind of ["tasks","records"]){state.rows[kind][0].entity_ids=[id(1)];state.rows[kind][0].entity_context=[{id:id(1),title:"엔터티",source:"selection",captured_at:stamp}];}
  state.rows.entities[0].tasks={count:1,items:[{id:id(2),title:"할 일",updated_at:stamp}]};
  const reads:{kind:string;params:URLSearchParams}[]=[];
  for(const kind of ["tasks","records"])await page.route(`**/api/${kind}?**`,route=>{const params=new URL(route.request().url()).searchParams;reads.push({kind,params});return route.fulfill({json:{items:state.rows[kind].filter(row=>!params.has("entity_id")||(row.entity_ids as string[]).includes(params.get("entity_id")!)),next_cursor:null}});});
  await go(page,`/entities/${id(1)}`);const full=form(page).getByRole("link",{name:"전체 할 일 보기",exact:true});await expect(full).toHaveAttribute("href",`/tasks?entity_id=${id(1)}`);await full.click();await expect(page.getByText("연결된 엔터티: 엔터티",{exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get("entity_id")).toBe(id(1));await expect.poll(()=>reads.length).toBe(1);expect(reads[0].kind).toBe("tasks");expect(reads[0].params.get("entity_id")).toBe(id(1));
  await page.getByRole("button",{name:"같은 이름",exact:true}).click();await page.getByLabel("검색어",{exact:true}).fill("할");await expect.poll(()=>state.searches.length).toBe(1);expect(state.searches[0].entity_id).toBe(id(1));expect(state.searches[0].tag_ids).toEqual([id(11)]);expect(state.searches[0]).not.toHaveProperty("from");
  await page.getByRole("link",{name:"할 일",exact:true}).click();await form(page).getByRole("button",{name:"닫기",exact:true}).click();await expect(page.getByText("연결된 엔터티: 엔터티",{exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get("entity_id")).toBe(id(1));
  await page.getByRole("button",{name:"엔터티 범위 해제",exact:true}).click();await expect(page).not.toHaveURL(/entity_id=/);await expect.poll(()=>state.searches.length).toBe(3);expect(state.searches.at(-1)).not.toHaveProperty("entity_id");expect(new URL(page.url()).searchParams.get("q")).toBe("할");
  await go(page,`/records?entity_id=${id(1)}&from=2026-10-01&q=기록`);await expect(page.locator(".records .list .item-title")).toBeVisible();expect(state.searches.at(-1)?.kinds).toEqual(["record"]);expect(state.searches.at(-1)?.from).toBeTruthy();expect(state.searches.at(-1)?.entity_id).toBe(id(1));expect(state.errors).toEqual([]);
});
for(const kind of ["tasks","records"] as const) test(`${kind} 보기의 연결 대상은44px 링크로 엔터티 보기를 연다`,async({page})=>{
  const state=await fixtures(page),row=state.rows[kind][0];row.entity_ids=[id(1)];row.entity_context=[{id:id(1),title:"함",source:"selection",captured_at:stamp}];
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:900});await go(page,`/${kind}/${row.id}`);
    const link=form(page).getByRole("region",{name:"연결 엔터티"}).getByRole("link",{name:"함",exact:true});const box=(await link.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
    await link.focus();await page.keyboard.press("Enter");await expect(page).toHaveURL(new RegExp(`/entities/${id(1)}$`));await expect(form(page).getByLabel("속성 1",{exact:false})).toHaveCount(0);await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeVisible();
  }expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
test("연결 범위 해제 뒤 늦은 scoped 페이지는 전체 행·cursor를 덮지 않는다",async({page})=>{
  const state=await fixtures(page);let release=()=>{},arrived=()=>{};const held=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>arrived=resolve);
  await page.route("**/api/tasks?**",async route=>{const params=new URL(route.request().url()).searchParams;if(params.has("cursor")){arrived();await held;return route.fulfill({json:{items:[{...task(60),title:"오래된 범위 추가"}],next_cursor:null}}).catch(()=>{});}return route.fulfill({json:{items:params.has("entity_id")?Array.from({length:20},(_,i)=>({...task(100+i),title:`연결 업무 ${i}`})):[{...task(),title:"전체 업무"}],next_cursor:params.has("entity_id")?"next":null}});});
  await go(page,`/tasks?entity_id=${id(1)}`);await page.locator(".tasks").getByRole("button",{name:"할 일 더 보기",exact:true}).click();await started;await page.getByRole("button",{name:"엔터티 범위 해제",exact:true}).click();await expect(page.locator(".tasks .item-title")).toHaveText(["전체 업무"]);release();await expect(page.locator(".tasks .item-title")).toHaveText(["전체 업무"]);await expect(page.locator(".tasks").getByText("오래된 범위 추가",{exact:true})).toHaveCount(0);await expect(page).not.toHaveURL(/entity_id=|tasks_pages=/);expect(state.errors).toEqual([]);
});
for(const scope of ["invalid",id(99)])test(`연결 범위 ${scope}: owner 조회 실패·URL 이름 불신·명시 해제`,async({page})=>{
  const state=await fixtures(page);let reads=0;await page.route("**/api/entities/*",route=>{reads++;return route.fulfill({status:404,json:{code:"not_found",message:"항목을 찾을 수 없습니다"}});});await go(page,`/tasks?entity_id=${scope}&entity_name=믿지않을이름`);await expect(page.getByText(scope==="invalid"?"엔터티 범위 ID가 올바르지 않습니다.":"연결된 엔터티를 조회할 수 없습니다.",{exact:true})).toBeVisible();expect(reads).toBe(scope==="invalid"?0:1);await expect(page.getByText("연결된 엔터티: 믿지않을이름",{exact:true})).toHaveCount(0);expect(new URL(page.url()).searchParams.get("entity_id")).toBe(scope);await page.getByRole("button",{name:"엔터티 범위 해제",exact:true}).click();await expect(page).not.toHaveURL(/entity_id=/);expect(state.errors).toEqual([]);
});
for(const width of [390,1440])for(const [kind,n] of [["tasks",2],["records",3],["principles",4]] as const)test(`문서 viewer ${kind} ${width}px: 정보 구획·편집과 안전한 markdown`,async({page},info)=>{
  const state=await fixtures(page),item=state.rows[kind][0];item.tag_ids=[id(11)];item.body="검증 **본문**\n\n[위험 링크](javascript:alert(1))\n\n<img src=x onerror=alert(1)>\n\n![외부](https://example.invalid/never-load.png)\n\n- [x] 읽기 확인\n\n~~취소선~~\n\nhttps://example.com";
  const images:string[]=[];page.on("request",r=>{if(r.url().includes("never-load.png"))images.push(r.url());});await page.setViewportSize({width,height:800});await go(page,`/${kind}/${id(n)}`);
  await expect(form(page).getByRole("heading",{name:kind==="records"?"기록":item.title,exact:true})).toBeVisible();await expect(form(page).locator(".markdown strong")).toHaveText("본문");
  await expect(form(page).locator(".document-summary")).toHaveCount(0);await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeVisible();
  await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeVisible();await expect(form(page).getByRole("button",{name:"닫기",exact:true})).toBeVisible();await expect(form(page).locator(".panel,img,script,a[href^='javascript:']")).toHaveCount(0);
  await expect(form(page).getByRole("link",{name:"이미지: 외부",exact:true})).toHaveAttribute("rel","noopener noreferrer nofollow");await expect(form(page).getByRole("checkbox")).toBeDisabled();await expect(form(page).getByRole("checkbox")).toBeChecked();await expect(form(page).locator("del")).toHaveText("취소선");expect(images).toEqual([]);expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);await page.screenshot({path:info.outputPath(`viewer-${kind}-${width}.png`)});
});
for(const width of [390,1440])test(`기록 편집 POP 재조회 실패 ${width}px: 원문·업무·실패와 재시도 복원`,async({page})=>{
  const state=await fixtures(page);await page.setViewportSize({width,height:900});let failed=false,reads=0;
  await page.route(`**/api/records/${id(3)}`,route=>{reads++;return failed?route.fulfill({status:503,json:{code:"internal",message:"reload failed"}}):route.fulfill({json:state.rows.records[0]});});
  await go(page,`/records/${id(3)}`);await expect(form(page).locator(".markdown")).toBeVisible();failed=true;
  await page.evaluate(()=>{history.pushState({...history.state,idx:(history.state?.idx??0)+1},"",location.pathname+"?edit=1&edit_from=view");dispatchEvent(new PopStateEvent("popstate",{state:history.state}));});
  await expect(form(page).getByRole("alert")).toHaveText("기록을 불러오지 못했습니다.");await expect(form(page).locator(".markdown")).toBeVisible();await expect(form(page).getByRole("button",{name:"조회 다시 시도",exact:true})).toBeVisible();await expect(form(page).getByRole("button",{name:"저장",exact:true})).toHaveCount(0);await expect(page).toHaveURL(/edit=1/);expect(reads).toBe(2);expect(state.writes).toHaveLength(0);
  failed=false;state.rows.records[0].body="새 서버 원문";state.rows.records[0].version=2;await form(page).getByRole("button",{name:"조회 다시 시도",exact:true}).click();await expect(form(page).getByRole("alert")).toHaveCount(0);await expect(form(page).getByLabel("본문")).toHaveValue("새 서버 원문");await expect(form(page).getByRole("button",{name:"삭제",exact:true})).toBeVisible();expect(reads).toBe(3);
  await form(page).getByRole("button",{name:"닫기",exact:true}).click();await expect(page).not.toHaveURL(/edit=1/);await expect(form(page).locator(".markdown")).toHaveText("새 서버 원문");await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeVisible();expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
for(const width of [390,1440])test(`기능/목록 구획 ${width}px: 엔터티 편집만·독립 구획·할 일 여백`,async({page},info)=>{
  const state=await fixtures(page);await page.setViewportSize({width,height:900});await go(page,"/entities");
  await page.screenshot({path:info.outputPath(`tab-entities-${width}.png`)});
  const top=page.locator(".app-main > .panel"),bottom=page.getByRole("region",{name:"엔터티 목록",exact:true});expect((await bottom.boundingBox())!.y).toBeGreaterThanOrEqual((await top.boundingBox())!.y+(await top.boundingBox())!.height);
  const inset=width<640?16:24,topBox=(await top.boundingBox())!,listBox=(await bottom.locator(".list.panel").boundingBox())!;
  expect((await top.getByRole("heading",{name:"엔터티",exact:true}).boundingBox())!.x-topBox.x).toBeGreaterThanOrEqual(inset);expect((await top.getByLabel("속성 1 키워드",{exact:false}).boundingBox())!.x-topBox.x).toBeGreaterThanOrEqual(inset);expect((await bottom.locator(".item-title").first().boundingBox())!.x-listBox.x).toBeGreaterThanOrEqual(inset);
  await expect(bottom.getByRole("link",{name:"엔터티 보기",exact:true})).toHaveCount(0);await bottom.getByRole("link",{name:"엔터티 편집",exact:true}).click();await expect(form(page).getByLabel("속성 1",{exact:false})).toHaveValue("엔터티");await expect(form(page).getByRole("button",{name:"관련 할 일 추가",exact:true})).toHaveCount(0);await expect(form(page).getByRole("link",{name:/목록/})).toHaveCount(0);await expect(form(page).getByRole("button",{name:"취소",exact:true})).toHaveCount(0);await form(page).getByRole("button",{name:"닫기",exact:true}).click();await expect(page.locator(`#entity-${id(1)}`)).toBeFocused();
  await go(page,"/principles");const current=page.getByRole("region",{name:"현재 원칙",exact:true});expect((await current.boundingBox())!.y).toBeGreaterThanOrEqual((await top.boundingBox())!.y+(await top.boundingBox())!.height);await expect(top.getByRole("link",{name:"과거 근거는 통합 기록에서 보기"})).toHaveAttribute("href","/records");await expect(top.getByLabel("검색어",{exact:true})).toHaveCount(0);await expect(top.locator(".current-document,.record-date-group")).toHaveCount(0);await page.screenshot({path:info.outputPath(`principles-sections-${width}.png`)});
  await go(page,"/tasks");expect(await page.locator(".tasks-list > .list-item").first().evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(12);await page.screenshot({path:info.outputPath(`tab-activity-${width}.png`)});await page.getByRole("link",{name:"할 일 편집",exact:true}).click();await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("할 일");await page.screenshot({path:info.outputPath(`edit-task-${width}.png`)});const head=form(page).locator(".modal-head"),body=form(page).locator(":scope > .modal-inner > .modal-body");expect(await head.evaluate(el=>getComputedStyle(el).paddingLeft)).toBe(width<640?"16px":"24px");expect(await body.evaluate(el=>getComputedStyle(el).paddingLeft)).toBe(width<640?"16px":"24px");expect(state.errors).toEqual([]);
});
for(const width of [390,1440])test(`숨긴 scrollbar ${width}px: wheel·PageDown·긴 코드 가로 스크롤`,async({page},info)=>{
  const state=await fixtures(page,{long:true});state.rows.tasks[0].body="```text\n"+"long_unbroken_code_".repeat(100)+"\n```\n\n"+"긴 본문 문단\n\n".repeat(200);await page.setViewportSize({width,height:800});await go(page,`/tasks/${id(2)}`);
  const body=form(page).locator(":scope > .modal-inner > .modal-body"),code=form(page).locator("pre");await expect(code).toBeVisible();expect(await body.evaluate(el=>getComputedStyle(el).scrollbarWidth)).toBe("none");expect(await code.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);
  await code.hover();await page.mouse.wheel(240,0);await expect.poll(()=>code.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);await body.hover();await page.mouse.wheel(0,400);await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBeGreaterThan(0);const before=await body.evaluate(el=>el.scrollTop);await body.focus();await page.keyboard.press("PageDown");await expect.poll(()=>body.evaluate(el=>el.scrollTop)).toBeGreaterThan(before);
  await expect(form(page).getByRole("button",{name:"닫기",exact:true})).toBeInViewport();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`scroll-${width}.png`)});await page.keyboard.press("Escape");await expect(form(page)).toHaveCount(0);expect(state.errors).toEqual([]);
});
const base=(n:number,title:string)=>({id:id(n),title,body:"상세 본문",version:1,created_at:stamp,updated_at:stamp});
test("할 일 보기에서 완료, 편집 초안은 닫기 확인으로 보호",async({page})=>{
  const state=await fixtures(page);await go(page,"/tasks");await page.getByRole("link",{name:"할 일",exact:true}).click();
  await form(page).getByRole("button",{name:"완료하고 기록",exact:true}).click();await expect(form(page).getByRole("heading",{name:"할 일 완료",exact:true})).toBeVisible();await form(page).getByRole("button",{name:"닫기",exact:true}).click();await expect(page).not.toHaveURL(/action=/);
  await form(page).getByRole("button",{name:"편집",exact:true}).click();await form(page).getByLabel("본문").fill("보존할 초안");await expect(form(page).getByRole("button",{name:"완료하고 기록",exact:true})).toHaveCount(0);
  await form(page).getByRole("button",{name:"닫기",exact:true}).click();const discard=page.getByRole("dialog",{name:"변경을 버릴까요?",exact:true});await discard.getByRole("button",{name:"취소",exact:true}).click();await expect(form(page).getByLabel("본문")).toHaveValue("보존할 초안");
  await form(page).getByRole("button",{name:"닫기",exact:true}).click();await discard.getByRole("button",{name:"변경 버리기",exact:true}).click();await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeFocused();await form(page).getByRole("button",{name:"닫기",exact:true}).click();await expect(page.locator(`#activity-tasks-${id(2)}`)).toBeFocused();expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
for(const width of [390,1440])test(`긴 GFM 표 ${width}px: 표 안 가로 스크롤·안전 체크리스트`,async({page},info)=>{
  const state=await fixtures(page),cells=Array.from({length:40},(_,i)=>`열${i} 긴값`),row="|"+cells.join("|")+"|";state.rows.records[0].body=row+"\n|"+cells.map(()=>"---").join("|")+"|\n"+row+"\n\n- [ ] 읽기 항목\n\n"+"아래 본문\n\n".repeat(30);await page.setViewportSize({width,height:800});await go(page,`/records/${id(3)}`);const table=form(page).getByRole("table");await expect(table).toBeVisible();await expect(table.getByRole("columnheader")).toHaveCount(40);expect(await table.evaluate(el=>el.scrollWidth>el.clientWidth)).toBe(true);expect(await table.evaluate(el=>getComputedStyle(el).scrollbarWidth)).toBe("none");await table.hover();await page.mouse.wheel(300,0);await expect.poll(()=>table.evaluate(el=>el.scrollLeft)).toBeGreaterThan(0);await expect(form(page).getByRole("checkbox")).toBeDisabled();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`table-${width}.png`)});expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
const entity=(n=1)=>({...base(n,"엔터티"),prop1:"엔터티",prop2:0,prop3:null,prop4:"a",tag_ids:[],tasks:{count:0,items:[]},records:{count:0,items:[]},});
const task=(n=2)=>({...base(n,"할 일"),kind:"once",status:"open",due_on:null,recurrence:null,timezone:null,result_record:null,completed_at:null,result_record_id:null,pauses:[],tag_ids:[],entity_ids:[],entity_context:[],occurrence:null});
const record=(n=3)=>({id:id(n),body:"기록",version:1,created_at:stamp,updated_at:stamp,record_kind:"user",change:null,occurred_at:stamp,task_id:null,occurrence_on:null,tag_ids:[],entity_ids:[],entity_context:[],applied_principle_snapshots:[]});
const principle=(n=4,current=true)=>({...base(n,current?"현재 기준":"과거 기준"),is_current:current,saved_at:stamp,origin:"saved",legacy_context:null});
type Row={id:string;version:number;body:string;created_at:string;updated_at:string;title?:string}&Record<string,unknown>;
async function fixtures(page:Page, options:{long?:boolean;emptyPrinciple?:boolean;failWrite?:"unknown"|"conflict";hold?:boolean}={}) {
  const rows:Record<string,Row[]>={entities:[entity()],tasks:[task()],records:[record()],principles:options.emptyPrinciple?[]:[principle(),principle(5,false)],tags:[{...base(10,""),name:"같은 이름",scope:"entity"},{...base(11,""),name:"같은 이름",scope:"activity"}]};
  if(options.long){for(const kind of ["entities","tasks","records","principles"]){if(kind!=="records")rows[kind][0].title="긴제목".repeat(32);rows[kind][0].prop1="긴제목".repeat(25);rows[kind][0].body="긴 본문\n\n".repeat(150);}}
  const writes:{method:string;path:string;body:Record<string,unknown>;params:URLSearchParams}[]=[],searches:Record<string,unknown>[]=[],errors:string[]=[];
  let sequence=20, failed=false,release=()=>{},started=()=>{};
  const pending=new Promise<void>(r=>{started=r;});
  page.on("pageerror",e=>errors.push(e.message));page.on("console",e=>{if(/one blocker|Maximum update depth/.test(e.text()))errors.push(e.text());});
  await page.route("http://127.0.0.1:55580/**",async route=>{if(route.request().isNavigationRequest()){const response=await route.fetch({url:"http://127.0.0.1:55580/e2e/fixtures/workspace-screens.html"});await route.fulfill({response});}else await route.continue();});
  await page.route("http://127.0.0.1:55581/api/**",async route=>{
    const req=route.request(),url=new URL(req.url()),parts=url.pathname.replace("/api/","").split("/"),[kind,key,action]=parts,method=req.method();
    const body=(req.postDataJSON()??{}) as Record<string,unknown>;
    const reply=(data:unknown,status=200)=>route.fulfill({status,json:data});
    if(kind==="search"){searches.push(body);const selected=String((body.kinds as string[])[0])+"s";return reply({items:(rows[selected]??[]).filter(r=>selected!=="principles"||r.is_current).map(r=>({id:r.id,kind:selected.slice(0,-1),title:selected==="records"?recordDisplayText(r.body):r.title,snippet:r.body,snippet_start:0,snippet_end:Array.from(r.body).length,at:stamp,tag_ids:r.tag_ids??[],path:`/${selected}/${r.id}`,match:"keyword",index_state:"pending"})),next_cursor:null,anchor_page:null,search_state:body.mode==="auto"?"keyword_fallback":"ok",semantic_coverage:{pending:1,excluded:0}});}
    if(!rows[kind])return reply({code:"invalid_input",message:`Unexpected fixture endpoint ${url.pathname}`},400);
    if(method==="GET") {
      if(kind==="principles"&&key==="current")return reply({current:rows.principles.find(r=>r.is_current)??null});
      if(key){const found=rows[kind].find(r=>r.id===key&&(kind!=="principles"||r.is_current));return found?reply(found):reply({code:"not_found",message:"삭제된 자료"},404);}
      let items=rows[kind];if(kind==="tags")items=items.filter(r=>r.scope===(url.searchParams.get("scope")??"activity"));
      if(kind==="principles")return reply({code:"not_found",message:"지원하지 않는 원칙 목록"},404);
      if(kind==="records"&&url.searchParams.get("record_kind"))items=items.filter(r=>r.record_kind===url.searchParams.get("record_kind"));
      return reply({items,next_cursor:null});
    }
    writes.push({method,path:url.pathname,body,params:url.searchParams});
    if(options.hold){started();await new Promise<void>(r=>{release=r;});options.hold=false;}
    if(options.failWrite&&!failed){failed=true;return options.failWrite==="unknown"?route.abort("connectionreset"):reply({code:"conflict",message:"다른 곳에서 수정했습니다."},409);}
    if(method==="DELETE"||action==="delete"){rows[kind]=rows[kind].filter(r=>r.id!==key);return route.fulfill({status:204});}
    if(kind==="principles"&&method==="POST"&&!key){
      const current=rows.principles.find(r=>r.is_current);if(current)return reply({code:"conflict",message:"현재 원칙이 있습니다"},409);const saved={...principle(sequence++),...body};rows.principles.unshift(saved);return reply(saved,201);
    }
    if(method==="POST"&&!key){const saved={...(kind==="entities"?entity(sequence++):kind==="tasks"?task(sequence++):kind==="records"?record(sequence++):base(sequence++,"")),...body};rows[kind].unshift(saved);return reply(saved,201);}
    const found=rows[kind].find(r=>r.id===key);if(!found)return reply({code:"not_found",message:"자료 없음"},404);
    Object.assign(found,body,{version:found.version+1});return reply(found);
  });
  return {rows,writes,searches,errors,pending,release:()=>release()};
}
const go=async(page:Page,path:string)=>page.goto(path);
const form=(page:Page)=>page.locator("dialog.modal:not(.modal-confirm)[open]");
for (const width of [320, 1440]) test(`상세 탐색 ${width}px: 한 surface·다단계 이전·편집·닫기 history`, async ({page}, info) => {
  const state = await fixtures(page);
  Object.assign(state.rows.entities[0], { tasks: { count: 1, items: [task()] } });
  Object.assign(state.rows.tasks[0], { status: "done", body:"긴 업무 내용\n\n".repeat(40), result_record: { id: id(3), body: "결과 문서" } });
  Object.assign(state.rows.records[0], { entity_ids: [id(1)], entity_context: [{id:id(1),title:"연결 엔터티",source:"selection",captured_at:stamp}] });
  await page.setViewportSize({width,height:800});
  await go(page, "/entities");
  await page.getByRole("link", {name:"엔터티",exact:true}).click();
  await expect(form(page).getByRole("button", {name:/^이전:/})).toHaveCount(0);
  await form(page).getByRole("link", {name:"할 일",exact:true}).click();
  await expect(form(page)).toHaveCount(1);
  await form(page).getByRole("link", {name:"결과 문서",exact:true}).scrollIntoViewIfNeeded();
  const taskScroll=await form(page).locator(".modal-body").evaluate(element=>element.scrollTop);
  await form(page).getByRole("link", {name:"결과 문서",exact:true}).click();
  await expect(form(page)).toHaveCount(1);
  await expect(form(page).getByRole("heading",{name:"기록",exact:true})).toBeVisible();
  await page.reload();
  await form(page).getByRole("button", {name:"편집",exact:true}).click();
  await expect(form(page).getByRole("button", {name:/^이전:/})).toHaveCount(0);
  await form(page).getByLabel("본문",{exact:false}).fill("미저장 수정");
  await page.goBack();
  const discard=page.getByRole("dialog",{name:"변경을 버릴까요?"});
  await discard.getByRole("button",{name:"취소",exact:true}).click();
  await expect(form(page).getByLabel("본문",{exact:false})).toHaveValue("미저장 수정");
  await form(page).getByRole("button", {name:"닫기",exact:true}).click();
  await discard.getByRole("button",{name:"변경 버리기",exact:true}).click();
  await expect(form(page).getByRole("button", {name:/^이전: 할 일/})).toBeVisible();
  await page.screenshot({path:info.outputPath(`detail-navigation-${width}.png`)});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await form(page).getByRole("button", {name:/^이전: 할 일/}).click();
  await expect(form(page).getByRole("link", {name:"결과 문서",exact:true})).toBeFocused();
  await expect.poll(()=>form(page).locator(".modal-body").evaluate(element=>element.scrollTop)).toBe(taskScroll);
  await page.goBack();
  await expect(form(page).getByRole("link", {name:"할 일",exact:true})).toBeFocused();
  await page.goForward();
  await form(page).getByRole("link", {name:"결과 문서",exact:true}).click();
  await expect(form(page).getByRole("heading", {name:"기록",exact:true})).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/records$/);
  await expect(form(page)).toHaveCount(0);
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`/tasks/${id(2)}$`));
  expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
test("상세 탐색: 같은 대상의 두 링크는 실제 진입한 링크로 복귀",async({page})=>{
  const state=await fixtures(page);
  Object.assign(state.rows.records[0],{record_kind:"change",entity_ids:[id(1)],entity_context:[{id:id(1),title:"연결 제목",source:"selection",captured_at:stamp}],change:{event_id:id(30),target_kind:"entity",target_id:id(1),target_title:"당시 엔터티",action:"update",source:"web",before:{prop2:0},after:{prop2:1},path:`/entities/${id(1)}`}});
  await go(page,`/records/${id(3)}`);
  await expect(form(page).getByRole("link",{name:"대상 원문 보기",exact:true})).toBeVisible();
  await form(page).getByRole("link",{name:"연결 제목",exact:true}).click();
  await form(page).getByRole("button",{name:/^이전: 기록/}).click();
  await expect(form(page).getByRole("link",{name:"연결 제목",exact:true})).toBeFocused();
  expect(state.errors).toEqual([]);
});
test("상세 탐색: 계정 전환 뒤 이전 계정의 history를 무시",async({page})=>{
  const state=await fixtures(page);
  Object.assign(state.rows.entities[0],{records:{count:1,items:[record()]}});
  Object.assign(state.rows.records[0],{entity_ids:[id(1)],entity_context:[{id:id(1),title:"연결 제목",source:"selection",captured_at:stamp}]});
  await go(page,`/entities/${id(1)}`);
  await form(page).getByRole("link",{name:"기록",exact:true}).click();
  await form(page).getByRole("link",{name:"연결 제목",exact:true}).click();
  await form(page).getByRole("button",{name:"닫기",exact:true}).click();
  await page.getByRole("button",{name:"계정 전환 fixture",exact:true}).click();
  await page.goBack();
  await expect(form(page).getByRole("heading",{name:"기록",exact:true})).toBeVisible();
  await expect(form(page).getByRole("button",{name:/^이전:/})).toHaveCount(0);
  expect(state.errors).toEqual([]);
});
test("상세 탐색: 다른 상세를 거친 닫기도 원래 소유 목록 조건 복원",async({page})=>{
  const state=await fixtures(page);
  Object.assign(state.rows.records[0],{task_id:id(2)});
  state.rows.records.push({...record(31),body:"다음 기록"});
  Object.assign(state.rows.tasks[0],{status:"done",result_record:{id:id(31),body:"다음 기록"}});
  await go(page,"/records?record_kind=user");
  await page.getByRole("link",{name:"기록",exact:true}).click();
  await form(page).getByRole("link",{name:"결과로 연결된 할 일",exact:true}).click();
  await form(page).getByRole("link",{name:"다음 기록",exact:true}).click();
  await expect(form(page).getByRole("heading",{name:"기록",exact:true})).toBeVisible();
  await form(page).getByRole("button",{name:"닫기",exact:true}).click();
  expect(new URL(page.url()).searchParams.get("record_kind")).toBe("user");
  await expect(page.locator(`#activity-records-${id(3)}`)).toBeFocused();
  expect(state.errors).toEqual([]);
});
test("상세 탐색 검색: 동시 추가 뒤 깊은 anchor와 reload 초점 복원",async({page})=>{
  const state=await fixtures(page);
  state.rows.records=Array.from({length:45},(_,index)=>({...record(100+index),body:`검색 기록 ${index}`}));
  await page.route("**/api/search",route=>{
    const input=route.request().postDataJSON(),start=Number(input.cursor??0),items=state.rows.records.slice(start,start+20);
    const anchor=input.anchor?state.rows.records.findIndex(row=>row.id===input.anchor.id):-1;
    return route.fulfill({json:{items:items.map(row=>({id:row.id,kind:"record",title:recordDisplayText(row.body),snippet:row.body,snippet_start:0,snippet_end:Array.from(row.body).length,at:stamp,path:`/records/${row.id}`,match:"keyword",index_state:"pending"})),next_cursor:start+20<state.rows.records.length?String(start+20):null,anchor_page:anchor<0?null:Math.floor(anchor/20)+1,search_state:"ok",semantic_coverage:{pending:0,excluded:0}}});
  });
  await go(page,"/search?q=자료&kind=record");
  await page.getByRole("button",{name:"더 보기",exact:true}).click();
  const target=page.getByRole("link",{name:"검색 기록 35",exact:true});
  await target.click();await expect(form(page).getByRole("heading",{name:"기록",exact:true})).toBeVisible();
  state.rows.records.unshift(...Array.from({length:21},(_,index)=>({...record(200+index),body:`새 검색 기록 ${index}`})));
  await form(page).getByRole("button",{name:/^이전: 검색/}).click();
  await expect(target).toBeFocused();await expect(target).toBeInViewport();
  await expect(page.locator(".list .item-title")).toHaveCount(60);
  await page.reload();await expect(target).toBeFocused();await expect(target).toBeInViewport();
  expect(state.errors).toEqual([]);
});
for (const [kind,label] of [["tasks","할 일"],["records","기록"],["principles","현재 기준"]]) test(`상세 탐색 검색 ${kind}: 이전은 검색·닫기는 소유 목록·직접 링크`,async({page})=>{
  const state=await fixtures(page);
  await go(page,`/search?q=자료&kind=${kind.slice(0,-1)}`);
  await page.getByRole("link",{name:label,exact:true}).click();
  await form(page).getByRole("button",{name:/^이전: 검색/}).click();
  await expect(page).toHaveURL(/\/search\?/);
  await expect(page.getByRole("link",{name:label,exact:true})).toBeFocused();
  await page.getByRole("link",{name:label,exact:true}).click();
  await form(page).getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/${kind}$`));
  await go(page,`/${kind}/${state.rows[kind][0].id}`);
  await expect(form(page)).toHaveCount(1);
  await expect(form(page).getByRole("button",{name:/^이전:/})).toHaveCount(0);
  expect(state.errors).toEqual([]);
});
for(const [kind,title] of [["entities","엔터티"],["tasks","할 일"],["records","기록"]] as const)test(`${kind}: 제목은 보기, 편집 저장은 보기와 목록 초점으로 복귀`,async({page},info)=>{
  const state=await fixtures(page);await go(page,`/${kind}`);
  await expect(page.getByRole("link",{name:`${title} 보기`,exact:true})).toHaveCount(0);
  await page.getByRole("link",{name:title,exact:true}).click();await expect(form(page).getByRole("textbox")).toHaveCount(0);expect(state.writes).toHaveLength(0);
  await page.screenshot({path:info.outputPath(`${kind}-read.png`)});
  await form(page).getByRole("button",{name:"편집",exact:true}).click();
  const footer=form(page).locator(".modal-foot");await expect(footer.getByRole("button",{name:"삭제",exact:true})).toBeVisible();
  await expect(form(page).locator(".modal-body").getByRole("button",{name:"삭제",exact:true})).toHaveCount(0);
  await form(page).getByLabel(kind==="entities"?"속성 1":kind==="records"?"본문":"제목",{exact:false}).fill("수정한 제목");
  await page.screenshot({path:info.outputPath(`${kind}-edit.png`)});await saveOnce(page,form(page));
  await expect(form(page).getByRole("heading",{name:kind==="records"?"기록":"수정한 제목",exact:true})).toBeVisible();await expect(form(page).getByRole("textbox")).toHaveCount(0);
  await form(page).getByRole("button",{name:"닫기",exact:true}).click();await expect(page.getByRole("link",{name:"수정한 제목",exact:true})).toBeFocused();
  expect(state.writes.filter(w=>w.method==="PATCH")).toHaveLength(1);expect(state.errors).toEqual([]);
});
/** Existing edit_from=view deep links remain compatible; normal UI uses list edit actions. */
async function compatibleEdit(page:Page) {const next=new URL(page.url());next.searchParams.set("edit","1");next.searchParams.set("edit_from","view");await page.goto(next.toString());await expect(form(page).getByRole("button",{name:/^저장$/})).toBeVisible();}
async function fillText(page:Page,title="새 자료") {await expect(form(page).locator("form")).toBeVisible();const input=form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/});if(await input.count())await input.fill(title);await form(page).getByRole("textbox",{name:/^본문(?: \(필수\))?$/}).fill(title);}

for(const [kind,label] of [["entities","엔터티"],["tasks","할 일"],["records","기록"]]) {
  test(`${kind}: 생성·보기·편집 메모·태그·삭제 이유`,async({page})=>{
    const state=await fixtures(page);await go(page,`/${kind}`);await beginTabAction(page,kind==="records"?"기록 작성":`${label} 추가`);
    if(kind==="entities")await form(page).getByLabel("속성 1",{exact:false}).fill("새 엔터티");else await fillText(page,`새 ${label}`);
    await form(page).getByRole("button",{name:"같은 이름",exact:true}).click();await saveOnce(page, form(page), kind==="tasks"?"추가":"저장");
    await expect(page).toHaveURL(new RegExp(`/${kind}/`));await expect(form(page)).toHaveCount(1);const createdPath=new URL(page.url()).pathname;
    await compatibleEdit(page);await expect(form(page)).toHaveCount(1);
    await expect(form(page).getByRole("button",{name:"저장",exact:true})).toBeVisible();
    await form(page).getByLabel(kind==="records"?"본문":"편집 메모",{exact:false}).fill("실측 결과 반영");
    if(kind==="entities")await form(page).getByLabel("속성 2",{exact:false}).fill("20");else await form(page).getByRole("textbox",{name:/^본문(?: \(필수\))?$/}).fill("편집한 본문");
    await saveOnce(page, form(page));if(kind==="entities")await go(page,createdPath+"?edit=1");else await compatibleEdit(page);await expect(form(page).getByRole("button",{name:"삭제",exact:true})).toBeVisible();
    const patch=state.writes.find(w=>w.method==="PATCH")!;if(kind==="records"){expect(patch.body).not.toHaveProperty("change_note");expect(patch.body.body).toBe("편집한 본문");}else expect(patch.body.change_note).toBe("실측 결과 반영");expect(patch.body.expected_version).toBe(1);expect(patch.body.tag_ids).toEqual([id(kind==="entities"?10:11)]);
    await form(page).getByRole("button",{name:"삭제",exact:true}).click();const confirm=page.locator(".delete-action.is-armed");if(kind!=="records")await confirm.getByLabel("이유 (선택)").fill("중복 자료 정리");await saveOnce(page,confirm,"삭제 확인");
    await expect(page).toHaveURL(`http://127.0.0.1:55580/${kind}${kind==="entities"?`#entity-${createdPath.split("/").at(-1)}`:""}`);if(kind==="records")expect(state.writes.at(-1)?.params.has("change_note")).toBe(false);else expect(state.writes.at(-1)?.body.change_note).toBe("중복 자료 정리");expect(state.errors).toEqual([]);
  });
}
test("원칙: 최초 등록·같은 ID 편집·삭제 뒤 없음·기록으로 과거 근거 조회",async({page})=>{
  const state=await fixtures(page,{emptyPrinciple:true});await go(page,"/principles");await beginTabAction(page,"현재 원칙 등록");await fillText(page,"첫 기준");await saveOnce(page,form(page));
  await expect.poll(()=>state.rows.principles.length).toBe(1);const first=state.rows.principles[0].id;await expect(page).toHaveURL(new RegExp(`/principles/${first}`));
  await compatibleEdit(page);await form(page).getByRole("textbox",{name:"본문",exact:true}).fill("둘째 정책");await saveOnce(page,form(page));
  await expect(page).toHaveURL(new RegExp(first));expect(state.rows.principles.filter(p=>p.is_current)).toHaveLength(1);
  await compatibleEdit(page);await form(page).getByRole("button",{name:"삭제",exact:true}).click();
  const confirm=page.locator(".delete-action.is-armed");await expect(confirm).toContainText("과거 원칙을 자동 승격하지 않습니다");
  await saveOnce(page,confirm,"삭제 확인");await page.getByRole("button",{name:"원칙 작업 메뉴"}).click();await expect(page.getByRole("button",{name:"원칙 작성"})).toBeVisible();
  await expect(page.getByRole("link",{name:"과거 근거는 통합 기록에서 보기"})).toHaveAttribute("href","/records");expect(state.errors).toEqual([]);
});

for (const condition of ["status=inactive", "principle_view=all"]) test(`검색: 폐기된 ${condition} 링크는 오류를 알리고 명시적 해제 후 현재 원칙만 찾는다`,async({page})=>{
  const state=await fixtures(page);
  await go(page,`/search?q=기준&kind=principle&${condition}`);
  await expect(page.getByRole("button",{name:"지원하지 않는 검색 조건 지우기",exact:true})).toBeVisible();
  expect(state.searches).toHaveLength(0);
  await expect(page.getByLabel("원칙 범위")).toHaveCount(0);
  await page.getByRole("button",{name:"지원하지 않는 검색 조건 지우기",exact:true}).click();
  await expect.poll(()=>state.searches.length).toBe(1);
  expect(state.searches[0]).not.toHaveProperty("status");
  expect(state.searches[0]).not.toHaveProperty("principle_view");
  await expect(page.locator(".list .item-title")).toHaveText(["현재 기준"]);
  expect(new URL(page.url()).searchParams.get("q")).toBe("기준");
  expect(state.errors).toEqual([]);
});

test("새 기록은 원칙 연관키 선택 없이 본문 근거를 저장한다",async({page})=>{
  const state=await fixtures(page);await go(page,"/records?create=1");await fillText(page,"독립 기록");
  await expect(form(page).getByText("적용한 원칙",{exact:true})).toHaveCount(0);
  await saveOnce(page,form(page));expect(state.writes[0].body).not.toHaveProperty("applied_principle_ids");
  expect(state.errors).toEqual([]);
});
for (const capture of ["application","migration"] as const) test(`기록: ${capture} 과거 원칙의 설명 정정은 snapshot 보존`, async ({page}) => {
  const state = await fixtures(page), r = state.rows.records[0];
  Object.assign(r, {applied_principle_snapshots:[
    {id:id(4),title:"당시 기준",body:"보존할 당시 본문",summary:"당시 요약",version:1,saved_at:stamp,captured_at:capture,status:"active"}
  ]});
  await page.route("**/api/records/"+r.id, async route => {
    if(route.request().method() !== "PATCH") return route.fallback();
    const body = route.request().postDataJSON();
    state.writes.push({method:"PATCH",path:new URL(route.request().url()).pathname,body,params:new URLSearchParams()});
    if(Object.hasOwn(body,"applied_principle_ids")) return route.fulfill({status:400,json:{code:"invalid_input",message:"지원하지 않는 기록 입력"}});
    Object.assign(r,body,{version:r.version+1});await route.fulfill({json:r});
  });
  await go(page,`/records/${r.id}?edit=1&edit_from=view`);await expect(form(page)).toContainText("보존할 당시 본문");
  await compatibleEdit(page);
  await expect(form(page).getByText("적용한 원칙",{exact:true})).toHaveCount(0);
  await form(page).getByRole("textbox",{name:/^본문(?: \(필수\))?$/}).fill("설명 정정");
  await expect(form(page).getByLabel("편집 메모",{exact:false})).toHaveCount(0);
  await saveOnce(page, form(page));
  await expect.poll(()=>r.version).toBe(2);await expect(page).not.toHaveURL(/[?&]edit=/);await expect(form(page).getByRole("heading",{name:"기록",exact:true})).toBeVisible();await compatibleEdit(page);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].body).not.toHaveProperty("applied_principle_ids");
  await expect(form(page)).toContainText("보존할 당시 본문");
  expect(state.errors).toEqual([]);
});

test("기록: 자동 변경 문맥·원칙 snapshot·정정 시스템 필드 제외",async({page})=>{
  const state=await fixtures(page);const r=state.rows.records[0];Object.assign(r,{record_kind:"change",body:"실측 반영",change:{event_id:id(30),target_kind:"entity",target_id:id(99),target_title:"삭제된 엔터티",action:"delete",source:"mcp",before:{prop2:10},after:null,path:null},applied_principle_snapshots:[{id:id(4),version:1,status:"active",title:"당시 기준",body:"당시 본문",saved_at:stamp,summary:"당시 요약",captured_at:"migration"}]});
  await go(page,`/records/${r.id}?edit=1&edit_from=view`);await expect(form(page)).toContainText("에이전트");await expect(form(page)).toContainText("삭제된 대상");await expect(form(page)).toContainText("당시 본문");await expect(form(page)).toContainText("실제 판단 당시의 본문을 보증하지 않습니다.");await expect(form(page).getByRole("link",{name:"대상 원문 보기"})).toHaveCount(0);
  await compatibleEdit(page);await expect(form(page).getByLabel("수행 시각")).toHaveCount(0);await expect(form(page).getByText("활동 태그",{exact:true})).toHaveCount(0);await form(page).getByLabel("본문",{exact:false}).fill("설명 정정");await saveOnce(page, form(page));
  expect(Object.keys(state.writes[0].body).sort()).toEqual(["body","expected_version"].sort());expect(state.rows.entities[0].prop2).toBe(0);
  await expect(form(page).getByRole("heading",{name:"기록",exact:true})).toBeVisible();await compatibleEdit(page);await form(page).getByRole("button",{name:"삭제",exact:true}).click();const confirm=page.locator(".delete-action.is-armed");await expect(confirm).toContainText("대상의 업무 상태는 되돌리지 않습니다.");await saveOnce(page,confirm,"삭제 확인");await expect(page).toHaveURL(/\/records$/);expect(state.rows.entities[0].prop2).toBe(0);expect(state.rows.records).toHaveLength(0);expect(state.errors).toEqual([]);
});
test("검색: IME·300ms·옛 keyword URL도 auto·할 일 scope·clear 초점",async({page})=>{
  const state=await fixtures(page);await go(page,"/tasks?kind=once&status=open&mode=keyword");
  const input=page.getByLabel("검색어",{exact:true});await input.dispatchEvent("compositionstart");await input.fill("한글");await input.press("Enter");
  await page.waitForTimeout(350);expect(state.searches).toHaveLength(0);await input.dispatchEvent("compositionend");
  await expect.poll(()=>state.searches.length).toBe(1);
  expect(state.searches[0].kinds).toEqual(["task"]);
  expect(state.searches[0].mode).toBe("auto");expect(state.searches[0].task_kind).toBe("once");expect(state.searches[0].task_status).toBe("open");
  await expect(page.getByLabel("검색 방식",{exact:true})).toHaveCount(0);
  await expect(page.getByText("의미 검색을 사용할 수 없어 키워드 검색 결과를 표시합니다.")).toHaveCount(1);
  await expect(page.getByText("의미 색인 대기 1개 · 제외 0개")).toBeVisible();
  await page.getByRole("button",{name:"검색어 지우기"}).click();await expect(page).not.toHaveURL(/q=/);await expect(input).toBeFocused();expect(state.errors).toEqual([]);
});
test("검색 대기 중 필터 병합·IME 시작 취소·즉시 clear는 오래된 검색을 되살리지 않는다",async({page})=>{
  const state=await fixtures(page);await go(page,"/tasks");const input=page.getByLabel("검색어",{exact:true});
  await input.fill("아직 대기");await input.dispatchEvent("compositionstart");await page.waitForTimeout(350);expect(state.searches).toHaveLength(0);
  await input.fill("최신 초안");await page.getByRole("button",{name:"같은 이름",exact:true}).click();await expect(input).toHaveValue("최신 초안");
  await input.dispatchEvent("compositionend");await expect.poll(()=>state.searches.length).toBe(1);
  expect(state.searches.every(s=>s.query==="최신 초안"&&(s.tag_ids as string[]).includes(id(11)))).toBe(true);
  await input.fill("되살아나면 안 됨");await page.getByRole("button",{name:"검색어 지우기"}).click();await expect(page).not.toHaveURL(/q=/);
  await page.waitForTimeout(350);expect(state.searches).toHaveLength(1);await expect(input).toHaveValue("");await expect(input).toBeFocused();
});
test("기록 기간 변경과 잘못된 범위는 할 일을 재조회하지 않고 이전 기록을 유지한다",async({page})=>{
  await fixtures(page);const reads:string[]=[];await page.route("**/api/records?**",route=>{reads.push(new URL(route.request().url()).search);return route.fulfill({json:{items:[record(3)],next_cursor:null}});});
  let tasks=0;await page.route("**/api/tasks?**",route=>{tasks++;return route.fulfill({json:{items:[task(2)],next_cursor:null}});});
  await go(page,"/records");await expect(page.locator(".records .list .item-title")).toBeVisible();expect(tasks).toBe(0);
  await page.getByLabel("기록 종료일",{exact:true}).fill("2026-10-05");await expect.poll(()=>reads.length).toBe(2);expect(reads[1]).toContain("occurred_to=");
  await page.getByLabel("기록 시작일",{exact:true}).fill("2026-10-06");await expect(page.getByRole("alert")).toContainText("이전 유효 기간");
  await expect(page.locator(".records .list .item-title")).toHaveText("기록");await expect(page.locator(".tasks")).toHaveCount(0);expect(reads).toHaveLength(2);expect(tasks).toBe(0);
});
for(const failure of ["unknown","conflict"] as const)test(`편집 ${failure}: 초안·중복 요청키·Escape 확인 취소`,async({page})=>{
  const state=await fixtures(page,{failWrite:failure});await go(page,`/tasks/${id(2)}?edit=1`);await form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill("보존할 초안");await form(page).getByLabel("편집 메모",{exact:false}).fill("정정 이유");await saveOnce(page, form(page));await expect(form(page).getByRole("alert")).toBeVisible();await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("보존할 초안");
  await page.keyboard.press("Escape");const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("보존할 초안");
  if(failure==="unknown"){await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toBeDisabled();await form(page).getByRole("button",{name:"같은 내용 다시 시도"}).click();expect(state.writes[1].body).toEqual(state.writes[0].body);}expect(state.errors).toEqual([]);
});
test("busy POP·dirty back/forward·reload·직접 링크",async({page})=>{
  const state=await fixtures(page,{hold:true});await go(page,"/tasks");await page.getByRole("link",{name:"할 일 편집",exact:true}).click();await form(page).getByLabel("편집 메모",{exact:false}).fill("저장 이유");await saveOnce(page, form(page));await state.pending;await page.goBack();await expect(page).toHaveURL(/edit=1/);await expect(page.getByRole("dialog",{name:"변경을 버릴까요?"})).not.toBeVisible();state.release();await expect(page).toHaveURL(/\/tasks\?/);
  await page.getByRole("link",{name:"할 일 편집",exact:true}).click();await form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill("버리지 않을 초안");await page.goBack();const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("버리지 않을 초안");await page.goBack();await confirm.getByRole("button",{name:"변경 버리기"}).click();await expect(page).toHaveURL(/\/tasks\?/);await page.goForward();await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("할 일");await page.reload();await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("할 일");expect(state.errors).toEqual([]);
});
for(const width of [320,360,390,639,640,768,1024,1440])test(`shell ${width}px: 긴 제목·본문 스크롤·키보드·단일 surface`,async({page},info)=>{
  const state=await fixtures(page,{long:true});await page.setViewportSize({width,height:800});await go(page,`/tasks/${id(2)}`);await expect(form(page)).toBeVisible();const dimensions=await form(page).evaluate(d=>{const r=d.getBoundingClientRect();return {width:r.width,height:r.height,scroll:document.documentElement.scrollWidth,viewport:innerWidth};});expect(dimensions.scroll).toBeLessThanOrEqual(width);expect(dimensions.width).toBeLessThanOrEqual(width<640?width:672);if(width<640)expect(dimensions.width).toBe(width);
  await form(page).locator(":scope > .modal-inner > .modal-body").evaluate(el=>{el.scrollTop=el.scrollHeight;});await expect(form(page).getByRole("button",{name:"닫기",exact:true})).toBeInViewport();await expect(form(page).getByRole("button",{name:"닫기",exact:true})).toBeInViewport();await form(page).locator(":scope > .modal-inner > .modal-body").evaluate(el=>{el.scrollTop=0;});await compatibleEdit(page);await expect(form(page)).toHaveCount(1);await form(page).getByLabel("편집 메모",{exact:false}).fill("길이 검수");await page.keyboard.press("Tab");await page.screenshot({path:info.outputPath(`surface-${width}.png`)});await page.keyboard.press("Escape");await expect(page.getByRole("dialog",{name:"변경을 버릴까요?"})).toBeVisible();expect(state.errors).toEqual([]);
});

for(const width of [320,360,390,639,640,768,1024,1440])test(`소비 화면 ${width}px: 목록·원칙·기록·엔터티·태그`,async({page},info)=>{
  const state=await fixtures(page,{long:true});state.rows.tags[0].name="긴이름".repeat(10);await page.setViewportSize({width,height:800});
  for(const path of ["/entities","/tasks","/records","/principles","/tags/entity","/tags/activity"]){await go(page,path);await expect(page.getByRole("heading",{level:1})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path).toBe(true);}
  for(const [kind,n] of [["entities",1],["records",3],["principles",4]] as const){await go(page,`/${kind}/${id(n)}`);await expect(form(page)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),kind).toBe(true);await expect(form(page).getByRole("button",{name:"닫기",exact:true})).toBeInViewport();await page.screenshot({path:info.outputPath(`${kind}-${width}.png`)});}
  await go(page,`/tags/entity?view=${id(10)}`);await expect(form(page)).toBeVisible();await form(page).getByRole("button",{name:"편집",exact:true}).click();await expect(form(page)).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`tags-${width}.png`)});expect(state.errors).toEqual([]);
});
test("200% reflow·축소 visual viewport·한 글자 제목",async({page},info)=>{
  const state=await fixtures(page);state.rows.tasks[0].title="일";await page.setViewportSize({width:768,height:800});await go(page,`/tasks/${id(2)}?edit=1`);await page.evaluate(()=>{document.documentElement.style.zoom="2";});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await form(page).getByLabel("편집 메모",{exact:false}).fill("확대 확인");await page.setViewportSize({width:390,height:360});await expect(form(page).getByRole("button",{name:/^저장$/})).toBeInViewport();await page.screenshot({path:info.outputPath("zoom-keyboard-viewport.png")});expect(state.errors).toEqual([]);
});

test("태그 보기 편집: 닫기는 보기로 복귀·삭제 실패는 동일 입력과 버전으로 재시도",async({page})=>{
  const state=await fixtures(page);await go(page,`/tags/entity?view=${id(10)}`);
  await form(page).getByRole("button",{name:"편집",exact:true}).click();
  await form(page).getByRole("button",{name:"닫기",exact:true}).click();
  await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeFocused();
  await form(page).getByRole("button",{name:"편집",exact:true}).click();
  await form(page).getByRole("textbox",{name:/태그 이름/}).fill("보존할 이름");
  await form(page).getByRole("button",{name:"삭제",exact:true}).click();
  const deletion=page.locator(".delete-action.is-armed");
  await deletion.getByRole("button",{name:"취소",exact:true}).click();
  await expect(form(page).getByRole("textbox",{name:/태그 이름/})).toHaveValue("보존할 이름");
  const attempts:string[]=[];await page.route(`**/api/tags/${id(10)}?**`,async route=>{
    attempts.push(route.request().url());
    if(attempts.length===1)return route.abort("connectionreset");
    return route.fallback();
  });
  await form(page).getByRole("button",{name:"삭제",exact:true}).click();
  await deletion.getByLabel("이유 (선택)",{exact:true}).fill("분류 정리");
  await deletion.getByRole("button",{name:"삭제 확인",exact:true}).click();
  await expect(deletion.getByRole("button",{name:"같은 내용 다시 시도",exact:true})).toBeVisible();
  await expect(deletion.getByLabel("이유 (선택)",{exact:true})).toHaveValue("분류 정리");
  await deletion.getByRole("button",{name:"같은 내용 다시 시도",exact:true}).click();
  await expect(deletion).toHaveCount(0);await expect(form(page)).toHaveCount(0);
  expect(attempts).toHaveLength(2);expect(attempts[1]).toBe(attempts[0]);
  expect(state.errors).toEqual([]);
});

test("태그: 두 사전 같은 이름·URL 보기/편집·CRUD·dirty scoped 이동",async({page})=>{
  const state=await fixtures(page);await go(page,"/tags/entity");await expect(page.getByRole("button",{name:"같은 이름 보기",exact:true})).toHaveCount(1);
  await page.getByRole("button",{name:"같은 이름 보기",exact:true}).click();await expect(form(page)).toContainText("엔터티에 사용하는 태그");await form(page).getByRole("button",{name:"편집",exact:true}).click();await expect(form(page)).toHaveCount(1);await form(page).getByRole("textbox",{name:/태그 이름/}).fill("엔터티 분류");await saveOnce(page, form(page));await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeFocused();await form(page).getByRole("button",{name:"닫기",exact:true}).click();await expect(page.getByRole("button",{name:"엔터티 분류 이름 변경"})).toBeFocused();
  await page.getByRole("link",{name:"활동 태그 fixture"}).click();await expect(page.getByRole("button",{name:"같은 이름 이름 변경"})).toBeVisible();await expect(page.getByRole("button",{name:"엔터티 분류 이름 변경"})).toHaveCount(0);
  await page.getByRole("button",{name:"태그 추가",exact:true}).click();await form(page).getByRole("textbox",{name:/태그 이름/}).fill("활동 추가");await page.goBack();const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();await expect(form(page).getByRole("textbox",{name:/태그 이름/})).toHaveValue("활동 추가");await saveOnce(page, form(page));expect(state.writes.at(-1)?.body.scope).toBe("activity");
  await page.getByRole("button",{name:"활동 추가 삭제",exact:true}).click();await page.locator(".delete-action.is-armed").getByRole("button",{name:"삭제 확인",exact:true}).click();await expect(page.getByRole("button",{name:"활동 추가 삭제",exact:true})).toHaveCount(0);expect(state.errors).toEqual([]);
});

test("저장 성공 후 GET 실패·조회만 재시도·서버 conflict 초안 유지",async({page})=>{
  const state=await fixtures(page);let fail=false,patches=0;
  await page.route(`**/api/tasks/${id(2)}`,async route=>{if(route.request().method()==="PATCH"){patches++;Object.assign(state.rows.tasks[0],route.request().postDataJSON(),{version:2});fail=true;await route.fulfill({json:state.rows.tasks[0]});return;}if(fail){await route.fulfill({status:503,json:{code:"internal",message:"fixture GET failure"}});return;}await route.fulfill({json:state.rows.tasks[0]});});
  await go(page,`/tasks/${id(2)}`);await compatibleEdit(page);await form(page).getByLabel("편집 메모",{exact:false}).fill("수정 사유");await form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill("최신 내용");await saveOnce(page, form(page));await expect(form(page).getByText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.")).toBeVisible();await expect(form(page).getByRole("heading",{name:"최신 내용",level:1})).toBeVisible();fail=false;await form(page).getByRole("button",{name:"조회 다시 시도"}).click();await expect(form(page).getByText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.")).toHaveCount(0);expect(patches).toBe(1);expect(state.errors).toEqual([]);
});

test("늦은 다른 탭 페이지는 기록 날짜·페이지·검색 초안과 초점을 덮지 않는다",async({page})=>{
  const state=await fixtures(page);let release=()=>{},started=()=>{};const held=new Promise<void>(r=>release=r),pending=new Promise<void>(r=>started=r);
  await page.route("**/api/tasks?**",async route=>{const cursor=new URL(route.request().url()).searchParams.get("cursor");if(cursor){started();await held;}await route.fulfill({json:{items:[task(cursor?102:101)],next_cursor:cursor?null:"next"}}).catch(()=>{});});
  await page.route("**/api/records?**",route=>{const cursor=new URL(route.request().url()).searchParams.get("cursor");return route.fulfill({json:{items:[record(cursor?104:103)],next_cursor:cursor?null:"next"}});});
  await go(page,"/tasks");await page.locator("#activity-tasks-page-control").click();await pending;
  await page.getByRole("link",{name:"기록 fixture",exact:true}).click();
  const date=page.getByLabel("기록 시작일",{exact:true});await date.fill("2026-10-01");await page.locator("#activity-records-page-control").click();await expect(page).toHaveURL(/pages=2/);
  const input=page.getByLabel("검색어",{exact:true});await input.dispatchEvent("compositionstart");await input.fill("아직 조합 중인 초안");await date.focus();release();
  await page.waitForTimeout(100);const params=new URL(page.url()).searchParams;
  expect(params.get("from")).toBe("2026-10-01");expect(params.get("pages")).toBe("2");await expect(date).toHaveValue("2026-10-01");await expect(date).toBeFocused();await expect(input).toHaveValue("아직 조합 중인 초안");
  await expect(page.locator(".records .list .item-title")).toHaveCount(2);await expect(page.locator(".tasks")).toHaveCount(0);expect(state.errors).toEqual([]);
});
for(const overLimit of [false,true])test(`활동 태그 10개 한도: ${overLimit?"기존 URL 정규화":"선택 제한과 해제"}`,async({page})=>{
  const state=await fixtures(page),tags=Array.from({length:11},(_,i)=>({...base(200+i,""),name:`분류 ${i+1}`,scope:"activity"}));state.rows.tags=tags;
  const requests:number[]=[];await page.route(/\/api\/(tasks|records)\?/,route=>{const count=new URL(route.request().url()).searchParams.get("tag_ids")?.split(",").filter(Boolean).length??0;requests.push(count);return route.fulfill({status:count>10?400:200,json:count>10?{code:"invalid_input",message:"tag_ids max10"}:{items:[],next_cursor:null}});});
  await go(page,overLimit?`/tasks?tag_ids=${tags.map(tag=>tag.id).join(",")}`:"/tasks");
  if(overLimit){await expect(page.locator(".tag-filter-chips").getByRole("status")).toContainText("기존 조건의 앞 10개만 적용");expect(new URL(page.url()).searchParams.get("tag_ids")?.split(",")).toHaveLength(10);}
  else for(const tag of tags.slice(0,10))await page.getByRole("button",{name:tag.name,exact:true}).click();
  const eleventh=page.getByRole("button",{name:tags[10].name,exact:true});await expect(eleventh).toBeDisabled();await expect(page.locator(".tag-filter-chips button[aria-pressed=true]")).toHaveCount(10);
  await page.getByRole("button",{name:tags[0].name,exact:true}).click();await expect(eleventh).toBeEnabled();await eleventh.click();await expect(eleventh).toHaveAttribute("aria-pressed","true");
  expect(Math.max(...requests)).toBeLessThanOrEqual(10);await expect(page.getByRole("alert")).toHaveCount(0);expect(state.errors).toEqual([]);
});
for(const kind of ["tasks"] as const)test(`${kind}: 무시한 이전 검색 페이지는 최신 행·대체 상태·coverage를 덮지 않는다`,async({page})=>{
  const state=await fixtures(page);let release=()=>{},started=()=>{};const held=new Promise<void>(r=>release=r),pending=new Promise<void>(r=>started=r);
  await page.route("**/api/search",async route=>{const input=route.request().postDataJSON(),target=(input.kinds as string[])[0];const stale=input.query==="old"&&input.cursor&&target===kind.slice(0,-1);if(stale){started();await held;}
    await route.fulfill({json:{items:[{id:id(input.query==="old"?101:102),kind:target,title:input.query==="old"?"old hit":"new hit",snippet:"본문",snippet_start:0,snippet_end:2,at:stamp,tag_ids:[],path:`/${target}s/${id(102)}`,match:"keyword",index_state:"pending"}],next_cursor:input.query==="old"&&!input.cursor?"next":null,search_state:stale?"keyword_fallback":"ok",semantic_coverage:{pending:stale?99:1,excluded:0}}});});
  await go(page,`/${kind}?q=old`);const section=kind==="tasks"?page.locator(".tasks"):page.locator("main");await section.getByRole("button",{name:kind==="tasks"?"할 일 더 보기":"더 보기",exact:true}).click();await pending;
  await page.getByLabel("검색어",{exact:true}).fill("new");await expect(section.getByRole("link",{name:"new hit",exact:true})).toBeVisible();
  const oldResponse=page.waitForResponse(response=>{const request=response.request();return request.url().endsWith("/api/search")&&request.postDataJSON().query==="old"&&!!request.postDataJSON().cursor;});release();await (await oldResponse).finished();await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve())));
  await expect(section.getByText(/색인 대기 1개/)).toBeVisible();await expect(section.getByText(/의미 검색을 사용할 수 없어/)).toHaveCount(0);await expect(section.getByText(/대기 99개/)).toHaveCount(0);await expect(section.getByRole("link",{name:"old hit",exact:true})).toHaveCount(0);expect(state.errors).toEqual([]);
});
test("검색 복원의 마지막 요청 페이지가 cursor를 반복하면 이전 행·coverage만 보존한다",async({page})=>{
  const state=await fixtures(page);
  await page.route("**/api/search",route=>{
    const input=route.request().postDataJSON();
    return route.fulfill({json:{items:[{id:id(input.cursor?102:101),kind:"task",title:input.cursor?"거절할 결과":"보존할 결과",snippet:"본문",snippet_start:0,snippet_end:2,at:stamp,tag_ids:[],path:`/tasks/${id(101)}`,match:"keyword",index_state:"pending"}],next_cursor:"next",search_state:input.cursor?"keyword_fallback":"ok",semantic_coverage:{pending:input.cursor?99:1,excluded:0}}});
  });
  await go(page,"/tasks?q=검색&pages=2");const section=page.locator(".tasks");
  await expect(section.getByRole("button",{name:"다시 시도",exact:true})).toBeVisible();
  await expect(section.getByRole("link",{name:"보존할 결과",exact:true})).toBeVisible();
  await expect(section.getByRole("link",{name:"거절할 결과",exact:true})).toHaveCount(0);
  await expect(section.getByText(/색인 대기 1개/)).toBeVisible();
  await expect(section.getByText(/대기 99개|의미 검색을 사용할 수 없어/)).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test("검색의 반복 cursor 실패는 기존 행·coverage를 보존하고 같은 페이지를 재시도한다",async({page})=>{
  const state=await fixtures(page);let failed=false;
  await page.route("**/api/search",route=>{
    const input=route.request().postDataJSON(),bad=!!input.cursor&&!failed;
    if(bad)failed=true;
    return route.fulfill({json:{items:[{id:id(input.cursor?102:101),kind:"task",title:input.cursor?"추가 결과":"첫 결과",snippet:"본문",snippet_start:0,snippet_end:2,at:stamp,tag_ids:[],path:`/tasks/${id(101)}`,match:"keyword",index_state:"pending"}],next_cursor:!input.cursor||bad?"next":null,search_state:bad?"keyword_fallback":"ok",semantic_coverage:{pending:bad?99:1,excluded:0}}});
  });
  await go(page,"/tasks?q=검색");const section=page.locator(".tasks");
  await expect(section.getByText(/색인 대기 1개/)).toBeVisible();
  await section.getByRole("button",{name:"할 일 더 보기",exact:true}).click();
  await expect(section.getByRole("button",{name:"다시 시도",exact:true})).toBeVisible();
  await expect(section.getByRole("link",{name:"첫 결과",exact:true})).toBeVisible();
  await expect(section.getByRole("link",{name:"추가 결과",exact:true})).toHaveCount(0);
  await expect(section.getByText(/색인 대기 1개/)).toBeVisible();
  await expect(section.getByText(/대기 99개|의미 검색을 사용할 수 없어/)).toHaveCount(0);
  expect(new URL(page.url()).searchParams.has("pages")).toBe(false);
  await section.getByRole("button",{name:"다시 시도",exact:true}).click();
  await expect(section.getByRole("link",{name:"추가 결과",exact:true})).toBeVisible();
  await expect(page).toHaveURL(/pages=2/);expect(state.errors).toEqual([]);
});

test("목록 페이지·조건·scroll/focus 왕복과 검색 anchor 재조회",async({page})=>{
  const state=await fixtures(page);const many=Array.from({length:21},(_,i)=>({...task(100+i),title:`행 ${i}`}));
  await page.route("**/api/tasks**",route=>{const url=new URL(route.request().url()),key=url.pathname.split("/").at(-1);if(key!=="tasks")return route.fulfill({json:many.find(t=>t.id===key)??state.rows.tasks.find(t=>t.id===key)});return route.fulfill({json:url.searchParams.get("cursor")?{items:many.slice(20),next_cursor:null}:{items:many.slice(0,20),next_cursor:"page2"}});});
  await go(page,"/tasks?kind=once");await page.locator("#activity-tasks-page-control").click();await page.getByRole("link",{name:"행 20 편집",exact:true}).click();await form(page).getByRole("button",{name:"닫기",exact:true}).click();await expect(page).toHaveURL(/pages=2&scroll=/);await expect(page.locator(`#activity-tasks-${many[20].id}`)).toBeFocused();expect(await page.evaluate(()=>scrollY)).toBeGreaterThan(0);await page.reload();await expect(page.locator(`#activity-tasks-${many[20].id}`)).toBeFocused();
  await go(page,"/tasks?q=행&kind=once");await page.getByRole("link",{name:"할 일",exact:true}).click();await form(page).getByRole("button",{name:"닫기",exact:true}).click();await expect(page).toHaveURL(/q=행|q=%ED%96%89/);await expect(page.locator(`#activity-tasks-${id(2)}`)).toBeFocused();expect(state.searches.filter(s=>(s.kinds as string[])[0]==="task").at(-1)?.anchor).toEqual({kind:"task",id:id(2)});expect(state.errors).toEqual([]);
});

for(const [kind,n] of [["entities",1],["tasks",2],["records",3],["principles",4]] as const)test(`${kind}: 두 단계 삭제·취소는 요청 없이 같은 surface`,async({page})=>{
  const state=await fixtures(page);await go(page,`/${kind}/${id(n)}?edit=1`);
  const before=state.writes.length;
  await form(page).getByRole("button",{name:"삭제",exact:true}).click();
  const confirm=form(page).locator(".delete-action.is-armed");await expect(confirm.getByRole("button",{name:"삭제 확인",exact:true})).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(1);expect(state.writes).toHaveLength(before);
  await expect(form(page).getByRole("button",{name:"저장",exact:true})).toBeDisabled();
  await confirm.getByRole("button",{name:"취소",exact:true}).click();await expect(confirm).toHaveCount(0);await expect(form(page).getByRole("button",{name:"삭제",exact:true})).toBeFocused();expect(state.writes).toHaveLength(before);
  await form(page).getByRole("button",{name:"삭제",exact:true}).click();await form(page).getByRole("button",{name:"삭제 확인",exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/${kind}$`));expect(state.writes).toHaveLength(before+1);expect(state.errors).toEqual([]);
});
for(const width of [390,1440])test(`기록 정돈 ${width}px: 본문·변경 정보·연결·접힌 저장 정보`,async({page},info)=>{
  const state=await fixtures(page);await page.setViewportSize({width,height:850});
  Object.assign(state.rows.records[0],{body:"테스트 속성1222 수정 (속성 1, 속성 2)",record_kind:"change",entity_ids:[id(1)],entity_context:[{id:id(1),title:"테스트 속성1222",source:"selection",captured_at:stamp}],change:{event_id:id(30),target_kind:"entity",target_id:id(1),target_title:"테스트 속성1222",action:"update",source:"http",before:{prop1:"기존 이름"},after:{prop1:"테스트 속성1222"},path:`/entities/${id(1)}`}});
  await go(page,`/records/${id(3)}`);await expect(form(page).getByRole("link",{name:"대상 원문 보기",exact:true})).toBeVisible();
  const text=form(page).locator(".record-content .markdown"),meta=form(page).locator(".record-context-meta");
  const style=async(el:ReturnType<typeof form>)=>el.evaluate(n=>({size:parseFloat(getComputedStyle(n).fontSize),color:getComputedStyle(n).color}));
  expect((await style(text)).size).toBeGreaterThan((await style(meta)).size);expect((await style(text)).color).not.toBe((await style(meta)).color);
  await expect(form(page).locator(".record-audit")).not.toHaveAttribute("open","");await expect(form(page).getByRole("button",{name:"닫기",exact:true})).toHaveText("×");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`record-layout-${width}.png`)});expect(state.errors).toEqual([]);
});
