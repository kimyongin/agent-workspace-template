import { saveWithMemo, beginTabAction, openDetailEditor } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";

test("Entity 웹 CRUD·초안 보호→MCP parity·활동 연결→삭제 원문 보존", async ({ page }) => {
  await devLogin(page);
  await page.getByRole("link", { name: "엔터티", exact: true }).click();
  await beginTabAction(page,"엔터티 추가");
  const form = page.getByRole("dialog", { name: "엔터티 추가" }),
    name = unique("예제 엔터티");
  await form.getByLabel("속성 1").fill(name);
  await form.getByLabel("속성 2").fill("0");
  await form.getByLabel("속성 3").fill("2024-02-29");
  await form.getByLabel("속성 4").selectOption("b");
  await form.getByRole("button", {name:"닫기",exact:true}).click();
  await page.getByRole("dialog", { name: "변경을 버릴까요?" }).getByRole(
    "button",
    { name: "취소", exact: true },
  ).click();
  await expect(form.getByLabel("속성 1")).toHaveValue(name);
  await saveWithMemo(page, form);
  await expect(form).not.toBeVisible();await expect(page).toHaveURL(/\/entities\/[0-9a-f-]{36}(?:\?|$)/);
  await expect(page.getByRole("heading",{name,level:1,exact:true})).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const e = await mcp.call("get_entity", { id });
    expect(e.prop2).toBe(0);
    expect(e.prop3).toBe("2024-02-29");
    const task = await mcp.call("create_task", {
      kind: "once",
      title: unique("연결 행동"),
      summary: "연결을 보존",
      entity_ids: [id],
    });
    const unrelated = await mcp.call("create_task", { kind: "once", title: task.title + " 외부", summary: "별도" });
    await page.goto(`/search?q=${encodeURIComponent(task.title)}&mode=keyword&kind=task`);
    await page.getByLabel("엔터티", { exact: true }).selectOption(id);
    await expect(page.locator(".list .item-title")).toHaveCount(1);
    expect(new URL(page.url()).searchParams.get("entity_id")).toBe(id);
    await page.getByRole("link", { name: task.title, exact: true }).click();
    await page.getByRole("button",{name:"닫기",exact:true}).click();
    await expect(page.getByRole("link", { name: task.title, exact: true })).toBeFocused();
    await page.reload();
    await expect(page.locator(".list .item-title")).toHaveCount(1);
    expect(
      (await mcp.call("search", { query: task.title, entity_id: id, mode: "keyword", kinds:["task"] })).items.map((x: { id: string }) =>
        x.id
      ),
    ).toEqual([task.id]);
    await mcp.call("delete_task", { id: unrelated.id, expected_version: 1 });
    await page.goto(`/entities/${id}`);
    await expect(page.getByRole("heading", { name: "연결된 할 일 (1개)" }))
      .toBeVisible();
    await page.getByRole("link", { name: "전체 할 일 보기" }).click();
    await expect(page).toHaveURL(new RegExp(`/tasks\\?entity_id=${id}`));
    await expect(page.getByRole("link", { name: task.title, exact: true }))
      .toBeVisible();
    expect(new URL(page.url()).searchParams.get("entity_id")).toBe(id);
    await page.goto(`/tasks/${task.id}`);
    await openDetailEditor(page);
    const editTask = page.getByRole("dialog", { name: "할 일 편집" });
    await expect(editTask.getByRole("checkbox", { name, exact: true })).toBeChecked();
    await editTask.getByRole("button", {name:"닫기",exact:true}).click();
    await page.goto(`/entities/${id}`);
    await openDetailEditor(page);
    const edit = page.getByRole("dialog", { name: "엔터티 편집" });
    await edit.getByLabel("속성 2").fill("10");
    await edit.getByLabel("편집 메모").fill("실측 반영");
    await saveWithMemo(page, edit);
    await expect(edit).not.toBeVisible();
    expect((await mcp.call("get_entity", { id })).prop2).toBe(10);
    await page.goto(`/entities/${id}`);
    await openDetailEditor(page);
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    const remove = page.getByRole("dialog", { name: "엔터티를 삭제할까요?" });
    await remove.getByRole("button", { name: "취소", exact: true }).click();
    await expect(page.locator("dialog.modal:not(.modal-confirm)[open]").getByLabel("속성 1")).toHaveValue(name);
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    await saveWithMemo(page,page.getByRole("dialog", { name: "엔터티를 삭제할까요?" }),"삭제");
    await expect(
      page.getByRole("heading", { name: "엔터티", level: 1, exact: true }),
    )
      .toBeVisible();
    const current = await mcp.call("get_task", { id: task.id });
    expect(current.entity_ids).toEqual([]);
    expect(current.entity_context).toContainEqual(expect.objectContaining({id,title:name}));
    expect(current).not.toHaveProperty("entity_id");
    expect(current.version).toBe(2);
    await mcp.call("delete_task", { id: task.id, expected_version: 2 });
  } finally {
    await mcp.close();
  }
});


