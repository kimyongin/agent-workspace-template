
for(const uncertain of [false,true]) test(`#181 반복 중단: 취소·재진입 메모/태그${uncertain?"·같은 요청 재시도":""}`,async({page})=>{
  const state=await fixtures(page),attempts:unknown[]=[];
  Object.assign(state.rows.tasks[0],{kind:"recurring",status:"active",timezone:"Asia/Seoul",recurrence:{freq:"daily",starts_on:"2026-10-04"}});
  await page.route("**/api/tasks/*/occurrences?**",route=>route.fulfill({json:{today:"2026-10-04",items:[]}}));
  await page.route("**/api/tasks/*/stop",route=>{attempts.push(route.request().postDataJSON());return route.abort("connectionreset");});
  await go(page,`/tasks/${id(2)}`);await form(page).getByRole("button",{name:"중단",exact:true}).click();
  await form(page).getByLabel("기록 메모",{exact:true}).fill("다음 주부터 계획 변경");
  await form(page).getByRole("button",{name:"같은 이름",exact:true}).click();
  if(uncertain){await form(page).getByRole("button",{name:"중단하고 저장"}).click();await expect(form(page).getByRole("button",{name:"같은 내용 다시 시도"})).toBeVisible();}
  await form(page).getByRole("button",{name:"취소",exact:true}).click();await form(page).getByRole("button",{name:"중단",exact:true}).click();
  await expect(form(page).getByLabel("기록 메모",{exact:true})).toHaveValue("다음 주부터 계획 변경");
  await expect(form(page).getByRole("button",{name:"같은 이름",exact:true})).toHaveAttribute("aria-pressed","true");
  if(uncertain){await expect(form(page).getByLabel("기록 메모",{exact:true})).toBeDisabled();await form(page).getByRole("button",{name:"같은 내용 다시 시도"}).click();await expect.poll(()=>attempts.length).toBe(2);expect(attempts[1]).toEqual(attempts[0]);}
  else expect(attempts).toHaveLength(0);
  expect(state.errors).toEqual([]);
});
test("#181 일반 기록: 취소한 삭제 메모의 검증이 본문 저장을 막지 않는다",async({page})=>{
  const state=await fixtures(page);await go(page,`/records/${id(3)}?edit=1&edit_from=view`);
  await form(page).getByRole("button",{name:"삭제",exact:true}).click();await form(page).getByLabel("기록 메모",{exact:true}).fill("x".repeat(22001));
  await form(page).getByRole("button",{name:"취소",exact:true}).click();await form(page).getByLabel("본문",{exact:false}).fill("유효한 본문");
  await saveOnce(page,form(page));await expect.poll(()=>state.writes.length).toBe(1);expect(state.writes[0].body.body).toBe("유효한 본문");
});
import { openDetailEditor, openListEditor, fillChangeMemo } from "./ui-actions.ts";
import { recordDisplayText } from "../supabase/functions/_shared/contracts/record-display.ts";
import { saveOnce, beginTabAction, discardEditor } from "./ui-actions.ts";
import { expect, test, type Page } from "@playwright/test";
for (const [kind,n,label] of [["entities",1,"속성 1"],["tasks",2,"제목"],["principles",4,"제목"]] as const) test(`#181 ${kind}: 작은 단일 확인 단계·취소 초안 보존·기록 태그`,async({page},info)=>{
  const state=await fixtures(page);await page.setViewportSize({width:390,height:844});await go(page,`/${kind}/${id(n)}?edit=1&edit_from=view`);
  await form(page).getByRole("textbox",{name:`${label} (필수)`,exact:true}).fill("변경 초안");
  await expect(form(page).getByLabel("기록 메모")).toHaveCount(0);
  await form(page).getByRole("button",{name:kind==="tasks"?"저장":"저장",exact:true}).click();
  await expect(form(page).getByLabel("기록 메모")).toHaveValue("변경 초안 수정");
  await expect(page.locator("dialog[open]")).toHaveCount(1);expect(state.writes).toHaveLength(0);
  const box=(await form(page).boundingBox())!;expect(box.height).toBeLessThan(844-32);expect(box.y).toBeGreaterThan(0);
  await form(page).getByLabel("기록 메모").fill("금요일 일정에 맞춰 수정함");
  await form(page).getByRole("group",{name:"기록 태그",exact:true}).getByRole("button",{name:"같은 이름",exact:true}).click();
  await page.screenshot({path:info.outputPath(`confirmation-${kind}.png`)});
  await form(page).getByRole("button",{name:"취소",exact:true}).click();
  await expect(form(page).getByRole("textbox",{name:`${label} (필수)`,exact:true})).toHaveValue("변경 초안");
  await expect(form(page).getByRole("button",{name:"저장",exact:true})).toBeFocused();
  await form(page).getByRole("button",{name:"저장",exact:true}).click();
  await expect(form(page).getByLabel("기록 메모")).toHaveValue("금요일 일정에 맞춰 수정함");
  await form(page).getByRole("button",{name:"수정하고 저장",exact:true}).click();
  await expect.poll(()=>state.writes.length).toBe(1);
  expect(state.writes[0].body.change_note).toBe("금요일 일정에 맞춰 수정함");expect(state.writes[0].body.change_tag_ids).toEqual([id(11)]);
  expect(state.writes[0].body.tag_ids??[]).toEqual([]);expect(state.errors).toEqual([]);
});
test("#181 응답 유실은 확인 입력을 고정하고 같은 ID/version·메모·태그로 재시도",async({page})=>{
  const state=await fixtures(page,{failWrite:"unknown"});await go(page,`/entities/${id(1)}?edit=1&edit_from=view`);
  await form(page).getByLabel("속성 1",{exact:false}).fill("수정");await form(page).getByRole("button",{name:"저장",exact:true}).click();
  await form(page).getByLabel("기록 메모").fill("동일 요청 메모");await form(page).getByRole("button",{name:"수정하고 저장",exact:true}).click();
  await expect(form(page).getByRole("button",{name:"같은 내용 다시 시도",exact:true})).toBeVisible();await expect(form(page).getByLabel("기록 메모")).toBeDisabled();
  await form(page).getByRole("button",{name:"같은 내용 다시 시도",exact:true}).click();await expect.poll(()=>state.writes.length).toBe(2);
  expect(state.writes[1]).toEqual(state.writes[0]);expect(state.errors).toEqual([]);
});
test("#181 일반 기록은 바로 저장하고 삭제만 작은 메모·태그 확인을 사용",async({page})=>{
  const state=await fixtures(page);await go(page,`/records/${id(3)}?edit=1&edit_from=view`);
  await form(page).getByLabel("본문",{exact:false}).fill("직접 기록 정정");await form(page).getByRole("button",{name:"저장",exact:true}).click();
  await expect.poll(()=>state.writes.length).toBe(1);expect(state.writes[0].body.change_note).toBeUndefined();
  await form(page).getByRole("button",{name:"편집",exact:true}).click();await form(page).getByRole("button",{name:"삭제",exact:true}).click();
  await expect(form(page).getByLabel("기록 메모")).toBeVisible();await expect(page.locator("dialog[open]")).toHaveCount(1);
  await form(page).getByLabel("기록 메모").fill("중복 자료 삭제");await form(page).getByRole("button",{name:"삭제하고 기록",exact:true}).click();
  await expect.poll(()=>state.writes.length).toBe(2);expect(state.writes[1].params.get("change_note")).toBe("중복 자료 삭제");expect(state.errors).toEqual([]);
});
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
const connectedTarget=(page:Page,kind:typeof targetCases[number][0])=>form(page).getByRole("region",{name:`${{entity:"엔터티",task:"할 일",record:"기록",principle:"원칙"}[kind]} (1개)`,exact:true});
for(const kind of ["entity","task"] as const)for(const deleted of [false,true])test(`#183 ${kind}: 사건 대상·기존 연결을 한 카드로 통합${deleted?"·삭제된 대상":""}`,async({page},info)=>{
  const state=await fixtures(page),r=state.rows.records[0],targetId=id(kind==="entity"?1:2);
  state.rows.entities.push({...entity(5),prop1:"다른 연결 엔터티"});
  Object.assign(r,{record_kind:"change",task_id:id(2),occurrence_on:"2026-10-04",entity_ids:[id(1),id(1),id(5)],entity_context:[{id:id(1),title:"중복된 연결 제목",source:"selection",captured_at:stamp},{id:id(5),title:"다른 연결 엔터티",source:"selection",captured_at:stamp}],change:{event_id:id(30),target_kind:kind,target_id:targetId,target_title:"당시 대상",action:deleted?"delete":"update",source:"http",before:null,after:null,path:null}});
  const original=JSON.stringify(r);
  if(deleted)await page.route(`**/api/${kind==="entity"?"entities":"tasks"}/${targetId}`,route=>route.fulfill({status:404,json:{code:"not_found",message:"항목을 찾을 수 없습니다"}}));
  await page.setViewportSize({width:390,height:844});await go(page,`/records/${r.id}`);
  const entities=form(page).getByRole("region",{name:"엔터티 (2개)",exact:true}),tasks=connectedTarget(page,"task");
  await expect(entities).toHaveCount(1);await expect(entities.locator(".related-item")).toHaveCount(2);await expect(tasks.locator(".related-item")).toHaveCount(1);
  await expect(form(page).getByRole("heading",{name:/^변경 대상/})).toHaveCount(0);
  const changed=kind==="entity"?entities:tasks;
  await expect(changed.locator(".related-item").filter({hasText:"당시 대상"})).toHaveCount(1);
  await expect(changed).toContainText(deleted?"삭제":"수정");
  await expect(entities.getByRole("button",{name:"다른 연결 엔터티",exact:true})).toHaveAttribute("aria-expanded","false");
  if(deleted){await expect(changed).toContainText("삭제된 대상 또는 접근할 수 없는 대상");await expect(changed.getByRole("button",{name:"당시 대상",exact:true})).toHaveCount(0);}
  else await expect(changed.getByRole("button",{name:"당시 대상",exact:true})).toHaveAttribute("aria-expanded","false");
  if(kind==="task"){await expect(tasks).toContainText("2026-10-04 회차");if(!deleted)await expect(tasks).toContainText("진행 중");}
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`record-relations-${kind}-${deleted}.png`)});
  expect(JSON.stringify(r)).toBe(original);expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
for(const [kind,route,n] of targetCases) for(const outcome of ["exists","deleted","foreign","failed"] as const)test(`변경 대상 ${kind}: ${outcome} 현재 조회와 역사 metadata 분리`,async({page})=>{
  const state=await fixtures(page),r=state.rows.records[0];
  const change={event_id:id(30),target_kind:kind,target_id:id(n),target_title:"당시 대상 이름",action:"update",source:"mcp",before:{title:"수정 전"},after:{title:"수정 후"},path:`/${route}/${id(n)}`};
  Object.assign(r,{record_kind:"change",body:"당시 편집 근거",change});
  const original=JSON.stringify(r);let reads=0,fail=outcome==="failed";
  await page.route(`**/api/${route}/${id(n)}`,endpoint=>{reads++;return outcome==="deleted"||outcome==="foreign"?endpoint.fulfill({status:404,json:{code:"not_found",message:"항목을 찾을 수 없습니다"}}):fail?endpoint.fulfill({status:503,json:{code:"internal",message:"조회 실패"}}):endpoint.fulfill({json:{id:id(n)}});});
  await go(page,`/records/${r.id}`);
  const target=connectedTarget(page,kind);
  await expect(target.locator(".related-item .item-title")).toContainText(change.target_title);
  const link=target.getByRole("button",{name:change.target_title,exact:true});
  if(outcome==="exists")await expect(link).toHaveAttribute("aria-expanded","false");
  else if(outcome==="failed"){
    await expect(form(page)).toContainText("대상의 현재 상태를 확인하지 못했습니다.");
    await expect(form(page)).not.toContainText("삭제된 대상");await expect(link).toHaveCount(0);
    fail=false;await form(page).getByRole("button",{name:"대상 다시 조회",exact:true}).click();
    await expect(link).toHaveAttribute("aria-expanded","false");expect(reads).toBe(2);
  }else{await expect(form(page)).toContainText("삭제된 대상 또는 접근할 수 없는 대상");await expect(link).toHaveCount(0);}
  await expect(form(page)).toContainText("당시 대상 이름");await expect(form(page)).toContainText("수정 전");await expect(form(page)).toContainText("수정 후");await expect(form(page)).toContainText("당시 편집 근거");await expect(form(page)).toContainText("에이전트");
  expect(JSON.stringify(r)).toBe(original);expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
  if(kind==="task"&&outcome==="exists"){
    await page.unroute(`**/api/${route}/${id(n)}`);await go(page,`/records/${r.id}`);
    const card=connectedTarget(page,kind).getByRole("button",{name:change.target_title,exact:true});await card.click();
    await expect(card).toHaveAttribute("aria-expanded","true");await expect(page).toHaveURL(new RegExp(`/records/${r.id}$`));expect(state.writes).toHaveLength(0);

  }
});

