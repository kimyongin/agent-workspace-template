import { expect, test, type Page } from "@playwright/test";
const targetCases=[["entity","entities",1],["task","tasks",2],["record","records",31],["principle","principles",4]] as const;
for(const [kind,route,n] of targetCases) for(const outcome of ["exists","deleted","foreign","failed"] as const)test(`변경 대상 ${kind}: ${outcome} 현재 조회와 역사 metadata 분리`,async({page})=>{
  const state=await fixtures(page),r=state.rows.records[0];
  const change={event_id:id(30),target_kind:kind,target_id:id(n),target_title:"당시 대상 이름",action:"update",source:"mcp",before:{title:"수정 전"},after:{title:"수정 후"},path:`/${route}/${id(n)}`};
  Object.assign(r,{record_kind:"change",change_note:"당시 편집 근거",change});
  const original=JSON.stringify(r);let reads=0,fail=outcome==="failed";
  await page.route(`**/api/${route}/${id(n)}`,endpoint=>{reads++;return outcome==="deleted"||outcome==="foreign"?endpoint.fulfill({status:404,json:{code:"not_found",message:"항목을 찾을 수 없습니다"}}):fail?endpoint.fulfill({status:503,json:{code:"internal",message:"조회 실패"}}):endpoint.fulfill({json:{id:id(n)}});});
  await go(page,`/records/${r.id}`);
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
  await go(page,`/records/${r.id}`);await expect(form(page)).toContainText("대상의 현재 상태를 확인하지 못했습니다.");await expect(form(page)).not.toContainText("삭제된 대상");await expect(form(page).getByRole("link",{name:"대상 원문 보기",exact:true})).toHaveCount(0);
  await expect(form(page).getByRole("button",{name:"대상 다시 조회",exact:true})).toBeEnabled();expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

test("변경 대상 목록은 추가 조회 없이 당시 행동만 표시·늦은 상세 응답은 다음 대상에 반영하지 않는다",async({page})=>{
  const state=await fixtures(page),r=state.rows.records[0];
  const historical={event_id:id(30),target_kind:"entity",target_id:id(1),target_title:"첫 대상",action:"create",source:"http",before:null,after:{prop1:"첫 대상"},path:`/entities/${id(1)}`};
  Object.assign(r,{record_kind:"change",change:historical});const second={...record(32),record_kind:"change",change:{...historical,target_id:id(99),target_title:"다음 대상",path:`/entities/${id(99)}`}};state.rows.records.push(second);
  let reads=0,release=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/entities/${id(1)}`,async endpoint=>{reads++;await held;await endpoint.fulfill({json:state.rows.entities[0]}).catch(()=>{});});
  await go(page,"/records");await expect(page.locator(".list")).toContainText("첫 대상");expect(reads).toBe(0);await expect(page.locator(".list")).not.toContainText("삭제된 대상");
  await go(page,`/records/${r.id}`);await expect(form(page)).toContainText("대상의 현재 상태 확인 중");await expect.poll(()=>reads).toBe(1);
  await go(page,`/records/${second.id}`);await expect(form(page)).toContainText("삭제된 대상 또는 접근할 수 없는 대상");release();
  await expect(form(page)).toContainText("다음 대상");await expect(form(page).getByRole("link",{name:"대상 원문 보기",exact:true})).toHaveCount(0);expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

for(const [kind,label] of [["entities","엔터티"],["tasks","할 일"],["records","기록"],["principles","원칙"]])test(`${kind}: uncertain 생성 폐기 후 새 작성은 새로운 요청키`,async({page})=>{
  const state=await fixtures(page,{failWrite:"unknown",emptyPrinciple:true});await go(page,`/${kind}`);
  const begin=()=>page.getByRole("button",{name:kind==="principles"?"현재 원칙 등록":kind==="records"?"기록 작성":`${label} 추가`,exact:true}).click();
  const fill=async(value:string)=>{if(kind==="entities")await form(page).getByLabel("속성 1",{exact:false}).fill(value);else await fillText(page,value);};
  const submit=()=>form(page).getByRole("button",{name:kind==="tasks"?"추가":"저장",exact:true}).click();
  await begin();await fill("첫 작성");await submit();await expect(form(page).getByRole("button",{name:"같은 내용 다시 시도"})).toBeVisible();
  await page.keyboard.press("Escape");await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();
  await expect(form(page)).toHaveCount(0);await begin();await fill("새 작성");await submit();await expect(state.writes).toHaveLength(2);
  expect(state.writes[1].body.request_id).not.toBe(state.writes[0].body.request_id);expect(state.errors).toEqual([]);
});

for(const [kind,n] of [["entities",1],["tasks",2],["records",3],["principles",4]] as const)test(`${kind}: uncertain 편집 폐기 후 새 편집은 새로운 요청키`,async({page})=>{
  const state=await fixtures(page,{failWrite:"unknown"});await go(page,`/${kind}/${id(n)}`);
  await form(page).getByRole("button",{name:"편집",exact:true}).click();await form(page).getByLabel("편집 메모",{exact:false}).fill("첫 수정");await form(page).getByRole("button",{name:"저장",exact:true}).click();
  await expect(form(page).getByRole("button",{name:"같은 내용 다시 시도"})).toBeVisible();await page.keyboard.press("Escape");
  await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();
  await form(page).getByRole("button",{name:"편집",exact:true}).click();await form(page).getByLabel("편집 메모",{exact:false}).fill("새 수정");await form(page).getByRole("button",{name:"저장",exact:true}).click();
  await expect.poll(()=>state.writes.length).toBe(2);expect(state.writes[1].body.request_id).not.toBe(state.writes[0].body.request_id);expect(state.errors).toEqual([]);
});

test("dirty 작성 조건 이동 승인: create 유지 URL도 새 초안",async({page})=>{
  const state=await fixtures(page);await go(page,"/tasks?create=1");await fillText(page,"버릴 작성 초안");
  // Native dialog makes background links inert; trigger the route guard through the fixture router.
  await page.getByRole("link",{name:"작성 조건 변경 fixture"}).evaluate(el=>el.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true})));
  const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"변경 버리기"}).click();
  await expect(page).toHaveURL(/create=1&kind=recurring/);await expect(form(page).getByLabel("제목",{exact:false})).toHaveValue("");expect(state.errors).toEqual([]);
});

for(const [kind,label,submit] of [["task","관련 할 일 추가","추가"],["record","기록 작성","저장"]])test(`엔터티 관련 ${kind}: uncertain 폐기 후 forward 새 요청키`,async({page})=>{
  const state=await fixtures(page,{failWrite:"unknown"});await go(page,`/entities/${id(1)}`);
  await form(page).getByRole("button",{name:label,exact:true}).click();await fillText(page,"첫 연결 작성");await form(page).getByRole("button",{name:submit,exact:true}).click();
  await expect(form(page).getByRole("button",{name:"같은 내용 다시 시도"})).toBeVisible();await page.goBack();
  await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();await expect(page).not.toHaveURL(/create=/);
  await page.goForward();await fillText(page,"새 연결 작성");await form(page).getByRole("button",{name:submit,exact:true}).click();
  await expect.poll(()=>state.writes.length).toBe(2);expect(state.writes[1].body.request_id).not.toBe(state.writes[0].body.request_id);expect(state.errors).toEqual([]);
});

test("엔터티 create/edit 복합 직접 링크는 연결 작성 한 폼만 연다",async({page})=>{
  const state=await fixtures(page);await go(page,`/entities/${id(1)}?create=task&edit=1`);
  await expect(form(page)).toHaveCount(1);await expect(form(page).getByLabel("제목",{exact:false})).toBeVisible();await expect(form(page).getByLabel("속성 1",{exact:false})).toHaveCount(0);
  await fillText(page,"연결 작성 한 번");await form(page).getByRole("button",{name:"추가",exact:true}).click();await expect.poll(()=>state.writes.length).toBe(1);expect(state.writes[0].body.entity_id).toBe(id(1));expect(state.errors).toEqual([]);
});

for(const [kind,label] of [["task","관련 할 일 추가"],["record","기록 작성"]] as const) test(`엔터티 연결 ${kind}: 취소·폐기 승인은 작성 URL을 닫고 reload는 읽기`,async({page})=>{
  const state=await fixtures(page);await go(page,`/entities/${id(1)}?list=%2Fentities%3Fq%3D%EC%97%94%ED%84%B0%ED%8B%B0`);
  for(const dirty of [false,true]){
    await form(page).getByRole("button",{name:label,exact:true}).click();await expect(page).toHaveURL(new RegExp(`create=${kind}`));
    if(dirty) await fillText(page,"폐기할 연결 작성");
    await form(page).getByRole("button",{name:"취소",exact:true}).click();
    if(dirty){
      const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();
      await expect(form(page).getByLabel("제목",{exact:false})).toHaveValue("폐기할 연결 작성");
      await form(page).getByRole("button",{name:"취소",exact:true}).click();await confirm.getByRole("button",{name:"변경 버리기"}).click();
    }
    await expect(page).not.toHaveURL(/create=/);await expect(page).toHaveURL(/list=/);
    await expect(form(page).getByRole("button",{name:label,exact:true})).toBeFocused();
  }
  await page.reload();await expect(form(page).getByRole("button",{name:label,exact:true})).toBeVisible();
  await expect(form(page).getByLabel("제목",{exact:false})).toHaveCount(0);expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

test("태그 DELETE pending: Back·경로 이동·reload 보호와 응답 뒤 복귀",async({page})=>{
  const state=await fixtures(page,{hold:true});await go(page,"/entities");
  await page.getByRole("link",{name:"활동 태그 fixture",exact:true}).click();
  await page.getByRole("button",{name:"같은 이름 삭제",exact:true}).click();
  const confirm=page.getByRole("dialog",{name:"태그를 삭제할까요?"});await confirm.getByRole("button",{name:"삭제",exact:true}).click();await state.pending;
  await expect(confirm.getByRole("button",{name:"처리 중…"})).toBeDisabled();await expect(confirm.getByRole("button",{name:"취소",exact:true})).toBeDisabled();
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

test("원칙 삭제 영향 조회 실패: 삭제 금지·취소 가능·GET 재시도",async({page})=>{
  const state=await fixtures(page);let failed=true;
  await page.route("**/api/principles?view=history&limit=1",route=>failed?route.fulfill({status:503,json:{code:"internal",message:"조회 실패"}}):route.fulfill({json:{items:[state.rows.principles[1]],next_cursor:null}}));
  await go(page,`/principles/${id(4)}`);await form(page).getByRole("button",{name:"삭제",exact:true}).click();
  const confirm=page.getByRole("dialog",{name:"원칙을 삭제할까요?"});await expect(confirm).toContainText("삭제 후의 현재 원칙을 확인하지 못했습니다.");
  await expect(confirm.getByRole("button",{name:"삭제",exact:true})).toBeDisabled();await expect(confirm.getByRole("button",{name:"취소",exact:true})).toBeEnabled();expect(state.writes).toHaveLength(0);
  failed=false;await confirm.getByRole("button",{name:"삭제 영향 다시 조회",exact:true}).click();await expect(confirm).toContainText("현재 원칙이 됩니다.");
  await confirm.getByRole("button",{name:"삭제",exact:true}).click();await expect(page).toHaveURL(/\/principles$/);expect(state.rows.principles[0].id).toBe(id(5));expect(state.errors).toEqual([]);
});

test("과거 원칙 삭제 이유·키는 현재 본문·ID를 바꾸지 않는다",async({page})=>{
  const state=await fixtures(page);const current={...state.rows.principles[0]};await go(page,`/principles/${id(5)}`);
  await form(page).getByRole("button",{name:"삭제",exact:true}).click();const confirm=page.getByRole("dialog",{name:"원칙을 삭제할까요?"});
  await expect(confirm).toContainText("현재 원칙은 바뀌지 않습니다.");await confirm.getByLabel("이유 (선택)").fill("잘못 보관한 과거본");await confirm.getByRole("button",{name:"삭제",exact:true}).click();
  await expect(page).toHaveURL(/\/principles$/);expect(state.rows.principles).toEqual([current]);expect(state.writes.at(-1)?.params.get("change_note")).toBe("잘못 보관한 과거본");expect(state.writes.at(-1)?.params.get("request_id")).toBeTruthy();expect(state.errors).toEqual([]);
});

for(const width of [320,640])test(`확인창 ${width}px: 긴 승격 본문·줄어든 viewport·고정 footer`,async({page})=>{
  const state=await fixtures(page);state.rows.principles[1].body="승격될 긴 본문\n\n".repeat(300);
  await page.setViewportSize({width,height:360});await go(page,`/principles/${id(4)}`);await form(page).getByRole("button",{name:"삭제",exact:true}).click();
  const confirm=page.getByRole("dialog",{name:"원칙을 삭제할까요?"});await expect(confirm).toContainText("승격될 긴 본문");
  const bounds=await confirm.boundingBox();expect(bounds!.width).toBeLessThanOrEqual(Math.min(448,width-32));expect(bounds!.height).toBeLessThanOrEqual(328);
  await confirm.locator(".modal-body").evaluate(el=>{el.scrollTop=el.scrollHeight;});await expect(confirm.getByRole("button",{name:"삭제",exact:true})).toBeInViewport();
  await expect(confirm.getByRole("button",{name:"취소",exact:true})).toBeInViewport();expect(state.errors).toEqual([]);
});

for(const [kind,title] of [["entities","엔터티"],["tasks","할 일"],["records","기록"],["principles","현재 원칙 보기"]])test(`${kind}: 읽기 편집 취소 뒤 POP은 한 번에 목록으로 복귀`,async({page})=>{
  const state=await fixtures(page);await go(page,`/${kind}`);await (kind==="principles"?page:page.locator(".list")).getByRole("link",{name:title,exact:true}).click();
  await form(page).getByRole("button",{name:"편집",exact:true}).click();await form(page).getByRole("button",{name:"취소",exact:true}).click();
  await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeFocused();await page.goBack();await expect(page).toHaveURL(new RegExp(`/${kind}\\?`));expect(state.errors).toEqual([]);
});

test("원칙 저장 뒤 조회 실패는 확인된 새 ID·본문 보존과 GET 재시도만 제공",async({page})=>{
  const state=await fixtures(page);await go(page,`/principles/${id(4)}?list=%2Fprinciples`);
  await form(page).getByRole("button",{name:"편집",exact:true}).click();await form(page).getByLabel("본문",{exact:false}).fill("확인된 새 원칙");
  await form(page).getByLabel("편집 메모",{exact:false}).fill("새 환경 반영");
  let failed=true,reads=0;
  await page.route("**/api/principles/"+id(20),route=>{reads++;return failed?route.fulfill({status:503,json:{code:"internal",message:"조회 실패"}}):route.fulfill({json:state.rows.principles[0]});});
  await form(page).getByRole("button",{name:"저장",exact:true}).click();await expect(page).toHaveURL(new RegExp(id(20)));
  await expect(form(page)).toContainText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.");await expect(form(page)).toContainText("확인된 새 원칙");
  failed=false;await form(page).getByRole("button",{name:"조회 다시 시도",exact:true}).click();await expect.poll(()=>reads).toBe(2);
  await expect(form(page)).not.toContainText("최신 내용을 불러오지 못했습니다.");expect(state.writes).toHaveLength(1);expect(state.errors).toEqual([]);
});

test("엔터티 관련 작성은 URL·뒤로가기 초안 보호·reload·같은 surface 저장",async({page})=>{
  const state=await fixtures(page);await go(page,`/entities/${id(1)}`);
  await form(page).getByRole("button",{name:"관련 할 일 추가",exact:true}).click();await expect(page).toHaveURL(/create=task/);await expect(form(page)).toHaveCount(1);
  await fillText(page,"연결 업무");await page.goBack();const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();
  await expect(form(page).getByLabel("제목",{exact:false})).toHaveValue("연결 업무");await form(page).getByRole("button",{name:"추가",exact:true}).click();
  await expect(page).not.toHaveURL(/create=/);expect(state.writes[0].body.entity_id).toBe(id(1));await expect(form(page)).toContainText("할 일을 추가했습니다.");
  await form(page).getByRole("button",{name:"기록 작성",exact:true}).click();await page.reload();await expect(form(page).getByLabel("제목",{exact:false})).toHaveValue("");
  expect(state.errors).toEqual([]);
});

test("반복 중단·재개 메모·결과 생성은 같은 surface",async({page})=>{
  const state=await fixtures(page);Object.assign(state.rows.tasks[0],{kind:"recurring",status:"active",timezone:"Asia/Seoul",recurrence:{freq:"daily",starts_on:"2026-10-04"}});
  await page.route("**/api/tasks/*/occurrences?**",route=>route.fulfill({json:{today:"2026-10-04",items:[]}}));
  for(const [action,status,label] of [["stop","stopped","중단"],["resume","active","재개"]]){
    await page.route("**/api/tasks/*/"+action,route=>{const body=route.request().postDataJSON();Object.assign(state.rows.tasks[0],{status,version:state.rows.tasks[0].version+1});state.writes.push({method:"POST",path:new URL(route.request().url()).pathname,body,params:new URLSearchParams()});return route.fulfill({json:state.rows.tasks[0]});});
    await go(page,`/tasks/${id(2)}`);await form(page).getByRole("button",{name:label,exact:true}).click();await expect(form(page)).toHaveCount(1);
    await form(page).getByRole("button",{name:label,exact:true}).click();await expect(form(page)).toContainText("편집 메모를 입력하세요.");
    await form(page).getByLabel("편집 메모",{exact:false}).fill(label+" 이유");await form(page).getByRole("button",{name:label,exact:true}).click();
    await expect(form(page).getByRole("button",{name:label==="중단"?"재개":"중단",exact:true})).toBeVisible();expect(state.writes.at(-1)?.body.change_note).toBe(label+" 이유");
  }
  Object.assign(state.rows.tasks[0],task());await go(page,`/tasks/${id(2)}`);
  await page.route("**/api/tasks/*/complete",route=>{const result={...record(40),...route.request().postDataJSON(),record_kind:"result"};state.rows.records.push(result);Object.assign(state.rows.tasks[0],{status:"done",result_record:{id:result.id,title:result.title}});return route.fulfill({json:state.rows.tasks[0]});});
  await form(page).getByRole("button",{name:"완료",exact:true}).click();await fillText(page,"수행 결과");await form(page).getByRole("button",{name:"완료하고 기록 저장",exact:true}).click();
  await expect(form(page).getByRole("link",{name:"수행 결과",exact:true})).toBeVisible();expect(state.rows.records.at(-1)?.record_kind).toBe("result");expect(state.errors).toEqual([]);
});

const stamp="2026-10-04T03:00:00Z", id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const base=(n:number,title:string)=>({id:id(n),title,summary:"검색할 요약",body:"상세 본문",version:1,created_at:stamp,updated_at:stamp});
const entity=(n=1)=>({...base(n,"엔터티"),prop1:"엔터티",prop2:0,prop3:null,prop4:"a",tag_ids:[],tasks:{count:0,items:[]},records:{count:0,items:[]},principles:{count:0,items:[]}});
const task=(n=2)=>({...base(n,"할 일"),kind:"once",status:"open",due_on:null,recurrence:null,timezone:null,result_record:null,completed_at:null,result_record_id:null,pauses:[],tag_ids:[],entity_id:null,occurrence:null});
const record=(n=3)=>({...base(n,"기록"),record_kind:"user",change_note:null,change:null,occurred_at:stamp,task_id:null,occurrence_on:null,tag_ids:[],entity_id:null,applied_principle_ids:[],applied_principles:[],applied_principle_snapshots:[]});
const principle=(n=4,current=true)=>({...base(n,current?"현재 기준":"과거 기준"),is_current:current,saved_at:stamp,change_note:"당시 저장 이유",origin:"saved",legacy_context:null});
type Row=ReturnType<typeof base>&Record<string,unknown>;
async function fixtures(page:Page, options:{long?:boolean;emptyPrinciple?:boolean;failWrite?:"unknown"|"conflict";hold?:boolean}={}) {
  const rows:Record<string,Row[]>={entities:[entity()],tasks:[task()],records:[record()],principles:options.emptyPrinciple?[]:[principle(),principle(5,false)],tags:[{...base(10,""),name:"같은 이름",scope:"entity"},{...base(11,""),name:"같은 이름",scope:"activity"}]};
  if(options.long){for(const kind of ["entities","tasks","records","principles"]){rows[kind][0].title="긴제목".repeat(32);rows[kind][0].prop1="긴제목".repeat(25);rows[kind][0].body="긴 본문\n\n".repeat(150);}}
  const writes:{method:string;path:string;body:Record<string,unknown>;params:URLSearchParams}[]=[],searches:Record<string,unknown>[]=[],errors:string[]=[];
  let sequence=20, failed=false,release=()=>{},started=()=>{};
  const pending=new Promise<void>(r=>{started=r;});
  page.on("pageerror",e=>errors.push(e.message));page.on("console",e=>{if(/one blocker|Maximum update depth/.test(e.text()))errors.push(e.text());});
  await page.route("http://127.0.0.1:55580/**",async route=>{if(route.request().isNavigationRequest()){const response=await route.fetch({url:"http://127.0.0.1:55580/e2e/fixtures/workspace-screens.html"});await route.fulfill({response});}else await route.continue();});
  await page.route("http://127.0.0.1:55581/api/**",async route=>{
    const req=route.request(),url=new URL(req.url()),parts=url.pathname.replace("/api/","").split("/"),[kind,key,action]=parts,method=req.method();
    const body=(req.postDataJSON()??{}) as Record<string,unknown>;
    const reply=(data:unknown,status=200)=>route.fulfill({status,json:data});
    if(kind==="search"){searches.push(body);const selected=String((body.kinds as string[])[0])+"s";return reply({items:(rows[selected]??[]).filter(r=>selected!=="principles"||!r.is_current).map(r=>({id:r.id,kind:selected.slice(0,-1),title:r.title,summary:r.summary,at:stamp,tag_ids:[],path:`/${selected}/${r.id}`,match:"keyword",index_state:"pending"})),next_cursor:null,anchor_page:null,search_state:body.mode==="auto"?"keyword_fallback":"ok",semantic_coverage:{pending:1,excluded:0}});}
    if(!rows[kind])return reply({code:"invalid_input",message:`Unexpected fixture endpoint ${url.pathname}`},400);
    if(method==="GET") {
      if(kind==="principles"&&key==="current")return reply({current:rows.principles.find(r=>r.is_current)??null});
      if(key){const found=rows[kind].find(r=>r.id===key);return found?reply(found):reply({code:"not_found",message:"삭제된 자료"},404);}
      let items=rows[kind];if(kind==="tags")items=items.filter(r=>r.scope===(url.searchParams.get("scope")??"activity"));
      if(kind==="principles")items=items.filter(r=>url.searchParams.get("view")==="history"?!r.is_current:!!r.is_current);
      if(kind==="records"&&url.searchParams.get("record_kind"))items=items.filter(r=>r.record_kind===url.searchParams.get("record_kind"));
      return reply({items,next_cursor:null});
    }
    writes.push({method,path:url.pathname,body,params:url.searchParams});
    if(options.hold){started();await new Promise<void>(r=>{release=r;});options.hold=false;}
    if(options.failWrite&&!failed){failed=true;return options.failWrite==="unknown"?route.abort("connectionreset"):reply({code:"conflict",message:"다른 곳에서 수정했습니다."},409);}
    if(method==="DELETE"){rows[kind]=rows[kind].filter(r=>r.id!==key);if(kind==="principles"&&!rows.principles.some(r=>r.is_current)&&rows.principles[0])rows.principles[0].is_current=true;return route.fulfill({status:204});}
    if(kind==="principles"&&key==="current"){
      rows.principles.forEach(r=>{r.is_current=false;});const saved={...principle(sequence++),...body};rows.principles.unshift(saved);return reply(saved,201);
    }
    if(method==="POST"&&!key){const saved={...(kind==="entities"?entity(sequence++):kind==="tasks"?task(sequence++):kind==="records"?record(sequence++):base(sequence++,"")),...body};rows[kind].unshift(saved);return reply(saved,201);}
    const found=rows[kind].find(r=>r.id===key);if(!found)return reply({code:"not_found",message:"자료 없음"},404);
    Object.assign(found,body,{version:found.version+1});return reply(found);
  });
  return {rows,writes,searches,errors,pending,release:()=>release()};
}
const go=(page:Page,path:string)=>page.goto(path);
const form=(page:Page)=>page.locator("dialog.modal:not(.modal-confirm)[open]");
async function fillText(page:Page,title="새 자료") {await form(page).getByLabel("제목",{exact:false}).fill(title);await form(page).getByLabel("요약",{exact:false}).fill("새 요약");}

for(const [kind,label] of [["entities","엔터티"],["tasks","할 일"],["records","기록"]]) {
  test(`${kind}: 생성·보기·편집 메모·태그·삭제 이유`,async({page})=>{
    const state=await fixtures(page);await go(page,`/${kind}`);await page.getByRole("button",{name:kind==="records"?"기록 작성":`${label} 추가`,exact:true}).click();
    if(kind==="entities")await form(page).getByLabel("속성 1",{exact:false}).fill("새 엔터티");else await fillText(page,`새 ${label}`);
    await form(page).getByRole("button",{name:"같은 이름",exact:true}).click();await form(page).getByRole("button",{name:kind==="tasks"?"추가":"저장",exact:true}).click();
    await expect(page).toHaveURL(new RegExp(`/${kind}/`));await expect(form(page)).toHaveCount(1);
    await form(page).getByRole("button",{name:"편집",exact:true}).click();await expect(form(page)).toHaveCount(1);
    await form(page).getByRole("button",{name:"저장",exact:true}).click();await expect(form(page).getByText("편집 메모를 입력하세요.", {exact:true})).toBeVisible();
    await form(page).getByLabel("편집 메모",{exact:false}).fill("실측 결과 반영");
    if(kind==="entities")await form(page).getByLabel("속성 2",{exact:false}).fill("20");else await form(page).getByLabel("요약",{exact:false}).fill("편집한 요약");
    await form(page).getByRole("button",{name:"저장",exact:true}).click();await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeVisible();
    const patch=state.writes.find(w=>w.method==="PATCH")!;expect(patch.body.change_note).toBe("실측 결과 반영");expect(patch.body.request_id).toBeTruthy();expect(patch.body.tag_ids).toEqual([id(kind==="entities"?10:11)]);
    await form(page).getByRole("button",{name:"삭제",exact:true}).click();const confirm=page.getByRole("dialog",{name:kind==="entities"?"엔터티를 삭제할까요?":`${label}을 삭제할까요?`,exact:true});await confirm.getByLabel("이유 (선택)").fill("중복 자료 정리");await confirm.getByRole("button",{name:"삭제",exact:true}).click();
    await expect(page).toHaveURL(`http://127.0.0.1:55580/${kind}`);expect(state.writes.at(-1)?.params.get("change_note")).toBe("중복 자료 정리");expect(state.errors).toEqual([]);
  });
}
test("원칙: 최초 등록·현재 저장 새 ID·과거 정정·최신 삭제 승격·마지막 삭제",async({page})=>{
  const state=await fixtures(page,{emptyPrinciple:true});await go(page,"/principles");await page.getByRole("button",{name:"현재 원칙 등록"}).click();await fillText(page,"첫 기준");await form(page).getByRole("button",{name:"저장",exact:true}).click();
  const first=state.rows.principles[0].id;await form(page).getByRole("button",{name:"편집",exact:true}).click();await form(page).getByLabel("본문",{exact:false}).fill("둘째 정책");await form(page).getByLabel("편집 메모",{exact:false}).fill("환경 변화 반영");await form(page).getByRole("button",{name:"저장",exact:true}).click();
  await expect(page).not.toHaveURL(new RegExp(first));expect(state.rows.principles.filter(p=>p.is_current)).toHaveLength(1);await form(page).getByRole("button",{name:"목록으로"}).click();
  await page.getByRole("link",{name:"첫 기준 정정",exact:true}).click();await form(page).getByLabel("본문",{exact:false}).fill("정정 본문");await form(page).getByLabel("편집 메모",{exact:false}).fill("오타 정정");await form(page).getByRole("button",{name:"저장",exact:true}).click();expect(state.writes.at(-1)?.path).toContain("/correct");await expect(page).toHaveURL(/\/principles\?/);
  await page.getByRole("link",{name:"현재 원칙 보기"}).click();await form(page).getByRole("button",{name:"삭제",exact:true}).click();let confirm=page.getByRole("dialog",{name:"원칙을 삭제할까요?"});await expect(confirm).toContainText("현재 원칙이 됩니다");await expect(confirm).toContainText("정정 본문");await confirm.getByRole("button",{name:"삭제",exact:true}).click();
  await page.getByRole("link",{name:"현재 원칙 보기"}).click();await form(page).getByRole("button",{name:"삭제",exact:true}).click();confirm=page.getByRole("dialog",{name:"원칙을 삭제할까요?"});await expect(confirm).toContainText("현재 원칙이 없는 상태");await confirm.getByRole("button",{name:"삭제",exact:true}).click();await expect(page.getByRole("button",{name:"현재 원칙 등록"})).toBeVisible();expect(state.errors).toEqual([]);
});
for (const selected of [false, true]) test(`기록: 원칙 ${selected ? "선택 해제는 snapshot 삭제" : "삭제 뒤 설명 정정은 snapshot 보존"}`, async ({page}) => {
  const state = await fixtures(page), r = state.rows.records[0];
  Object.assign(r, {applied_principle_ids:selected ? [id(4)] : [], applied_principle_snapshots:[
    {id:id(4),title:"당시 기준",body:"보존할 당시 본문",summary:"당시 요약",version:1,saved_at:stamp,captured_at:"application",status:"active"}
  ]});
  await page.route("**/api/records/"+r.id, async route => {
    if(route.request().method() !== "PATCH") return route.fallback();
    const body = route.request().postDataJSON();
    state.writes.push({method:"PATCH",path:new URL(route.request().url()).pathname,body,params:new URLSearchParams()});
    if(Object.hasOwn(body,"applied_principle_ids")) r.applied_principle_snapshots = [];
    Object.assign(r,body,{version:r.version+1});await route.fulfill({json:r});
  });
  await go(page,`/records/${r.id}`);await expect(form(page)).toContainText("보존할 당시 본문");
  await form(page).getByRole("button",{name:"편집",exact:true}).click();
  if(selected) await form(page).getByRole("button",{name:"현재 기준 (선택한 저장본)",exact:true}).click();
  await form(page).getByLabel("요약",{exact:false}).fill("설명 정정");
  await form(page).getByLabel("편집 메모",{exact:false}).fill("당시 판단을 유지한 설명 정정");
  await form(page).getByRole("button",{name:"저장",exact:true}).click();
  await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeVisible();
  expect(state.writes).toHaveLength(1);
  if(selected) {
    expect(state.writes[0].body.applied_principle_ids).toEqual([]);
    await expect(form(page)).not.toContainText("보존할 당시 본문");
  } else {
    expect(state.writes[0].body).not.toHaveProperty("applied_principle_ids");
    await expect(form(page)).toContainText("보존할 당시 본문");
  }
  expect(state.errors).toEqual([]);
});

test("기록: 자동 변경 문맥·원칙 snapshot·정정 시스템 필드 제외",async({page})=>{
  const state=await fixtures(page);const r=state.rows.records[0];Object.assign(r,{record_kind:"change",change_note:"실측 반영",change:{event_id:id(30),target_kind:"entity",target_id:id(99),target_title:"삭제된 엔터티",action:"delete",source:"mcp",before:{prop2:10},after:null,path:null},applied_principle_snapshots:[{title:"당시 기준",body:"당시 본문",saved_at:stamp,summary:"당시 요약",captured_at:"migration"}]});
  await go(page,`/records/${r.id}`);await expect(form(page)).toContainText("에이전트");await expect(form(page)).toContainText("삭제된 대상");await expect(form(page)).toContainText("당시 본문");await expect(form(page)).toContainText("실제 판단 당시의 본문을 보증하지 않습니다.");await expect(form(page).getByRole("link",{name:"대상 원문 보기"})).toHaveCount(0);
  await form(page).getByRole("button",{name:"편집",exact:true}).click();await expect(form(page).getByLabel("수행 시각")).toHaveCount(0);await expect(form(page).getByText("활동 태그",{exact:true})).toHaveCount(0);await form(page).getByLabel("편집 메모",{exact:false}).fill("설명 정정");await form(page).getByRole("button",{name:"저장",exact:true}).click();
  expect(Object.keys(state.writes[0].body).sort()).toEqual(["body","change_note","expected_version","request_id","summary","title"].sort());expect(state.rows.entities[0].prop2).toBe(0);
  await form(page).getByRole("button",{name:"삭제",exact:true}).click();const confirm=page.getByRole("dialog",{name:"기록을 삭제할까요?"});await expect(confirm).toContainText("대상의 업무 상태는 되돌리지 않습니다.");await confirm.getByRole("button",{name:"삭제",exact:true}).click();await expect(page).toHaveURL(/\/records$/);expect(state.rows.entities[0].prop2).toBe(0);expect(state.rows.records).toHaveLength(0);expect(state.errors).toEqual([]);
});
test("검색: 키워드 기본·한글 IME·조건 scope·자동 대체·검색 지우기",async({page})=>{
  const state=await fixtures(page);await go(page,"/tasks");const input=page.getByLabel("검색어",{exact:true});await input.fill("한글");await input.dispatchEvent("compositionstart");await input.press("Enter");expect(state.searches).toHaveLength(0);await input.dispatchEvent("compositionend");await page.getByRole("button",{name:"검색",exact:true}).click();await expect(page.getByText("검색 결과 · 키워드 일치순")).toBeVisible();await expect.poll(()=>state.searches.at(-1)?.mode).toBe("keyword");
  await page.getByText("추가 조건",{exact:true}).click();await page.getByRole("button",{name:"반복",exact:true}).click();await expect.poll(()=>state.searches.at(-1)?.task_kind).toBe("recurring");await page.getByRole("button",{name:"중단됨",exact:true}).click();await expect.poll(()=>state.searches.at(-1)?.task_status).toBe("stopped");expect(state.searches.at(-1)?.kinds).toEqual(["task"]);
  await page.getByLabel("검색 방식").selectOption("auto");await expect(page.getByText("의미 검색을 사용할 수 없어 키워드 검색 결과를 표시합니다.")).toBeVisible();await page.getByRole("button",{name:"검색어 지우기"}).click();await expect(page).not.toHaveURL(/q=/);await expect(page.getByText("검색 결과 · 관련도순")).toHaveCount(0);expect(state.errors).toEqual([]);
});
for(const failure of ["unknown","conflict"] as const)test(`편집 ${failure}: 초안·중복 요청키·Escape 확인 취소`,async({page})=>{
  const state=await fixtures(page,{failWrite:failure});await go(page,`/tasks/${id(2)}?edit=1`);await form(page).getByLabel("제목",{exact:false}).fill("보존할 초안");await form(page).getByLabel("편집 메모",{exact:false}).fill("정정 이유");await form(page).getByRole("button",{name:"저장",exact:true}).click();await expect(form(page).getByRole("alert")).toBeVisible();await expect(form(page).getByLabel("제목",{exact:false})).toHaveValue("보존할 초안");
  await page.keyboard.press("Escape");const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();await expect(form(page).getByLabel("제목",{exact:false})).toHaveValue("보존할 초안");
  if(failure==="unknown"){await expect(form(page).getByLabel("제목",{exact:false})).toBeDisabled();await form(page).getByRole("button",{name:"같은 내용 다시 시도"}).click();expect(state.writes[1].body).toEqual(state.writes[0].body);}expect(state.errors).toEqual([]);
});
test("busy POP·dirty back/forward·reload·직접 링크",async({page})=>{
  const state=await fixtures(page,{hold:true});await go(page,"/tasks");await page.getByRole("link",{name:"할 일 편집",exact:true}).click();await form(page).getByLabel("편집 메모",{exact:false}).fill("저장 이유");await form(page).getByRole("button",{name:"저장",exact:true}).click();await state.pending;await page.goBack();await expect(page).toHaveURL(/edit=1/);await expect(page.getByRole("dialog",{name:"변경을 버릴까요?"})).not.toBeVisible();state.release();await expect(page).toHaveURL(/\/tasks\?/);
  await page.getByRole("link",{name:"할 일 편집",exact:true}).click();await form(page).getByLabel("제목",{exact:false}).fill("버리지 않을 초안");await page.goBack();const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();await expect(form(page).getByLabel("제목",{exact:false})).toHaveValue("버리지 않을 초안");await page.goBack();await confirm.getByRole("button",{name:"변경 버리기"}).click();await expect(page).toHaveURL(/\/tasks\?/);await page.goForward();await expect(form(page).getByLabel("제목",{exact:false})).toHaveValue("할 일");await page.reload();await expect(form(page).getByLabel("제목",{exact:false})).toHaveValue("할 일");expect(state.errors).toEqual([]);
});
for(const width of [320,360,390,639,640,768,1024,1440])test(`shell ${width}px: 긴 제목·본문 스크롤·키보드·단일 surface`,async({page},info)=>{
  const state=await fixtures(page,{long:true});await page.setViewportSize({width,height:800});await go(page,`/tasks/${id(2)}`);await expect(form(page)).toBeVisible();const dimensions=await form(page).evaluate(d=>{const r=d.getBoundingClientRect();return {width:r.width,height:r.height,scroll:document.documentElement.scrollWidth,viewport:innerWidth};});expect(dimensions.scroll).toBeLessThanOrEqual(width);expect(dimensions.width).toBeLessThanOrEqual(width<640?width:640);if(width<640)expect(dimensions.width).toBe(width);
  await form(page).locator(":scope > .modal-inner > .modal-body").evaluate(el=>{el.scrollTop=el.scrollHeight;});await expect(form(page).getByRole("button",{name:"닫기",exact:true})).toBeInViewport();await expect(form(page).getByRole("button",{name:"목록으로"})).toBeInViewport();await form(page).locator(":scope > .modal-inner > .modal-body").evaluate(el=>{el.scrollTop=0;});await form(page).getByRole("button",{name:"편집",exact:true}).click();await expect(form(page)).toHaveCount(1);await form(page).getByLabel("편집 메모",{exact:false}).fill("길이 검수");await page.keyboard.press("Tab");await page.screenshot({path:info.outputPath(`surface-${width}.png`)});await page.keyboard.press("Escape");await expect(page.getByRole("dialog",{name:"변경을 버릴까요?"})).toBeVisible();expect(state.errors).toEqual([]);
});

for(const width of [320,360,390,639,640,768,1024,1440])test(`소비 화면 ${width}px: 목록·원칙·기록·엔터티·태그`,async({page},info)=>{
  const state=await fixtures(page,{long:true});state.rows.tags[0].name="긴이름".repeat(10);await page.setViewportSize({width,height:800});
  for(const path of ["/entities","/tasks","/records","/principles","/tags/entity","/tags/activity"]){await go(page,path);await expect(page.getByRole("heading",{level:1})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path).toBe(true);}
  for(const [kind,n] of [["entities",1],["records",3],["principles",4]] as const){await go(page,`/${kind}/${id(n)}`);await expect(form(page)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),kind).toBe(true);await expect(form(page).getByRole("button",{name:"닫기",exact:true})).toBeInViewport();await page.screenshot({path:info.outputPath(`${kind}-${width}.png`)});}
  await go(page,`/tags/entity?view=${id(10)}`);await expect(form(page)).toBeVisible();await form(page).getByRole("button",{name:"편집",exact:true}).click();await expect(form(page)).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`tags-${width}.png`)});expect(state.errors).toEqual([]);
});
test("200% reflow·축소 visual viewport·한 글자 제목",async({page},info)=>{
  const state=await fixtures(page);state.rows.tasks[0].title="일";await page.setViewportSize({width:768,height:800});await go(page,`/tasks/${id(2)}?edit=1`);await page.evaluate(()=>{document.documentElement.style.zoom="2";});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await form(page).getByLabel("편집 메모",{exact:false}).fill("확대 확인");await page.setViewportSize({width:390,height:360});await expect(form(page).getByRole("button",{name:"저장",exact:true})).toBeInViewport();await page.screenshot({path:info.outputPath("zoom-keyboard-viewport.png")});expect(state.errors).toEqual([]);
});

