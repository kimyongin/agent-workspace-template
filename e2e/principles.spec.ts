import { expect, test } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";

test("웹 원칙 작성→MCP 원문 읽기, MCP 작성→웹 확인", async ({ page }) => {
  await devLogin(page);
  await page.getByRole("link", { name: "원칙", exact: true }).click();
  const title = unique("긴 책 읽기");
  await page.getByRole("button", { name: "원칙 추가" }).click();
  const form = page.getByRole("dialog", { name: "원칙 추가" });
  await form.getByLabel("제목").fill(title);
  await form.getByLabel("요약").fill("300쪽 넘는 책은 휴가에 읽는다.");
  await form.getByLabel("본문").fill("# 독서 근거\n시간을 확보한다.");
  await form.getByLabel("적용 조건").fill("300쪽 초과");
  await form.getByRole("button", { name: "취소", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "변경을 버릴까요?" });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(form.getByLabel("제목")).toHaveValue(title);
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const p = await mcp.call("get_principle", { id });
    expect(p.applies_when).toBe("300쪽 초과");
    expect(p.body).toContain("시간을 확보한다.");
    const second = await mcp.call("create_principle", { title: unique("두 번째 원칙"), summary: "예산 승인 후 구매", body: "승인 전에는 보류" });
    await page.goto(`/principles/${second.id}`);
    await expect(page.getByText("승인 전에는 보류")).toBeVisible();
  } finally { await mcp.close(); }
});

test("모든 내용 폼의 취소는 초안을 보호하고 닫은 뒤 초점이 복귀한다", async ({ page }) => {
  await devLogin(page);
  for (const [path, action] of [["/tasks", "할 일 추가"], ["/records", "기록 작성"], ["/principles", "원칙 추가"]]) {
    await page.goto(path);
    const trigger = page.getByRole("button", { name: action, exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: action, exact: true });
    await dialog.getByLabel("제목").fill("보존할 초안");
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    const discard = page.getByRole("dialog", { name: "변경을 버릴까요?" });
    await expect(discard).toBeVisible();
    await discard.getByRole("button", { name: "변경 버리기" }).click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  }
});

test("원칙 상세 왕복과 새로고침은 추가 페이지와 상태 필터를 유지한다", async ({ page }) => {
  await devLogin(page);
  const token = await mcpTokenViaConsent(page);
  const mcp = await mcpClient(token);
  const titles: string[] = [];
  try {
    for (let i = 0; i < 21; i++) {
      const title = unique(`페이지 원칙 ${i}`);
      titles.push(title);
      await mcp.call("create_principle", { title, summary: "페이지 복원 검증" });
    }
  } finally { await mcp.close(); }
  await page.goto("/principles?status=active");
  const oldest = page.getByRole("link", { name: titles[0], exact: true });
  await expect(oldest).toHaveCount(0);
  // 다른 병렬 사용자 흐름이 같은 개발 계정에 추가한 항목도 포함하므로 실제 위치까지 탐색한다.
  for (let i = 0; await oldest.count() === 0 && i < 20; i++) {
    await page.getByRole("button", { name: "더 보기", exact: true }).click();
    await expect(page.getByRole("button", { name: "불러오는 중…" })).toHaveCount(0);
  }
  await expect(oldest).toBeVisible();
  const listUrl = page.url();
  expect(new URL(listUrl).searchParams.get("pages")).not.toBeNull();
  await oldest.click();
  const concurrent = await mcpClient(token);
  try {
    for (let i = 0; i < 21; i++) await concurrent.call("create_principle", { title: unique("왕복 중 추가"), summary: "항목 이동" });
  } finally { await concurrent.close(); }
  await page.getByRole("link", { name: "← 원칙 목록" }).click();
  const restored = new URL(page.url()), original = new URL(listUrl);
  expect(restored.pathname).toBe(original.pathname);
  for (const [key,value] of original.searchParams) {
    if(key!=="pages")expect(restored.searchParams.get(key)).toBe(value);
  }
  expect(Number(restored.searchParams.get("pages"))).toBeGreaterThanOrEqual(Number(original.searchParams.get("pages")));
  expect(restored.searchParams.has("scroll")).toBe(true);
  await expect(oldest).toBeVisible();
  await expect(oldest).toBeFocused();
  await page.reload();
  await expect(oldest).toBeVisible();
  await expect(oldest).toBeFocused();
});

