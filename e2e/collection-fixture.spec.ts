// Actual App and routing; remote Auth/API are isolated, with no DB or real-account writes.
import { fixtureType, fixtureSchema, entityKey } from "./support/workspace-data.ts";
import { expect, test, type Page } from "@playwright/test";
import {id,stamp,identity as base,entity as makeEntity,task as makeTask,record as makeRecord} from "./support/workspace-data.ts";
import {installWorkspaceApi} from "./support/workspace-api.ts";
import {closeDetail} from "./ui-actions.ts";
const task={...makeTask(),title:"다음 상담 준비",body:"필요한 자료를 준비합니다.",due_on:"2026-10-12",entity_ids:[entityKey(1)],entity_context:[{id:entityKey(1),title:"김민수",source:"selection" as const,captured_at:stamp}]};
const record={...makeRecord(),body:"상담 내용을 정리하고 다음 방문 일정을 확인했습니다.",task_id:id(2),entity_ids:[entityKey(1)],entity_context:task.entity_context};
const entity={...makeEntity(1, {prop_1:"김민수",prop_3:"2026-10-08"}),tasks:{count:1,items:[task]},records:{count:1,items:[record]}};
const user = { id: id(100), aud: "authenticated", email: "fixture@example.test", app_metadata: {}, user_metadata: { workspace_timezone: "Asia/Seoul" } };

async function fixture(page: Page, records = [record]) {
  const state=await installWorkspaceApi(page,"http://127.0.0.1:55587",{entities:[entity],tasks:[task],records,tags:[]},{pageSize:20});
  await page.addInitScript(user => localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token: "fixture", refresh_token: "fixture", expires_at: Math.floor(Date.now() / 1000) + 3600, user })), user);
  await page.route("**/*",async route=>{
    const url=new URL(route.request().url());
    if(url.origin==="http://127.0.0.1:55587"&&url.pathname.startsWith("/api/"))return route.fallback();
    if(url.origin==="http://127.0.0.1:55587"&&url.pathname==="/auth/v1/user")return route.fulfill({json:user});
    if(url.origin==="http://127.0.0.1:55586")return route.continue();
    return route.abort();
  });
  return state;
}