test("엔터티 관련 기록 취소: 작성 URL·reload·메모와 변경 이벤트 무쓰기",async({page})=>{
  await devLogin(page);const mcp=await mcpClient(await mcpTokenViaConsent(page));
  try{
    const entity=await mcp.call("create_entity",{prop1:unique("연결 취소"),prop2:0,prop4:"a"});
    const before=await mcp.call("list_records",{entity_id:entity.id,record_kind:"change",limit:100});
    await page.goto(`/entities/${entity.id}?list=%2Fentities`);
    for(const dirty of [false,true]){
      await beginTabAction(page,"기록 작성");
      const editor=page.getByRole("dialog",{name:"기록 작성",exact:true});await expect(page).toHaveURL(/create=record/);
      if(dirty){await editor.getByLabel("제목").fill("저장하지 않을 기록");await editor.getByLabel("요약").fill("취소할 설명");}
      await editor.getByRole("button", {name:"닫기",exact:true}).click();
      if(dirty) await page.getByRole("dialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();
      await expect(page).not.toHaveURL(/create=/);await expect(page).toHaveURL(/list=/);
      await expect(page.getByRole("button",{name:"기록 작성",exact:true})).toBeFocused();
    }
    await page.reload();await expect(page.getByRole("heading",{name:entity.prop1,level:1,exact:true})).toBeVisible();
    await expect(page.getByRole("dialog",{name:"기록 작성",exact:true})).toHaveCount(0);
    expect((await mcp.call("get_entity",{id:entity.id})).version).toBe(1);
    expect((await mcp.call("list_records",{entity_id:entity.id,record_kind:"user"})).items).toEqual([]);
    expect((await mcp.call("list_records",{entity_id:entity.id,record_kind:"change",limit:100})).items).toEqual(before.items);
  }finally{await mcp.close();}
});
test("Entity 목록: 키워드/선택/정렬·추가 페이지·상세 복귀/새로고침 초점·viewport", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page)),
    marker = unique("페이지 엔터티"),
    ids: string[] = [];
  try {
    for (let i = 0; i < 21; i++) {
      const e = await mcp.call("create_entity", {
        prop1: `${marker} ${String(i).padStart(2, "0")}`,
        prop2: i,
        prop4: "c",
      });
      ids.push(e.id);
    }
    await page.goto(
      `/entities?keyword=${encodeURIComponent(marker)}&prop4=c&sort=prop2`,
    );
    await expect(page.getByRole("link", { name: `${marker} 00`, exact: true }))
      .toBeVisible();
    await page.getByRole("button", { name: "더 보기", exact: true }).click();
    const last = page.getByRole("link", { name: `${marker} 20`, exact: true });
    await expect(last).toBeVisible();
    const before = page.url();
    await last.click();
    await page.getByRole("button",{name:"닫기",exact:true}).click();
    const restored=new URL(page.url()),original=new URL(before);
    for(const [key,value] of original.searchParams)expect(restored.searchParams.get(key)).toBe(value);
    expect(restored.searchParams.has("scroll")).toBe(true);
    await expect(last).toBeFocused();
    await page.reload();
    await expect(last).toBeFocused();
    for (const width of [320,360,390,639,640,768,1024,1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      ).toBe(true);
    }
    await page.goto(`/entities?keyword=${encodeURIComponent(marker)}&prop4=c&sort=prop2`);
    await page.getByRole("link", { name: `${marker} 19`, exact: true }).click();
    const concurrent = await mcp.call("create_entity", { prop1: `${marker} 새 항목`, prop2: 0, prop4: "c" });
    ids.push(concurrent.id);
    await page.getByRole("button",{name:"닫기",exact:true}).click();
    await expect(page.getByRole("link", { name: `${marker} 19`, exact: true })).toBeFocused();
    await mcp.call("delete_entity", { id: ids[19], expected_version: 1 });
    ids.splice(19, 1);
    await page.reload();
    await expect(page.getByRole("heading", { name: "엔터티", exact: true })).toBeFocused();
  } finally {
    for (const id of ids) {
      await mcp.call("delete_entity", { id, expected_version: 1 });
    }
    await mcp.close();
  }
});

