import { expect, test } from "@playwright/test";
import { beginTabAction, openDetailEditor } from "./ui-actions.ts";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";

test("엔터티 기본 메모 확인은 무저장, 보충한 메모와 업무를 함께 저장하고 MCP로 확인", async ({page}) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const name = unique("메모 검토 고객");
    await page.goto("/entities");
    await beginTabAction(page,"엔터티 추가");
    const form = page.getByRole("dialog",{name:"엔터티 추가",exact:true});
    await form.getByLabel("속성 1").fill(name);
    await form.getByLabel("속성 2").fill("10");
    await form.getByRole("button",{name:"기록 메모 확인",exact:true}).click();
    await expect(form.getByLabel("기록 제목")).toHaveValue(`${name} 등록`);
    await expect(form.getByLabel("기록 본문")).toHaveValue(/속성 2: 10/);
    expect((await mcp.call("list_entities",{keyword:name})).items).toHaveLength(0);
    await form.getByLabel("기록 제목").fill("첫 상담에서 확인한 고객 정보");
    await form.getByLabel("기록 요약").fill("고객이 직접 확인한 자료로 등록");
    await form.getByLabel("기록 본문").fill("속성 2는 고객이 확인한 10. 필요할 때 전체 설명을 함께 작성한다.");
    await form.getByRole("button",{name:"확인하고 저장",exact:true}).click();
    await expect(page).toHaveURL(/\/entities\/[0-9a-f-]{36}/);
    const id = new URL(page.url()).pathname.split("/").at(-1)!;
    const entity = await mcp.call("get_entity",{id});
    expect(entity.prop2).toBe(10);
    const records = await mcp.call("list_records",{record_kind:"change",limit:100});
    const record = records.items.find((r:{change:{target_id:string}})=>r.change?.target_id===id);
    expect(record.title).toBe("첫 상담에서 확인한 고객 정보");
    expect(record.body).toContain("고객이 확인한 10");
    expect(record.change.action).toBe("create");
    await openDetailEditor(page);
    const edit = page.getByRole("dialog",{name:"엔터티 편집",exact:true});
    await edit.getByLabel("속성 2").fill("20");
    await edit.getByRole("button",{name:"기록 메모 확인",exact:true}).click();
    await expect(edit.getByLabel("기록 본문")).toHaveValue("속성 2: 10 → 20");
    await edit.getByLabel("기록 본문").fill("수정 이유를 보충한 초안");
    await edit.getByLabel("속성 2").fill("30");
    await expect(edit.getByRole("button",{name:"기록 메모 확인",exact:true})).toBeVisible();
    await expect(edit.getByLabel("기록 본문")).toHaveCount(0);
    await edit.getByRole("button",{name:"기록 메모 확인",exact:true}).click();
    await expect(edit.getByLabel("기록 본문")).toHaveValue("속성 2: 10 → 30");
    expect((await mcp.call("get_entity",{id})).prop2).toBe(10);
  } finally { await mcp.close(); }
});