test("태그: 두 사전 같은 이름·URL 보기/편집·CRUD·dirty scoped 이동",async({page})=>{
  const state=await fixtures(page);await go(page,"/tags/entity");await expect(page.getByRole("button",{name:"같은 이름 보기",exact:true})).toHaveCount(1);
  await page.getByRole("button",{name:"같은 이름 보기",exact:true}).click();await expect(form(page)).toContainText("엔터티에 사용하는 태그");await form(page).getByRole("button",{name:"편집",exact:true}).click();await expect(form(page)).toHaveCount(1);await form(page).getByRole("textbox",{name:/태그 이름/}).fill("엔터티 분류");await form(page).getByRole("button",{name:"저장",exact:true}).click();await expect(page.getByRole("button",{name:"엔터티 분류 이름 변경"})).toBeFocused();
  await page.getByRole("link",{name:"활동 태그 fixture"}).click();await expect(page.getByRole("button",{name:"같은 이름 이름 변경"})).toBeVisible();await expect(page.getByRole("button",{name:"엔터티 분류 이름 변경"})).toHaveCount(0);
  await page.getByRole("button",{name:"태그 추가",exact:true}).click();await form(page).getByRole("textbox",{name:/태그 이름/}).fill("활동 추가");await page.goBack();const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();await expect(form(page).getByRole("textbox",{name:/태그 이름/})).toHaveValue("활동 추가");await form(page).getByRole("button",{name:"저장",exact:true}).click();expect(state.writes.at(-1)?.body.scope).toBe("activity");
  await page.getByRole("button",{name:"활동 추가 삭제",exact:true}).click();await page.getByRole("dialog",{name:"태그를 삭제할까요?"}).getByRole("button",{name:"삭제",exact:true}).click();await expect(page.getByRole("button",{name:"활동 추가 삭제",exact:true})).toHaveCount(0);expect(state.errors).toEqual([]);
});