for(const failure of [401,403,500,"network","other404"] as const)test(`변경 대상 조회 ${failure}: 삭제로 오인하지 않고 GET 재시도`,async({page})=>{
  const state=await fixtures(page),r=state.rows.records[0];Object.assign(r,{record_kind:"change",change:{event_id:id(30),target_kind:"entity",target_id:id(1),target_title:"당시 이름",action:"create",source:"http",before:null,after:{prop1:"당시 이름"},path:`/entities/${id(1)}`}});
  await page.route(`**/api/entities/${id(1)}`,endpoint=>failure==="network"?endpoint.abort("connectionreset"):endpoint.fulfill({status:failure==="other404"?404:failure,json:{code:failure===401?"unauthenticated":failure===403?"forbidden":"internal",message:"조회 실패"}}));
  await go(page,`/records/${r.id}`);await expect(form(page)).toContainText("대상의 현재 상태를 확인하지 못했습니다.");await expect(form(page)).not.toContainText("삭제된 대상");await expect(connectedTarget(page,"entity").getByRole("button",{name:"당시 이름",exact:true})).toHaveCount(0);
  await expect(form(page).getByRole("button",{name:"대상 다시 조회",exact:true})).toBeEnabled();expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

test("변경 대상 목록은 추가 조회 없이 당시 행동만 표시·늦은 상세 응답은 다음 대상에 반영하지 않는다",async({page})=>{
  const state=await fixtures(page),r=state.rows.records[0];
  const historical={event_id:id(30),target_kind:"entity",target_id:id(1),target_title:"첫 대상",action:"create",source:"http",before:null,after:{prop1:"첫 대상"},path:`/entities/${id(1)}`};
  Object.assign(r,{record_kind:"change",change:historical});const second={...record(32),record_kind:"change",change:{...historical,target_id:id(99),target_title:"다음 대상",path:`/entities/${id(99)}`}};state.rows.records.push(second);
  let reads=0,release=()=>{};const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route(`**/api/entities/${id(1)}`,async endpoint=>{reads++;await held;await endpoint.fulfill({json:state.rows.entities[0]}).catch(()=>{});});
  await go(page,"/records");await expect(page.locator(".records .list")).toContainText("첫 대상");expect(reads).toBe(0);await expect(page.locator(".records .list")).not.toContainText("삭제된 대상");
  await go(page,`/records/${r.id}`);await expect(form(page).getByRole("status",{name:"변경 대상 조회"})).toBeVisible();await expect.poll(()=>reads).toBe(1);
  await go(page,`/records/${second.id}`);await expect(form(page)).toContainText("삭제된 대상 또는 접근할 수 없는 대상");release();
  await expect(form(page)).toContainText("다음 대상");await expect(connectedTarget(page,"entity").getByRole("button",{name:"다음 대상",exact:true})).toHaveCount(0);expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

for(const [kind,label] of [["entities","엔터티"],["tasks","할 일"],["records","기록"],["principles","원칙"]])test(`${kind}: uncertain 생성 폐기 후 새 작성은 새로운 요청키`,async({page})=>{
  const state=await fixtures(page,{failWrite:"unknown",emptyPrinciple:true});await go(page,`/${kind}`);
  const begin=()=>beginTabAction(page,kind==="principles"?"현재 원칙 등록":kind==="records"?"기록 작성":`${label} 추가`);
  const fill=async(value:string)=>{if(kind==="entities")await form(page).getByLabel("속성 1",{exact:false}).fill(value);else await fillText(page,value);};
  const submit=()=>saveOnce(page, form(page), kind==="tasks"?"추가":"저장");
  await begin();await fill("첫 작성");await submit();await expect(form(page).getByRole("button",{name:"같은 내용 다시 시도"})).toBeVisible();
  await discardEditor(page);await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();
  await expect(form(page)).toHaveCount(0);await begin();await fill("새 작성");await submit();await expect(state.writes).toHaveLength(2);
  expect(state.writes[1].body.id).not.toBe(state.writes[0].body.id);expect(state.errors).toEqual([]);
});

for(const [kind,n] of [["entities",1],["tasks",2],["records",3],["principles",4]] as const)test(`${kind}: uncertain 편집 폐기 후 새 편집은 같은 버전에 새 메모`,async({page})=>{
  const state=await fixtures(page,{failWrite:"unknown"});await go(page,`/${kind}/${id(n)}`);
  await compatibleEdit(page);if(kind==="records")await form(page).getByLabel("본문",{exact:false}).fill("첫 수정");else await fillChangeMemo(page,form(page),"첫 수정");await saveOnce(page, form(page));
  await expect(form(page).getByRole("button",{name:"같은 내용 다시 시도"})).toBeVisible();await discardEditor(page);
  await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();
  await go(page,`/${kind}/${id(n)}`);
  await compatibleEdit(page);if(kind==="records")await form(page).getByLabel("본문",{exact:false}).fill("새 수정");else await fillChangeMemo(page,form(page),"새 수정");await saveOnce(page, form(page));
  await expect.poll(()=>state.writes.length).toBe(2);expect(state.writes[1].body.expected_version).toBe(state.writes[0].body.expected_version);expect(state.writes[1].body[kind==="records"?"body":"change_note"]).toBe("새 수정");expect(state.errors).toEqual([]);
});

test("dirty 작성 조건 이동 승인: create 유지 URL도 새 초안",async({page})=>{
  const state=await fixtures(page);await go(page,"/tasks?create=1");await fillText(page,"버릴 작성 초안");
  // Native dialog makes background links inert; trigger the route guard through the fixture router.
  await page.getByRole("link",{name:"작성 조건 변경 fixture"}).evaluate(el=>el.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true})));
  const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"변경 버리기"}).click();
  await expect(page).toHaveURL(/tasks\?create=1&kind=recurring$/);await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("");expect(state.errors).toEqual([]);
});

for(const [kind,label,submit] of [["task","할 일 작성","추가"],["record","기록 작성","저장"]])test(`엔터티 관련 ${kind}: uncertain 폐기 후 새 작성은 새 요청키`,async({page})=>{
  const state=await fixtures(page,{failWrite:"unknown"});await go(page,`/entities/${id(1)}`);
  await form(page).getByRole("button",{name:label,exact:true}).click();await fillText(page,"첫 연결 작성");await saveOnce(page, form(page), submit);
  await expect(form(page).getByRole("button",{name:"같은 내용 다시 시도"})).toBeVisible();await discardEditor(page);
  await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();await expect(page).not.toHaveURL(/create=/);await go(page,`/entities/${id(1)}`);
  await form(page).getByRole("button",{name:label,exact:true}).click();await fillText(page,"새 연결 작성");await saveOnce(page, form(page), submit);
  await expect.poll(()=>state.writes.length).toBe(2);expect(state.writes[1].body.id).not.toBe(state.writes[0].body.id);expect(state.errors).toEqual([]);
});

test("엔터티 create/edit 복합 직접 링크는 연결 작성 한 폼만 연다",async({page})=>{
  const state=await fixtures(page);await go(page,`/entities/${id(1)}?create=task&edit=1`);
  await expect(form(page)).toHaveCount(1);await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toBeVisible();await expect(form(page).getByLabel("속성 1",{exact:false})).toHaveCount(0);
  await fillText(page,"연결 작성 한 번");await saveOnce(page, form(page), "추가");await expect.poll(()=>state.writes.length).toBe(1);expect(state.writes[0].body.entity_ids).toEqual([id(1)]);expect(state.errors).toEqual([]);
});