for (const [kind, label, title] of [["entities", "전체 자료", entity.title], ["tasks", "할 일", task.title], ["records", "기록", record.body]] as const) test(`${kind}: views keep filters, list reads and disclosure/detail return`, async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/${kind}`);
  const list = page.getByRole("region", { name: `${label} 목록`, exact: true });
  const modes = list.getByRole("radiogroup", { name: `${label} 보기 방식` });
  await expect(list.getByRole("heading", { name: `${label} (1개)`, exact: true })).toBeVisible();
  const readCount = state.reads.filter(url => new URL(url).pathname === `/api/${kind}`).length;
  for (const mode of ["카드", "테이블", "리스트"]) {
    await modes.getByRole("radio", { name: mode, exact: true }).click();
    await expect(modes.getByRole("radio", { name: mode, exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(list.getByRole("button", { name: title, exact: true })).toBeVisible();
    if (kind === "tasks") {
      const toggle = list.getByRole("button", { name: title, exact: true });
      await expect(list.locator(".badge")).toHaveCount(1);
      await expect(list.locator(".badge")).toBeVisible();
      await toggle.click();
      await expect(list.getByText(task.body, { exact: true })).toBeVisible();
      await expect(list.locator(".badge")).toHaveCount(1);
      await expect(list.locator(".related-preview .badge")).toHaveCount(0);
      await toggle.click();
      await expect(list.locator(".badge")).toHaveCount(1);
    }
  }
  expect(state.reads.filter(url => new URL(url).pathname === `/api/${kind}`).length).toBe(readCount);
  await modes.getByRole("radio", { name: "테이블", exact: true }).click();
  await list.getByRole("button", { name: title, exact: true }).click();
  await list.getByRole("link", { name: `${title} 상세`, exact: true }).click();
  await closeDetail(page, title);
  await expect(page).toHaveURL(/view=table/);
  await expect(list.getByRole("button", { name: title, exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "필터 열기" }).click();
  await page.getByRole("button", { name: "조건 초기화" }).click();
      await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect(modes.getByRole("radio", { name: "테이블", exact: true })).toHaveAttribute("aria-checked", "true");
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test("related sections switch independently and return from a linked detail", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(`/entities/${entity.id}`);
  const dialog = page.getByRole("dialog"), tasks = dialog.getByRole("region", { name: "할 일 (1개)" }), records = dialog.getByRole("region", { name: "기록 (1개)" });
  await tasks.getByRole("radio", { name: "카드", exact: true }).click();
  await records.getByRole("radio", { name: "테이블", exact: true }).click();
  await tasks.getByRole("button", { name: task.title, exact: true }).click();
  await tasks.getByRole("link", { name: `${task.title} 상세`, exact: true }).click();
  await closeDetail(page, task.title);
  await expect(tasks.getByRole("radio", { name: "카드", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(records.getByRole("radio", { name: "테이블", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.goto(`/records/${record.id}`);
  await expect(dialog.getByRole("radiogroup", { name: "연결된 자료 보기 방식" })).toBeVisible();
  await expect(dialog.getByRole("radiogroup", { name: "할 일 보기 방식" })).toBeVisible();
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test("empty and failed lists keep truthful counts and retry in every view", async ({ page }) => {
  const state = await fixture(page);
  state.rows.records.length = 0;
  const clearFailure = state.failRead({ kind: "records", page: 1 }, { once: false });
  await page.goto("/records");
  await expect(page.getByRole("alert")).toContainText("기록을 불러오지 못했습니다");
  await expect(page.locator(".collection-heading h2")).toHaveText("기록");
  const recordReads = () => state.reads.filter(url => new URL(url).pathname === "/api/records").length;
  const before = recordReads();
  for (const mode of ["카드", "테이블", "캘린더"]) {
    await page.getByRole("radio", { name: mode, exact: true }).click();
    await expect(page.getByRole("alert")).toBeVisible();
  }
  expect(recordReads()).toBe(before);
  clearFailure(); await page.getByRole("button", { name: "다시 시도", exact: true }).click();
  await expect(page.getByRole("heading", { name: "기록 (0개)", exact: true })).toHaveText("0개");
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test("calendar uses display dates, keyboard month edges, partial pages and saved selection", async ({ page }) => {
  const rows = Array.from({ length: 21 }, (_, n) => ({ ...record, ...base(200 + n), body: `기록 ${n}`, occurred_at: n === 0 ? "2026-10-07T15:30:00Z" : "2026-09-30T15:30:00Z" }));
  const state = await fixture(page, rows);
  await page.goto("/records?view=calendar");
  await expect(page.getByRole("heading", { name: "기록 (20개+)" })).toBeVisible();
  const day = page.getByRole("button", { name: "2026-10-08, 불러온 기록 1개", exact: true });
  await expect(day).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("불러온 기록만 표시합니다.", { exact: false })).toBeVisible();
  await day.press("ArrowLeft"); await expect(page.getByRole("button", { name: "2026-10-07, 불러온 기록 0개", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "2026-10-01, 불러온 기록 19개", exact: true }).click();
  await page.getByRole("button", { name: "2026-10-01, 불러온 기록 19개", exact: true }).press("ArrowLeft");
  await expect(page.getByRole("heading", { name: "2026년 9월", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "다음 달", exact: true }).click();
  await page.getByRole("button", { name: "2026-10-08, 불러온 기록 1개", exact: true }).click();
  await page.getByRole("button", { name: "기록 더 보기", exact: true }).click();
  await expect(page.getByRole("heading", { name: "기록 (21개)", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "2026-10-01, 불러온 기록 20개", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "기록 0", exact: true }).click();
  await page.getByRole("link", { name: "기록 0 상세", exact: true }).click();
  await closeDetail(page, "기록 0");
  await expect(page).toHaveURL(/calendar_day=2026-10-08/);
  await expect(day).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "2026-10-01, 불러온 기록 20개", exact: true }).click();
  await page.getByRole("radio", { name: "리스트", exact: true }).click();
  await page.getByRole("button", { name: "기록 0", exact: true }).click();
  await page.getByRole("radio", { name: "캘린더", exact: true }).click();
  await expect(day).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: "기록 0", exact: true })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "2026-10-01, 불러온 기록 20개", exact: true }).click();
  await expect(page).not.toHaveURL(/open=/);
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

test("all layouts fit narrow/wide screens and large text, with quiet icon controls", async ({ page }, info) => {
  // Forty viewport/layout combinations include screenshots; keep their full assertions.
  test.setTimeout(60_000);
  const state = await fixture(page);
  for (const width of [320, 390, 640, 1440]) for (const kind of ["entities", "tasks", "records"]) {
    await page.setViewportSize({ width, height: 844 });
    for (const view of ["list", "cards", "table", ...(kind === "records" ? ["calendar"] : [])]) {
      await page.goto(`/${kind}?view=${view}`); await expect(page.locator(".collection-heading h2")).toContainText("1개");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${await page.evaluate(() => innerWidth)}px ${await page.evaluate(() => [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(el => `${el.className}:${Math.round(el.getBoundingClientRect().left)}-${Math.round(el.getBoundingClientRect().right)}`).join(", "))}`).toBe(true);
      if (view === "calendar") {
        const target = await page.locator(".calendar-days button").first().boundingBox();
        expect(target!.width).toBeGreaterThanOrEqual(44); expect(target!.height).toBeGreaterThanOrEqual(44);
      }
      if (view === "table") for (const cell of await page.locator(".collection-numeric").all()) {
        expect(await cell.evaluate(el => getComputedStyle(el.querySelector(".collection-cell-value") ?? el).textAlign)).toBe("right");
        expect(await cell.evaluate(el => getComputedStyle(el).fontVariantNumeric)).toBe("tabular-nums");
      }
      await page.screenshot({ path: info.outputPath(`${kind}-${view}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto("/tasks?view=table");
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${await page.evaluate(() => innerWidth)}px ${await page.evaluate(() => [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(el => `${el.className}:${Math.round(el.getBoundingClientRect().left)}-${Math.round(el.getBoundingClientRect().right)}`).join(", "))}`).toBe(true);
  const modes = page.getByRole("radiogroup", { name: "할 일 보기 방식" });
  await modes.getByRole("radio", { name: "테이블" }).press("Home");
  await expect(modes.getByRole("radio", { name: "리스트" })).toBeFocused();
  const style = await modes.getByRole("radio", { name: "리스트" }).evaluate(el => { const r = el.getBoundingClientRect(), face = el.querySelector("span")!.getBoundingClientRect(); return { width: r.width, height: r.height, face: face.width }; });
  expect(style.width).toBeGreaterThanOrEqual(44); expect(style.height).toBeGreaterThanOrEqual(44); expect(style.face).toBe(44);
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

test("table rows and headers share the same columns across wrapper types and viewports", async ({ page }) => {
  const rows = [record, { ...record, ...base(4), body: "짧은 기록" }, { ...record, ...base(5), body: "아주 긴 한국어 기록을 제목처럼 표시할 때에도 날짜와 종류의 열은 흔들리지 않아야 합니다." }];
  const state = await fixture(page, rows);
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) for (const kind of ["entities", "tasks", "records"]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(`/${kind}?view=table`);
    await expect(page.locator(".collection-table-head")).toBeVisible();
    const geometry = await page.locator(".collection-table").evaluate(table => {
      const header = table.querySelector(".collection-table-head")!;
      const box = (el: Element) => ({ left: el.getBoundingClientRect().left, width: el.getBoundingClientRect().width });
      return { stacked: getComputedStyle(header).position === "absolute", head: box(header), columns: Array.from(header.children).map(box), rows: Array.from(table.querySelectorAll(".related-item-title")).map(row => ({ box: box(row), columns: Array.from(row.children).map(box), pairs: Array.from(row.querySelectorAll(".collection-title-data > div, .collection-table-cell")).map(pair => ({ key:box(pair.querySelector("dt, .collection-cell-key")!), value:box(pair.querySelector("dd, .collection-cell-value")!) })) })) };
    });
    for (const row of geometry.rows) {
      if(geometry.stacked) {
        expect(row.pairs).toHaveLength(geometry.columns.length);
        for(const pair of row.pairs) {
          expect(pair.value.left).toBeGreaterThan(pair.key.left + pair.key.width);
          expect(Math.abs(pair.key.left-row.pairs[0].key.left)).toBeLessThan(1);
          expect(Math.abs(pair.value.left-row.pairs[0].value.left)).toBeLessThan(1);
        }
      } else {
        expect(Math.abs(row.box.width - geometry.head.width)).toBeLessThan(1);
        for (const [index, cell] of row.columns.entries()) {
          expect(Math.abs(cell.left - geometry.columns[index].left)).toBeLessThan(1);
          expect(Math.abs(cell.width - geometry.columns[index].width)).toBeLessThan(1);
        }
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${await page.evaluate(() => innerWidth)}px ${await page.evaluate(() => [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(el => `${el.className}:${Math.round(el.getBoundingClientRect().left)}-${Math.round(el.getBoundingClientRect().right)}`).join(", "))}`).toBe(true);
  }
  await page.goto(`/entities/${entity.id}`);
  const section = page.getByRole("dialog").getByRole("region", { name: "기록 (1개)", exact: true });
  await section.getByRole("radio", { name: "테이블", exact: true }).click();
  const widths = await section.evaluate(el => [el.querySelector(".collection-table-head")!.getBoundingClientRect().width, el.querySelector(".related-item-title")!.getBoundingClientRect().width]);
  if(widths[0]>1)expect(Math.abs(widths[0] - widths[1])).toBeLessThan(1);
  else await expect(section.locator(".collection-title-data dt")).toBeVisible();
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

test("calendar reflows at enlarged text without shrinking day targets", async ({ page }) => {
  const state = await fixture(page);
  for (const width of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto("/records?view=calendar");
    await expect(page.locator(".calendar-days button").first()).toBeVisible();
    await page.evaluate(() => document.documentElement.style.fontSize = "200%");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${await page.evaluate(() => innerWidth)}px ${await page.evaluate(() => [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(el => `${el.className}:${Math.round(el.getBoundingClientRect().left)}-${Math.round(el.getBoundingClientRect().right)}`).join(", "))}`).toBe(true);
    const box = await page.locator(".calendar-days button").first().boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44); expect(box!.height).toBeGreaterThanOrEqual(44);
    const month = (await page.locator(".calendar-month-panel").boundingBox())!, selected = (await page.locator(".calendar-selection").boundingBox())!;
    expect(selected.y).toBeGreaterThanOrEqual(month.y + month.height);
  }
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});


test("restored preview waits for its read and settles even when tag lookup fails", async ({ page }) => {
  const row = { ...record, body: "태그 조회 실패에도 돌아올 기록", tag_ids: [id(11)] };
  const state = await fixture(page, [row]);
  state.failRead({ kind: "tags", page: 1 }, { once: false });
  const held = state.holdRead({ kind: "records", id: row.id });
  await page.goto("/records?open=" + encodeURIComponent("/records/" + row.id) + "&scroll=0#activity-records-" + row.id);
  await held.started;
  const title = page.getByRole("button", { name: row.body, exact: true });
  await expect(title).not.toBeFocused();
  held.release(); await held.finished;
  await expect(title).toBeFocused();
  await expect(title).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("태그 이름 조회 실패", { exact: true })).toBeVisible();
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

for (const action of ["delete", "create"] as const) test(`unavailable change target ${action} keeps the same disclosure row and entity links`, async ({page}) => {
  const history={...record,record_kind:"change" as const,change:{target_kind:"task" as const,target_id:task.id,target_title:task.title,action,source:"http" as const,event_id:id(88),path:null,before:null,after:null}};
  const state=await fixture(page,[history]);
  state.rows.tasks.length=0;
  await page.goto(`/records/${history.id}`);
  const detail=page.getByRole("dialog");
  const tasks=detail.getByRole("region",{name:"할 일 (1개)"});
  const badge=action==="delete"?"삭제됨":"조회 불가";
  await expect(tasks.getByText(badge,{exact:true})).toBeVisible();
  await expect(detail.getByRole("region",{name:"연결된 자료 (1개)"})).toBeVisible();
  for(const view of ["리스트","카드","테이블"]){
    await tasks.getByRole("radio",{name:view,exact:true}).click();
    await expect(tasks.getByText(badge,{exact:true})).toBeVisible();
    const toggle=tasks.getByRole("button",{name:task.title,exact:true});
    await expect(toggle).toHaveAttribute("aria-expanded","false");
    await expect(tasks.getByText(/기록에 저장된 당시 제목/)).toBeHidden();
    await toggle.click();
    await expect(tasks.locator(".related-preview")).toContainText("기록에 저장된 당시 제목");
    await expect(tasks.getByRole("link",{name:`${task.title} 상세`,exact:true})).toHaveCount(0);
    await toggle.click();
    await expect(tasks.locator(".related-preview")).toBeHidden();
  }
  expect(state.writes).toEqual([]);
});

test("responsive brand aligns desktop title and menu/search gaps, with icon-only mobile brand", async ({ page }) => {
  await fixture(page);
  await page.goto("/entities");
  await expect(page.locator("#entities-title")).toBeVisible();
  for (const width of [320,360,390,639,640,768,1024,1440]) {
    await page.setViewportSize({ width, height: 900 });
    const geometry = await page.evaluate(() => {
      const title = document.querySelector<HTMLElement>("#entities-title")!;
      const brand = document.querySelector<HTMLElement>(".navigation-brand")!;
      const rect = (el: Element) => el.getBoundingClientRect();
      const ts = getComputedStyle(title), bs = getComputedStyle(brand);
      return {
        overflow: document.documentElement.scrollWidth > innerWidth,
        brandShown: rect(brand).height > 0,
        headerShown: rect(document.querySelector(".workspace-header")!).height > 0,
        titleTop: rect(title).top, brandTop: rect(brand).top,
        searchGap: rect(document.querySelector(".query-bar")!).top - rect(document.querySelector(".page-heading")!).bottom,
        menuGap: rect(document.querySelector(".nav-profile-trigger")!).top - rect(brand).bottom,
        titleFont: ts.fontSize, brandFont: bs.fontSize,
        mobileIcon: getComputedStyle(title, "::before").backgroundImage,
      };
    });
    expect(geometry.overflow, `${width}px`).toBe(false);
    expect(geometry.headerShown).toBe(false);
    if (width >= 1024) {
      expect(geometry.brandShown).toBe(true);
      expect(geometry.titleFont).toBe(geometry.brandFont);
      expect(geometry.titleTop).toBe(geometry.brandTop);
      expect(geometry.searchGap).toBe(16);
      expect(geometry.menuGap).toBe(geometry.searchGap);
    } else {
      expect(geometry.brandShown).toBe(false);
      expect(geometry.mobileIcon).not.toBe("none");
    }
    if (width === 390 || width === 1440) await page.screenshot({ path: test.info().outputPath(`header-${width}.png`) });
  }
});

test("closed filters show conditions below search and opening hides the summary", async ({ page }) => {
  await fixture(page);
  for (const [path, condition] of [["/entities?entity_type_id=00000000-0000-4000-8000-000000000900&property_filters=%5B%7B%22key%22%3A%22prop_4%22%2C%22operator%22%3A%22eq%22%2C%22value%22%3A%22a%22%7D%5D", "분류: a"], ["/tasks?status=done", "상태: 완료"], ["/records?record_kind=change", "종류: 변경 기록"]]) {
    await page.goto(path);
    const summary = page.getByLabel("적용된 필터", {exact:true});
    await expect(summary).toContainText(condition);
    await page.getByRole("button", {name:/필터 열기/}).click();
    await expect(summary).toHaveCount(0);
    await page.getByRole("button", {name:/필터 닫기/}).click();
    await expect(summary).toContainText(condition);
  }
});

test("soft-deleted entity returned by GET keeps historical relation without a detail link", async ({page}) => {
  const history={...record,record_kind:"change" as const,change:{target_kind:"entity" as const,target_id:entity.id,target_title:entity.title,action:"delete" as const,source:"http" as const,event_id:id(90),path:null,before:null,after:null}};
  const state=await fixture(page,[history]);
  state.rows.entities[0].deleted_at="2026-10-10T00:00:00Z";
  await page.goto(`/records/${history.id}`);
  const section=page.getByRole("dialog").getByRole("region",{name:"연결된 자료 (1개)",exact:true});
  await expect(section.getByText("삭제됨",{exact:true})).toBeVisible();
  await section.getByRole("button",{name:entity.title,exact:true}).click();
  await expect(section).toContainText("기록에 저장된 당시 제목");
  await expect(section.getByRole("link",{name:entity.title+" 상세",exact:true})).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

for (const kind of ["entities","tasks","records"] as const) test(`${kind}: read properties use aligned horizontal key/value rows at every width`, async ({page}) => {
  const state=await fixture(page);
  const key=kind==="entities"?entity.id:kind==="tasks"?task.id:record.id;
  for(const width of [320,360,390,639,640,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await page.goto(`/${kind}/${encodeURIComponent(key)}`);
    const properties=page.locator("dialog.modal:not(.modal-confirm)[open] .detail-section .props").first();
    await expect(properties.locator("dt").first()).toBeVisible();
    const rows=await properties.locator(":scope > div").evaluateAll(nodes=>nodes.map(node=>{
      const key=node.querySelector("dt")!,value=node.querySelector("dd")!;
      const k=key.getBoundingClientRect(),v=value.getBoundingClientRect();
      return {keyX:k.x,keyRight:k.right,valueX:v.x,keyColor:getComputedStyle(key).color,valueColor:getComputedStyle(value).color};
    }));
    for(const row of rows) {
      expect(row.valueX).toBeGreaterThan(row.keyRight);
      expect(Math.abs(row.keyX-rows[0].keyX)).toBeLessThan(1);
      expect(Math.abs(row.valueX-rows[0].valueX)).toBeLessThan(1);
      expect(row.keyColor).not.toBe(row.valueColor);
    }
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(state.writes).toEqual([]);
});

test("selected entity fields stay identical in every layout and expansion without repeating its name", async ({page}, info) => {
  const state=await fixture(page);
  const schema=structuredClone(fixtureSchema);
  schema.schema.properties.prop_1.title="품명";
  schema.schema.properties.prop_2["x-show-in-list"]=true;
  schema.schema.properties.prop_3["x-show-in-list"]=false;
  schema.schema.properties.prop_4={type:"boolean",title:"검사", "x-order":40,"x-show-in-list":true};
  const selected={...entity,properties:{prop_1:"선택 자료",prop_2:0,prop_3:"숨긴 날짜",prop_4:false},display_properties:{prop_1:"선택 자료",prop_2:0,prop_4:false},title:"선택 자료"};
  state.rows.entities.splice(0,state.rows.entities.length,selected);
  await page.route("**/api/entity-types/*/schema{,?**}",route=>route.fulfill({json:schema}));
  await page.goto(`/entities?entity_type_id=${fixtureType.id}`);
  for(const view of ["리스트","카드","테이블"]) {
    await page.getByRole("radio",{name:view,exact:true}).click();
    const row=page.locator(".collection .related-item").first();
    await expect(row.getByRole("button",{name:selected.title,exact:true})).toBeVisible();
    if(view !== "테이블")await expect(row.getByText("품명",{exact:true})).toBeVisible();
    await expect(row.getByText("0",{exact:true})).toBeVisible();
    await expect(row.getByText("거짓",{exact:true})).toBeVisible();
    await row.getByRole("button",{name:selected.title,exact:true}).click();
    await expect(row.getByRole("link",{name:`${selected.title} 상세`,exact:true})).toBeVisible();
    await expect(row.getByText("숨긴 날짜",{exact:true})).toHaveCount(0);
    await expect(row.getByText(selected.title,{exact:true})).toHaveCount(1);
    await expect(row.getByText("0",{exact:true})).toHaveCount(1);
    await page.screenshot({path:info.outputPath(`selected-${view}.png`),fullPage:true});
    await row.getByRole("button",{name:selected.title,exact:true}).click();
  }
  await page.goto(`/tasks/${task.id}`);
  const related=page.getByRole("region",{name:"연결된 자료 (1개)",exact:true});
  await related.getByRole("button",{name:entity.title,exact:true}).click();
  await expect(related.getByText("품명",{exact:true})).toBeVisible();
  await expect(related.getByText("숨긴 날짜",{exact:true})).toHaveCount(0);
  await expect(related.getByText("0",{exact:true})).toBeVisible();
  await expect(related.getByText("거짓",{exact:true})).toBeVisible();
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("card title keys align with the first line of short and wrapped values", async ({ page }, info) => {
  const state = await fixture(page);
  const short = makeEntity(1, { prop_1: "짧은 이름" });
  const long = makeEntity(6, { prop_1: "첫 줄부터 키와 나란히 읽는 아주 긴 상품 이름 ".repeat(4) });
  state.rows.entities.splice(0, state.rows.entities.length, short, long);
  for (const width of [320, 640]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`/entities?entity_type_id=${fixtureType.id}&view=cards`);
    await page.getByRole("radio", { name: "카드", exact: true }).click();
    for (const item of [short, long]) {
      const title = page.getByRole("button", { name: item.title, exact: true });
      const row = page.locator(".related-item").filter({ has: title });
      await expect(title).toBeVisible();
      const text = await row.evaluate(node => {
        const key = node.querySelector("dt")!;
        const value = node.querySelector(".related-item-text")!;
        const first = (el: Element) => {
          const range = document.createRange();
          range.setStart(el.firstChild!, 0);
          range.setEnd(el.firstChild!, 1);
          return range.getBoundingClientRect();
        };
        return { keyTop: first(key).y, valueTop: first(value).y };
      });
      expect(Math.abs(text.keyTop - text.valueTop)).toBeLessThan(3);
      expect((await title.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: info.outputPath(`title-axis-${width}.png`), fullPage: true });
  }
  expect(state.writes).toEqual([]);
});