test("저장 성공 후 GET 실패·조회만 재시도·서버 conflict 초안 유지",async({page})=>{
  const state=await fixtures(page);let fail=false,patches=0;
  await page.route(`**/api/tasks/${id(2)}`,async route=>{if(route.request().method()==="PATCH"){patches++;Object.assign(state.rows.tasks[0],route.request().postDataJSON(),{version:2});fail=true;await route.fulfill({json:state.rows.tasks[0]});return;}if(fail){await route.fulfill({status:503,json:{code:"internal",message:"fixture GET failure"}});return;}await route.fulfill({json:state.rows.tasks[0]});});
  await go(page,`/tasks/${id(2)}`);await form(page).getByRole("button",{name:"편집",exact:true}).click();await form(page).getByLabel("편집 메모",{exact:false}).fill("수정 사유");await form(page).getByLabel("제목",{exact:false}).fill("최신 내용");await form(page).getByRole("button",{name:"저장",exact:true}).click();await expect(form(page).getByText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.")).toBeVisible();await expect(form(page).getByRole("heading",{name:"최신 내용",level:1})).toBeVisible();fail=false;await form(page).getByRole("button",{name:"조회 다시 시도"}).click();await expect(form(page).getByText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.")).toHaveCount(0);expect(patches).toBe(1);expect(state.errors).toEqual([]);
});

