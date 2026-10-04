import { beginTabAction } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";
import { savePrinciple } from "./principle-support.ts";

// Account-wide current requires an exclusive integration account (parent owns allocation).
test("현재 웹 저장→MCP 과거 원문 보존·정정→최신 삭제 승격",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const first=await savePrinciple(mcp,{title:unique("첫 판단 기준"),summary:"기존 근거",body:"보존할 원문"});
    await page.goto(`/principles/${first.id}`);await page.getByRole("button",{name:"편집",exact:true}).click();
    const form=page.getByRole("dialog",{name:"현재 원칙 편집",exact:true});
    await expect(form.getByLabel("태그")).toHaveCount(0);await expect(form.getByLabel("적용 조건")).toHaveCount(0);
    const title=unique("새 판단 기준");await form.getByLabel("제목").fill(title);await form.getByLabel("본문").fill("새 판단 원문");
    await form.getByRole("button",{name:"저장",exact:true}).click();await expect(form.getByText("편집 메모를 입력하세요.",{exact:true})).toBeVisible();
    await form.getByLabel("편집 메모").fill("새 환경 반영");await form.getByRole("button",{name:"저장",exact:true}).click();
    await expect(page.getByRole("heading",{name:title,level:1})).toBeVisible();
    const {current}=await mcp.call("get_current_principle",{});expect(current.id).not.toBe(first.id);expect(current.change_note).toBe("새 환경 반영");
    expect((await mcp.call("get_principle",{id:first.id})).body).toBe("보존할 원문");
    await page.goto(`/principles/${first.id}`);await page.getByRole("button",{name:"정정",exact:true}).click();
    const correct=page.getByRole("dialog",{name:"과거 원칙 정정",exact:true});
    await correct.getByLabel("본문").fill("오타만 정정한 원문");await correct.getByLabel("편집 메모").fill("오타 정정");
    await correct.getByRole("button",{name:"저장",exact:true}).click();await expect(correct).not.toBeVisible();
    expect((await mcp.call("get_current_principle",{})).current.id).toBe(current.id);
    await page.goto(`/principles/${current.id}`);await page.getByRole("button",{name:"삭제",exact:true}).click();
    const confirm=page.getByRole("dialog",{name:"원칙을 삭제할까요?"});await expect(confirm).toContainText(first.title);await expect(confirm).toContainText("오타만 정정한 원문");
    await confirm.getByRole("button",{name:"삭제",exact:true}).click();
    await expect(page).toHaveURL(/\/principles(?:\?|$)/);
    expect((await mcp.call("get_current_principle",{})).current.id).toBe(first.id);
  }finally{await mcp.close();}
});

test("내용 폼 취소는 초안·초점을 보호한다",async({page})=>{
  await devLogin(page);
  for(const [path,action] of [["/tasks","할 일 추가"],["/records","기록 작성"]]){
    await page.goto(path);const trigger=page.getByRole("button",{name:"활동 작업 메뉴",exact:true});await beginTabAction(page,action);
    const dialog=page.getByRole("dialog",{name:action,exact:true});await dialog.getByLabel("제목").fill("보존할 초안");await dialog.getByRole("button",{name:"취소",exact:true}).click();
    const discard=page.getByRole("dialog",{name:"변경을 버릴까요?"});await discard.getByRole("button",{name:"취소",exact:true}).click();
    await expect(dialog.getByLabel("제목")).toHaveValue("보존할 초안");await dialog.getByRole("button",{name:"취소",exact:true}).click();
    await discard.getByRole("button",{name:"변경 버리기"}).click();await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
  }
});

