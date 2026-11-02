import { expect, test, type Page } from "@playwright/test";
import { installWorkspaceApi, type FakeOptions } from "./support/workspace-api.ts";
import { entity, task, id, fixtureSchema, fixtureType, entityKey } from "./support/workspace-data.ts";
import { fixtureWorkspaceId, fixtureWorkspacePath } from "./support/workspace-scope.ts";
import { executionDialog } from "./ui-actions.ts";
import { detailDialog } from "./ui-actions.ts";
const draft = Array.from({length:20},(_,i)=>`${i+1}. 원고의 준비 조건과 미승인 기능을 확인합니다.`).join("\n");
async function setup(page:Page,options:FakeOptions={},extra:ReturnType<typeof task>[] = [],seed?:(state:Awaited<ReturnType<typeof installWorkspaceApi>>)=>void){
 const t={...task(),title:"CT01 원고 검토",body:"원고7행 공개 전 준비 조건을 명시하세요.\n\n원고10행 미승인 기능의 보류 이유를 적으세요.",entity_ids:[entityKey(1)]};
 const e={...entity(1,{prop_1:"시험 원고",prop_7:draft}),tasks:{count:1+extra.length,items:[t,...extra]}};
 const state=await installWorkspaceApi(page,"http://127.0.0.1:55591",{entities:[e],tasks:[t,...extra],records:[],tags:[]},options);
 const user={id:id(100),aud:"authenticated",email:"fixture@example.test",app_metadata:{},user_metadata:{}};
 await page.addInitScript(user=>localStorage.setItem("sb-127-auth-token",JSON.stringify({access_token:"fixture",refresh_token:"fixture",expires_at:Math.floor(Date.now()/1000)+3600,user})),user);
 await page.route("**/auth/v1/user",route=>route.fulfill({json:user}));
 const definition=structuredClone(fixtureSchema);definition.schema.properties.prop_7={type:"string",title:"원고",maxLength:4096,"x-order":70};
 await page.route(`**/api/entity-types/${fixtureType.id}/schema**`,route=>route.fulfill({json:definition}));
 seed?.(state);
 await page.goto(fixtureWorkspacePath(`/entities/${encodeURIComponent(entityKey(1))}`));
 await detailDialog(page).getByRole("button",{name:"편집",exact:true}).click();
 return state;
}
const reader=(page:Page)=>page.getByRole("dialog",{name:"관련 할 일 읽기",exact:true});
test("#663 reading a current related task returns to the same manuscript input without navigation or writes",async({page},info)=>{
 await page.setViewportSize({width:1280,height:720});const state=await setup(page);
 const input=detailDialog(page).getByRole("textbox",{name:"원고",exact:true});
 await input.fill(draft+"\n미저장 수정");await input.focus();await input.press("ControlOrMeta+A");await input.press("ArrowLeft");await input.press("ArrowDown");await input.press("End");
 await input.evaluate(node=>new Promise<void>(resolve=>{let previous=node.scrollTop,stable=0;const frame=()=>{stable=node.scrollTop===previous?stable+1:0;previous=node.scrollTop;if(stable>=4)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);}));
 await page.evaluate(()=>document.fonts.ready);
 const handle=await input.elementHandle();
 await input.evaluate(n=>{const t=n as HTMLTextAreaElement;(window as any).readerEvents=[];for(const type of ["focusin","focusout","select","scroll"])document.addEventListener(type,e=>{if(e.target===t)(window as any).readerEvents.push({type,top:t.scrollTop,start:t.selectionStart,height:t.clientHeight,width:t.clientWidth,active:document.activeElement?.tagName,time:performance.now()});},true);});
 const before=await input.evaluate(n=>{const t=n as HTMLTextAreaElement;const parents=[];for(let p=t.parentElement;p;p=p.parentElement)if(p.scrollHeight>p.clientHeight)parents.push({node:p,top:p.scrollTop});(window as any).readerParents=parents;return{value:t.value,start:t.selectionStart,end:t.selectionEnd,direction:t.selectionDirection,top:t.scrollTop,left:t.scrollLeft};});
 const url=page.url();await detailDialog(page).getByRole("button",{name:"관련 할 일",exact:true}).click();
 await reader(page).getByRole("button",{name:"CT01 원고 검토",exact:true}).click();
 await expect(reader(page)).toContainText("원고10행 미승인 기능의 보류 이유를 적으세요.");
 await page.screenshot({path:info.outputPath("related-task-desktop.png")});
 await reader(page).getByRole("button",{name:"편집으로 돌아가기",exact:true}).click();
 await expect(input).toBeFocused();expect(await handle!.evaluate(n=>n.isConnected)).toBe(true);expect(await input.evaluate((node,original)=>node===original,handle)).toBe(true);
 await info.attach("origin-events",{body:JSON.stringify(await page.evaluate(()=>(window as any).readerEvents)),contentType:"application/json"});
 expect(await input.evaluate(n=>{const t=n as HTMLTextAreaElement;return{value:t.value,start:t.selectionStart,end:t.selectionEnd,direction:t.selectionDirection,top:t.scrollTop,left:t.scrollLeft};})).toEqual(before);
 expect(await page.evaluate(()=>(window as any).readerParents.every((p:any)=>p.node.scrollTop===p.top))).toBe(true);
 await expect(page).toHaveURL(url);expect(state.writes).toEqual([]);expect(state.requests.every(request=>request.method==="GET")).toBe(true);expect(state.errors).toEqual([]);
 await info.attach("read-only-http",{body:JSON.stringify(state.requests),contentType:"application/json"});
 await page.screenshot({path:info.outputPath("manuscript-return-desktop.png")});
});