test("목록 페이지·조건·scroll/focus 왕복과 검색 anchor 재조회",async({page})=>{
  const state=await fixtures(page);const many=Array.from({length:21},(_,i)=>({...task(100+i),title:`행 ${i}`}));
  await page.route("**/api/tasks**",route=>{const url=new URL(route.request().url()),key=url.pathname.split("/").at(-1);if(key!=="tasks")return route.fulfill({json:many.find(t=>t.id===key)??state.rows.tasks.find(t=>t.id===key)});return route.fulfill({json:url.searchParams.get("cursor")?{items:many.slice(20),next_cursor:null}:{items:many.slice(0,20),next_cursor:"page2"}});});
  await go(page,"/tasks?kind=once");await page.getByRole("button",{name:"더 보기",exact:true}).click();await page.getByRole("link",{name:"행 20 편집",exact:true}).click();await form(page).getByRole("button",{name:"취소",exact:true}).click();await expect(page).toHaveURL(/kind=once&pages=2&scroll=/);await expect(page.locator(`#activity-tasks-${many[20].id}`)).toBeFocused();expect(await page.evaluate(()=>scrollY)).toBeGreaterThan(0);await page.reload();await expect(page.locator(`#activity-tasks-${many[20].id}`)).toBeFocused();
  await go(page,"/tasks?q=행&kind=once");await page.getByRole("link",{name:"할 일 보기",exact:true}).click();await form(page).getByRole("button",{name:"목록으로"}).click();await expect(page).toHaveURL(/q=행|q=%ED%96%89/);await expect(page.locator(`#activity-tasks-${id(2)}`)).toBeFocused();expect(state.searches.at(-1)?.anchor).toEqual({kind:"task",id:id(2)});expect(state.errors).toEqual([]);
});
