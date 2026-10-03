import {expect,test} from "@playwright/test";
import {devLogin,mcpClient,mcpTokenViaConsent,unique} from "./support.ts";

test("더 보기 응답이 늦어도 새 태그 필터 목록에 섞이지 않는다",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  let release=()=>{};
  try{
    const tag=await mcp.call("create_tag",{name:unique("동시 필터").slice(0,30)});
    for(const [kind,path] of [["task","tasks"],["record","records"]]){
      const title=unique("태그 결과");await mcp.call(`create_${kind}`,{...(kind==="task"?{kind:"once"}:{}),title,summary:"분류",tag_ids:[tag.id]});
      for(let i=0;i<21;i++)await mcp.call(`create_${kind}`,{...(kind==="task"?{kind:"once"}:{}),title:unique("다른 항목"),summary:"필터 밖"});
      await page.goto(`/${path}`);await expect(page.getByRole("button",{name:"더 보기",exact:true})).toBeVisible();
      let arrived!:()=>void,finished!:()=>void;
      const waiting=new Promise<void>(r=>{arrived=r;}),done=new Promise<void>(r=>{finished=r;}),hold=new Promise<void>(r=>{release=r;});
      await page.route(`**/api/${path}?**`,async route=>{
        if(!new URL(route.request().url()).searchParams.has("cursor")){await route.continue();return;}
        const response=await route.fetch();arrived();await hold;await route.fulfill({response});finished();
      });
      await page.getByRole("button",{name:"더 보기",exact:true}).click();await waiting;
      await page.getByLabel("태그 필터").selectOption(tag.id);await expect(page.getByRole("link",{name:title,exact:true})).toBeVisible();
      const delivered=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith(`/api/${path}`)&&new URL(r.url()).searchParams.has("cursor"));
      release();await done;await (await delivered).finished();
      await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
      await expect(page.locator(".list .item-title")).toHaveCount(1);await page.unroute(`**/api/${path}?**`);
    }
  }finally{release();await mcp.close();}
});

test("웹 기록·원칙 태그 선택·정정→MCP 필터→태그 삭제 후 원문 보존",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const tag=await mcp.call("create_tag",{name:unique("지식 태그").slice(0,30)});
    const saved:{path:string;id:string;kind:string}[]=[];
    for(const [path,action,createTitle,kind] of [["/records","기록 작성","기록 작성","record"],["/principles","원칙 추가","원칙 추가","principle"]]){
      await page.goto(path);await page.getByRole("button",{name:action,exact:true}).click();
      const form=page.getByRole("dialog",{name:createTitle,exact:true}),title=unique("분류된 지식");
      await form.getByLabel("제목").fill(title);await form.getByLabel("요약").fill("태그 분류");await form.getByLabel("본문").fill("원문 보존");
      await form.getByRole("button",{name:tag.name,exact:true}).click();await form.getByRole("button",{name:"저장",exact:true}).click();
      await expect(page.getByRole("heading",{name:title,exact:true})).toBeVisible();const id=new URL(page.url()).pathname.split("/").at(-1)!;
      saved.push({path,id,kind});
      expect((await mcp.call(`get_${kind}`,{id})).tag_ids).toEqual([tag.id]);
      await page.getByRole("button",{name:"편집",exact:true}).click();const edit=page.getByRole("dialog",{name:kind==="record"?"기록 편집":"원칙 편집"});
      await edit.getByRole("button",{name:tag.name,exact:true}).click();await edit.getByRole("button",{name:"저장",exact:true}).click();await expect(edit).not.toBeVisible();
      expect((await mcp.call(`get_${kind}`,{id})).tag_ids).toEqual([]);await mcp.call(`update_${kind}`,{id,expected_version:2,tag_ids:[tag.id]});
      const filtered=await mcp.call(kind==="record"?"list_records":"list_principles",{tag_id:tag.id});expect(filtered.items.map((x:{id:string})=>x.id)).toEqual([id]);
      await page.goto(`${path}?tag_id=${tag.id}`);await expect(page.getByRole("link",{name:title,exact:true})).toBeVisible();
      await page.getByRole("link",{name:title,exact:true}).click();
      await page.getByRole("button",{name:"편집",exact:true}).click();
      const revisit=page.getByRole("dialog",{name:kind==="record"?"기록 편집":"원칙 편집"});
      await revisit.getByLabel("요약").fill("수정 후 필터 보존");await revisit.getByRole("button",{name:"저장",exact:true}).click();
      await expect(revisit).not.toBeVisible();await page.getByRole("link",{name:kind==="record"?"← 기록 목록":"← 원칙 목록",exact:true}).click();
      await expect(page.getByLabel("태그 필터")).toHaveValue(tag.id);await expect(page.locator(".list .item-title")).toHaveCount(1);
    }
    await mcp.call("delete_tag",{id:tag.id,expected_version:1});
    for(const s of saved){await page.goto(`${s.path}/${s.id}`);await expect(page.getByText("원문 보존",{exact:true})).toBeVisible();expect((await mcp.call(`get_${s.kind}`,{id:s.id})).tag_ids).toEqual([]);}
  }finally{await mcp.close();}
});
test("웹 태그 생성→MCP 중복·이름 변경→웹 삭제",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    await page.goto("/tags");await page.getByRole("button",{name:"태그 추가"}).click();
    const title=unique("태그").slice(0,30),form=page.getByRole("dialog",{name:"태그 추가"});
    await form.getByLabel("태그 이름").fill(title);await form.getByRole("button",{name:"저장"}).click();
    await expect(page.getByRole("button",{name:`${title} 이름 변경`,exact:true})).toBeVisible();
    const list=await mcp.call("list_tags",{limit:100});const tag=list.items.find((t:{name:string})=>t.name===title);
    const renamed=unique("정정").slice(0,30);await mcp.call("rename_tag",{id:tag.id,expected_version:1,name:renamed});
    await page.reload();await page.getByRole("button",{name:`${renamed} 삭제`,exact:true}).click();
    await page.getByRole("dialog",{name:"태그를 삭제할까요?"}).getByRole("button",{name:"삭제",exact:true}).click();
    await expect(page.getByRole("button",{name:`${renamed} 삭제`,exact:true})).toHaveCount(0);
    await expect.poll(()=>page.evaluate(()=>document.activeElement?.id)).toMatch(/^(tag-|tags-title)/);
  }finally{await mcp.close();}
});