for(const [width,height,zoom] of [[320,568,2],[320,300,2],[390,844,1]] as const)test(`#663 initial mobile ${width}x${height} zoom${zoom} reaches the last instruction and escapes to the draft`,async({page},info)=>{
 await page.setViewportSize({width,height});const state=await setup(page);
 state.rows.tasks[0].body=Array.from({length:30},(_,i)=>`지시 ${i+1}: 공개 준비 조건을 확인하세요.`).join("\n\n");
 const input=detailDialog(page).getByRole("textbox",{name:"원고",exact:true});await input.fill(draft+"\n모바일 미저장");await input.focus();
 await page.evaluate(zoom=>document.documentElement.style.zoom=String(zoom),zoom);
 const entry=detailDialog(page).getByRole("button",{name:"관련 할 일",exact:true});await entry.click();
 await reader(page).getByRole("button",{name:"CT01 원고 검토",exact:true}).click();
 const last=reader(page).getByText("지시 30: 공개 준비 조건을 확인하세요.",{exact:true});await last.scrollIntoViewIfNeeded();
 await expect(last).toBeInViewport({ratio:0.99});
 const back=reader(page).getByRole("button",{name:"편집으로 돌아가기",exact:true});await expect(back).toBeInViewport({ratio:0.99});
 const bounds=await reader(page).boundingBox();expect(bounds!.x).toBeGreaterThanOrEqual(0);expect(bounds!.y).toBeGreaterThanOrEqual(0);expect(bounds!.y+bounds!.height).toBeLessThanOrEqual(height+1);
 await page.screenshot({path:info.outputPath(`reader-${width}-${height}-zoom${zoom}.png`)});
 await page.keyboard.press("Escape");await expect(reader(page)).toHaveCount(0);await expect(input).toBeFocused();await expect(input).toHaveValue(draft+"\n모바일 미저장");
 await expect(page.getByRole("alertdialog",{name:"변경을 버릴까요?"})).toHaveCount(0);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});