test("Entity 복원: 대상 없음 조회 한도·제목 초점·필터 hash 제거·늦은 응답 격리", async ({ page }) => {
  await devLogin(page);
  let requests = 0, release: () => void = () => {}, started: () => void = () => {};
  const delayed = new Promise<void>((resolve) => release = resolve),
    arrived = new Promise<void>((resolve) => started = resolve);
  await page.route("**/api/entities?**", async (route) => {
    const url = new URL(route.request().url()), keyword = url.searchParams.get("keyword");
    requests++;
    if (keyword === "느림") {
      started();
      await delayed;
    }
    const item = {
      id: crypto.randomUUID(),
      prop1: keyword ?? "계속되는 목록",
      prop2: null,
      prop3: null,
      prop4: "a",
      version: 1,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    await route.fulfill({ json: { items: [item], next_cursor: keyword ? null : "more" } }).catch(() => {});
  });
  await page.goto(`/entities?pages=1#entity-${crypto.randomUUID()}`);
  await expect(page.getByRole("heading", { name: "엔터티", exact: true })).toBeFocused();
  expect(requests).toBe(2);
  await page.getByText("필터",{exact:true}).click();
  await page.getByLabel("속성 4 필터").selectOption("b");
  await expect(page).not.toHaveURL(/#entity-/);
  expect(new URL(page.url()).searchParams.has("pages")).toBe(false);
  await page.getByLabel("속성 1 키워드",{exact:true}).fill("느림");
  await arrived;
  await page.getByLabel("속성 1 키워드",{exact:true}).fill("최신");
  await expect(page.getByRole("link", { name: "최신", exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("link", { name: "느림", exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "최신", exact: true })).toBeVisible();
});

test("Entity lookahead 뒤 더 보기: 현재 커서 append·실패 retry·행과 버튼 초점 보존", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page)), marker = unique("복원 후 추가"), ids: string[] = [];
  try {
    for (let i = 0; i < 61; i++) {
      ids.push((await mcp.call("create_entity", { prop1: `${marker} ${String(i).padStart(2, "0")}`, prop2: i })).id);
    }
    await page.goto(`/entities?keyword=${encodeURIComponent(marker)}&sort=prop2`);
    const anchor = page.getByRole("link", { name: `${marker} 19`, exact: true });
    await anchor.click();
    ids.push((await mcp.call("create_entity", { prop1: `${marker} 동시 추가`, prop2: 0 })).id);
    await page.getByRole("button",{name:"닫기",exact:true}).click();
    await expect(anchor).toBeFocused();
    await expect(page.locator(".list .item-title")).toHaveCount(40);
    const cursors: string[] = [];
    let fail = false, failed = false;
    await page.route("**/api/entities?**", async (route) => {
      const cursor = new URL(route.request().url()).searchParams.get("cursor");
      if (cursor) cursors.push(cursor);
      if (fail && !failed) {
        failed = true;
        await route.fulfill({
          status: 503,
          json: { code: "unavailable", message: "추가 페이지 일시 실패", retryable: true, fields: [] },
        });
      } else await route.continue();
    });
    const more = page.getByRole("button", { name: "더 보기", exact: true });
    await more.scrollIntoViewIfNeeded();
    const y = await page.evaluate(() => window.scrollY);
    await more.click();
    await expect(page.locator(".list .item-title")).toHaveCount(60);
    await expect(more).toBeFocused();
    expect(cursors).toHaveLength(1);
    expect(new URL(page.url()).searchParams.get("pages")).toBe("3");
    expect(await page.evaluate(() => window.scrollY)).toBe(y);
    await more.scrollIntoViewIfNeeded();
    const retryY = await page.evaluate(() => window.scrollY);
    const retryBox = (await more.boundingBox())!;
    fail = true;
    await more.click();
    const retry = page.getByRole("button", { name: "다시 시도", exact: true });
    await expect(retry).toBeFocused();
    await expect(page.locator(".list .item-title")).toHaveCount(60);
    // The notice changes document height; browser scroll anchoring should keep the button in place.
    await expect(retry).toBeInViewport();
    expect(Math.abs((await retry.boundingBox())!.y - retryBox.y)).toBeLessThan(2);
    await retry.click();
    const done = page.getByRole("button", { name: "모두 불러왔습니다", exact: true });
    await expect(page.locator(".list .item-title")).toHaveCount(62);
    await expect(done).toBeFocused();
    await expect(done).toHaveAttribute("aria-disabled", "true");
    expect(cursors).toHaveLength(3);
    expect(cursors[2]).toBe(cursors[1]);
    expect(cursors[1]).not.toBe(cursors[0]);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThanOrEqual(retryY - 100);
    await expect(anchor).not.toBeFocused();
  } finally {
    for (const id of ids) await mcp.call("delete_entity", { id, expected_version: 1 });
    await mcp.close();
  }
});

test("Entity 자동 복원 250 상한 뒤 수동 251페이지·같은 cursor 재시도", async ({ page }) => {
  await devLogin(page);
  const cursors: (string | null)[] = [];
  let failed = false;
  await page.route("**/api/entities?**", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    cursors.push(cursor);
    if (cursor === "page-250" && !failed) {
      failed = true;
      await route.fulfill({
        status: 503,
        json: { code: "unavailable", message: "251페이지 일시 실패", retryable: true, fields: [] },
      });
      return;
    }
    const index = cursor ? Number(cursor.slice(5)) + 1 : 1;
    await route.fulfill({
      json: {
        items: [{
          id: crypto.randomUUID(),
          prop1: `경계 항목 ${index}`,
          prop2: null,
          prop3: null,
          prop4: "a",
          version: 1,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }],
        next_cursor: `page-${index}`,
      },
    });
  });
  // One item per fake page exercises page transitions without 5000 real DB rows.
  await page.goto("/entities?pages=999999");
  const more = page.getByRole("button", { name: "더 보기", exact: true });
  await expect(more).toHaveAttribute("aria-disabled", "false", { timeout: 30000 });
  await expect(page.locator(".list .item-title")).toHaveCount(250);
  expect(cursors).toHaveLength(250);
  await more.click();
  const retry = page.getByRole("button", { name: "다시 시도", exact: true });
  await expect(retry).toBeFocused();
  await expect(retry).toBeInViewport();
  await expect(page.locator(".list .item-title")).toHaveCount(250);
  expect(new URL(page.url()).searchParams.get("pages")).toBe("251");
  expect(cursors.at(-1)).toBe("page-250");
  await retry.click();
  await expect(page.locator(".list .item-title")).toHaveCount(251);
  await expect(more).toBeFocused();
  expect(cursors).toHaveLength(252);
  expect(cursors.slice(-2)).toEqual(["page-250", "page-250"]);
  const beforeFilter = cursors.length;
  await page.getByText("필터",{exact:true}).click();
  await page.getByLabel("속성 4 필터").selectOption("b");
  await expect(page.locator(".list .item-title")).toHaveCount(1);
  await page.getByLabel("속성 4 필터").selectOption("");
  await expect.poll(() => cursors.length).toBe(beforeFilter + 2);
  await expect(page.locator(".list .item-title")).toHaveCount(1);
  await expect(more).toHaveAttribute("aria-disabled", "false");
  expect(cursors.slice(beforeFilter)).toEqual([null, null]);
});
