import { detailDialog, executionDialog, openDialogs } from "./ui-actions.ts";
import { createFixtureEntity, scalarFixtureType, fixtureEntityList } from "./entity-schema-support.ts";
import { expect } from "@playwright/test";
import { test, devLogin, mcpClient, mcpTokenViaConsent, unique , ownedWorkspace, workspacePath} from "./support.ts";
import { beginTabAction, openDetailEditor, saveOnce } from "./ui-actions.ts";

test("상세 보기의 양방향 연결·해제와 할 일 결과의 단일 소속이 웹/MCP에서 일치한다",async({page})=>{
  await devLogin(page);
  const workspace = await ownedWorkspace(page);const mcp=await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  const label=unique("관계"),entity=await createFixtureEntity(mcp, workspace, {prop_1:label+" 고객"}),task=await mcp.call("create_task",{kind:"once",title:label+" 상담"});
  let recordId="";
  const dialog=()=>detailDialog(page);
  const confirmRelation = async (actionLabel: "연결" | "해제") => {
    const action = executionDialog(page);
    await expect(dialog()).toHaveCount(1);
    await expect(dialog()).toBeVisible();
    await expect(action).toBeVisible();
    await expect(openDialogs(page)).toHaveCount(2);
    await action.getByRole("button", { name: `${actionLabel}하고 저장`, exact: true }).click();
    await expect(action).toHaveCount(0);
    await expect(dialog()).toBeVisible();
  };
  try {
    await page.goto(workspacePath(workspace.id, `/tasks/${task.id}`));await dialog().getByRole("button",{name:"자료 연결",exact:true}).click();await dialog().getByRole("searchbox",{name:"자료 제목 검색"}).fill(label);
    await dialog().getByRole("button",{name:entity.title+" 연결",exact:true}).click();await confirmRelation("연결");
    await expect(dialog().getByRole("button",{name:entity.title,exact:true})).toBeVisible();await dialog().getByRole("button",{name:entity.title,exact:true}).click();await expect(dialog().getByRole("button",{name:entity.title+" 해제",exact:true})).toBeVisible();expect((await mcp.call("get_task",{id:task.id})).entity_ids).toEqual([entity.id]);
    await openDetailEditor(page);await expect(dialog().getByRole("searchbox",{name:"자료 제목 검색"})).toHaveCount(0);await dialog().getByLabel("본문",{exact:false}).fill("상담 업무 내용");await saveOnce(page,dialog());
    await expect(dialog().getByRole("button", { name: "기록 작성", exact: true })).toHaveCount(0);
    await dialog().getByRole("button",{name:entity.title+" 해제"}).click();await confirmRelation("해제");
    expect((await mcp.call("get_task", {id:task.id})).entity_ids).toEqual([]);
    await page.goto(workspacePath(workspace.id, `/entities/${encodeURIComponent(entity.id)}`));await dialog().getByRole("button",{name:"할 일 연결",exact:true}).click();await dialog().getByRole("searchbox",{name:"할 일 제목 검색"}).fill(label);
    await dialog().getByRole("button",{name:task.title+" 연결",exact:true}).click();await confirmRelation("연결");await expect(dialog().getByRole("button",{name:task.title,exact:true})).toBeVisible();await dialog().getByRole("button",{name:task.title,exact:true}).click();await expect(dialog().getByRole("button",{name:task.title+" 해제",exact:true})).toBeVisible();
    expect((await mcp.call("get_task",{id:task.id})).entity_ids).toEqual([entity.id]);await dialog().getByRole("button",{name:task.title+" 해제"}).click();await confirmRelation("해제");await expect(dialog().getByRole("button",{name:task.title+" 해제"})).toHaveCount(0);expect((await mcp.call("get_task",{id:task.id})).entity_ids).toEqual([]);
    const current = await mcp.call("get_task", { id: task.id });
    const completed = await mcp.call("complete_task", { id: task.id, expected_version: current.version, body: label+" 수행 결과" });
    recordId = completed.record.id;
    expect(completed.record).toMatchObject({ record_kind: "result", task_id: task.id, entity_id: null });
    expect(completed.record).not.toHaveProperty("entity_ids");
    expect(completed.task.status).toBe("done");
  } finally {
    if(recordId){const row=await mcp.call("get_record",{id:recordId});await mcp.call("delete_record",{id:recordId,expected_version:row.version});}
    const row=await mcp.call("get_task",{id:task.id});await mcp.call("delete_task",{id:task.id,expected_version:row.version});await mcp.call("delete_entity",{id:entity.id,expected_version:entity.version});await mcp.close();
  }
});
