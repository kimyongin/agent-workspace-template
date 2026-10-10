import { entityKey } from "./support/workspace-data.ts";
import { fillChangeMemo } from "./ui-actions.ts";
import { saveOnce, beginTabAction } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { id, stamp } from "./support/workspace-data.ts";
import { connectedTarget, fixtures, go, form, compatibleEdit, fillText } from "./support/workspace-screens.ts";

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

test("폐기한 원칙 ID는 조회 오류를 알리고 편집·삭제를 제공하지 않는다",async({page})=>{
  const state=await fixtures(page);const current={...state.rows.principles[0]};await go(page,`/principles/${encodeURIComponent(entityKey(5))}?edit=1`);
  await expect(form(page)).toContainText("삭제된 자료");await expect(form(page).getByRole("button",{name:"삭제",exact:true})).toHaveCount(0);
  await expect(form(page).getByRole("textbox")).toHaveCount(0);expect(state.writes).toHaveLength(0);
  expect(state.rows.principles[0]).toEqual(current);expect(state.errors).toEqual([]);
});

test("원칙 저장 결과는 같은 ID·확인된 본문을 보여준다",async({page})=>{
  const state=await fixtures(page);await go(page,`/principles/${id(4)}?list=%2Fprinciples`);
  await compatibleEdit(page);await form(page).getByRole("textbox",{name:"본문",exact:true}).fill("확인된 현재 원칙");
  await saveOnce(page,form(page));await expect(page).toHaveURL(new RegExp(id(4)));
  await expect(form(page)).toContainText("확인된 현재 원칙");
  expect(state.rows.principles[0].id).toBe(id(4));expect(state.writes).toHaveLength(1);expect(state.errors).toEqual([]);
});

for(const [kind,label] of [["entities","엔터티"],["tasks","할 일"],["records","기록"]]) {
  test(`${kind}: 생성·보기·편집 메모·태그·삭제 이유`,async({page})=>{
    const state=await fixtures(page);await go(page,`/${kind}`);await beginTabAction(page,kind==="records"?"기록 작성":`${label} 추가`);
    if(kind==="entities")await form(page).getByLabel("속성 1",{exact:false}).fill("새 엔터티");else await fillText(page,`새 ${label}`);
    await form(page).getByRole("button",{name:"같은 이름",exact:true}).click();await saveOnce(page, form(page), kind==="tasks"?"추가":"저장");
    await expect(page).toHaveURL(new RegExp(`/${kind}/`));await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeVisible();const createdPath=new URL(page.url()).pathname;
    await compatibleEdit(page);await expect(form(page)).toHaveCount(1);
    await expect(form(page).getByRole("button",{name:"저장",exact:true})).toBeVisible();
    if(kind==="entities")await form(page).getByLabel("속성 2",{exact:false}).fill("20");else await form(page).getByRole("textbox",{name:/^본문(?: \(필수\))?$/}).fill("편집한 본문");
    if(kind!=="records") await fillChangeMemo(page,form(page),"실측 결과 반영");
    await saveOnce(page, form(page));if(kind==="entities")await go(page,createdPath+"?edit=1");else {await expect(form(page).getByRole("button",{name:"편집",exact:true})).toBeVisible();await compatibleEdit(page);}await expect(form(page).getByRole("button",{name:"삭제",exact:true})).toBeVisible();
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
  await saveOnce(page,confirm,"삭제 확인");await expect(page.getByRole("button",{name:"원칙 작성"})).toBeVisible();
  await expect(page.getByRole("link",{name:"과거 근거는 통합 기록에서 보기"})).toHaveAttribute("href","/records");expect(state.errors).toEqual([]);
});

test("새 기록은 원칙 연관키 선택 없이 본문 근거를 저장한다",async({page})=>{
  const state=await fixtures(page);await go(page,"/records?create=1");await fillText(page,"독립 기록");
  await expect(form(page).getByText("적용한 원칙",{exact:true})).toHaveCount(0);
  await saveOnce(page,form(page));await expect.poll(()=>state.writes.length).toBe(1);expect(state.writes[0].body).not.toHaveProperty("applied_principle_ids");
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
  const state=await fixtures(page);const r=state.rows.records[0];Object.assign(r,{record_kind:"change",body:"실측 반영",change:{event_id:id(30),target_kind:"entity",target_id:entityKey(99),target_title:"삭제된 엔터티",action:"delete",source:"mcp",before:{prop2:10},after:null,path:null},applied_principle_snapshots:[{id:id(4),version:1,status:"active",title:"당시 기준",body:"당시 본문",saved_at:stamp,summary:"당시 요약",captured_at:"migration"}]});
  await go(page,`/records/${r.id}`);await expect(form(page)).toContainText("에이전트");await expect(connectedTarget(page,"entity")).toContainText("삭제됨");await expect(form(page)).toContainText("당시 본문");await expect(form(page)).toContainText("실제 판단 당시의 본문을 보증하지 않습니다.");await expect(connectedTarget(page,"entity").getByRole("link")).toHaveCount(0);
  await compatibleEdit(page);await expect(form(page).getByLabel("수행 시각")).toHaveCount(0);await expect(form(page).getByText("기록 태그",{exact:true})).toHaveCount(0);await form(page).getByLabel("본문",{exact:false}).fill("설명 정정");await saveOnce(page, form(page));
  await expect.poll(()=>state.writes.length).toBe(1);expect(Object.keys(state.writes[0].body).sort()).toEqual(["body","expected_version"].sort());expect(state.rows.entities[0].prop2).toBe(0);
  await expect(form(page).getByRole("heading",{name:"기록",exact:true})).toBeVisible();await compatibleEdit(page);await form(page).getByRole("button",{name:"삭제",exact:true}).click();const confirm=page.locator("dialog.modal-action[open]");await expect(confirm).toContainText("대상의 업무 상태는 되돌리지 않습니다.");await saveOnce(page,confirm,"삭제 확인");await expect(page).toHaveURL(/\/records$/);expect(state.rows.entities[0].prop2).toBe(0);expect(state.rows.records).toHaveLength(0);expect(state.errors).toEqual([]);
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
  await expect(form(page).getByRole("textbox",{name:/태그 이름/})).toHaveValue("활동 추가");await saveOnce(page,form(page),"추가");await expect.poll(()=>state.writes.at(-1)?.body.scope).toBe("record");
  await page.getByRole("button",{name:"활동 추가 삭제",exact:true}).click();await page.locator("dialog.modal-action[open]").getByRole("button",{name:"삭제하고 기록",exact:true}).click();await expect(page.getByRole("button",{name:"활동 추가 삭제",exact:true})).toHaveCount(0);expect(state.errors).toEqual([]);
});
