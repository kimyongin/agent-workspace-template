import { fillChangeMemo } from "./ui-actions.ts";
import { beginTabAction, openDetailEditor, saveOnce, openListDetail } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";
import { savePrinciple } from "./principle-support.ts";

// Account-wide current requires an exclusive integration account (parent owns allocation).
test("현재 웹 메모 확인→MCP 같은 문서 갱신→삭제 후 현재 없음",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const first=await savePrinciple(mcp,{title:unique("첫 판단 기준"),body:"첫 원문"});
    await page.goto(`/principles/${first.id}`);await openDetailEditor(page);
    const form=page.getByRole("dialog",{name:"현재 원칙 편집",exact:true});
    await expect(form.getByLabel("태그")).toHaveCount(0);await expect(form.getByLabel("적용 조건")).toHaveCount(0);
    const title=unique("새 판단 기준");await form.getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill(title);await form.getByLabel("본문").fill("새 판단 원문");
    expect((await mcp.call("get_current_principle",{})).current.body).toBe("첫 원문");
    await fillChangeMemo(page,form,"사용자가 확인한 근거");await saveOnce(page,form);
    await expect(page.locator("dialog.modal:not(.modal-confirm)[open]").getByRole("heading",{name:title,exact:true})).toBeVisible();
    const {current}=await mcp.call("get_current_principle",{});expect(current.id).toBe(first.id);expect(current.body).toBe("새 판단 원문");
    expect((await mcp.call("get_principle",{id:first.id})).body).toBe("새 판단 원문");
    await page.goto(`/principles/${current.id}?edit=1`);await page.getByRole("button",{name:"삭제",exact:true}).click();
    const confirm=page.locator("dialog.modal-action[open]");await expect(confirm).toContainText("과거 원칙을 자동 승격하지 않습니다");
    await saveOnce(page,confirm,"삭제 확인");await expect(page).toHaveURL(/principles(?:[?#]|$)/);
    expect((await mcp.call("get_current_principle",{})).current).toBeNull();
  }finally{await mcp.close();}
});

test("내용 폼 취소는 초안·초점을 보호한다",async({page})=>{
  await devLogin(page);
  for(const [path,action] of [["/tasks","할 일 추가"],["/records","기록 작성"]]){
    await page.goto(path);const trigger=page.getByRole("button",{name:path==="/tasks"?"할 일 등록":"기록 작성",exact:true});await beginTabAction(page,action);
    const dialog=page.getByRole("dialog",{name:action,exact:true});await dialog.getByRole("textbox",{name:path==="/records"?/^본문(?: \(필수\))?$/:/^제목(?: \(필수\))?$/}).fill("보존할 초안");await dialog.getByRole("button", {name:"닫기",exact:true}).click();
    const discard=page.getByRole("dialog",{name:"변경을 버릴까요?"});await discard.getByRole("button",{name:"취소",exact:true}).click();
    await expect(dialog.getByRole("textbox",{name:path==="/records"?/^본문(?: \(필수\))?$/:/^제목(?: \(필수\))?$/})).toHaveValue("보존할 초안");await dialog.getByRole("button", {name:"닫기",exact:true}).click();
    await discard.getByRole("button",{name:"변경 버리기"}).click();await expect(dialog).not.toBeVisible();await expect(trigger).toBeFocused();
  }
});

test("현재 원칙이 바뀌어도 과거 근거는 기록 검색에서 원문을 읽는다",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page)),marker=unique("보존 근거");
  try{
    await savePrinciple(mcp,{title:marker,body:"기록으로 보존할 최초 근거",change_note:`${marker} 기록으로 보존할 최초 근거`});
    await savePrinciple(mcp,{title:unique("현재 다른 기준"),body:"현재 본문"});
    await page.goto("/principles");await page.getByRole("link",{name:"과거 근거는 통합 기록에서 보기"}).click();
    await page.getByLabel("검색어",{exact:true}).fill(marker);
    const item=page.locator(".records .list .item-title").filter({hasText:marker}).first();await expect(item).toBeVisible();await openListDetail(page,await item.innerText());
    await expect(page.locator("dialog.modal:not(.modal-confirm)[open]")).toContainText("기록으로 보존할 최초 근거");
  }finally{await mcp.close();}
});

test("현재 문서 편집 충돌은 초안 유지·폐기 뒤 최신 원문 재조회",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const old=await savePrinciple(mcp,{title:unique("충돌 과거본"),body:"원래 요약"});
    await page.goto(`/principles/${old.id}`);await openDetailEditor(page);
    const form=page.getByRole("dialog",{name:"현재 원칙 편집"});await form.getByLabel("본문").fill("보호할 초안");await fillChangeMemo(page,form,"정정 이유");
    await mcp.call("update_principle",{id:old.id,expected_version:old.version,body:"최신 본문",change_note:"동시 편집"});
    await saveOnce(page,form);const action=page.locator("dialog.modal-action[open]");await expect(action.getByRole("alert")).toContainText("다른 변경");await action.getByRole("button",{name:"취소",exact:true}).click();
    await expect(form.getByLabel("본문")).toHaveValue("보호할 초안");await form.getByRole("button", {name:"취소",exact:true}).click();
    await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기",exact:true}).click();await expect(page.locator("dialog.modal:not(.modal-confirm)[open]").getByRole("heading",{name:old.title,exact:true})).toBeVisible();await openDetailEditor(page);await expect(page.getByLabel("본문")).toHaveValue("최신 본문");
  }finally{await mcp.close();}
});

test("본문에 남긴 원칙 근거는 현재 변경·삭제 뒤 기록 설명을 고쳐도 보존된다",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const p=await savePrinciple(mcp,{title:unique("적용 기준"),body:"당시 판단 본문"});
    const r=await mcp.call("create_record",{body:`참고한 원칙 「${p.title}」: 당시 판단 본문`});
    await savePrinciple(mcp,{title:unique("새 기준"),body:"새 본문"});
    const {current}=await mcp.call("get_current_principle",{});await mcp.call("delete_principle",{id:current.id,expected_version:current.version});
    await page.goto(`/records/${r.id}`);await openDetailEditor(page);
    const edit=page.getByRole("dialog",{name:"기록 편집",exact:true});
    await expect(edit).toContainText("당시 판단 본문");await expect(edit.getByText("적용한 원칙",{exact:true})).toHaveCount(0);
    await edit.getByLabel("본문").fill(r.body+"\n원칙 삭제 뒤 설명 정정");await saveOnce(page,edit);await expect(edit).not.toBeVisible();
    const corrected=await mcp.call("get_record",{id:r.id});expect(corrected.body).toBe(r.body+"\n원칙 삭제 뒤 설명 정정");expect(corrected.applied_principle_snapshots).toEqual([]);expect(corrected).not.toHaveProperty("applied_principle_ids");
  }finally{await mcp.close();}
});
