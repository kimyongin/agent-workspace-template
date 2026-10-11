import { expect, test } from "@playwright/test";
import { devLogin, env, mcpClient, mcpTokenViaConsent } from "./support.ts";

test("상태: 실제 인증 HTTP·OAuth MCP 집계와 lazy 기본 접힘, 키보드·터치 날짜 선택", async ({ page }) => {
  await devLogin(page);
  const mcp=await mcpClient(await mcpTokenViaConsent(page));
  let issuesRequests=0;
  page.on("request",r=>{ if(r.url().includes("/status/indexing/issues")) issuesRequests++; });
  try {
    await page.goto("/status");
    await expect(page.getByRole("heading",{name:"상태",level:1})).toBeVisible();
    await expect(page.getByText("이번 조회 연결 성공")).toBeVisible();
    expect(issuesRequests).toBe(0);
    const toggle=page.getByRole("button",{name:/^색인 문제/});
    await expect(toggle).toHaveAttribute("aria-expanded","false");
    const response=await mcp.call("get_status",{});
    await expect(page.getByText(`전체 기록 ${response.indexing.total.toLocaleString("ko-KR")}개 · 현재 상태`)).toBeVisible();
    const sliders=page.getByRole("slider");
    expect(await sliders.count()).toBe(4);
    await sliders.first().focus(); await page.keyboard.press("Home");
    await expect(sliders.first()).toHaveValue("0");
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded","true");
    await expect.poll(()=>issuesRequests).toBe(1);
    await expect(page.getByText("색인 문제 조회 중…")).toHaveCount(0);
    expect(await page.locator(".status-issue-list > li").count()).toBeLessThanOrEqual(5);
    const mcpIssues=await mcp.call("list_indexing_issues",{});
    expect(mcpIssues.items.length).toBeLessThanOrEqual(5);
    await page.getByRole("button",{name:"새로고침",exact:true}).click();
    await expect(page.getByRole("button",{name:/^색인 문제/})).toHaveAttribute("aria-expanded","false");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  } finally { await mcp.close(); }
});

test("색인 문제: 실제 상태 화면에서 다수·마지막 페이지·이전·오류 재시도·긴 제목",async({page})=>{
  await devLogin(page);
  let calls=0, fail=true;
  const item=(n:number)=>({id:`20261011-ABCDEF${n}${n}`,created_at:"2026-10-11T00:00:00.000Z",title:`문제${n} `+"긴제목".repeat(24),reason:"provider_unknown",attempts:5,chunks:{total:2,succeeded:1,preparing:0,unknown:1,failed:0}});
  // Mock only the network boundary for otherwise hard-to-reproduce diagnostic/error states.
  await page.route(`${env.VITE_API_URL}/status/indexing/issues**`,async route=>{
    calls++;
    if(fail){ fail=false; await route.fulfill({status:503,json:{code:"unavailable",message:"fixture failure"}});return; }
    const last=new URL(route.request().url()).searchParams.has("cursor");
    await route.fulfill({json:{items:last?[item(5)]:Array.from({length:5},(_,n)=>item(n)),next_cursor:last?null:"last-page"}});
  });
  await page.goto("/status");
  await expect(page.getByText("이번 조회 연결 성공")).toBeVisible(); expect(calls).toBe(0);
  const toggle=page.getByRole("button",{name:/^색인 문제/});await toggle.focus();await page.keyboard.press("Enter");
  await expect(page.getByRole("alert")).toContainText("색인 문제를 조회하지 못했습니다");
  await page.getByRole("button",{name:"다시 시도"}).click();
  await expect(page.locator(".status-issue-list > li")).toHaveCount(5);
  await expect(page.getByRole("button",{name:"이전",exact:true})).toBeDisabled();
  const detail=page.locator(".status-issue-list summary").first();await detail.focus();await page.keyboard.press("Enter");
  await expect(page.getByText("실패나 성공으로 확정할 수 없습니다",{exact:false}).first()).toBeVisible();
  await expect(page.getByText("현재 구간 전송 시도 5회 · 본문 구간 1/2 완료").first()).toBeVisible();
  await page.getByRole("button",{name:"다음",exact:true}).click();
  await expect(page.locator(".status-issue-list > li")).toHaveCount(1);
  await expect(page.getByRole("button",{name:"다음",exact:true})).toBeDisabled();
  await page.getByRole("button",{name:"이전",exact:true}).click();
  await expect(page.locator(".status-issue-list > li")).toHaveCount(5);
  const size=await page.getByRole("button",{name:"다음",exact:true}).boundingBox();expect(size!.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.getByRole("button",{name:"새로고침",exact:true}).click();
  await expect(page.getByRole("button",{name:/^색인 문제/})).toHaveAttribute("aria-expanded","false");
});

test("색인 문제: 접기와 새로고침은 오래된 요청을 취소하고 늦은 결과를 표시하지 않는다",async({page})=>{
  await devLogin(page);
  let calls=0;
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  const item={id:"20261011-ABCDEF00",created_at:"2026-10-11T00:00:00.000Z",title:"새 조회의 문제",reason:"configuration",attempts:1,chunks:{total:1,succeeded:0,preparing:0,unknown:0,failed:1}};
  await page.route(`${env.VITE_API_URL}/status/indexing/issues**`,async route=>{
    const first=++calls===1;
    if(first)await held;
    try {await route.fulfill({json:{items:[{...item,title:first?"오래된 요청의 문제":item.title}],next_cursor:null}});} catch { /* Aborted requests may no longer accept a response. */ }
  });
  await page.goto("/status");await expect(page.getByText("이번 조회 연결 성공")).toBeVisible();
  const toggle=page.getByRole("button",{name:/^색인 문제/});
  await toggle.click();await expect.poll(()=>calls).toBe(1);
  await expect(page.getByText("색인 문제 조회 중…")).toBeVisible();
  await toggle.click();await expect(toggle).toHaveAttribute("aria-expanded","false");
  await toggle.click();await expect(page.getByText("새 조회의 문제")).toBeVisible();
  release();
  await page.getByRole("button",{name:"새로고침",exact:true}).click();
  await expect(page.getByText("이번 조회 연결 성공")).toBeVisible();
  await expect(page.getByRole("button",{name:/^색인 문제/})).toHaveAttribute("aria-expanded","false");
  await expect(page.getByText("오래된 요청의 문제")).toHaveCount(0);
});