for(const status of [403,404,503])test(`#663 current task GET ${status} never exposes a retained body and only network failure can retry`,async({page})=>{
 const state=await setup(page);const release=state.failRead({kind:"tasks",id:id(2)},{status});
 await detailDialog(page).getByRole("button",{name:"관련 할 일",exact:true}).click();
 await reader(page).getByRole("button",{name:"CT01 원고 검토",exact:true}).click();
 if(status===503){await expect(reader(page)).toContainText("할 일 내용을 불러오지 못했습니다.");release();await reader(page).getByRole("button",{name:"내용 다시 시도",exact:true}).click();await expect(reader(page)).toContainText("원고10행 미승인 기능의 보류 이유를 적으세요.");}
 else{await expect(reader(page)).toContainText("삭제된 할 일 또는 접근할 수 없는 할 일입니다.");await expect(reader(page)).not.toContainText("원고10행 미승인 기능");await expect(reader(page).getByRole("button",{name:"내용 다시 시도",exact:true})).toHaveCount(0);}
 expect(state.writes).toEqual([]);await reader(page).getByRole("button",{name:"편집으로 돌아가기",exact:true}).click();
});
test("#663 selection, close and fresh reopening abort late reads and keep task content independent",async({page})=>{
 const state=await setup(page,{},[{...task(3),title:"두 번째 검토",body:"현재 두 번째 검토 지시",entity_ids:[entityKey(1)]}]);
 const first=state.holdRead({kind:"tasks",id:id(2)});
 await detailDialog(page).getByRole("button",{name:"관련 할 일",exact:true}).click();
 await reader(page).getByRole("button",{name:"CT01 원고 검토",exact:true}).click();await first.started;
 await reader(page).getByRole("button",{name:"두 번째 검토",exact:true}).click();await expect(reader(page)).toContainText("현재 두 번째 검토 지시");
 first.release();await first.finished;await expect(reader(page)).not.toContainText("원고10행 미승인 기능");
 const second=state.holdRead({kind:"tasks",id:id(2)});await reader(page).getByRole("button",{name:"CT01 원고 검토",exact:true}).click();await second.started;
 await page.keyboard.press("Escape");second.release();await second.finished;await expect(reader(page)).toHaveCount(0);
 state.rows.tasks[0].body="再조회한 최신 지시";
 await detailDialog(page).getByRole("button",{name:"관련 할 일",exact:true}).click();await expect(reader(page)).not.toContainText("현재 두 번째 검토 지시");
 await reader(page).getByRole("button",{name:"CT01 원고 검토",exact:true}).click();await expect(reader(page)).toContainText("再조회한 최신 지시");await expect(reader(page).getByRole("link")).toHaveCount(0);
 expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});

for(const failWrite of ["unknown", "hold"] as const)test(`#663 ${failWrite} saving and its confirmation do not allow a reader to bypass the write lock`,async({page})=>{
 const state=await setup(page,failWrite==="hold"?{hold:true}:{failWrite:"unknown"});
 const input=detailDialog(page).getByRole("textbox",{name:"원고",exact:true});await input.fill(draft+"\n저장 잠금 시험");
 await detailDialog(page).getByRole("button",{name:"저장",exact:true}).click();
 const entry=page.getByRole("button",{name:"관련 할 일",exact:true,includeHidden:true});await expect(entry).toBeDisabled();await expect(reader(page)).toHaveCount(0);
 await executionDialog(page).getByRole("button",{name:"수정하고 저장",exact:true}).click();
 if(failWrite==="hold"){await state.pending;await expect(entry).toBeDisabled();await expect(reader(page)).toHaveCount(0);state.release();await expect(detailDialog(page).getByRole("button",{name:"편집",exact:true})).toBeVisible();}
 else{await expect(executionDialog(page).getByRole("button",{name:"같은 내용 다시 시도",exact:true})).toBeEnabled();await expect(entry).toBeDisabled();await expect(reader(page)).toHaveCount(0);}
 expect(state.writes).toHaveLength(1);expect(state.errors).toEqual([]);
});
test("#663 live task read authority revocation hides open contents without discarding the manuscript",async({page})=>{
 const state=await setup(page);const input=detailDialog(page).getByRole("textbox",{name:"원고",exact:true});await input.fill(draft+"\n권한 회수 중 미저장");
 await detailDialog(page).getByRole("button",{name:"관련 할 일",exact:true}).click();await reader(page).getByRole("button",{name:"CT01 원고 검토",exact:true}).click();await expect(reader(page)).toContainText("원고10행 미승인 기능");
 await page.route(`**/api/workspaces/${fixtureWorkspaceId}`,route=>route.fulfill({json:{workspace:{id:fixtureWorkspaceId,name:"테스트 공간",deleted_at:null},membership_version:2,grants:[{target_kind:"settings",target_id:"*",access:"write"},{target_kind:"entity_type",target_id:fixtureType.id,access:"write"}],can_manage:true}}));
 const refreshed=page.waitForResponse(response=>response.request().method()==="GET"&&new URL(response.url()).pathname.endsWith(`/workspaces/${fixtureWorkspaceId}`));
 await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await refreshed;
 await expect(reader(page)).toHaveCount(0);await expect(detailDialog(page).getByRole("button",{name:"관련 할 일",exact:true})).toHaveCount(0);await expect(input).toHaveValue(draft+"\n권한 회수 중 미저장");expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});