test("웹 할 일 태그 선택→MCP 필터·정정→태그 삭제 후 본문 유지",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const tag=await mcp.call("create_tag",{name:unique("업무 태그").slice(0,30)});
    await page.goto("/tasks");await page.getByRole("button",{name:"할 일 추가",exact:true}).click();
    const form=page.getByRole("dialog",{name:"할 일 추가"});await form.getByLabel("제목").fill(unique("태그 업무"));await form.getByLabel("요약").fill("분류 검증");await form.getByLabel("본문").fill("삭제 후에도 보존");
    await form.getByRole("button",{name:tag.name,exact:true}).click();await form.getByRole("button",{name:"추가",exact:true}).click();
    await expect(form).not.toBeVisible();const id=new URL(page.url()).pathname.split("/").at(-1)!;expect((await mcp.call("get_task",{id})).tag_ids).toEqual([tag.id]);
    await page.getByRole("button",{name:"편집",exact:true}).click();const edit=page.getByRole("dialog",{name:"할 일 편집"});
    await edit.getByRole("button",{name:tag.name,exact:true}).click();await edit.getByRole("button",{name:"저장",exact:true}).click();
    await expect(edit).not.toBeVisible();expect((await mcp.call("get_task",{id})).tag_ids).toEqual([]);
    await mcp.call("update_task",{id,expected_version:2,tag_ids:[tag.id]});
    const items=await mcp.call("list_tasks",{tag_id:tag.id});expect(items.items.map((t:{id:string})=>t.id)).toEqual([id]);
    await page.goto(`/tasks?tag_id=${tag.id}`);await expect(page.getByLabel("태그 필터")).toHaveValue(tag.id);
    await mcp.call("delete_tag",{id:tag.id,expected_version:1});await page.goto(`/tasks/${id}`);
    await expect(page.getByText("삭제 후에도 보존",{exact:true})).toBeVisible();expect((await mcp.call("get_task",{id})).tag_ids).toEqual([]);
  }finally{await mcp.close();}
});

test("추가 페이지 태그의 편집 취소·충돌·저장 뒤 목록과 초점 유지",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const tags=[];
    for(let i=0;i<21;i++)tags.push(await mcp.call("create_tag",{name:unique(`보존 ${i}`).slice(0,30)}));
    const oldest=tags[0];await page.goto("/tags");
    const trigger=page.getByRole("button",{name:`${oldest.name} 이름 변경`,exact:true});
    while(await trigger.count()===0){await page.getByRole("button",{name:"더 보기",exact:true}).click();await expect(page.getByRole("button",{name:"불러오는 중…"})).toHaveCount(0);}
    await trigger.click();let form=page.getByRole("dialog",{name:"태그 이름 변경"});
    await form.getByRole("button",{name:"취소",exact:true}).click();await expect(trigger).toBeFocused();
    await trigger.click();const draft=unique("초안").slice(0,30);await form.getByLabel("태그 이름").fill(draft);
    const server=unique("서버").slice(0,30);await mcp.call("rename_tag",{id:oldest.id,expected_version:1,name:server});
    await form.getByRole("button",{name:"저장",exact:true}).click();await expect(form.getByText(/다른 변경이 저장/)).toBeVisible();
    await expect(form.getByLabel("태그 이름")).toHaveValue(draft);await form.getByRole("button",{name:"취소",exact:true}).click();
    await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();
    const fresh=page.getByRole("button",{name:`${server} 이름 변경`,exact:true});await expect(fresh).toBeFocused();
    await expect(trigger).toHaveCount(0);await fresh.click();form=page.getByRole("dialog",{name:"태그 이름 변경"});
    await form.getByLabel("태그 이름").fill(draft);await form.getByRole("button",{name:"저장",exact:true}).click();
    await expect(page.getByRole("button",{name:`${draft} 이름 변경`,exact:true})).toBeFocused();
    await expect(page.getByRole("button",{name:`${tags[1].name} 이름 변경`,exact:true})).toBeVisible();
  }finally{await mcp.close();}
});