for(const [kind,label] of [["task","할 일 작성"],["record","기록 작성"]] as const) test(`엔터티 연결 ${kind}: 취소·폐기 승인은 작성 URL을 닫고 reload는 읽기`,async({page})=>{
  const state=await fixtures(page);await go(page,`/entities/${id(1)}?list=%2Fentities%3Fq%3D%EC%97%94%ED%84%B0%ED%8B%B0`);
  for(const dirty of [false,true]){
    await form(page).getByRole("button",{name:label,exact:true}).click();await expect(page).toHaveURL(new RegExp(`create=${kind}`));
    if(dirty) await fillText(page,"폐기할 연결 작성");
    await form(page).getByRole("button",{name:"취소",exact:true}).click();
    if(dirty){
      const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();
      await expect(form(page).getByRole("textbox",{name:kind==="record"?/^본문/:/^제목/})).toHaveValue("폐기할 연결 작성");
      await form(page).getByRole("button",{name:"취소",exact:true}).click();await confirm.getByRole("button",{name:"변경 버리기"}).click();
    }
    await expect(page).not.toHaveURL(/create=/);await expect(page).toHaveURL(/list=/);
    await expect(form(page).getByRole("button",{name:label,exact:true})).toBeFocused();
  }
  await page.reload();await expect(form(page).getByRole("button",{name:label,exact:true})).toBeVisible();
  await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveCount(0);expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

test("태그 DELETE pending: Back·경로 이동·reload 보호와 응답 뒤 복귀",async({page})=>{
  const state=await fixtures(page,{hold:true});await go(page,"/entities");
  await page.getByRole("link",{name:"기록 태그 fixture",exact:true}).click();
  await page.getByRole("button",{name:"같은 이름 삭제",exact:true}).click();
  const confirm=page.locator("dialog.modal-action[open]");await saveOnce(page,confirm,"삭제 확인",false);await state.pending;
  await expect(confirm.getByRole("button",{name:"삭제 중…"})).toBeDisabled();await expect(confirm.getByRole("button",{name:"취소",exact:true})).toBeDisabled();
  await page.goBack();await expect(page).toHaveURL(/tags\/record$/);await expect(confirm).toBeVisible();
  await page.getByRole("link",{name:"엔터티 fixture",exact:true}).evaluate(el=>el.dispatchEvent(new MouseEvent("click",{bubbles:true,cancelable:true})));
  await expect(page).toHaveURL(/tags\/record$/);await expect(page.getByRole("dialog",{name:"변경을 버릴까요?"})).toHaveCount(0);
  expect(await page.evaluate(()=>{const event=new Event("beforeunload",{cancelable:true});window.dispatchEvent(event);return event.defaultPrevented;})).toBe(true);
  await page.keyboard.press("Escape");await expect(confirm).toBeVisible();state.release();
  await expect(confirm).toHaveCount(0);await expect(page.getByRole("button",{name:"같은 이름 삭제",exact:true})).toHaveCount(0);
  await expect(page.getByRole("heading",{name:"기록 태그 관리",exact:true})).toBeFocused();
  await page.goBack();await expect(page).toHaveURL(/entities$/);expect(state.writes).toHaveLength(1);expect(state.errors).toEqual([]);
});

test("태그 scoped 상세/편집·legacy ID 직접 링크 호환",async({page})=>{
  const state=await fixtures(page);await go(page,`/tags/entity/${id(10)}`);await expect(page).toHaveURL(/tags\/entity\?edit=/);await expect(form(page).getByRole("textbox",{name:/태그 이름/})).toHaveValue("같은 이름");
  await go(page,`/tags/entity/${id(10)}?edit=1`);await expect(form(page).getByRole("textbox",{name:/태그 이름/})).toHaveValue("같은 이름");
  await go(page,`/tags/${id(11)}`);await expect(page).toHaveURL(/tags\/record\?edit=/);await expect(form(page).getByRole("textbox",{name:/태그 이름/})).toHaveValue("같은 이름");expect(state.errors).toEqual([]);
});

test("원칙 삭제 실패는 메모를 보존하고 단일 요청으로 재시도한다",async({page})=>{
  const state=await fixtures(page);await go(page,`/principles/${id(4)}?edit=1`);let failed=true;const attempts:Record<string,unknown>[]=[];
  await page.route(`**/api/principles/${id(4)}/delete`,route=>{attempts.push(route.request().postDataJSON());if(failed)return route.fulfill({status:422,json:{code:"validation_failed",message:"저장 실패"}});state.rows.principles=state.rows.principles.filter(r=>r.id!==id(4));return route.fulfill({status:204});});
  await form(page).getByRole("button",{name:"삭제",exact:true}).click();const confirm=page.locator("dialog.modal-action[open]");
  await confirm.getByLabel("기록 메모").fill("보존할 이유");await saveOnce(page,confirm,"삭제 확인");await expect(confirm).toContainText("저장 실패");
  await expect(confirm.getByLabel("기록 메모")).toHaveValue("보존할 이유");expect(attempts).toHaveLength(1);
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
  const confirm=page.locator("dialog.modal-action[open]");await confirm.getByLabel("기록 메모").fill("긴 삭제 메모\\n".repeat(300));
  const bounds=await confirm.boundingBox();expect(bounds!.width).toBeLessThanOrEqual(width-32);expect(bounds!.height).toBeLessThanOrEqual(328);
  await confirm.locator(".modal-body").evaluate(el=>{el.scrollTop=el.scrollHeight;});await expect(confirm.getByRole("button",{name:"삭제하고 기록",exact:true})).toBeInViewport();
  await expect(confirm.getByRole("button",{name:"취소",exact:true})).toBeInViewport();expect(state.errors).toEqual([]);
});

for(const [kind,title] of [["entities","엔터티 편집"],["tasks","할 일 편집"],["records","기록 편집"],["principles","현재 원칙 편집"]])test(`${kind}: 목록 편집 닫기는 한 번에 목록·초점으로 복귀`,async({page})=>{
  const state=await fixtures(page);await go(page,`/${kind}`);await openListEditor(page,kind==="entities"?"엔터티":kind==="tasks"?"할 일":kind==="records"?"기록":"현재 기준");
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
  await form(page).getByRole("button",{name:"할 일 작성",exact:true}).click();await expect(page).toHaveURL(/create=task/);await expect(form(page)).toHaveCount(1);
  await fillText(page,"연결 업무");await page.goBack();const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();
  await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("연결 업무");await saveOnce(page, form(page), "추가");
  await expect(page).not.toHaveURL(/create=/);expect(state.writes[0].body.entity_ids).toEqual([id(1)]);await expect(form(page)).not.toContainText("할 일을 추가했습니다.");await expect(form(page).getByRole("button",{name:"할 일 작성",exact:true})).toBeFocused();
  await form(page).getByRole("button",{name:"기록 작성",exact:true}).click();await page.reload();await expect(form(page).getByLabel("본문")).toHaveValue("");
  expect(state.errors).toEqual([]);
});

test("반복 중단·재개 메모·결과 생성은 같은 surface",async({page})=>{
  const state=await fixtures(page);Object.assign(state.rows.tasks[0],{kind:"recurring",status:"active",timezone:"Asia/Seoul",recurrence:{freq:"daily",starts_on:"2026-10-04"}});
  await page.route("**/api/tasks/*/occurrences?**",route=>route.fulfill({json:{today:"2026-10-04",items:[]}}));
  for(const [action,status,label] of [["stop","stopped","중단"],["resume","active","재개"]]){
    await page.route("**/api/tasks/*/"+action,route=>{const body=route.request().postDataJSON();Object.assign(state.rows.tasks[0],{status,version:state.rows.tasks[0].version+1});state.writes.push({method:"POST",path:new URL(route.request().url()).pathname,body,params:new URLSearchParams()});return route.fulfill({json:state.rows.tasks[0]});});
    await go(page,`/tasks/${id(2)}`);await form(page).getByRole("button",{name:label,exact:true}).click();await expect(form(page)).toHaveCount(1);
    await expect(form(page).getByRole("button",{name:label+"하고 저장",exact:true})).toBeVisible();
    await fillChangeMemo(page,form(page),label+" 이유");await saveOnce(page,form(page),label);
    await expect(form(page).getByRole("button",{name:label==="중단"?"재개":"중단",exact:true})).toBeVisible();expect(state.writes.at(-1)?.body.change_note).toBe(label+" 이유");
  }
  Object.assign(state.rows.tasks[0],task());await go(page,`/tasks/${id(2)}`);
  await page.route("**/api/tasks/*/complete",route=>{const result={...record(40),...route.request().postDataJSON(),task_id:id(2),record_kind:"result"};state.rows.records.push(result);Object.assign(state.rows.tasks[0],{status:"done",version:state.rows.tasks[0].version+1,result_record:{id:result.id,body:result.body}});return route.fulfill({json:state.rows.tasks[0]});});
  await form(page).getByRole("button",{name:"완료하고 기록",exact:true}).click();await expect(form(page).getByRole("heading",{name:"할 일 완료",exact:true})).toBeVisible();await fillText(page,"수행 결과");await form(page).getByRole("button",{name:"완료하고 기록 저장",exact:true}).click();
  await expect(form(page).getByRole("button",{name:"수행 결과",exact:true})).toBeVisible();expect(state.rows.records.at(-1)?.record_kind).toBe("result");expect(state.errors).toEqual([]);
});

const stamp="2026-10-04T03:00:00Z", id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;

for(const width of [320,360,390,639,640,768,1024,1440])test(`시각 위계 ${width}px: 제목·보조 정보·편집 정렬과 검색·가이드`,async({page},info)=>{
  await page.setViewportSize({width,height:900});
  const state=await fixtures(page);state.rows.tasks[0].title="긴 제목 ".repeat(8);state.rows.tasks[0].change_note="강조하지 않을 보충 메모";
  const typography=async(selector:string)=>page.locator(selector).first().evaluate(el=>{const s=getComputedStyle(el);return {size:parseFloat(s.fontSize),weight:Number(s.fontWeight),color:s.color};});
  for(const path of ["/entities","/tasks","/records","/principles","/tags/entity","/tags/record","/search","/guide"]){
    await go(page,path);await expect(page.locator(path.startsWith("/tags")?"dialog[open]:not(.modal-confirm) .dialog-title":".page-title")).toBeVisible();
    if(!["/search","/guide"].includes(path))await expect(page.locator(".item-title").first()).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path).toBe(true);
    if(await page.locator(".item-title").count()){
      const title=await typography(".item-title"),pageTitle=await typography(path.startsWith("/tags")?".dialog-title":".page-title");expect(pageTitle.size).toBeGreaterThan(title.size);expect(title.weight).toBeGreaterThanOrEqual(600);
      if(await page.locator(".secondary").count()){const secondary=await typography(".secondary");expect(title.size).toBeGreaterThan(secondary.size);expect(title.weight).toBeGreaterThan(secondary.weight);expect(title.color).not.toBe(secondary.color);}
    }
    if(path==="/tasks"){
      const heading=page.locator(".activity-item-heading").first(),title=heading.locator(".item-title"),edit=heading.locator(".activity-item-actions a");
      const t=(await title.boundingBox())!;await expect(edit).toHaveCount(0);expect(t.height).toBeGreaterThanOrEqual(44);
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
  await expect(form(page).getByRole("button",{name:"연결된 엔터티",exact:true})).toBeVisible();await expect(form(page).getByText("연결 당시 정보",{exact:true})).toHaveCount(0);
  expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

for(const width of [320,390,1024])test(`엔터티 연결 목록 ${width}px: 종류·본문 대표 문구·시각·행 구획과 간결한 상세`,async({page},info)=>{
  const state=await fixtures(page),title="memo-edd743a2-2a0c-455b-b3ad-312e05d47d4e 등록";
  Object.assign(state.rows.entities[0],{records:{count:2,items:[{id:id(3),body:"상담 판단 정리",record_kind:"user",occurred_at:stamp,updated_at:stamp},{id:id(30),body:title,record_kind:"change",occurred_at:stamp,updated_at:stamp}]}});
  await page.setViewportSize({width,height:900});await go(page,`/entities/${id(1)}`);
  const section=form(page).locator(".related-section").filter({has:page.getByRole("heading",{name:"기록 (2개)",exact:true})}),rows=section.locator(".related-item");
  await expect(rows).toHaveCount(2);await expect(rows.first()).toContainText("직접 작성");await expect(rows.first()).toContainText("상담 판단 정리");
  await expect(rows.last()).toContainText("변경 기록");await expect(rows.last().getByRole("button",{name:title,exact:true})).toHaveCount(1);
  await expect(rows.locator("time")).toHaveCount(2);await expect(form(page).getByRole("link",{name:"전체 할 일 보기",exact:true})).toHaveCount(0);
  await expect(section.getByRole("link",{name:"전체 기록 보기",exact:true})).toHaveCount(0);
  await expect(form(page).getByRole("button",{name:"할 일 작성",exact:true})).toBeVisible();
  for(const section of await form(page).locator(".detail-management > .related-section").all())expect(await section.evaluate(el=>getComputedStyle(el).borderTopWidth)).toBe("0px");
  for(const row of await rows.all())expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await section.screenshot({path:info.outputPath(`entity-related-${width}.png`)});
  await rows.first().getByRole("button",{name:"상담 판단 정리",exact:true}).click();await expect(page).toHaveURL(new RegExp(`/entities/${id(1)}$`));expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
test("연결 엔터티 범위: 각 탭 조회·검색 조건·본문 왕복·해제",async({page})=>{
  const state=await fixtures(page);for(const kind of ["tasks","records"]){state.rows[kind][0].entity_ids=[id(1)];state.rows[kind][0].entity_context=[{id:id(1),title:"엔터티",source:"selection",captured_at:stamp}];}
  state.rows.entities[0].tasks={count:1,items:[{id:id(2),title:"할 일",updated_at:stamp}]};
  const reads:{kind:string;params:URLSearchParams}[]=[];
  for(const kind of ["tasks","records"])await page.route(`**/api/${kind}?**`,route=>{const params=new URL(route.request().url()).searchParams;reads.push({kind,params});return route.fulfill({json:{items:state.rows[kind].filter(row=>!params.has("entity_id")||(row.entity_ids as string[]).includes(params.get("entity_id")!)),next_cursor:null}});});
  await go(page,`/entities/${id(1)}`);await expect(form(page).getByRole("link",{name:"전체 할 일 보기",exact:true})).toHaveCount(0);await go(page,`/tasks?entity_id=${id(1)}`);await expect(page.getByText("연결된 엔터티: 엔터티",{exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get("entity_id")).toBe(id(1));await expect.poll(()=>reads.length).toBe(1);expect(reads[0].kind).toBe("tasks");expect(reads[0].params.get("entity_id")).toBe(id(1));
  await page.getByRole("button",{name:"같은 이름",exact:true}).click();await page.getByLabel("검색어",{exact:true}).fill("할");await expect.poll(()=>state.searches.length).toBe(1);expect(state.searches[0].entity_id).toBe(id(1));expect(state.searches[0].tag_ids).toEqual([id(12)]);expect(state.searches[0]).not.toHaveProperty("from");
  await page.getByRole("link",{name:"할 일",exact:true}).click();await form(page).getByRole("button",{name:"닫기",exact:true}).click();await expect(page.getByText("연결된 엔터티: 엔터티",{exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get("entity_id")).toBe(id(1));
  await page.getByRole("button",{name:"엔터티 범위 해제",exact:true}).click();await expect(page).not.toHaveURL(/entity_id=/);await expect.poll(()=>state.searches.length).toBe(3);expect(state.searches.at(-1)).not.toHaveProperty("entity_id");expect(new URL(page.url()).searchParams.get("q")).toBe("할");
  await go(page,`/records?entity_id=${id(1)}&from=2026-10-01&q=기록`);await expect(page.locator(".records .list .item-title")).toBeVisible();expect(state.searches.at(-1)?.kinds).toEqual(["record"]);expect(state.searches.at(-1)?.from).toBeTruthy();expect(state.searches.at(-1)?.entity_id).toBe(id(1));expect(state.errors).toEqual([]);
});
for(const kind of ["tasks","records"] as const) test(`${kind} 보기의 연결 대상은44px 펼침으로 엔터티 내용을 읽는다`,async({page})=>{
  const state=await fixtures(page),row=state.rows[kind][0];row.entity_ids=[id(1)];row.entity_context=[{id:id(1),title:"함",source:"selection",captured_at:stamp}];
  for(const width of [320,390,1440]){
    await page.setViewportSize({width,height:900});await go(page,`/${kind}/${row.id}`);
    const link=form(page).getByRole("region",{name:/^엔터티/}).getByRole("button",{name:"함",exact:true});const box=(await link.boundingBox())!;expect(box.width).toBeGreaterThanOrEqual(44);expect(box.height).toBeGreaterThanOrEqual(44);
    await link.focus();await page.keyboard.press("Enter");await expect(link).toHaveAttribute("aria-expanded","true");expect(new URL(page.url()).pathname).toBe(`/${kind}/${row.id}`);await expect(form(page).getByLabel("속성 1",{exact:false})).toHaveCount(0);await expect(form(page).getByRole("link",{name:"함 편집",exact:true})).toBeVisible();
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
  await form(page).getByRole("button",{name:"취소",exact:true}).click();await expect(page).not.toHaveURL(/edit=1/);await expect(form(page).locator(".markdown")).toHaveText("새 서버 원문");await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeVisible();expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
for(const width of [390,1440])test(`기능/목록 구획 ${width}px: 엔터티 편집만·독립 구획·할 일 여백`,async({page},info)=>{
  const state=await fixtures(page);await page.setViewportSize({width,height:900});await go(page,"/entities");
  await page.screenshot({path:info.outputPath(`tab-entities-${width}.png`)});
  const top=page.locator(".app-main > .panel"),bottom=page.getByRole("region",{name:"엔터티 목록",exact:true});expect((await bottom.boundingBox())!.y).toBeGreaterThanOrEqual((await top.boundingBox())!.y+(await top.boundingBox())!.height);
  const inset=width<640?16:24,topBox=(await top.boundingBox())!,listBox=(await bottom.locator(".list.panel").boundingBox())!;
  expect((await top.getByRole("heading",{name:"엔터티",exact:true}).boundingBox())!.x-topBox.x).toBeGreaterThanOrEqual(inset);expect((await top.getByLabel("속성 1 키워드",{exact:false}).boundingBox())!.x-topBox.x).toBeGreaterThanOrEqual(inset);expect((await bottom.locator(".item-title").first().boundingBox())!.x-listBox.x).toBeGreaterThanOrEqual(inset);
  await expect(bottom.getByRole("link",{name:"엔터티 보기",exact:true})).toHaveCount(0);await openListEditor(page,"엔터티",bottom);await expect(form(page).getByLabel("속성 1",{exact:false})).toHaveValue("엔터티");await expect(form(page).getByRole("button",{name:"할 일 작성",exact:true})).toHaveCount(0);await expect(form(page).getByRole("link",{name:/목록/})).toHaveCount(0);await expect(form(page).getByRole("button",{name:"취소",exact:true})).toHaveCount(1);await form(page).getByRole("button",{name:"닫기",exact:true}).click();await expect(page.locator(`#entity-${id(1)}`)).toBeFocused();
  await go(page,"/principles");const current=page.getByRole("region",{name:"현재 원칙",exact:true});expect((await current.boundingBox())!.y).toBeGreaterThanOrEqual((await top.boundingBox())!.y+(await top.boundingBox())!.height);await expect(top.getByRole("link",{name:"과거 근거는 통합 기록에서 보기"})).toHaveAttribute("href","/records");await expect(top.getByLabel("검색어",{exact:true})).toHaveCount(0);await expect(top.locator(".current-document,.record-date-group")).toHaveCount(0);await page.screenshot({path:info.outputPath(`principles-sections-${width}.png`)});
  await go(page,"/tasks");expect(await page.locator(".tasks-list > .list-item").first().evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft))).toBeGreaterThanOrEqual(12);await page.screenshot({path:info.outputPath(`tab-activity-${width}.png`)});await openListEditor(page,"할 일");await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("할 일");await page.screenshot({path:info.outputPath(`edit-task-${width}.png`)});const head=form(page).locator(".modal-head"),body=form(page).locator(":scope > .modal-inner > .modal-body");expect(await head.evaluate(el=>getComputedStyle(el).paddingLeft)).toBe(width<640?"16px":"24px");expect(await body.evaluate(el=>getComputedStyle(el).paddingLeft)).toBe(width<640?"16px":"24px");expect(state.errors).toEqual([]);
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
  await form(page).getByRole("button",{name:"완료하고 기록",exact:true}).click();await expect(form(page).getByRole("heading",{name:"할 일 완료",exact:true})).toBeVisible();await form(page).getByRole("button",{name:"취소",exact:true}).click();await expect(page).not.toHaveURL(/action=/);
  await form(page).getByRole("button",{name:"편집",exact:true}).click();await form(page).getByLabel("본문").fill("보존할 초안");await expect(form(page).getByRole("button",{name:"완료하고 기록",exact:true})).toHaveCount(0);
  await form(page).getByRole("button",{name:"닫기",exact:true}).click();const discard=page.getByRole("dialog",{name:"변경을 버릴까요?",exact:true});await discard.getByRole("button",{name:"취소",exact:true}).click();await expect(form(page).getByLabel("본문")).toHaveValue("보존할 초안");
  await form(page).getByRole("button",{name:"닫기",exact:true}).click();await discard.getByRole("button",{name:"변경 버리기",exact:true}).click();await expect(form(page)).toHaveCount(0);await expect(page.locator(`#activity-tasks-${id(2)}`)).toBeFocused();expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
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
  const rows:Record<string,Row[]>={entities:[entity()],tasks:[task()],records:[record()],principles:options.emptyPrinciple?[]:[principle(),principle(5,false)],tags:[{...base(10,""),name:"같은 이름",scope:"entity"},{...base(11,""),name:"같은 이름",scope:"record"},{...base(12,""),name:"같은 이름",scope:"task"}]};
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
      let items=rows[kind];if(kind==="tags")items=items.filter(r=>r.scope===(url.searchParams.get("scope")??"record"));
      if(kind==="principles")return reply({code:"not_found",message:"지원하지 않는 원칙 목록"},404);
      if(kind==="records"&&url.searchParams.get("task_id"))items=items.filter(r=>r.task_id===url.searchParams.get("task_id"));
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
    Object.assign(found,body,{version:found.version+1});
    if(kind==="tasks"&&body.entity_ids)found.entity_context=(body.entity_ids as string[]).map(id=>({id,title:rows.entities.find(e=>e.id===id)?.prop1??"엔터티",source:"selection",captured_at:stamp}));
    return reply(found);
  });
  return {rows,writes,searches,errors,pending,release:()=>release()};
}
const go=async(page:Page,path:string)=>page.goto(path);
const form=(page:Page)=>page.locator("dialog.modal:not(.modal-confirm)[open]");

function linkedFixture(state:Awaited<ReturnType<typeof fixtures>>) {
  Object.assign(state.rows.entities[0],{tasks:{count:1,items:[{id:id(2),title:"할 일",updated_at:stamp}]},records:{count:1,items:[record()]}});
  Object.assign(state.rows.tasks[0],{entity_ids:[id(1)],entity_context:[{id:id(1),title:"엔터티",source:"selection",captured_at:stamp}]});
  Object.assign(state.rows.records[0],{entity_ids:[id(1)],entity_context:[{id:id(1),title:"엔터티",source:"selection",captured_at:stamp}],task_id:id(2)});
}
for(const width of [320,1440])test(`#193 ${width}px: A 목록·한 항목 펼침·읽기만·원래 위치와 편집 복귀`,async({page},info)=>{
  const state=await fixtures(page);linkedFixture(state);await page.setViewportSize({width,height:900});await go(page,`/entities/${id(1)}?list=${encodeURIComponent('/entities?pages=1&scroll=0#entity-'+id(1))}`);
  const url=page.url(),toggle=form(page).getByRole("button",{name:"할 일",exact:true});
  const edit=form(page).getByRole("link",{name:"할 일 편집",exact:true}),expand=form(page).getByRole("button",{name:"할 일 펼치기",exact:true});
  await expect(edit).toBeVisible();await expect(expand).toHaveAttribute("aria-expanded","false");
  await edit.click();await expect(page).toHaveURL(new RegExp(`/tasks/${id(2)}\\?edit=1$`));await form(page).getByRole("button",{name:"취소",exact:true}).click();await expect(page).toHaveURL(url);await expect(edit).toBeFocused();await expect(toggle).toHaveAttribute("aria-expanded","false");
  const recordRow=form(page).locator(".related-item").filter({has:page.getByRole("button",{name:"기록",exact:true})});await expect(recordRow.locator(".related-item-meta, time, .badge")).toHaveCount(0);
  await expand.focus();await expand.press("Space");await expect(form(page).getByRole("button",{name:"할 일 접기",exact:true})).toHaveAttribute("aria-expanded","true");
  await form(page).getByRole("button",{name:"할 일 접기",exact:true}).click();await expect(toggle).toHaveAttribute("aria-expanded","false");await toggle.focus();await toggle.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded","true");await expect(form(page).locator(".related-preview").filter({visible:true})).toHaveCount(1);await expect(form(page).getByText("상세 본문",{exact:true})).toBeVisible();await expect(page).toHaveURL(url);
  const recordToggle=form(page).getByRole("button",{name:"기록",exact:true});await recordToggle.click();await expect(toggle).toHaveAttribute("aria-expanded","false");await expect(recordToggle).toHaveAttribute("aria-expanded","true");await toggle.click();
  const editBox=await edit.boundingBox(),expandBox=await form(page).getByRole("button",{name:"할 일 접기",exact:true}).boundingBox();expect(editBox&&expandBox&&editBox.x+editBox.width<=expandBox.x).toBe(true);
  await edit.click();await expect(page).toHaveURL(new RegExp(`/tasks/${id(2)}\\?edit=1$`));await expect(form(page).getByRole("heading",{name:"할 일 편집",exact:true})).toBeVisible();await expect(page.locator("dialog[open]")).toHaveCount(1);
  await form(page).getByRole("button",{name:"취소",exact:true}).click();await expect(page).toHaveURL(url);await expect(toggle).toHaveAttribute("aria-expanded","true");await expect(edit).toBeFocused();
  expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`inline-relations-${width}.png`)});
});
test("#193 할 일 편집 저장·삭제는 처음 엔터티 복귀, 반복 진입은 중첩 이력 없음",async({page})=>{
  const state=await fixtures(page);linkedFixture(state);await go(page,`/entities/${id(1)}`);const url=page.url();
  const toggle=form(page).getByRole("button",{name:"할 일",exact:true});await toggle.click();await form(page).getByRole("link",{name:"할 일 편집",exact:true}).click();await form(page).getByLabel("본문").fill("바뀐 본문");await saveOnce(page);
  await expect(page).toHaveURL(url);await expect(form(page).getByText("바뀐 본문",{exact:true})).toBeVisible();
  for(let n=0;n<3;n++){await form(page).getByRole("link",{name:"할 일 편집",exact:true}).click();await expect.poll(()=>page.evaluate(()=>history.state.usr.detailTrail.filter((f:{path:string})=>f.path.startsWith('/entities/')).length)).toBe(1);await page.goBack();await expect(page).toHaveURL(url);}
  await form(page).getByRole("link",{name:"할 일 편집",exact:true}).click();await form(page).getByRole("button",{name:"삭제",exact:true}).click();await form(page).getByRole("button",{name:"삭제하고 기록",exact:true}).click();await expect(page).toHaveURL(url);expect(state.rows.tasks).toHaveLength(0);expect(state.errors).toEqual([]);
});
for(const exit of ["close","escape","back","arrow"] as const)test(`#193 ${exit}: 미저장 보호·처음 엔터티 목록·왕복 이력 없음`,async({page})=>{
  const state=await fixtures(page);linkedFixture(state);await go(page,"/entities");await page.getByRole("link",{name:"엔터티",exact:true}).click();const rootUrl=page.url();
  await form(page).getByRole("button",{name:"할 일",exact:true}).click();await form(page).getByRole("link",{name:"할 일 편집",exact:true}).click();await form(page).getByLabel("본문").fill("유지할 초안");
  const attempt=async()=>{if(exit==="close")await form(page).getByRole("button",{name:"닫기",exact:true}).click();else if(exit==="escape")await page.keyboard.press("Escape");else if(exit==="arrow")await form(page).getByRole("button",{name:/^이전:/}).click();else await page.goBack();};
  await attempt();const discard=page.getByRole("dialog",{name:"변경을 버릴까요?",exact:true});await discard.getByRole("button",{name:"취소",exact:true}).click();await expect(form(page).getByLabel("본문")).toHaveValue("유지할 초안");await attempt();await discard.getByRole("button",{name:"변경 버리기",exact:true}).click();
  if(exit==="back"||exit==="arrow"){await expect(page).toHaveURL(rootUrl);await expect(form(page).getByRole("button",{name:"할 일",exact:true})).toHaveAttribute("aria-expanded","true");}
  else{await expect(page).toHaveURL(/\/entities\?/);await expect(form(page)).toHaveCount(0);await page.goBack();await expect(page).not.toHaveURL(/\/tasks\//);await expect(page).not.toHaveURL(/\/entities\/[^?]+/);await page.goForward();await page.goForward();await expect(form(page)).toHaveCount(0);await expect(page).toHaveURL(/\/entities\?/);}
  expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
test("#193 기록과 할 일에서 엔터티 펼침·편집, 실패 재시도·삭제 대상 편집 없음",async({page})=>{
  const state=await fixtures(page);linkedFixture(state);let failed=true;
  await page.route(`**/api/entities/${id(1)}`,route=>failed?route.fulfill({status:503,json:{code:"internal",message:"조회 실패"}}):route.fallback());
  await go(page,`/tasks/${id(2)}`);const url=page.url();await form(page).getByRole("button",{name:"엔터티",exact:true}).click();await expect(form(page).getByText("내용을 불러오지 못했습니다.")).toBeVisible();failed=false;await form(page).getByRole("button",{name:"다시 시도",exact:true}).click();await form(page).getByRole("link",{name:"엔터티 편집",exact:true}).click();await form(page).getByRole("button",{name:/^이전:/}).click();await expect(page).toHaveURL(url);
  await go(page,`/records/${id(3)}`);await form(page).getByRole("button",{name:"엔터티",exact:true}).click();await form(page).getByRole("link",{name:"엔터티 편집",exact:true}).click();await form(page).getByRole("button",{name:"취소",exact:true}).click();await expect(page).toHaveURL(new RegExp(`/records/${id(3)}$`));
  state.rows.entities=[];await form(page).getByRole("button",{name:"엔터티",exact:true}).click();await form(page).getByRole("button",{name:"엔터티",exact:true}).click();await expect(form(page).getByText("삭제된 대상 또는 접근할 수 없는 대상입니다.")).toBeVisible();await expect(form(page).getByRole("link",{name:"엔터티 편집",exact:true})).toHaveCount(0);expect(state.errors).toEqual([]);expect(state.writes).toHaveLength(0);
});


for(const kind of ["tasks","records"] as const)test(`엔터티 제목 연결 검색 ${kind}: 빈 검색·부분 일치·선택 보존·해제·저장`,async({page})=>{
  const state=await fixtures(page),reads:URLSearchParams[]=[];
  const targets=[{...entity(81),prop1:"Alpha 고객"},{...entity(82),prop1:"Beta 고객"}];
  await page.route("**/api/entities?**",route=>{
    const params=new URL(route.request().url()).searchParams;reads.push(params);
    return route.fulfill({json:{items:targets.filter(item=>item.prop1.toLowerCase().includes((params.get("keyword")??"").toLowerCase())),next_cursor:null}});
  });
  await go(page,kind==="tasks"?"/tasks?create=1":`/records/${state.rows.records[0].id}?edit=1`);
  if(kind==="tasks")await form(page).getByRole("textbox",{name:"제목 (필수)",exact:true}).fill("새 관계 업무");
  const search=form(page).getByRole("searchbox",{name:"엔터티 제목 검색",exact:true});await expect(search).toBeVisible();expect(reads).toHaveLength(0);
  await search.fill("aLpHa");await form(page).getByRole("button",{name:"Alpha 고객 연결",exact:true}).focus();await page.keyboard.press("Space");await expect(form(page).getByRole("button",{name:"Alpha 고객 해제",exact:true})).toBeFocused();
  expect(reads[0].get("keyword")).toBe("aLpHa");expect(reads[0].get("limit")).toBe("20");
  await search.fill("Beta");await form(page).getByRole("button",{name:"Beta 고객 연결",exact:true}).click();
  await search.clear();await expect(form(page).getByRole("button",{name:"Alpha 고객 해제",exact:true})).toBeVisible();await expect(form(page).getByRole("button",{name:"Beta 고객 해제",exact:true})).toBeVisible();
  await form(page).getByRole("button",{name:"Alpha 고객 해제",exact:true}).click();await expect(form(page).getByRole("button",{name:"Alpha 고객 해제",exact:true})).toHaveCount(0);await expect(search).toBeFocused();await saveOnce(page,form(page),kind==="tasks"?"추가":"저장");
  expect(state.writes.at(-1)?.body.entity_ids).toEqual([id(82)]);expect(reads).toHaveLength(2);expect(state.errors).toEqual([]);
});
test("엔터티 제목 연결 검색: IME·늦은 응답 격리·페이지 실패 동일 cursor 재시도",async({page})=>{
  const state=await fixtures(page),reads:URLSearchParams[]=[];let release=()=>{},arrived=()=>{},failPage=true;
  const held=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>arrived=resolve);
  await page.route("**/api/entities?**",async route=>{
    const params=new URL(route.request().url()).searchParams;reads.push(params);const word=params.get("keyword");
    if(word==="느림"){arrived();await held;return route.fulfill({json:{items:[{...entity(91),prop1:"오래된 결과"}],next_cursor:null}}).catch(()=>{});}
    if(params.has("cursor")){
      if(failPage){failPage=false;return route.fulfill({status:503,json:{code:"internal",message:"검색 실패"}});}
      return route.fulfill({json:{items:[{...entity(92),prop1:"최신 결과"},{...entity(93),prop1:"추가 결과"}],next_cursor:null}});
    }
    return route.fulfill({json:{items:[{...entity(92),prop1:"최신 결과"}],next_cursor:"page-two"}});
  });
  await go(page,"/tasks?create=1");const search=form(page).getByRole("searchbox",{name:"엔터티 제목 검색",exact:true});await expect(search).toBeVisible();
  await search.dispatchEvent("compositionstart");await search.fill("느");await page.waitForTimeout(350);expect(reads).toHaveLength(0);
  await search.fill("느림");await search.dispatchEvent("compositionend");await started;
  await search.fill("최신%_");await expect(form(page).getByRole("button",{name:"최신 결과 연결",exact:true})).toBeVisible();release();
  await expect(form(page).getByRole("button",{name:"오래된 결과 연결",exact:true})).toHaveCount(0);expect(reads.at(-1)?.get("keyword")).toBe("최신%_");
  await form(page).getByRole("button",{name:"검색 결과 더 보기",exact:true}).click();await expect(form(page).getByRole("alert")).toBeVisible();
  await expect(form(page).getByRole("button",{name:"최신 결과 연결",exact:true})).toBeVisible();await form(page).getByRole("button",{name:"검색 다시 시도",exact:true}).click();
  await expect(form(page).getByRole("button",{name:"추가 결과 연결",exact:true})).toBeVisible();await expect(form(page).getByRole("button",{name:"최신 결과 연결",exact:true})).toHaveCount(1);
  expect(reads.slice(-2).map(params=>params.get("cursor"))).toEqual(["page-two","page-two"]);
  for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);for(const label of await form(page).locator(".entity-choice").all())expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(44);}
  expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
test("엔터티 상세: 편집·할 일 작성·기록 작성 뒤 성공 알림과 수정 시각 없음",async({page},info)=>{
  const state=await fixtures(page);await go(page,`/entities/${id(1)}`);await form(page).getByRole("button",{name:"편집",exact:true}).click();
  await form(page).getByLabel("속성 2",{exact:false}).fill("25");await saveOnce(page,form(page));await expect(form(page).getByLabel("속성 2",{exact:false})).toHaveCount(0);
  for(const [label,body,submit] of [["할 일 작성","새 업무","추가"],["기록 작성","새 상담","저장"]]){
    await form(page).getByRole("button",{name:label,exact:true}).click();await fillText(page,body);await saveOnce(page,form(page),submit);await expect(form(page).getByRole("button",{name:label,exact:true})).toBeVisible();
  }
  await expect(form(page).locator(".notice")).toHaveCount(0);await expect(form(page).getByText(/^수정 /)).toHaveCount(0);await expect(form(page).getByRole("link",{name:/전체 (할 일|기록) 보기/})).toHaveCount(0);
  for(const width of [390,1440]){await page.setViewportSize({width,height:900});await page.screenshot({path:info.outputPath(`entity171-detail-${width}.png`)});}
  expect(state.writes).toHaveLength(3);expect(state.errors).toEqual([]);
});
// Multi-level recursive relation navigation was replaced by the #193 disclosure/editor cases above.
test("상세 탐색: 같은 엔터티는 한 행으로 합치고 역사 제목을 유지한다",async({page})=>{
  const state=await fixtures(page);Object.assign(state.rows.records[0],{record_kind:"change",entity_ids:[id(1)],entity_context:[{id:id(1),title:"연결 제목",source:"selection",captured_at:stamp}],change:{event_id:id(30),target_kind:"entity",target_id:id(1),target_title:"당시 엔터티",action:"update",source:"http",before:{prop2:0},after:{prop2:1}}});
  await go(page,`/records/${id(3)}`);const group=connectedTarget(page,"entity");await expect(group.locator('.related-item')).toHaveCount(1);const toggle=group.getByRole('button',{name:'당시 엔터티',exact:true});await toggle.click();await expect(group.getByRole('button',{name:'연결 제목',exact:true})).toHaveCount(0);await group.getByRole('link',{name:'당시 엔터티 편집',exact:true}).click();await form(page).getByRole('button',{name:/^이전: 기록/}).click();await expect(group.getByRole('link',{name:'당시 엔터티 편집',exact:true})).toBeFocused();expect(state.errors).toEqual([]);
});
test("상세 탐색: 계정 전환 뒤 이전 계정의 편집 문맥을 무시",async({page})=>{
  const state=await fixtures(page);linkedFixture(state);await go(page,`/entities/${id(1)}`);await form(page).getByRole('button',{name:'기록',exact:true}).click();await form(page).getByRole('link',{name:'기록 편집',exact:true}).click();await form(page).getByRole('button',{name:'취소',exact:true}).click();await form(page).getByRole('button',{name:'닫기',exact:true}).click();await page.getByRole('button',{name:'계정 전환 fixture',exact:true}).click();await page.goForward();await expect(form(page).getByRole('button',{name:/^이전:/})).toHaveCount(0);expect(state.errors).toEqual([]);
});
test("상세 탐색: 관련 편집 닫기도 처음 기록 목록 조건 복원",async({page})=>{
  const state=await fixtures(page);linkedFixture(state);await go(page,'/records?record_kind=user');await page.getByRole('link',{name:'기록',exact:true}).click();await form(page).getByRole('button',{name:'할 일',exact:true}).click();await form(page).getByRole('link',{name:'할 일 편집',exact:true}).click();await form(page).getByRole('button',{name:'닫기',exact:true}).click();expect(new URL(page.url()).searchParams.get('record_kind')).toBe('user');await expect(page.locator(`#activity-records-${id(3)}`)).toBeFocused();expect(state.errors).toEqual([]);
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
for (const [kind,label] of [["tasks","할 일"],["records","기록"],["principles","현재 기준"]]) test(`상세 탐색 검색 ${kind}: 이전과 닫기는 검색·직접 링크`,async({page})=>{
  const state=await fixtures(page);
  await go(page,`/search?q=자료&kind=${kind.slice(0,-1)}`);
  await page.getByRole("link",{name:label,exact:true}).click();
  await form(page).getByRole("button",{name:/^이전: 검색/}).click();
  await expect(page).toHaveURL(/\/search\?/);
  await expect(page.getByRole("link",{name:label,exact:true})).toBeFocused();
  await page.getByRole("link",{name:label,exact:true}).click();
  await form(page).getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page).toHaveURL(/\/search\?/);
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
  if(kind==="entities") await form(page).getByLabel("속성 1",{exact:false}).fill("수정한 제목"); else await form(page).getByRole("textbox",{name:kind==="records"?/^본문/:/^제목/}).fill("수정한 제목");
  await page.screenshot({path:info.outputPath(`${kind}-edit.png`)});await saveOnce(page,form(page));
  await expect(form(page).getByRole("heading",{name:kind==="records"?"기록":"수정한 제목",exact:true})).toBeVisible();await expect(form(page).getByRole("textbox")).toHaveCount(0);
  await form(page).getByRole("button",{name:"닫기",exact:true}).click();await expect(page.getByRole("link",{name:"수정한 제목",exact:true})).toBeFocused();
  expect(state.writes.filter(w=>w.method==="PATCH")).toHaveLength(1);expect(state.errors).toEqual([]);
});
async function compatibleEdit(page:Page) {if(await form(page).getByRole("button",{name:"편집",exact:true}).isVisible())await openDetailEditor(page);else await expect(form(page).getByRole("button",{name:"저장",exact:true})).toBeVisible();}
async function fillText(page:Page,title="새 자료") {await expect(form(page).locator("form")).toBeVisible();const input=form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/});if(await input.count())await input.fill(title);await form(page).getByRole("textbox",{name:/^본문(?: \(필수\))?$/}).fill(title);}

for(const [kind,label] of [["entities","엔터티"],["tasks","할 일"],["records","기록"]]) {
  test(`${kind}: 생성·보기·편집 메모·태그·삭제 이유`,async({page})=>{
    const state=await fixtures(page);await go(page,`/${kind}`);await beginTabAction(page,kind==="records"?"기록 작성":`${label} 추가`);
    if(kind==="entities")await form(page).getByLabel("속성 1",{exact:false}).fill("새 엔터티");else await fillText(page,`새 ${label}`);
    await form(page).getByRole("button",{name:"같은 이름",exact:true}).click();await saveOnce(page, form(page), kind==="tasks"?"추가":"저장");
    await expect(page).toHaveURL(new RegExp(`/${kind}/`));await expect(form(page)).toHaveCount(1);const createdPath=new URL(page.url()).pathname;
    await compatibleEdit(page);await expect(form(page)).toHaveCount(1);
    await expect(form(page).getByRole("button",{name:"저장",exact:true})).toBeVisible();
    if(kind==="entities")await form(page).getByLabel("속성 2",{exact:false}).fill("20");else await form(page).getByRole("textbox",{name:/^본문(?: \(필수\))?$/}).fill("편집한 본문");
    if(kind!=="records") await fillChangeMemo(page,form(page),"실측 결과 반영");
    await saveOnce(page, form(page));if(kind==="entities")await go(page,createdPath+"?edit=1");else await compatibleEdit(page);await expect(form(page).getByRole("button",{name:"삭제",exact:true})).toBeVisible();
    const patch=state.writes.find(w=>w.method==="PATCH")!;if(kind==="records"){expect(patch.body).not.toHaveProperty("change_note");expect(patch.body.body).toBe("편집한 본문");}else expect(patch.body.change_note).toBe("실측 결과 반영");expect(patch.body.expected_version).toBe(1);expect(patch.body.tag_ids).toEqual([id(kind==="entities"?10:kind==="tasks"?12:11)]);
    await form(page).getByRole("button",{name:"삭제",exact:true}).click();const confirm=page.locator("dialog.modal-action[open]");await confirm.getByLabel("기록 메모").fill("중복 자료 정리");await saveOnce(page,confirm,"삭제 확인");
    await expect(page).toHaveURL(`http://127.0.0.1:55580/${kind}${kind==="entities"?`#entity-${createdPath.split("/").at(-1)}`:""}`);if(kind==="records")expect(state.writes.at(-1)?.params.get("change_note")).toBe("중복 자료 정리");else expect(state.writes.at(-1)?.body.change_note).toBe("중복 자료 정리");expect(state.errors).toEqual([]);
  });
}
test("원칙: 최초 등록·같은 ID 편집·삭제 뒤 없음·기록으로 과거 근거 조회",async({page})=>{
  const state=await fixtures(page,{emptyPrinciple:true});await go(page,"/principles");await beginTabAction(page,"현재 원칙 등록");await fillText(page,"첫 기준");await saveOnce(page,form(page));
  await expect.poll(()=>state.rows.principles.length).toBe(1);const first=state.rows.principles[0].id;await expect(page).toHaveURL(new RegExp(`/principles/${first}`));
  await compatibleEdit(page);await form(page).getByRole("textbox",{name:"본문",exact:true}).fill("둘째 정책");await saveOnce(page,form(page));
  await expect(page).toHaveURL(new RegExp(first));expect(state.rows.principles.filter(p=>p.is_current)).toHaveLength(1);
  await compatibleEdit(page);await form(page).getByRole("button",{name:"삭제",exact:true}).click();
  const confirm=page.locator("dialog.modal-action[open]");await expect(confirm).toContainText("과거 원칙을 자동 승격하지 않습니다");
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
  await go(page,`/records/${r.id}?edit=1&edit_from=view`);await expect(form(page)).toContainText("에이전트");await expect(form(page)).toContainText("삭제된 대상");await expect(form(page)).toContainText("당시 본문");await expect(form(page)).toContainText("실제 판단 당시의 본문을 보증하지 않습니다.");await expect(connectedTarget(page,"entity").getByRole("link")).toHaveCount(0);
  await compatibleEdit(page);await expect(form(page).getByLabel("수행 시각")).toHaveCount(0);await expect(form(page).getByText("기록 태그",{exact:true})).toHaveCount(0);await form(page).getByLabel("본문",{exact:false}).fill("설명 정정");await saveOnce(page, form(page));
  expect(Object.keys(state.writes[0].body).sort()).toEqual(["body","expected_version"].sort());expect(state.rows.entities[0].prop2).toBe(0);
  await expect(form(page).getByRole("heading",{name:"기록",exact:true})).toBeVisible();await compatibleEdit(page);await form(page).getByRole("button",{name:"삭제",exact:true}).click();const confirm=page.locator("dialog.modal-action[open]");await expect(confirm).toContainText("대상의 업무 상태는 되돌리지 않습니다.");await saveOnce(page,confirm,"삭제 확인");await expect(page).toHaveURL(/\/records$/);expect(state.rows.entities[0].prop2).toBe(0);expect(state.rows.records).toHaveLength(0);expect(state.errors).toEqual([]);
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
  expect(state.searches.every(s=>s.query==="최신 초안"&&(s.tag_ids as string[]).includes(id(12)))).toBe(true);
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
  const state=await fixtures(page,{failWrite:failure});await go(page,`/tasks/${id(2)}?edit=1`);await form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill("보존할 초안");await fillChangeMemo(page,form(page),"정정 이유");await saveOnce(page, form(page));await expect(form(page).getByRole("alert")).toBeVisible();
  await discardEditor(page);const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("보존할 초안");
  if(failure==="unknown"){await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toBeDisabled();await form(page).getByRole("button",{name:"같은 내용 다시 시도"}).click();await saveOnce(page,form(page));expect(state.writes[1].body).toEqual(state.writes[0].body);}expect(state.errors).toEqual([]);
});
test("busy POP·dirty back/forward·reload·직접 링크",async({page})=>{
  const state=await fixtures(page,{hold:true});await go(page,"/tasks");await openListEditor(page,"할 일");await fillChangeMemo(page,form(page),"저장 이유");await saveOnce(page, form(page),"저장",false);await state.pending;await page.goBack();await expect(page).toHaveURL(/edit=1/);await expect(page.getByRole("dialog",{name:"변경을 버릴까요?"})).not.toBeVisible();state.release();await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeVisible();await form(page).getByRole("button",{name:"닫기",exact:true}).click();
  await openListEditor(page,"할 일");await form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill("버리지 않을 초안");await page.goBack();const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("버리지 않을 초안");await page.goBack();await confirm.getByRole("button",{name:"변경 버리기"}).click();await expect(page).toHaveURL(/\/tasks\?/);await page.goForward();await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("할 일");await page.reload();await expect(form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("할 일");expect(state.errors).toEqual([]);
});
for(const width of [320,360,390,639,640,768,1024,1440])test(`shell ${width}px: 긴 제목·본문 스크롤·키보드·단일 surface`,async({page},info)=>{
  const state=await fixtures(page,{long:true});await page.setViewportSize({width,height:800});await go(page,`/tasks/${id(2)}`);await expect(form(page)).toBeVisible();const dimensions=await form(page).evaluate(d=>{const r=d.getBoundingClientRect();return {width:r.width,height:r.height,scroll:document.documentElement.scrollWidth,viewport:innerWidth};});expect(dimensions.scroll).toBeLessThanOrEqual(width);expect(dimensions.width).toBeLessThanOrEqual(width<640?width:672);if(width<640)expect(dimensions.width).toBe(width);
  await form(page).locator(":scope > .modal-inner > .modal-body").evaluate(el=>{el.scrollTop=el.scrollHeight;});await expect(form(page).getByRole("button",{name:"닫기",exact:true})).toBeInViewport();await expect(form(page).getByRole("button",{name:"닫기",exact:true})).toBeInViewport();await form(page).locator(":scope > .modal-inner > .modal-body").evaluate(el=>{el.scrollTop=0;});await compatibleEdit(page);await expect(form(page)).toHaveCount(1);await fillChangeMemo(page,form(page),"길이 검수");await page.keyboard.press("Tab");await page.screenshot({path:info.outputPath(`surface-${width}.png`)});await discardEditor(page);await expect(page.getByRole("dialog",{name:"변경을 버릴까요?"})).toBeVisible();expect(state.errors).toEqual([]);
});

for(const width of [320,360,390,639,640,768,1024,1440])test(`소비 화면 ${width}px: 목록·원칙·기록·엔터티·태그`,async({page},info)=>{
  const state=await fixtures(page,{long:true});state.rows.tags[0].name="긴이름".repeat(10);await page.setViewportSize({width,height:800});
  for(const path of ["/entities","/tasks","/records","/principles","/tags/entity","/tags/record"]){await go(page,path);await expect(page.getByRole("heading",{level:1})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path).toBe(true);}
  for(const [kind,n] of [["entities",1],["records",3],["principles",4]] as const){await go(page,`/${kind}/${id(n)}`);await expect(form(page)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),kind).toBe(true);await expect(form(page).getByRole("button",{name:"닫기",exact:true})).toBeInViewport();await page.screenshot({path:info.outputPath(`${kind}-${width}.png`)});}
  await go(page,`/tags/entity?edit=${id(10)}`);await expect(form(page).getByRole("form",{name:"태그 이름 변경"})).toBeVisible();await expect(form(page)).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath(`tags-${width}.png`)});expect(state.errors).toEqual([]);
});
test("200% reflow·축소 visual viewport·한 글자 제목",async({page},info)=>{
  const state=await fixtures(page);state.rows.tasks[0].title="일";await page.setViewportSize({width:768,height:800});await go(page,`/tasks/${id(2)}?edit=1`);await page.evaluate(()=>{document.documentElement.style.zoom="2";});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await fillChangeMemo(page,form(page),"확대 확인");await page.setViewportSize({width:390,height:360});await expect(form(page).getByRole("button",{name:"수정하고 저장",exact:true})).toBeInViewport();await page.screenshot({path:info.outputPath("zoom-keyboard-viewport.png")});expect(state.errors).toEqual([]);
});

test("태그 인라인 편집: 취소는 목록으로 복귀·삭제 실패는 동일 입력과 버전으로 재시도",async({page})=>{
  const state=await fixtures(page);await go(page,`/tags/entity?edit=${id(10)}`);
  await form(page).getByRole("button",{name:"취소",exact:true}).click();
  await expect(page.getByRole("button",{name:"같은 이름 이름 변경",exact:true})).toBeFocused();
  await page.getByRole("button",{name:"같은 이름 이름 변경",exact:true}).click();
  await form(page).getByRole("textbox",{name:/태그 이름/}).fill("보존할 이름");
  await form(page).getByRole("button",{name:"삭제",exact:true}).click();
  const deletion=page.locator("dialog.modal-action[open]");
  await deletion.getByRole("button",{name:"취소",exact:true}).click();
  await expect(form(page).getByRole("textbox",{name:/태그 이름/})).toHaveValue("보존할 이름");
  const attempts:string[]=[];await page.route(`**/api/tags/${id(10)}?**`,async route=>{
    attempts.push(route.request().url());
    if(attempts.length===1)return route.abort("connectionreset");
    return route.fallback();
  });
  await form(page).getByRole("button",{name:"삭제",exact:true}).click();
  await deletion.getByLabel("기록 메모",{exact:true}).fill("분류 정리");
  await deletion.getByRole("button",{name:"삭제하고 기록",exact:true}).click();
  await expect(deletion.getByRole("button",{name:"같은 내용 다시 시도",exact:true})).toBeVisible();
  await expect(deletion.getByLabel("기록 메모",{exact:true})).toHaveValue("분류 정리");
  await deletion.getByRole("button",{name:"같은 내용 다시 시도",exact:true}).click();
  await expect(deletion).toHaveCount(0);await expect(form(page)).toHaveCount(1);await expect(form(page).getByRole("form",{name:"태그 추가"})).toBeVisible();await expect(form(page).getByRole("heading",{name:"엔터티 태그 관리",exact:true})).toBeFocused();
  expect(attempts).toHaveLength(2);expect(attempts[1]).toBe(attempts[0]);
  expect(state.errors).toEqual([]);
});

test("태그: 두 사전 같은 이름·인라인 CRUD·dirty scoped 이동",async({page})=>{
  const state=await fixtures(page);await go(page,"/tags/entity");
  await page.getByRole("button",{name:"같은 이름 이름 변경",exact:true}).click();
  await form(page).getByRole("textbox",{name:/태그 이름/}).fill("엔터티 분류");await saveOnce(page,form(page));
  await expect(page.getByRole("button",{name:"엔터티 분류 이름 변경"})).toBeFocused();
  await page.getByRole("link",{name:"기록 태그 fixture"}).evaluate((el:HTMLAnchorElement)=>el.click());
  await expect(page.getByRole("button",{name:"같은 이름 이름 변경"})).toBeVisible();await expect(page.getByRole("button",{name:"엔터티 분류 이름 변경"})).toHaveCount(0);
  await form(page).getByRole("textbox",{name:/태그 이름/}).fill("활동 추가");await page.goBack();
  const confirm=page.getByRole("dialog",{name:"변경을 버릴까요?"});await confirm.getByRole("button",{name:"취소",exact:true}).click();
  await expect(form(page).getByRole("textbox",{name:/태그 이름/})).toHaveValue("활동 추가");await saveOnce(page,form(page),"추가");expect(state.writes.at(-1)?.body.scope).toBe("record");
  await page.getByRole("button",{name:"활동 추가 삭제",exact:true}).click();await page.locator("dialog.modal-action[open]").getByRole("button",{name:"삭제하고 기록",exact:true}).click();await expect(page.getByRole("button",{name:"활동 추가 삭제",exact:true})).toHaveCount(0);expect(state.errors).toEqual([]);
});

test("저장 성공 후 GET 실패·조회만 재시도·서버 conflict 초안 유지",async({page})=>{
  const state=await fixtures(page);let fail=false,patches=0;
  await page.route(`**/api/tasks/${id(2)}`,async route=>{if(route.request().method()==="PATCH"){patches++;Object.assign(state.rows.tasks[0],route.request().postDataJSON(),{version:2});fail=true;await route.fulfill({json:state.rows.tasks[0]});return;}if(fail){await route.fulfill({status:503,json:{code:"internal",message:"fixture GET failure"}});return;}await route.fulfill({json:state.rows.tasks[0]});});
  await go(page,`/tasks/${id(2)}`);await compatibleEdit(page);await form(page).getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill("최신 내용");await fillChangeMemo(page,form(page),"수정 사유");await saveOnce(page, form(page));await expect(form(page).getByText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.")).toBeVisible();await expect(form(page).getByRole("heading",{name:"최신 내용",level:1})).toBeVisible();fail=false;await form(page).getByRole("button",{name:"조회 다시 시도"}).click();await expect(form(page).getByText("저장은 완료했습니다. 최신 내용을 불러오지 못했습니다.")).toHaveCount(0);expect(patches).toBe(1);expect(state.errors).toEqual([]);
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
for(const overLimit of [false,true])test(`할 일 태그 10개 한도: ${overLimit?"기존 URL 정규화":"선택 제한과 해제"}`,async({page})=>{
  const state=await fixtures(page),tags=Array.from({length:11},(_,i)=>({...base(200+i,""),name:`분류 ${i+1}`,scope:"task"}));state.rows.tags=tags;
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
  await go(page,"/tasks?kind=once");await page.locator("#activity-tasks-page-control").click();await openListEditor(page,"행 20");await form(page).getByRole("button",{name:"닫기",exact:true}).click();await expect(page).toHaveURL(/pages=2&scroll=/);await expect(page.locator(`#activity-tasks-${many[20].id}`)).toBeFocused();expect(await page.evaluate(()=>scrollY)).toBeGreaterThan(0);await page.reload();await expect(page.locator(`#activity-tasks-${many[20].id}`)).toBeFocused();
  await go(page,"/tasks?q=행&kind=once");await page.getByRole("link",{name:"할 일",exact:true}).click();await form(page).getByRole("button",{name:"닫기",exact:true}).click();await expect(page).toHaveURL(/q=행|q=%ED%96%89/);await expect(page.locator(`#activity-tasks-${id(2)}`)).toBeFocused();expect(state.searches.filter(s=>(s.kinds as string[])[0]==="task").at(-1)?.anchor).toEqual({kind:"task",id:id(2)});expect(state.errors).toEqual([]);
});

for(const [kind,n] of [["entities",1],["tasks",2],["records",3],["principles",4]] as const)test(`${kind}: 두 단계 삭제·취소는 요청 없이 같은 surface`,async({page})=>{
  const state=await fixtures(page);await go(page,`/${kind}/${id(n)}?edit=1`);
  const before=state.writes.length;
  await form(page).getByRole("button",{name:"삭제",exact:true}).click();
  const confirm=page.locator("dialog.modal-action[open]");await expect(confirm.getByRole("button",{name:"삭제하고 기록",exact:true})).toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(1);expect(state.writes).toHaveLength(before);
  await expect(form(page).getByRole("button",{name:"저장",exact:true})).toHaveCount(0);
  await confirm.getByRole("button",{name:"취소",exact:true}).click();await expect(confirm).toHaveCount(0);await expect(form(page).getByRole("button",{name:"삭제",exact:true})).toBeFocused();expect(state.writes).toHaveLength(before);
  await form(page).getByRole("button",{name:"삭제",exact:true}).click();await form(page).getByRole("button",{name:"삭제하고 기록",exact:true}).click();
  await expect.poll(()=>new URL(page.url()).pathname).toBe(`/${kind}`);expect(state.writes).toHaveLength(before+1);expect(state.errors).toEqual([]);
});
for(const width of [320,360,390,639,640,768,1024,1440])test(`기록 정돈 ${width}px: 본문·변경 정보·연결 중심의 간결한 상세`,async({page},info)=>{
  const state=await fixtures(page);await page.setViewportSize({width,height:850});
  Object.assign(state.rows.records[0],{body:"상담 준비 수정 (일정, 내용)",record_kind:"change",entity_ids:[id(1)],entity_context:[{id:id(1),title:"테스트 속성1222",source:"selection",captured_at:stamp}],change:{event_id:id(30),target_kind:"task",target_id:id(2),target_title:"상담 준비 "+"긴제목".repeat(14),action:"update",source:"http",before:{title:"기존 할 일"},after:{title:"상담 준비"},path:`/tasks/${id(2)}`}});
  await go(page,`/records/${id(3)}`);await expect(connectedTarget(page,"task").getByRole("button")).toBeVisible();
  const text=form(page).locator(".record-content .markdown"),meta=form(page).locator(".record-context-meta");
  const style=async(el:ReturnType<typeof form>)=>el.evaluate(n=>({size:parseFloat(getComputedStyle(n).fontSize),color:getComputedStyle(n).color}));
  expect((await style(text)).size).toBeGreaterThan((await style(meta)).size);expect((await style(text)).color).not.toBe((await style(meta)).color);
  await expect(form(page).getByText("저장 정보",{exact:true})).toHaveCount(0);await expect(form(page)).not.toContainText("만든 시각");await expect(form(page).getByRole("button",{name:"닫기",exact:true})).toHaveText("×");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const card=connectedTarget(page,"task").locator(".related-item");
  const entityCard=form(page).getByRole("region",{name:"엔터티 (1개)",exact:true}).locator(".related-item");
  const cardStyle=async(el:ReturnType<typeof form>)=>el.evaluate(n=>{const c=getComputedStyle(n);return [c.padding,c.borderRadius,c.backgroundColor,c.borderWidth].join("|");});
  expect(await cardStyle(card)).toBe(await cardStyle(entityCard));expect((await card.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({path:info.outputPath(`record-layout-${width}.png`)});expect(state.errors).toEqual([]);
});


for(const width of [320,360,390,639,640,768,1024,1440])test(`공통 연결 목록 ${width}px: 엔터티·할 일·기록 카드 위계와 탐색`,async({page},info)=>{
  const state=await fixtures(page),r=state.rows.records[0],t=state.rows.tasks[0];
  Object.assign(r,{body:"상담 결과 "+"긴본문대표문구".repeat(18),record_kind:"result",task_id:t.id,entity_ids:[id(1)],entity_context:[{id:id(1),title:"고객 "+"긴이름".repeat(25),source:"selection",captured_at:stamp}]});
  Object.assign(t,{entity_ids:r.entity_ids,entity_context:r.entity_context,status:"done",completed_at:stamp,result_record_id:r.id,result_record:{id:r.id,body:r.body}});
  Object.assign(state.rows.entities[0],{tasks:{count:1,items:[t]},records:{count:1,items:[r]}});
  await page.setViewportSize({width,height:900});
  const styles:string[]=[];
  for(const path of [`/entities/${id(1)}`,`/tasks/${t.id}`,`/records/${r.id}`]){
    await go(page,path);const links=form(page).locator(".related-item");await expect(links).toHaveCount(2);
    const first=links.first();styles.push(await first.evaluate(el=>{const c=getComputedStyle(el);return [c.padding,c.borderRadius,c.backgroundColor,c.borderWidth].join("|");}));
    for(const link of await links.all()){const box=(await link.boundingBox())!;expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44);}
    await expect(form(page).getByText("연결 당시 정보",{exact:true})).toHaveCount(0);await expect(form(page).getByText("저장 정보",{exact:true})).toHaveCount(0);await expect(form(page)).not.toContainText("만든 시각");
    if(path.startsWith("/tasks/")){await expect(form(page).getByRole("heading",{name:"관련 정보",exact:true})).toHaveCount(0);await expect(form(page)).toContainText("완료 시각");}
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),path).toBe(true);
    if(width===390)await page.screenshot({path:info.outputPath(`related-${path.split("/")[1]}.png`)});
  }
  expect(new Set(styles).size).toBe(1);
  const linked=form(page).getByRole("region",{name:"할 일 (1개)"}).getByRole("button",{name:t.title,exact:true});
  await linked.click();await expect(linked).toHaveAttribute("aria-expanded","true");expect(new URL(page.url()).pathname).toBe(`/records/${r.id}`);
  await form(page).getByRole("link",{name:t.title+" 편집",exact:true}).click();expect(new URL(page.url()).pathname).toBe(`/tasks/${t.id}`);expect(new URL(page.url()).searchParams.get("edit")).toBe("1");
  await form(page).getByRole("button",{name:"이전: 기록",exact:true}).click();await expect(form(page).getByRole("link",{name:t.title+" 편집",exact:true})).toBeFocused();
  expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

test("할 일 연결 기록: 결과와 전체 기간 회차·페이지 오류 동일 cursor 재시도",async({page})=>{
  const state=await fixtures(page),reads:URLSearchParams[]=[];let fail=true;
  const first={...record(20),body:"최근 수행 결과",record_kind:"result",task_id:id(2)},old={...record(21),body:"오래된 회차 기록",task_id:id(2),occurrence_on:"2025-01-01"};
  await page.route("**/api/records?**",route=>{
    const params=new URL(route.request().url()).searchParams;reads.push(params);
    if(params.has("cursor")&&fail){fail=false;return route.fulfill({status:503,json:{code:"internal",message:"페이지 실패"}});}
    return route.fulfill({json:params.has("cursor")?{items:[first,old],next_cursor:null}:{items:[first],next_cursor:"more"}});
  });
  Object.assign(state.rows.tasks[0],{kind:"recurring",status:"active",timezone:"Asia/Seoul",recurrence:{freq:"daily",starts_on:"2026-10-01",ends_on:null}});
  await page.route("**/api/tasks/*/occurrences?**",route=>route.fulfill({json:{today:"2026-10-07",items:[]}}));
  await go(page,`/tasks/${id(2)}`);const related=form(page).getByRole("region",{name:/^기록 \(/});
  await expect(related.getByRole("button",{name:first.body,exact:true})).toBeVisible();await related.getByRole("button",{name:"기록 더 보기"}).click();
  await expect(related.getByRole("alert")).toBeVisible();await expect(related.getByRole("button",{name:first.body,exact:true})).toBeVisible();
  await related.getByRole("button",{name:"기록 다시 시도"}).click();await expect(related.getByRole("button",{name:old.body,exact:true})).toBeVisible();await expect(related.locator(".related-item")).toHaveCount(2);
  state.rows.records.push(old);
  await related.getByRole("button",{name:old.body,exact:true}).click();await form(page).getByRole("link",{name:old.body+" 편집",exact:true}).click();await form(page).getByRole("button",{name:/^이전: 할 일/}).click();
  await expect(related.getByRole("link",{name:old.body+" 편집",exact:true})).toBeFocused();await expect(page).toHaveURL(/related_record_pages=2/);
  expect(reads.slice(0,3).map(p=>p.get("cursor"))).toEqual([null,"more","more"]);for(const params of reads){expect(params.get("task_id")).toBe(id(2));expect(params.get("limit")).toBe("20");expect(params.has("occurred_from")).toBe(false);}
  expect(state.errors).toEqual([]);
});

test("기록 연결 할 일: 제목 조회 실패 재시도와 삭제 상태",async({page})=>{
  const state=await fixtures(page);state.rows.records[0].task_id=id(2);let failed=true,missing=false;
  await page.route(`**/api/tasks/${id(2)}`,route=>failed?route.fulfill({status:503,json:{code:"internal",message:"임시 실패"}}):missing?route.fulfill({status:404,json:{code:"not_found",message:"없음"}}):route.fulfill({json:state.rows.tasks[0]}));
  await go(page,`/records/${id(3)}`);const section=form(page).getByRole("region",{name:"할 일 (1개)"});
  await expect(section).toContainText("불러오지 못했습니다");failed=false;await section.getByRole("button",{name:"할 일 다시 조회"}).click();await expect(section.getByRole("button",{name:"할 일",exact:true})).toBeVisible();
  missing=true;await page.reload();await expect(section).toContainText("삭제된 할 일 또는 접근할 수 없는 할 일");await expect(section.getByRole("link")).toHaveCount(0);expect(state.errors).toEqual([]);
});


test("연결 조회 늦은 응답은 다음 할 일·기록에 섞이지 않는다",async({page})=>{
  const state=await fixtures(page);state.rows.tasks.push({...task(40),title:"다음 할 일"});state.rows.records.push({...record(41),body:"다음 기록",task_id:id(40)});state.rows.records[0].task_id=id(2);
  let release=()=>{},arrive=()=>{};const held=new Promise<void>(resolve=>release=resolve),started=new Promise<void>(resolve=>arrive=resolve);
  await page.route("**/api/records?**",async route=>{if(!new URL(route.request().url()).searchParams.has("task_id"))return route.fallback();if(new URL(route.request().url()).searchParams.get("task_id")==id(2)){arrive();await held;return route.fulfill({json:{items:[{...record(42),body:"오래된 조회"}],next_cursor:null}}).catch(()=>{});}return route.fulfill({json:{items:[],next_cursor:null}});});
  await go(page,`/tasks/${id(2)}`);await started;await page.getByRole("link",{name:"할 일 fixture",exact:true}).evaluate((el:HTMLAnchorElement)=>el.click());
  await page.getByRole("link",{name:"다음 할 일",exact:true}).click();await expect(form(page)).toContainText("기록 (0개)");release();await expect(form(page)).not.toContainText("오래된 조회");
  let releaseTask=()=>{},arriveTask=()=>{};const heldTask=new Promise<void>(resolve=>releaseTask=resolve),startedTask=new Promise<void>(resolve=>arriveTask=resolve);
  await page.route(`**/api/tasks/${id(2)}`,async route=>{arriveTask();await heldTask;return route.fulfill({json:{...state.rows.tasks[0],title:"오래된 할 일"}}).catch(()=>{});});
  await go(page,`/records/${id(3)}`);await startedTask;await page.getByRole("link",{name:"기록 fixture",exact:true}).evaluate((el:HTMLAnchorElement)=>el.click());await page.getByRole("link",{name:"다음 기록",exact:true}).click();
  await expect(form(page).getByRole("button",{name:"다음 할 일",exact:true})).toBeVisible();releaseTask();await expect(form(page)).not.toContainText("오래된 할 일");expect(state.errors).toEqual([]);
});


test("연결 기록 자동 복원 상한 뒤에도 수동 더 보기는 다음 cursor를 읽는다",async({page})=>{
  const state=await fixtures(page),cursors:number[]=[];
  await page.route("**/api/records?**",route=>{const n=Number(new URL(route.request().url()).searchParams.get("cursor")??0);cursors.push(n);return route.fulfill({json:{items:[{...record(1000+n),body:`기록 ${n}`,task_id:id(2)}],next_cursor:n<250?String(n+1):null}});});
  await go(page,`/tasks/${id(2)}?related_record_pages=250`);
  const section=form(page).getByRole("region",{name:/^기록 \(/});await expect(section.getByRole("button",{name:"기록 더 보기"})).toBeEnabled();
  expect(cursors).toHaveLength(250);await section.getByRole("button",{name:"기록 더 보기"}).click();await expect(section.getByRole("button",{name:"기록 250",exact:true})).toBeVisible();expect(cursors.at(-1)).toBe(250);expect(cursors).toHaveLength(251);expect(state.errors).toEqual([]);
});

for(const [kind,n,title] of [["entities",1,"엔터티"],["tasks",2,"할 일"],["records",3,"기록"],["principles",4,"현재 기준"]] as const)for(const width of [390,1440])test(`#185 ${kind} ${width}px: 제목만 클릭·동일 dialog 편집/취소·한 번 닫기`,async({page},info)=>{
  const state=await fixtures(page);await page.setViewportSize({width,height:900});await go(page,`/${kind}`);
  await expect(page.getByRole("link",{name:/ 편집$/})).toHaveCount(0);
  const titleLink=page.getByRole("link",{name:title,exact:true}),row=titleLink.locator("xpath=ancestor::section[contains(@class,'current-document')] | ancestor::li[contains(@class,'list-item')]").first();
  const t=(await titleLink.boundingBox())!,r=(await row.boundingBox())!;expect(t.width).toBeLessThan(r.width-40);
  await page.mouse.click(r.x+r.width-24,t.y+t.height/2);await expect(form(page)).toHaveCount(0);
  await titleLink.click();await expect(form(page)).toHaveCount(1);await form(page).evaluate(el=>el.setAttribute("data-same-dialog","yes"));
  await openDetailEditor(page);await expect(form(page)).toHaveAttribute("data-same-dialog","yes");await expect(page.locator("dialog[open]")).toHaveCount(1);
  await form(page).getByRole("button",{name:"취소",exact:true}).click();await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeVisible();await expect(form(page)).toHaveAttribute("data-same-dialog","yes");
  await openDetailEditor(page);await form(page).getByRole("textbox",{name:kind==="entities"?/^속성 1/:kind==="records"?/^본문/:/^제목/}).fill("버릴 초안");
  await form(page).getByRole("button",{name:"닫기",exact:true}).click();const discard=page.getByRole("dialog",{name:"변경을 버릴까요?",exact:true});
  await expect(discard).toBeVisible();const b=(await discard.boundingBox())!;expect(b.height).toBeLessThan(450);expect(Math.abs(b.y+b.height/2-450)).toBeLessThanOrEqual(2);
  await page.screenshot({path:info.outputPath(`discard-${kind}-${width}.png`)});await discard.getByRole("button",{name:"취소",exact:true}).click();
  await expect(form(page).getByRole("textbox",{name:kind==="entities"?/^속성 1/:kind==="records"?/^본문/:/^제목/})).toHaveValue("버릴 초안");
  await form(page).getByRole("button",{name:"닫기",exact:true}).click();await discard.getByRole("button",{name:"변경 버리기",exact:true}).click();await expect(page.locator("dialog[open]")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/${kind}[?#]`));expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});
for(const kind of ["tasks","records"] as const)test(`#185 ${kind}: 검색 Enter는 저장하지 않고 검색·선택은 아래 표준 카드`,async({page},info)=>{
  const state=await fixtures(page);state.rows.entities[0].prop1="검색 대상";if(kind==="tasks")await go(page,"/tasks?create=1");else{await go(page,`/records/${state.rows.records[0].id}`);await openDetailEditor(page);}
  const search=form(page).getByRole("searchbox",{name:"엔터티 제목 검색",exact:true});await search.dispatchEvent("compositionstart");await search.fill("검");await search.press("Enter");
  await expect(page.locator("dialog.modal-action[open]")).toHaveCount(0);expect(state.writes).toHaveLength(0);await search.fill("검색");await search.dispatchEvent("compositionend");await search.press("Enter");
  const result=form(page).getByRole("group",{name:"엔터티 검색 결과"});await result.getByRole("button",{name:"검색 대상 연결",exact:true}).click();
  const selected=form(page).getByRole("list",{name:"선택한 엔터티",exact:true});await expect(selected.locator(".related-item")).toHaveCount(1);expect((await selected.boundingBox())!.y).toBeGreaterThan((await search.boundingBox())!.y);
  await expect(page.locator("dialog.modal-action[open]")).toHaveCount(0);expect(state.writes).toHaveLength(0);
  if(kind==="tasks"){await expect(form(page).getByRole("heading",{name:"일정",exact:true})).toHaveCount(0);await expect(form(page).getByLabel("기한",{exact:true})).toHaveCount(1);}
  await page.screenshot({path:info.outputPath(`entity-picker-${kind}.png`)});expect(state.errors).toEqual([]);
});
test("#185 빈 연결 개수만 표시·관계 카드 빈 공간은 이동하지 않음",async({page})=>{
  const state=await fixtures(page);await go(page,`/tasks/${id(2)}`);await expect(form(page).getByRole("heading",{name:"기록 (0개)",exact:true})).toBeVisible();await expect(form(page).getByText("연결된 기록이 없습니다.",{exact:true})).toHaveCount(0);
  Object.assign(state.rows.tasks[0],{entity_ids:[id(1)],entity_context:[{id:id(1),title:"엔터티",source:"selection",captured_at:stamp}]});await page.reload();
  const link=form(page).getByRole("button",{name:"엔터티",exact:true}),card=link.locator("xpath=ancestor::div[contains(@class,'related-item')][last()]");
  const t=(await link.boundingBox())!;await page.mouse.click(t.x+t.width+12,t.y+t.height/2);await expect(page).toHaveURL(new RegExp(`/tasks/${id(2)}$`));await link.click();await expect(link).toHaveAttribute("aria-expanded","true");await expect(page).toHaveURL(new RegExp(`/tasks/${id(2)}$`));expect(state.errors).toEqual([]);
});

for(const [kind,n] of [["entities",1],["tasks",2],["records",3],["principles",4]] as const)test(`#185 ${kind}: 직접 편집 취소의 폐기 확인은 같은 보기로 복귀`,async({page})=>{
  const state=await fixtures(page);await go(page,`/${kind}/${id(n)}?edit=1`);const input=form(page).getByRole("textbox",{name:kind==="entities"?/^속성 1/:kind==="records"?/^본문/:/^제목/});
  await input.fill("취소할 편집");await form(page).getByRole("button",{name:"취소",exact:true}).click();const discard=page.getByRole("dialog",{name:"변경을 버릴까요?"});
  await discard.getByRole("button",{name:"변경 버리기",exact:true}).click();await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeVisible();await expect(page).not.toHaveURL(/[?&]edit=/);expect(new URL(page.url()).pathname).toBe(`/${kind}/${id(n)}`);
  await expect(page.locator("dialog[open]")).toHaveCount(1);await expect(form(page).getByRole("textbox")).toHaveCount(0);expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

for(const side of ["tasks","entities"] as const)for(const width of [390,1440])test(`#187 ${side} ${width}px: 보기에서 기존 연결·취소·해제·제목 링크·기록`,async({page},info)=>{
  const state=await fixtures(page),taskRow=state.rows.tasks[0],entityRow=state.rows.entities[0];
  await page.route(`**/api/entities/${id(1)}`,route=>route.fulfill({json:{...entityRow,tasks:{count:taskRow.entity_ids.includes(id(1))?1:0,items:taskRow.entity_ids.includes(id(1))?[taskRow]:[]}}}));
  await page.setViewportSize({width,height:900});await go(page,`/${side}/${id(side==="tasks"?2:1)}`);
  await form(page).evaluate(el=>el.setAttribute("data-original","yes"));
  await form(page).getByRole("button",{name:side==="tasks"?"엔터티 연결":"할 일 연결",exact:true}).click();
  const search=form(page).getByRole("searchbox",{name:side==="tasks"?"엔터티 제목 검색":"할 일 제목 검색"});await search.fill(side==="tasks"?"엔터티":"할 일");await search.press("Enter");
  expect(state.writes).toHaveLength(0);await expect(page.locator("dialog.modal-action[open]")).toHaveCount(0);
  const connect=form(page).getByRole("button",{name:side==="tasks"?"엔터티 연결":"할 일 연결",exact:true}).last();await connect.click();
  await expect(form(page).getByLabel("기록 메모",{exact:true})).toHaveValue("할 일 — 엔터티 연결");await expect(form(page)).toHaveAttribute("data-original","yes");await expect(page.locator("dialog[open]")).toHaveCount(1);
  await form(page).getByRole("button",{name:"취소",exact:true}).click();expect(state.writes).toHaveLength(0);await connect.click();await form(page).getByRole("button",{name:"연결하고 저장",exact:true}).click();
  const title=side==="tasks"?"엔터티":"할 일",unlink=form(page).getByRole("button",{name:`${title} 해제`,exact:true});await expect(unlink).toBeVisible();
  expect(state.writes[0].body.entity_ids).toEqual([id(1)]);expect(state.writes[0].body.expected_version).toBe(1);await expect(form(page).getByRole("button",{name:title,exact:true})).toBeVisible();
  if(side==="tasks"){
    await openDetailEditor(page);await expect(form(page).getByRole("searchbox",{name:"엔터티 제목 검색"})).toHaveCount(0);await form(page).getByRole("button",{name:"취소",exact:true}).click();
    await form(page).getByRole("button",{name:"기록 작성",exact:true}).click();await form(page).getByLabel("본문",{exact:false}).fill("완료 전 진행 메모");await form(page).getByRole("button",{name:"저장",exact:true}).click();
    await expect(form(page).getByRole("button",{name:"완료 전 진행 메모",exact:true})).toBeVisible();await expect(form(page).getByRole("button",{name:"기록 작성",exact:true})).toBeFocused();expect(taskRow.status).toBe("open");expect(state.writes.at(-1)?.body.task_id).toBe(id(2));
  }
  await page.screenshot({path:info.outputPath(`relations-${side}-${width}.png`)});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await unlink.click();await form(page).getByRole("button",{name:"해제하고 저장",exact:true}).click();await expect(page.locator("dialog.modal-action[open]")).toHaveCount(0);await expect(unlink).toHaveCount(0);
  expect(state.writes.at(-1)?.body.entity_ids).toEqual([]);expect(state.rows.tasks).toHaveLength(1);expect(state.rows.entities).toHaveLength(1);expect(state.errors).toEqual([]);
});

test("#187 연결 미확정 재시도는 같은 버전·내용을 유지하고 취소는 최신 보기를 조회한다",async({page})=>{
  const state=await fixtures(page,{failWrite:"unknown"});await go(page,`/tasks/${id(2)}`);await form(page).getByRole("button",{name:"엔터티 연결",exact:true}).click();await form(page).getByRole("searchbox",{name:"엔터티 제목 검색"}).fill("엔터티");
  await form(page).getByRole("button",{name:"엔터티 연결",exact:true}).last().click();await form(page).getByRole("button",{name:"연결하고 저장"}).click();await expect(form(page).getByRole("button",{name:"같은 내용 다시 시도"})).toBeVisible();await expect(form(page).getByLabel("기록 메모")).toBeDisabled();
  await form(page).getByRole("button",{name:"같은 내용 다시 시도"}).click();await expect(form(page).getByRole("button",{name:"엔터티 해제"})).toBeVisible();expect(state.writes[0].body).toEqual(state.writes[1].body);expect(state.errors).toEqual([]);
});

test("#187 연결 검색 IME·늦은 추가 페이지 격리와 다른 편집 중 준비 응답 무시",async({page})=>{
  const state=await fixtures(page),reads:URLSearchParams[]=[];let releasePage=()=>{},releaseTask=()=>{},arrivePage=()=>{},arriveTask=()=>{};
  const heldPage=new Promise<void>(resolve=>releasePage=resolve),startedPage=new Promise<void>(resolve=>arrivePage=resolve),heldTask=new Promise<void>(resolve=>releaseTask=resolve),startedTask=new Promise<void>(resolve=>arriveTask=resolve);
  await page.route("**/api/entities?**",async route=>{
    const q=new URL(route.request().url()).searchParams;reads.push(q);
    if(q.has("cursor")){arrivePage();await heldPage;return route.fulfill({json:{items:[{...entity(81),prop1:"오래된 후보"}],next_cursor:null}}).catch(()=>{});}
    return route.fulfill({json:{items:[{...entity(),prop1:q.get("keyword")}],next_cursor:q.get("keyword")==="이전"?"more":null}});
  });
  await go(page,`/tasks/${id(2)}`);await form(page).getByRole("button",{name:"엔터티 연결",exact:true}).click();const search=form(page).getByRole("searchbox",{name:"엔터티 제목 검색"});
  await search.dispatchEvent("compositionstart");await search.fill("이");await search.press("Enter");await page.waitForTimeout(350);expect(reads).toHaveLength(0);await search.fill("이전");await search.dispatchEvent("compositionend");await form(page).getByRole("button",{name:"검색 결과 더 보기"}).click();await startedPage;
  await search.fill("최신");await search.press("Enter");await expect(form(page).getByRole("button",{name:"최신 연결"})).toBeVisible();releasePage();await expect(form(page)).not.toContainText("오래된 후보");
  await page.route(`**/api/tasks/${id(2)}`,async route=>{arriveTask();await heldTask;return route.fulfill({json:state.rows.tasks[0]}).catch(()=>{});});
  await form(page).getByRole("button",{name:"최신 연결"}).click();await startedTask;await form(page).getByRole("button",{name:"편집",exact:true}).click();releaseTask();await form(page).getByRole("textbox",{name:"제목 (필수)"}).fill("보존할 편집");await page.waitForTimeout(100);await expect(page.locator("dialog.modal-action[open]")).toHaveCount(0);await expect(form(page).getByRole("textbox",{name:"제목 (필수)"})).toHaveValue("보존할 편집");expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

for(const side of ["tasks","entities"] as const)test(`#187 ${side}: 두 번째 검색 페이지 후보를 보고 돌아오면 검색·초점 복원`,async({page})=>{
  const state=await fixtures(page),kind=side==="tasks"?"entities":"tasks",label=side==="tasks"?"엔터티":"할 일";
  const a=kind==="entities"?{...entity(81),prop1:"후보 첫째"}:{...task(81),title:"후보 첫째"},b=kind==="entities"?{...entity(82),prop1:"후보 둘째"}:{...task(82),title:"후보 둘째"};
  if(kind==="entities")state.rows.entities.push(a as ReturnType<typeof entity>,b as ReturnType<typeof entity>);else state.rows.tasks.push(a as ReturnType<typeof task>,b as ReturnType<typeof task>);
  await page.route(`**/api/${kind}?**`,route=>route.fulfill({json:new URL(route.request().url()).searchParams.has("cursor")?{items:[b],next_cursor:null}:{items:[a],next_cursor:"more"}}));
  await go(page,`/${side}/${id(side==="tasks"?2:1)}`);await form(page).getByRole("button",{name:`${label} 연결`,exact:true}).click();
  await form(page).getByRole("searchbox",{name:`${label} 제목 검색`}).fill("후보");await form(page).getByRole("button",{name:"검색 결과 더 보기"}).click();
  const candidate=form(page).getByRole("group",{name:`${label} 검색 결과`}).getByRole("link",{name:"후보 둘째",exact:true});await candidate.click();
  await expect(page).toHaveURL(new RegExp(`/${kind}/${id(82)}$`));await expect(page.locator("dialog[open]")).toHaveCount(1);
  await form(page).getByRole("button",{name:/^이전:/}).click();await expect(form(page).getByRole("searchbox",{name:`${label} 제목 검색`})).toHaveValue("후보");await expect(candidate).toBeFocused();expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

for(const side of ["tasks","entities"] as const)test(`#187 ${side}: 연결 저장 뒤 조회 실패는 확정 연결을 유지하고 조회만 재시도`,async({page})=>{
  const state=await fixtures(page),taskRow=state.rows.tasks[0],entityRow=state.rows.entities[0],label=side==="tasks"?"엔터티":"할 일";let fail=true;
  await page.route(`**/api/${side}/${id(side==="tasks"?2:1)}`,route=>{
    if(route.request().method()!=="GET")return route.fallback();
    if(state.writes.length&&fail)return route.fulfill({status:503,json:{code:"internal",message:"조회 실패"}});
    return route.fulfill({json:side==="tasks"?taskRow:{...entityRow,tasks:{count:taskRow.entity_ids.length,items:taskRow.entity_ids.length?[taskRow]:[]}}});
  });
  await go(page,`/${side}/${id(side==="tasks"?2:1)}`);await form(page).getByRole("button",{name:`${label} 연결`,exact:true}).click();await form(page).getByRole("searchbox",{name:`${label} 제목 검색`}).fill(label);
  await form(page).getByRole("group",{name:`${label} 검색 결과`}).getByRole("button",{name:`${label} 연결`,exact:true}).click();await form(page).getByRole("button",{name:"연결하고 저장",exact:true}).click();
  await expect(form(page).getByRole("alert")).toContainText("연결은 저장했습니다. 최신 내용을 불러오지 못했습니다.");await expect(form(page).getByRole("button",{name:`${label} 해제`})).toBeVisible();expect(state.writes).toHaveLength(1);
  fail=false;await form(page).getByRole("button",{name:side==="tasks"?"조회 다시 시도":"다시 시도",exact:true}).click();await expect(form(page).getByRole("alert")).toHaveCount(0);expect(state.writes).toHaveLength(1);expect(state.errors).toEqual([]);
});

test("#187 엔터티: 확인 취소 후 외부 연결·해제 결과가 검색 후보에도 반영된다",async({page})=>{
  const state=await fixtures(page),taskRow=state.rows.tasks[0];
  await page.route(`**/api/entities/${id(1)}`,route=>route.fulfill({json:{...state.rows.entities[0],tasks:{count:taskRow.entity_ids.length,items:taskRow.entity_ids.length?[taskRow]:[]}}}));
  await go(page,`/entities/${id(1)}`);await form(page).getByRole("button",{name:"할 일 연결",exact:true}).click();await form(page).getByRole("searchbox",{name:"할 일 제목 검색"}).fill("할 일");
  const results=form(page).getByRole("group",{name:"할 일 검색 결과"});await results.getByRole("button",{name:"할 일 연결",exact:true}).click();
  taskRow.entity_ids=[id(1)];taskRow.version++;await form(page).getByRole("button",{name:"취소",exact:true}).click();
  await expect(form(page).getByRole("button",{name:"할 일 해제"})).toBeVisible();await expect(results.getByRole("button",{name:"할 일 연결",exact:true})).toHaveCount(0);
  await form(page).getByRole("button",{name:"할 일 해제"}).click();taskRow.entity_ids=[];taskRow.version++;await form(page).getByRole("button",{name:"취소",exact:true}).click();
  await expect(form(page).getByRole("heading",{name:"할 일 (0개)",exact:true})).toBeVisible();await expect(results.getByRole("button",{name:"할 일 연결",exact:true})).toBeVisible();expect(state.writes).toHaveLength(0);expect(state.errors).toEqual([]);
});

for (const width of [320,1440]) test(`#191 기록 작성 ${width}px: 할 일·엔터티 공통 카드와 독립 기록 태그`,async({page},info)=>{
  const state=await fixtures(page);await page.setViewportSize({width,height:900});await go(page,"/records?create=1");
  const draft=form(page);await draft.getByRole("textbox",{name:/^본문/}).fill("상담 내역");
  await expect(draft.getByRole("group",{name:"태그",exact:true})).toHaveCount(0);
  const tags=draft.locator(".tag-picker");await expect(tags).toContainText("기록 태그");await tags.getByRole("button",{name:"같은 이름",exact:true}).click();
  const taskSearch=draft.getByRole("searchbox",{name:"할 일 제목 검색"});await taskSearch.fill("할");await taskSearch.press("Enter");
  await draft.getByRole("group",{name:"할 일 검색 결과"}).getByRole("button",{name:"할 일 연결",exact:true}).click();
  const entitySearch=draft.getByRole("searchbox",{name:"엔터티 제목 검색"});await entitySearch.fill("엔터");await entitySearch.press("Enter");
  await draft.getByRole("group",{name:"엔터티 검색 결과"}).getByRole("button",{name:"엔터티 연결",exact:true}).click();
  expect(state.writes).toHaveLength(0);await expect(draft.getByRole("list",{name:"선택한 할 일"}).locator(".related-item")).toHaveCount(1);
  await expect(draft.getByRole("list",{name:"선택한 엔터티"}).locator(".related-item")).toHaveCount(1);await expect(draft.locator(".entity-choice")).toHaveCount(0);
  await draft.getByRole("button",{name:"엔터티 해제",exact:true}).click();await expect(entitySearch).toBeFocused();
  await draft.getByRole("group",{name:"엔터티 검색 결과"}).getByRole("button",{name:"엔터티 연결",exact:true}).click();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`record-relationships-${width}.png`)});await draft.getByRole("button",{name:"저장",exact:true}).click();
  await expect.poll(()=>state.writes.length).toBe(1);expect(state.writes[0].body).toMatchObject({task_id:id(2),entity_ids:[id(1)],tag_ids:[id(11)],body:"상담 내역"});expect(state.errors).toEqual([]);
});
test("#191 할 일에서 일반 기록 작성: 귀속 미리 선택·변경·엔터티 초안 유지",async({page})=>{
  const state=await fixtures(page),t=state.rows.tasks[0];Object.assign(t,{entity_ids:[id(1)],entity_context:[{id:id(1),title:"엔터티",source:"selection",captured_at:stamp}]});state.rows.tasks.push({...task(82),title:"다른 할 일"});
  await go(page,`/tasks/${id(2)}`);await form(page).getByRole("button",{name:"기록 작성",exact:true}).click();
  const draft=form(page);await draft.getByRole("textbox",{name:/^본문/}).fill("추가 관찰");await expect(draft.getByRole("list",{name:"선택한 할 일"})).toContainText("할 일");
  await draft.getByRole("searchbox",{name:"할 일 제목 검색"}).fill("다른");await draft.getByRole("group",{name:"할 일 검색 결과"}).getByRole("button",{name:"다른 할 일 연결",exact:true}).click();
  await expect(draft.getByRole("list",{name:"선택한 할 일"}).locator(".related-item")).toHaveCount(1);await expect(draft.getByRole("list",{name:"선택한 엔터티"})).toContainText("엔터티");
  await draft.getByRole("button",{name:"저장",exact:true}).click();await expect.poll(()=>state.writes.length).toBe(1);expect(state.writes[0].body).toMatchObject({task_id:id(82),entity_ids:[id(1)]});expect(t.status).toBe("open");expect(state.errors).toEqual([]);
});

for (const [kind,label,scope] of [["tasks","할 일","task"],["records","기록","record"]]) test(`#191 ${label} 태그 닫기는 원래 조건과 메뉴 초점을 복원`,async({page})=>{
  const state=await fixtures(page);await go(page,`/${kind}?pages=1&scroll=0`);await page.getByRole("button",{name:`${label} 작업 메뉴`}).click();
  await page.getByRole("link",{name:`${label} 태그 관리`,exact:true}).click();await expect(page).toHaveURL(new RegExp(`/tags/${scope}$`));await form(page).getByRole("button",{name:"닫기",exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/${kind}\\?pages=1&scroll=0$`));await expect(page.getByRole("button",{name:`${label} 작업 메뉴`})).toBeFocused();expect(state.errors).toEqual([]);
});
test("#191 원칙 검색 전환은 태그 조건 해제·직접 링크의 조건은 명시 해제 가능",async({page})=>{
  const state=await fixtures(page);await go(page,`/search?q=기준&kind=task&tag_id=${id(12)}`);await page.getByText("검색 조건 · 조건 적용 중",{exact:true}).click();
  await page.getByRole("combobox",{name:"검색 대상",exact:true}).selectOption("principle");await expect(page).not.toHaveURL(/tag_id=/);await expect.poll(()=>state.searches.at(-1)?.kinds).toEqual(["principle"]);expect(state.searches.at(-1)?.tag_ids).toBeUndefined();
  await go(page,`/search?q=기준&kind=principle&tag_id=${id(12)}`);await page.getByText("검색 조건 · 조건 적용 중",{exact:true}).click();await page.getByRole("button",{name:"저장된 태그 조건 해제",exact:true}).click();
  await expect(page).not.toHaveURL(/tag_id=/);expect(state.errors).toEqual([]);
});