test("#663 empty and paged task lists keep their own failure and retry state",async({page})=>{
 const state=await setup(page,{pageSize:5},Array.from({length:7},(_,i)=>({...task(i+3),title:`추가 검토 ${i+1}`,entity_ids:[entityKey(1)]})),s=>{s.rows.entities[0].tasks.items=s.rows.tasks.slice(0,5);});
 const fail=state.failRead({kind:"tasks",entityId:entityKey(1),page:1},{status:503});
 await detailDialog(page).getByRole("button",{name:"관련 할 일",exact:true}).click();await reader(page).getByRole("button",{name:"할 일 더 보기",exact:true}).click();await expect(reader(page)).toContainText("연결된 할 일을 불러오지 못했습니다.");
 await expect(reader(page).getByRole("button",{name:"CT01 원고 검토",exact:true})).toBeVisible();fail();await reader(page).getByRole("button",{name:"할 일 다시 시도",exact:true}).click();
 await expect(reader(page).getByRole("button",{name:"할 일 더 보기",exact:true})).toBeEnabled();await reader(page).getByRole("button",{name:"할 일 더 보기",exact:true}).click();await expect(reader(page).getByRole("button",{name:"추가 검토 7",exact:true})).toBeVisible();expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
test("#663 no related tasks is distinct from deleted or empty current task contents",async({page})=>{
 const state=await setup(page,{},[],s=>{s.rows.entities[0].tasks={count:0,items:[]};s.rows.tasks=[];});
 await detailDialog(page).getByRole("button",{name:"관련 할 일",exact:true}).click();await expect(reader(page)).toContainText("연결된 할 일이 없습니다.");await expect(reader(page).getByRole("button",{name:"할 일 더 보기",exact:true})).toHaveCount(0);await page.keyboard.press("Escape");expect(state.writes).toEqual([]);
});
for(const deleted of [false,true])test(`#663 selected current task ${deleted?"deleted":"empty body"} has an explicit state`,async({page})=>{
 const state=await setup(page);state.rows.tasks[0].deleted_at=deleted?"2026-11-02T00:00:00Z":null;state.rows.tasks[0].body=deleted?"삭제된 본문 노출 금지":"";
 await detailDialog(page).getByRole("button",{name:"관련 할 일",exact:true}).click();await reader(page).getByRole("button",{name:"CT01 원고 검토",exact:true}).click();await expect(reader(page)).toContainText(deleted?"삭제된 할 일입니다.":"본문이 없습니다.");await expect(reader(page)).not.toContainText("삭제된 본문 노출 금지");expect(state.writes).toEqual([]);
});

test("#663 keyboard reading retains a backward selection through desktop/mobile docking",async({page},info)=>{
 await page.setViewportSize({width:1280,height:720});const state=await setup(page);
 const input=detailDialog(page).getByRole("textbox",{name:"원고",exact:true});await input.fill(draft+"\n방향 있는 선택");await input.focus();await input.press("End");await input.press("Shift+Home");
 await input.evaluate(node=>new Promise<void>(resolve=>{let previous=node.scrollTop,stable=0;const frame=()=>{stable=node.scrollTop===previous?stable+1:0;previous=node.scrollTop;if(stable>=4)resolve();else requestAnimationFrame(frame);};requestAnimationFrame(frame);}));
 const same=await input.elementHandle(),selected=await input.evaluate(n=>{const t=n as HTMLTextAreaElement;return{start:t.selectionStart,end:t.selectionEnd,direction:t.selectionDirection,value:t.value,top:t.scrollTop};});expect(selected.direction).toBe("backward");
 const entry=detailDialog(page).getByRole("button",{name:"관련 할 일",exact:true});await entry.focus();await page.keyboard.press("Enter");await reader(page).getByRole("button",{name:"CT01 원고 검토",exact:true}).press("Enter");await expect(reader(page)).toContainText("원고10행 미승인 기능");
 await page.setViewportSize({width:390,height:844});await expect(reader(page).getByRole("button",{name:"편집으로 돌아가기",exact:true})).toBeVisible();await page.screenshot({path:info.outputPath("reader-docked-to-mobile.png")});
 await page.setViewportSize({width:1280,height:720});await page.keyboard.press("Escape");await expect(input).toBeFocused();expect(await same!.evaluate(n=>n.isConnected)).toBe(true);expect(await input.evaluate((node,original)=>node===original,same)).toBe(true);expect(await input.evaluate(n=>{const t=n as HTMLTextAreaElement;return{start:t.selectionStart,end:t.selectionEnd,direction:t.selectionDirection,value:t.value,top:t.scrollTop};})).toEqual(selected);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});

test("#663 returning from a read preserves the last edited choice control as well as text inputs",async({page})=>{
 const state=await setup(page);const choice=detailDialog(page).getByRole("combobox",{name:"분류",exact:true});await choice.focus();await choice.selectOption({label:"b"});await expect(choice).toBeFocused();
 await detailDialog(page).getByRole("button",{name:"관련 할 일",exact:true}).click();await reader(page).getByRole("button",{name:"CT01 원고 검토",exact:true}).click();await expect(reader(page)).toContainText("원고10행 미승인 기능");
 await reader(page).getByRole("button",{name:"편집으로 돌아가기",exact:true}).click();await expect(choice).toBeFocused();await expect(choice.locator("option:checked")).toHaveText("b");expect(state.writes).toEqual([]);
});

test("#663 a late read from a closed editor cannot appear after an explicit workspace change",async({page})=>{
 const next=id(981);const state=await setup(page,{},[],s=>{s.workspaces[next]={name:"다음 검토 공간",rows:{entities:[entity(8,{prop_1:"다음 공간 원문"})],tasks:[],records:[],tags:[]}};});
 const input=detailDialog(page).getByRole("textbox",{name:"원고",exact:true});await input.fill(draft+"\n공간 변경 전 초안");const held=state.holdRead({kind:"tasks",id:id(2),workspaceId:fixtureWorkspaceId});
 await detailDialog(page).getByRole("button",{name:"관련 할 일",exact:true}).click();await reader(page).getByRole("button",{name:"CT01 원고 검토",exact:true}).click();await held.started;
 await page.keyboard.press("Escape");await expect(input).toHaveValue(draft+"\n공간 변경 전 초안");
 await page.getByRole("button",{name:"공간 선택",exact:true}).click();await page.getByRole("menuitem",{name:"다음 검토 공간",exact:true}).click();
 await page.getByRole("alertdialog",{name:"변경을 버릴까요?",exact:true}).getByRole("button",{name:"변경 버리기",exact:true}).click();
 await expect(page).toHaveURL(new RegExp(`/w/${next}`));await expect(page.getByRole("heading",{name:"할 일 (0개)",exact:true})).toBeVisible();held.release();await held.finished;
 await expect(reader(page)).toHaveCount(0);await expect(page.getByText("원고10행 미승인 기능의 보류 이유를 적으세요.",{exact:true})).toHaveCount(0);expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});