test("원칙 웹 편집→MCP 상태 전환·삭제→웹 확인",async({page})=>{
  await devLogin(page);
  const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try {
    const p=await mcp.call("create_principle",{title:unique("관리 원칙"),summary:"판단 근거",body:"기존 근거"});
    await page.goto(`/principles/${p.id}`);
    await page.getByRole("button",{name:"편집",exact:true}).click();
    const edit=page.getByRole("dialog",{name:"원칙 편집"});
    await edit.getByLabel("본문").fill("정정된 근거");
    await edit.getByRole("button",{name:"저장",exact:true}).click();
    await expect(edit).not.toBeVisible();
    const updated=await mcp.call("get_principle",{id:p.id});
    expect(updated.body).toBe("정정된 근거");
    const inactive=await mcp.call("set_principle_status",{id:p.id,expected_version:updated.version,status:"inactive"});
    await page.reload();
    await expect(page.getByRole("button",{name:"활성화",exact:true})).toBeVisible();
    const replacement=await mcp.call("create_principle",{title:unique("새 판단 기준"),summary:"대체 기준"});
    await page.getByRole("button",{name:"대체 연결 변경",exact:true}).click();
    const replace=page.getByRole("dialog",{name:"대체 연결 변경"});
    await replace.getByLabel("대체 원칙").selectOption(replacement.id);
    await replace.getByRole("button",{name:"변경",exact:true}).click();
    await expect(replace).not.toBeVisible();
    expect((await mcp.call("get_principle",{id:p.id})).replaced_by_id).toBe(replacement.id);
    await page.getByRole("button",{name:"대체 연결 변경",exact:true}).click();
    await replace.getByLabel("대체 원칙").selectOption("");
    await replace.getByRole("button",{name:"변경",exact:true}).click();
    await expect(replace).not.toBeVisible();
    expect((await mcp.call("get_principle",{id:p.id})).replaced_by_id).toBeNull();
    await page.getByRole("button",{name:"활성화",exact:true}).click();
    await page.getByRole("dialog",{name:"원칙 활성화"}).getByRole("button",{name:"변경",exact:true}).click();
    await expect(page.getByRole("button",{name:"비활성화",exact:true})).toBeVisible();
    const active=await mcp.call("get_principle",{id:p.id});
    expect(active.version).toBe(Number(inactive.version)+3);
    await mcp.call("delete_principle",{id:p.id,expected_version:active.version});
    await page.reload();await expect(page.getByText("원칙을 찾을 수 없습니다.")).toBeVisible();
  }finally{await mcp.close();}
});

test("원칙 편집 충돌은 초안을 유지하고 명시적으로 닫으면 최신 버전으로 복구한다",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const p=await mcp.call("create_principle",{title:unique("충돌 원칙"),summary:"원래 요약"});
    await page.goto(`/principles/${p.id}`);await page.getByRole("button",{name:"편집",exact:true}).click();
    const form=page.getByRole("dialog",{name:"원칙 편집"});
    await form.getByLabel("본문").fill("보호할 초안");
    await mcp.call("update_principle",{id:p.id,expected_version:1,summary:"최신 요약"});
    await form.getByRole("button",{name:"저장",exact:true}).click();
    await expect(form.getByRole("alert")).toContainText("다른 변경");
    await expect(form.getByLabel("본문")).toHaveValue("보호할 초안");
    await form.getByRole("button",{name:"닫기",exact:true}).click();
    await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기",exact:true}).click();
    await expect(page.getByText("최신 요약",{exact:true})).toBeVisible();
    await page.getByRole("button",{name:"편집",exact:true}).click();
    await form.getByLabel("본문").fill("비교 후 정정");await form.getByRole("button",{name:"저장",exact:true}).click();
    await expect(form).not.toBeVisible();expect((await mcp.call("get_principle",{id:p.id})).body).toBe("비교 후 정정");
  }finally{await mcp.close();}
});

test("웹 기록에 원칙 적용→MCP 현재 상태 조회→원칙 삭제 후 기록 보존",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const p=await mcp.call("create_principle",{title:unique("적용 원칙"),summary:"근거"});
    await page.goto("/records");await page.getByRole("button",{name:"기록 작성",exact:true}).click();
    const form=page.getByRole("dialog",{name:"기록 작성"});
    await form.getByLabel("제목").fill(unique("적용 결과"));await form.getByLabel("요약").fill("판단 결과");
    await form.getByLabel("본문").fill("당시 근거를 보존합니다.");
    await form.getByRole("button",{name:p.title,exact:true}).click();
    await form.getByRole("button",{name:"저장",exact:true}).click();
    await expect(form).not.toBeVisible();
    const id=new URL(page.url()).pathname.split("/").at(-1)!;
    expect((await mcp.call("get_record",{id})).applied_principle_ids).toEqual([p.id]);
    await mcp.call("set_principle_status",{id:p.id,expected_version:1,status:"inactive"});
    await page.reload();await expect(page.getByText(/비활성 · 현재 원칙 수정/)).toBeVisible();
    await mcp.call("delete_principle",{id:p.id,expected_version:2});
    await page.reload();await expect(page.getByText("당시 근거를 보존합니다.",{exact:true})).toBeVisible();
    expect((await mcp.call("get_record",{id})).applied_principle_ids).toEqual([]);
  }finally{await mcp.close();}
});
