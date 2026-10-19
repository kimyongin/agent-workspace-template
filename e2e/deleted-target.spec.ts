import { detailDialog } from "./ui-actions.ts";
import { createFixtureEntity } from "./entity-schema-support.ts";
import { openDetailEditor } from "./ui-actions.ts";
import { expect } from "@playwright/test";
import { test, devLogin, mcpClient, mcpTokenViaConsent, unique , ownedWorkspace, workspacePath} from "./support.ts";


for(const kind of ["entity","task"] as const)test(`삭제된 ${kind}: 이전 변경 기록은 연결 행에서 당시 metadata 보존`,async({page})=>{
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const mcp=await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  let target:{id:string;version:number}|undefined,deleted=false;
  try{
    const title=unique(`삭제 대상 ${kind}`);
    target=(kind==="entity"?await createFixtureEntity(mcp,workspace, {prop_1:title,prop_2:10,prop_4:"a"}):await mcp.call("create_task",{kind:"once",title,body:"삭제 뒤 역사 확인"})) as {id:string;version:number};
    const events=await mcp.call("list_records",{record_kind:"change",limit:50});
    const historical=events.items.find((r:{change?:{target_kind:string;target_id:string;action:string}})=>r.change?.target_kind===kind&&r.change.target_id===target!.id&&r.change.action!=="delete");
    expect(historical).toBeTruthy();expect(historical.change.path).toBeTruthy();
    const metadata=structuredClone(historical.change);
    await mcp.call(`delete_${kind}`,{id:target!.id,expected_version:target!.version,change_note:"삭제 문맥 검증"});deleted=true;
    await page.goto(workspacePath(workspace.id, `/records/${historical.id}`));
    const detail=detailDialog(page);
    await expect(detail).toContainText(kind === "task" ? "삭제됨" : "조회 불가");
    await detail.getByRole("button",{name:title,exact:true}).click();
    if (kind === "task") {
      // A retained task parent is still readable with tasks READ after soft deletion.
      await expect(detail).toContainText("삭제 뒤 역사 확인");
      await expect(detail.getByLabel(`${title} 상세`, { exact: true })).toBeVisible();
    } else {
      await expect(detail).toContainText("현재 항목을 조회할 수 없습니다.");
      await expect(detail.getByLabel(`${title} 상세`, { exact: true })).toHaveCount(0);
    }
    await expect(detail).toContainText(title);await expect(detail).toContainText("에이전트");
    expect((await mcp.call("get_record",{id:historical.id})).change).toEqual(metadata);
  }finally{
    try{if(target&&!deleted)await mcp.call(`delete_${kind}`,{id:target.id,expected_version:target.version});}
    finally{await mcp.close();}
  }
});