test("과거 원칙 페이지·검색·상세 왕복·새로고침은 목록 초점을 복원한다",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));const marker=unique("과거 페이지"),titles:string[]=[];
  try{
    for(let i=0;i<22;i++){const title=`${marker} ${i}`;titles.push(title);await savePrinciple(mcp,{title,summary:"페이지 복원 검증"});}
    await page.goto(`/principles?q=${encodeURIComponent(marker)}&mode=keyword`);
    const oldest=page.getByRole("link",{name:titles[0],exact:true});await expect(oldest).toHaveCount(0);
    await page.getByRole("button",{name:"더 보기",exact:true}).click();await expect(oldest).toBeVisible();
    await oldest.click();
    for(let i=0;i<21;i++)await savePrinciple(mcp,{title:`${marker} 동시 추가 ${i}`,summary:"상세 왕복 중 새 저장본"});
    await page.getByRole("link",{name:"← 원칙 목록",exact:true}).click();
    expect(new URL(page.url()).searchParams.get("q")).toBe(marker);await expect.poll(()=>new URL(page.url()).searchParams.get("pages")).toBe("3");
    expect(new URL(page.url()).searchParams.has("scroll")).toBe(true);await expect(page.locator(".list .item-title")).toHaveCount(42);
    await expect(oldest).toBeFocused();await page.reload();await expect(oldest).toBeFocused();await expect(oldest).toBeInViewport();
  }finally{await mcp.close();}
});

test("과거 정정 충돌은 초안 유지·폐기 뒤 최신 원문 재조회",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const old=await savePrinciple(mcp,{title:unique("충돌 과거본"),summary:"원래 요약"});
    await savePrinciple(mcp,{title:unique("현재본"),summary:"현재 요약"});
    await page.goto(`/principles/${old.id}`);await page.getByRole("button",{name:"정정",exact:true}).click();
    const form=page.getByRole("dialog",{name:"과거 원칙 정정"});await form.getByLabel("본문").fill("보호할 초안");await form.getByLabel("편집 메모").fill("정정 이유");
    await mcp.call("correct_principle",{id:old.id,expected_version:old.version,summary:"최신 요약",change_note:"동시 정정"});
    await form.getByRole("button",{name:"저장",exact:true}).click();await expect(form.getByRole("alert")).toContainText("다른 변경");
    await expect(form.getByLabel("본문")).toHaveValue("보호할 초안");await form.getByRole("button",{name:"취소",exact:true}).click();
    await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기",exact:true}).click();await expect(page.getByText("최신 요약",{exact:true})).toBeVisible();
  }finally{await mcp.close();}
});

test("기록의 당시 원칙 snapshot은 현재 변경·과거본 삭제 뒤에도 보존된다",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const p=await savePrinciple(mcp,{title:unique("적용 기준"),summary:"당시 요약",body:"당시 판단 본문"});
    await page.goto("/records");await beginTabAction(page,"기록 작성");
    const form=page.getByRole("dialog",{name:"기록 작성"});await form.getByLabel("제목").fill(unique("적용 결과"));await form.getByLabel("요약").fill("판단 결과");
    await form.getByRole("button",{name:p.title,exact:true}).click();await form.getByRole("button",{name:"저장",exact:true}).click();
    await expect(form).not.toBeVisible();const id=new URL(page.url()).pathname.split("/").at(-1)!;
    expect((await mcp.call("get_record",{id})).applied_principle_snapshots[0].body).toBe("당시 판단 본문");
    await savePrinciple(mcp,{title:unique("새 기준"),summary:"새 요약",body:"새 본문"});
    await mcp.call("delete_principle",{id:p.id,expected_version:p.version});await page.reload();
    await expect(page.getByText("당시 판단 본문",{exact:true})).toBeVisible();expect((await mcp.call("get_record",{id})).applied_principle_snapshots[0].body).toBe("당시 판단 본문");
    await page.getByRole("button",{name:"편집",exact:true}).click();const edit=page.getByRole("dialog",{name:"기록 편집",exact:true});
    await edit.getByLabel("요약").fill("원칙 삭제 뒤 설명 정정");await edit.getByLabel("편집 메모").fill("판단 본문을 유지한 설명 정정");await edit.getByRole("button",{name:"저장",exact:true}).click();await expect(edit).not.toBeVisible();
    const corrected=await mcp.call("get_record",{id});expect(corrected.applied_principle_ids).toEqual([]);expect(corrected.applied_principle_snapshots[0].body).toBe("당시 판단 본문");await expect(page.getByText("당시 판단 본문",{exact:true})).toBeVisible();
  }finally{await mcp.close();}
});
