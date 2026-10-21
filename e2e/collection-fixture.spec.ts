import { disclosureContent } from "./table-actions.ts";
import type { RecordResult } from "../supabase/functions/_shared/contracts/record.ts";
import { fixtureWorkspacePath } from "./support/workspace-scope.ts";
import { openMainNavigation } from "./ui-actions.ts";
// Actual App and routing; remote Auth/API are isolated, with no DB or real-account writes.
import { fixtureType, fixtureSchema, entityKey } from "./support/workspace-data.ts";
import { expect, test, type Page } from "@playwright/test";
import {id,stamp,identity as base,entity as makeEntity,task as makeTask,record as makeRecord} from "./support/workspace-data.ts";
import {installWorkspaceApi} from "./support/workspace-api.ts";
import {closeDetail} from "./ui-actions.ts";
const task={...makeTask(),title:"다음 상담 준비",body:"필요한 자료를 준비합니다.",due_on:"2026-10-12",entity_ids:[entityKey(1)],entity_context:[{id:entityKey(1),title:"김민수",type:fixtureType,schema_version:1,source:"selection" as const,captured_at:stamp}]};
const record={...makeRecord(),body:"상담 내용을 정리하고 다음 방문 일정을 확인했습니다.",task_id:id(2)};
const entity={...makeEntity(1, {prop_1:"김민수",prop_3:"2026-10-08"}),tasks:{count:1,items:[task]},records:{count:0,items:[]}};
const user = { id: id(100), aud: "authenticated", email: "fixture@example.test", app_metadata: {}, user_metadata: { workspace_timezone: "Asia/Seoul" } };

async function fixture(page: Page, records: RecordResult[] = [record]) {
  const state=await installWorkspaceApi(page,"http://127.0.0.1:55587",structuredClone({entities:[entity],tasks:[task],records,tags:[]}),{pageSize:20});
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

function addEntityRecord(state: Awaited<ReturnType<typeof fixture>>) {
  const own = { ...makeRecord(34), body: record.body, entity_id: entity.id, task_id: null, record_kind: "change" as const };
  state.rows.records.push(own);
  state.rows.entities[0].records = { count: 1, items: [own] };
}

for (const [kind, label, title] of [["entities", "전체 자료", entity.title], ["tasks", "할 일", task.title], ["records", "기록", record.body]] as const) test(`${kind}: views keep filters, list reads and disclosure/detail return`, async ({ page }) => {
  const state = await fixture(page);
  await page.goto(fixtureWorkspacePath(`/${kind}`));
  const list = page.getByRole("region", { name: `${label} 목록`, exact: true });
  const modes = list.getByRole("radiogroup", { name: `${label} 보기 방식` });
  await expect(list.getByRole("heading", { name: `${label} (1개)`, exact: true })).toBeVisible();
  const readCount = state.reads.filter(url => new URL(url).pathname === `/api/${kind}`).length;
  for (const mode of ["카드", "테이블"]) {
    await modes.getByRole("radio", { name: mode, exact: true }).click();
    await expect(modes.getByRole("radio", { name: mode, exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(list.getByRole("button", { name: title, exact: true })).toBeVisible();
    if (kind === "tasks") {
      const toggle = list.getByRole("button", { name: title, exact: true });
      await expect(list.locator('[data-slot="badge"]')).toHaveCount(1);
      await expect(list.locator('[data-slot="badge"]')).toBeVisible();
      await toggle.click();
      await expect(list.getByText(task.body, { exact: true })).toBeVisible();
      await expect(list.locator('[data-slot="badge"]')).toHaveCount(1);
      await expect(list.locator('[data-slot="collapsible-content"] [data-slot="badge"]')).toHaveCount(0);
      await toggle.click();
      await expect(list.locator('[data-slot="badge"]')).toHaveCount(1);
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
  const invalidMarkup: string[] = [];
  page.on("console", message => { if (message.type() === "error" && /cannot (be a child|contain)|In HTML/.test(message.text())) invalidMarkup.push(message.text()); });
  const state = await fixture(page);
  addEntityRecord(state);
  await page.goto(fixtureWorkspacePath(`/entities/${entity.id}`));
  const dialog = page.getByRole("dialog"), tasks = dialog.getByRole("region", { name: "할 일 (1개)" }), records = dialog.getByRole("region", { name: "기록 (1개)" });
  await tasks.getByRole("radio", { name: "카드", exact: true }).click();
  await records.getByRole("radio", { name: "테이블", exact: true }).click();
  await tasks.getByRole("button", { name: task.title, exact: true }).click();
  await tasks.getByRole("link", { name: `${task.title} 상세`, exact: true }).click();
  await closeDetail(page, task.title);
  await expect(tasks.getByRole("radio", { name: "카드", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(records.getByRole("radio", { name: "테이블", exact: true })).toHaveAttribute("aria-checked", "true");
  await page.goto(fixtureWorkspacePath(`/records/${record.id}`));
  await expect(dialog.getByRole("radiogroup", { name: "연결된 자료 보기 방식" })).toHaveCount(0);
  await expect(dialog.getByRole("region", { name: "자료 (1개)", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("radiogroup", { name: "할 일 보기 방식" })).toBeVisible();
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
  expect(invalidMarkup).toEqual([]);
});

test("empty and failed lists keep truthful counts and retry in every view", async ({ page }) => {
  const state = await fixture(page);
  state.rows.records.length = 0;
  const clearFailure = state.failRead({ kind: "records", page: 1 }, { once: false });
  await page.goto(fixtureWorkspacePath("/records"));
  await expect(page.getByRole("alert")).toContainText("기록을 불러오지 못했습니다");
  await expect(page.getByRole("region", { name: / 목록$/ }).getByRole("heading", { level: 2 })).toHaveText("기록");
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
  await page.goto(fixtureWorkspacePath("/records?view=calendar"));
  await expect(page.getByRole("heading", { name: "기록 (20개+)" })).toBeVisible();
  const day = page.getByRole("button", { name: "2026-10-08, 불러온 기록 1개", exact: true });
  await expect(day).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByText("불러온 기록만 표시합니다.", { exact: false })).toBeVisible();
  await day.press("ArrowLeft"); await expect(page.getByRole("button", { name: "2026-10-07, 불러온 기록 0개", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "2026-10-01, 불러온 기록 19개", exact: true }).click();
  await page.getByRole("button", { name: "2026-10-01, 불러온 기록 19개", exact: true }).press("ArrowLeft");
  await expect(page.getByText("2026년 9월", {exact:true})).toBeVisible();
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
  await page.getByRole("radio", { name: "테이블", exact: true }).click();
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
      await page.goto(fixtureWorkspacePath(`/${kind}?view=${view}`)); await expect(page.getByRole("region", { name: / 목록$/ }).getByRole("heading", { level: 2 })).toContainText("1개");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${await page.evaluate(() => innerWidth)}px ${await page.evaluate(() => [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(el => `${el.className}:${Math.round(el.getBoundingClientRect().left)}-${Math.round(el.getBoundingClientRect().right)}`).join(", "))}`).toBe(true);
      if (view === "calendar") {
        const target = await page.getByRole("button", { name: /^\d{4}-\d{2}-\d{2}, 불러온 기록/ }).first().boundingBox();
        expect(target!.width).toBeGreaterThanOrEqual(44); expect(target!.height).toBeGreaterThanOrEqual(44);
      }
      if (view === "table") for (const cell of await page.locator('[data-slot="table-cell"][class*="tabular-nums"]').all()) {
        const reflowed = await cell.evaluate(el => getComputedStyle(el.parentElement!).display === "grid");
        expect(await cell.evaluate(el => getComputedStyle(el).textAlign)).toBe(reflowed ? "left" : "right");
        expect(await cell.evaluate(el => getComputedStyle(el).fontVariantNumeric)).toBe("tabular-nums");
      }
      await page.screenshot({ path: info.outputPath(`${kind}-${view}-${width}.png`) });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto(fixtureWorkspacePath("/tasks?view=table"));
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${await page.evaluate(() => innerWidth)}px ${await page.evaluate(() => [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(el => `${el.className}:${Math.round(el.getBoundingClientRect().left)}-${Math.round(el.getBoundingClientRect().right)}`).join(", "))}`).toBe(true);
  const modes = page.getByRole("radiogroup", { name: "할 일 보기 방식" });
  await modes.getByRole("radio", { name: "테이블" }).press("Home");
  await expect(modes.getByRole("radio", { name: "테이블" })).toBeFocused();
  const style = await modes.getByRole("radio", { name: "테이블" }).evaluate(el => { const r = el.getBoundingClientRect(); return { width: r.width, height: r.height }; });
  expect(style.width).toBeGreaterThanOrEqual(44); expect(style.height).toBeGreaterThanOrEqual(44);
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

test("table rows and headers share the same columns across wrapper types and viewports", async ({ page }) => {
  const rows = [record, { ...record, ...base(4), body: "짧은 기록" }, { ...record, ...base(5), body: "아주 긴 한국어 기록을 제목처럼 표시할 때에도 날짜와 종류의 열은 흔들리지 않아야 합니다." }];
  const state = await fixture(page, rows);
  addEntityRecord(state);
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) for (const kind of ["entities", "tasks", "records"]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(fixtureWorkspacePath(`/${kind}?view=table`));
    const table = page.getByRole("table").first();
    await expect(table.getByRole("columnheader").first()).toHaveCount(1);
    const geometry = await table.evaluate(table => {
      const box = (el: Element) => { const rect = el.getBoundingClientRect(); return { left: rect.left, top: rect.top, bottom: rect.bottom, width: rect.width }; };
      const headers = [...table.querySelectorAll<HTMLTableCellElement>("thead th")];
      return { columns: headers.map(box), rows: [...table.querySelectorAll("tbody tr")].filter(row => !row.querySelector("td[colspan]")).map(row => ({ reflowed: getComputedStyle(row).display === "grid", cells: [...row.children].map(box), labels: [...row.querySelectorAll<HTMLTableCellElement>(":scope > td")].slice(1).map((cell, index) => ({ actual: cell.headers, expected: headers[index + 1].id })) })) };
    });
    expect(geometry.rows.length).toBeGreaterThan(0);
    for (const row of geometry.rows) {
      if (width <= 390) expect(row.reflowed).toBe(true);
      if (width === 1440) expect(row.reflowed).toBe(false);
      expect(row.cells).toHaveLength(geometry.columns.length);
      for (const relation of row.labels) expect(relation.actual).toBe(relation.expected);
      if (!row.reflowed) {
        for (const [index, cell] of row.cells.entries()) {
          expect(Math.abs(cell.left - geometry.columns[index].left)).toBeLessThan(1);
          expect(Math.abs(cell.width - geometry.columns[index].width)).toBeLessThan(1);
        }
      } else {
        const title = row.cells[1];
        for (const [index, cell] of row.cells.slice(2).entries()) {
          expect(Math.abs(cell.left - title.left)).toBeLessThan(1);
          expect(Math.abs(cell.width - title.width)).toBeLessThan(1);
          expect(cell.top).toBeGreaterThanOrEqual(row.cells[index + 1].bottom);
        }
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${await page.evaluate(() => innerWidth)}px ${await page.evaluate(() => [...document.querySelectorAll("body *")].filter(el => el.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(el => `${el.className}:${Math.round(el.getBoundingClientRect().left)}-${Math.round(el.getBoundingClientRect().right)}`).join(", "))}`).toBe(true);
  }
  await page.goto(fixtureWorkspacePath(`/entities/${entity.id}`));
  const section = page.getByRole("dialog").getByRole("region", { name: "기록 (1개)", exact: true });
  await section.getByRole("radio", { name: "테이블", exact: true }).click();
  const table = section.getByRole("table");
  await expect(table.getByRole("columnheader")).toHaveCount(2);
  expect(await table.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});

test("calendar reflows at enlarged text without shrinking day targets", async ({ page }, info) => {
  const state = await fixture(page);
  for (const width of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await page.goto(fixtureWorkspacePath("/records?view=calendar"));
    await expect(page.getByRole("button", { name: /^\d{4}-\d{2}-\d{2}, 불러온 기록/ }).first()).toBeVisible();
    await page.evaluate(() => document.documentElement.style.fontSize = "200%");
    const layout = await page.getByRole("region", { name: "기록 달력", exact: true }).evaluate(root => {
      const month = root.querySelector(':scope > [data-slot="card"]')!;
      const selected = root.querySelector(':scope > section[aria-label]')!;
      const day = [...root.querySelectorAll("button")].find(button => /^\d{4}-\d{2}-\d{2}, 불러온 기록/.test(button.getAttribute("aria-label") ?? ""))!;
      const grid = getComputedStyle(root);
      const main = root.closest("main");
      return {
        month: month.getBoundingClientRect().toJSON(),
        selected: selected.getBoundingClientRect().toJSON(),
        day: day.getBoundingClientRect().toJSON(),
        grid: { columns: grid.gridTemplateColumns, rows: grid.gridTemplateRows, gap: grid.gap, alignItems: grid.alignItems },
        font: { root: getComputedStyle(document.documentElement).fontSize, calendar: grid.fontSize },
        scroll: { windowX: scrollX, windowY: scrollY, mainTop: main?.scrollTop, mainLeft: main?.scrollLeft },
        viewport: { width: innerWidth, height: innerHeight, visualWidth: visualViewport?.width, visualHeight: visualViewport?.height, scale: visualViewport?.scale },
        documentWidth: document.documentElement.scrollWidth,
      };
    });
    await info.attach(`calendar-200-${width}-layout`, { contentType: "application/json", body: JSON.stringify(layout, null, 2) });
    await page.screenshot({ path: info.outputPath(`calendar-200-${width}.png`) });
    expect(layout.documentWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.viewport.width);
    expect(layout.day.width).toBeGreaterThanOrEqual(44); expect(layout.day.height).toBeGreaterThanOrEqual(44);
    expect(layout.selected.y, JSON.stringify(layout)).toBeGreaterThanOrEqual(layout.month.y + layout.month.height);
    await page.getByRole("region", { name: /^\d{4}-\d{2}-\d{2} 기록$/ }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`calendar-200-${width}-boundary.png`) });
  }
  expect(state.errors).toEqual([]); expect(state.writes).toEqual([]);
});


test("restored preview waits for its read and settles even when tag lookup fails", async ({ page }) => {
  const row = { ...record, body: "태그 조회 실패에도 돌아올 기록", tag_ids: [id(11)] };
  const state = await fixture(page, [row]);
  state.failRead({ kind: "tags", page: 1 }, { once: false });
  const held = state.holdRead({ kind: "records", id: row.id });
  await page.goto(fixtureWorkspacePath(`/records?open=${encodeURIComponent(`/records/${row.id}`)}&scroll=0#activity-records-${row.id}`));
  expect(new URL(page.url()).pathname).toBe(fixtureWorkspacePath("/records"));
  expect(new URL(page.url()).searchParams.get("open")).toBe(`/records/${row.id}`);
  await held.started;
  const title = page.getByRole("link", { name: `${row.body} 상세`, exact: true });
  await expect(title).not.toBeFocused();
  held.release(); await held.finished;
  await expect(title).toBeFocused();
  await expect(page.getByRole("button", { name: row.body, exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("태그 이름 조회 실패", { exact: true })).toBeVisible();
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});

for (const action of ["delete", "create"] as const) test(`unavailable change target ${action} keeps the immutable task disclosure without adopting entity links`, async ({page}) => {
  const history={...record,record_kind:"change" as const,change:{target_kind:"task" as const,target_id:task.id,target_title:task.title,action,source:"http" as const,event_id:id(88),path:null,before:null,after:null}};
  const state=await fixture(page,[history]);
  state.rows.tasks.length=0;
  await page.goto(fixtureWorkspacePath(`/records/${history.id}`));
  const detail=page.getByRole("dialog");
  const tasks=detail.getByRole("region",{name:"할 일 (1개)"});
  const badge=action==="delete"?"삭제됨":"조회 불가";
  await expect(tasks.getByText(badge,{exact:true})).toBeVisible();
  await expect(detail.getByRole("region",{name:"자료 (1개)"})).toHaveCount(0);
  await expect(detail.getByRole("region",{name:"연결된 자료 (1개)"})).toHaveCount(0);
  for(const view of ["테이블","카드"]){
    await tasks.getByRole("radio",{name:view,exact:true}).click();
    await expect(tasks.getByText(badge,{exact:true})).toBeVisible();
    const toggle=tasks.getByRole("button",{name:task.title,exact:true});
    await expect(toggle).toHaveAttribute("aria-expanded","false");
    await expect(tasks.getByText(/기록에 저장된 당시 제목/)).toBeHidden();
    await toggle.click();
    await expect(tasks.getByText(/기록에 저장된 당시 제목/)).toContainText("기록에 저장된 당시 제목");
    await expect(tasks.getByRole("link",{name:`${task.title} 상세`,exact:true})).toHaveCount(0);
    await toggle.click();
    await expect(tasks.getByText(/기록에 저장된 당시 제목/)).toBeHidden();
  }
  expect(state.writes).toEqual([]);
});

test("responsive workspace brand and list heading remain reachable at every width", async ({ page }) => {
  await fixture(page); await page.goto(fixtureWorkspacePath("/entities"));
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const title = page.getByRole("heading", { name: "전체 자료", level: 1, exact: true });
    const brand = page.getByRole("banner").getByText("Workspace", { exact: true });
    await expect(title).toBeVisible(); await expect(brand).toBeVisible();
    const titleBox = (await title.boundingBox())!, banner = (await page.getByRole("banner").boundingBox())!;
    expect(titleBox.y).toBeGreaterThanOrEqual(banner.y + banner.height - 1);
    await openMainNavigation(page);
    const navigation = page.getByRole("navigation", { name: "주 메뉴", exact: true });
    await expect(navigation.getByRole("link", { name: "Workspace", exact: true })).toHaveAttribute("href", "/workspaces");
    await expect(navigation.getByRole("link", { name: "할 일", exact: true })).toBeVisible();
    const close = page.getByRole("button", { name: "메뉴 닫기", exact: true }); if (await close.isVisible()) await close.click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width === 390 || width === 1440) await page.screenshot({ path: test.info().outputPath(`header-${width}.png`) });
  }
});

test("closed filters show conditions below search and opening hides the summary", async ({ page }) => {
  await fixture(page);
  for (const [path, condition] of [["/entities?entity_type_id=00000000-0000-4000-8000-000000000900&property_filters=%5B%7B%22key%22%3A%22prop_4%22%2C%22operator%22%3A%22eq%22%2C%22value%22%3A%22a%22%7D%5D", "분류: a"], ["/tasks?status=done", "상태: 완료"], ["/records?record_kind=change", "종류: 변경 기록"]]) {
    await page.goto(fixtureWorkspacePath(path));
    const summary = page.getByLabel("적용된 필터", {exact:true});
    await expect(summary).toContainText(condition);
    await page.getByRole("button", {name:/필터 열기/}).click();
    await expect(summary).toHaveCount(0);
    await page.getByRole("button", {name:/필터 닫기/}).click();
    await expect(summary).toContainText(condition);
  }
});

test("soft-deleted entity returned by GET keeps historical relation without a detail link", async ({page}) => {
  const history={...record,entity_id:entity.id,task_id:null,record_kind:"change" as const,change:{target_kind:"entity" as const,target_id:entity.id,target_title:entity.title,action:"delete" as const,source:"http" as const,event_id:id(90),path:null,before:null,after:null}};
  const state=await fixture(page,[history]);
  state.rows.entities[0].deleted_at="2026-10-10T00:00:00Z";
  await page.goto(fixtureWorkspacePath(`/records/${history.id}`));
  const section=page.getByRole("dialog").getByRole("region",{name:"자료 (1개)",exact:true});
  await expect(section.getByText("삭제됨",{exact:true})).toBeVisible();
  await section.getByRole("button",{name:entity.title,exact:true}).click();
  await expect(section).toContainText("기록에 저장된 당시 제목");
  await expect(section.getByRole("link",{name:entity.title+" 상세",exact:true})).toHaveCount(0);
  expect(state.writes).toEqual([]);
});

for (const kind of ["entities","tasks","records"] as const) test(`${kind}: read properties retain readable labels and values at every width`, async ({page}, info) => {
  const state=await fixture(page);
  const key=kind==="entities"?entity.id:kind==="tasks"?task.id:record.id;
  for(const width of [320,360,390,639,640,768,1024,1440]) {
    await page.setViewportSize({width,height:900});
    await page.goto(fixtureWorkspacePath(`/${kind}/${encodeURIComponent(key)}`));
    const surface = page.getByRole("dialog").filter({ visible: true });
    const properties = surface;
    const expectedKeys = kind === "entities"
      ? ["제목", "번호 출처", "자료 번호", "수량", "날짜", "분류", "태그"]
      : kind === "tasks"
      ? ["제목", "본문", "상태", "종류", "기한", "태그"]
      : ["본문", "종류", "수행 시각", "태그"];
    for (const label of expectedKeys) {
      const key = properties.getByRole("term").and(properties.getByText(label, { exact: true })).filter({ visible: true }).first();
      await expect(key).toBeVisible();
      const value = key.locator("..").getByRole("definition").first(); await expect(value).toBeVisible();
      if (kind === "entities" && label === "수량") await expect(value).toHaveText("0");
      const { k, v } = await key.evaluate(element => {
        const definition = element.parentElement?.querySelector("dd");
        if (!definition) throw new Error("A readable property must retain its definition beside its term");
        return { k: element.getBoundingClientRect().toJSON(), v: definition.getBoundingClientRect().toJSON() };
      });
      expect(v.y >= k.y + k.height - 1 || v.x >= k.x + k.width - 1).toBe(true);
      expect(v.x).toBeGreaterThanOrEqual(0); expect(v.x + v.width).toBeLessThanOrEqual(width + 1);
      expect(await key.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(12);
    }
    if ([320, 639, 640, 1440].includes(width)) await page.screenshot({ path: info.outputPath(`detail-properties-${kind}-${width}.png`) });
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  }
  expect(state.writes).toEqual([]);
});

test("entity titles stay consistent and all expanded attributes retain their keys", async ({page}, info) => {
  const state=await fixture(page);
  const schema=structuredClone(fixtureSchema);
  schema.schema.properties.prop_1.title="품명";


  schema.schema.properties.prop_4={type:"boolean",title:"검사", "x-order":40};
  const selected={...entity,properties:{prop_1:"선택 자료",prop_2:0,prop_3:"숨긴 날짜",prop_4:false},title:"선택 자료"};
  state.rows.entities.splice(0,state.rows.entities.length,selected);
  Object.assign(state.rows.tasks[0], {
    entity_ids: [selected.id],
    entity_context: [{ id: selected.id, title: selected.title, type: selected.type,
      schema_version: selected.schema_version, source: "selection", captured_at: stamp }],
  });
  await page.route("**/api/entity-types/*/schema{,?**}",route=>route.fulfill({json:schema}));
  await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}`));
  for(const view of ["테이블","카드"]) {
    await page.getByRole("radio",{name:view,exact:true}).click();
    const collection = page.getByRole("region", { name: / 목록$/ });
    const row = view === "테이블"
      ? collection.getByRole("row").filter({ has: page.getByRole("button", { name: selected.title, exact: true }) })
      : collection.getByRole("listitem").first();
    await expect(row).toHaveCount(1);
    await expect(row.getByRole("button",{name:selected.title,exact:true})).toBeVisible();
    if(view !== "테이블")await expect(row.getByText("제목",{exact:true})).toBeVisible();
    await expect(row.getByText("0",{exact:true})).toHaveCount(0);
    await expect(row.getByText("거짓",{exact:true})).toHaveCount(0);
    const toggle = row.getByRole("button", { name: selected.title, exact: true });
    await toggle.click();
    const panelId = await toggle.getAttribute("aria-controls");
    expect(panelId).toBeTruthy();
    const preview = page.locator(`[id=${JSON.stringify(panelId)}]`);
    await expect(preview).toBeVisible();
    const expanded = view === "테이블" ? row.or(preview) : row;
    await expect(expanded.getByRole("link",{name:`${selected.title} 상세`,exact:true})).toBeVisible();
    await expect(preview.getByText("숨긴 날짜",{exact:true})).toBeVisible();
    await expect(preview.getByRole("term").filter({ hasText: /^품명$/ }).locator("..").getByRole("definition")).toHaveText(selected.title);
    await expect(expanded.getByText("0",{exact:true})).toHaveCount(1);
    await page.screenshot({path:info.outputPath(`selected-${view}.png`),fullPage:true});
    await row.getByRole("button",{name:selected.title,exact:true}).click();
  }
  await page.goto(fixtureWorkspacePath(`/tasks/${task.id}`));
  const related=page.getByRole("region",{name:"연결된 자료 (1개)",exact:true});
  for (const view of ["테이블", "카드"]) {
    await related.getByRole("radio", { name: view, exact: true }).click();
    const toggle = related.getByRole("button", { name: selected.title, exact: true });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const preview = await disclosureContent(page, toggle);
    await expect(preview.getByRole("term").filter({ hasText: /^품명$/ }).locator("..").getByRole("definition")).toHaveText(selected.title);
    await expect(preview.getByText("숨긴 날짜", { exact: true })).toBeVisible();
    await expect(related.getByText("0", { exact: true })).toBeVisible();
    await expect(related.getByText("0", { exact: true })).toHaveCount(1);
    await expect(related.getByText("거짓", { exact: true })).toBeVisible();
    await expect(related.getByText("거짓", { exact: true })).toHaveCount(1);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
  }
  expect(state.writes).toEqual([]);
  expect(state.errors).toEqual([]);
});

test("card title labels and wrapped values remain ordered and readable", async ({ page }, info) => {
  const state = await fixture(page);
  const short = makeEntity(1, { prop_1: "짧은 이름" });
  const long = makeEntity(6, { prop_1: "첫 줄부터 키와 나란히 읽는 아주 긴 상품 이름 ".repeat(4) });
  state.rows.entities.splice(0, state.rows.entities.length, short, long);
  for (const width of [320, 640]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}&view=cards`));
    await page.getByRole("radio", { name: "카드", exact: true }).click();
    for (const item of [short, long]) {
      const title = page.getByRole("link", { name: `${item.title} 상세`, exact: true });
      const row = page.getByRole("listitem").filter({ has: title });
      await expect(title).toBeVisible();
      const key = row.getByRole("term").first();
      await expect(key).toBeVisible();
      const keyBox = (await key.boundingBox())!, titleBox = (await title.boundingBox())!;
      const horizontal = await key.evaluate(el => {
        const fields = el.closest("dl")!;
        return fields.getBoundingClientRect().width >= 16 * parseFloat(getComputedStyle(document.documentElement).fontSize);
      });
      if (horizontal) {
        expect(keyBox.x + keyBox.width).toBeLessThanOrEqual(titleBox.x);
      } else {
        expect(keyBox.y + keyBox.height).toBeLessThanOrEqual(titleBox.y + 1);
      }
      expect(titleBox.x).toBeGreaterThanOrEqual(0);
      expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(width);
      expect((await title.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await page.screenshot({ path: info.outputPath(`title-axis-${width}.png`), fullPage: true });
  }
  expect(state.writes).toEqual([]);
});


test("calendar loads only when selected and retains keyboard control after loading", async ({ page }, info) => {
  const state = await fixture(page);
  let requests = 0;
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/src/features/activity/RecordCalendar.tsx", async route => {
    requests++;
    await held;
    await route.continue();
  });
  try {
    await page.goto(fixtureWorkspacePath("/records?calendar_month=2026-10&calendar_day=2026-10-08"), { waitUntil: "commit" });
    await expect(page.getByRole("heading", { name: "기록", level: 1, exact: true })).toBeVisible({ timeout: 5000 });
    expect(requests).toBe(0);
    const toggle = page.getByRole("radio", { name: "캘린더", exact: true });
    await toggle.focus();
    await toggle.press("Space");
    await expect(page.getByRole("status")).toContainText("기록 달력 화면을 불러오는 중");
    await expect(toggle).toBeFocused();
    expect(requests).toBe(1);
    release();
    const calendar = page.getByRole("region", { name: "기록 달력", exact: true });
    await expect(calendar).toBeVisible();
    const selected = calendar.getByRole("button", { name: /^2026-10-08, 불러온 기록/ });
    await selected.focus();
    await selected.press("End");
    await expect(calendar.getByRole("button", { name: /^2026-10-10, 불러온 기록/ })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(calendar.getByRole("button", { name: /^2026-10-04, 불러온 기록/ })).toBeFocused();
    await page.screenshot({ path: info.outputPath("deferred-calendar-keyboard.png") });
    expect(state.writes).toEqual([]);
    expect(state.errors).toEqual([]);
  } finally { release(); }
});


test("business tables: legacy list URLs keep context and disclosure columns stay stable", async ({ page }) => {
  const state = await fixture(page);
  await page.goto(fixtureWorkspacePath("/entities?view=list&keyword=김민수"));
  const collection = page.getByRole("region", { name: "전체 자료 목록", exact: true });
  await expect(collection.getByRole("radio", { name: "테이블", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(collection.getByRole("radio", { name: "리스트", exact: true })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get("keyword")).toBe("김민수");
  const table = collection.getByRole("table", { name: "전체 자료 목록", exact: true });
  const title = table.getByRole("link", { name: `${entity.title} 상세`, exact: true });
  const row = table.getByRole("row").filter({ has: page.getByRole("button", { name: entity.title, exact: true }) });
  const toggle = row.getByRole("button", { name: entity.title, exact: true });
  const before = await row.evaluate(el => [...el.querySelectorAll("td")].map(cell => {const r=cell.getBoundingClientRect();return {x:r.x,width:r.width};}));
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(table.getByRole("link", { name: entity.title + " 상세", exact: true })).toBeVisible();
  const after = await row.evaluate(el => [...el.querySelectorAll("td")].map(cell => {const r=cell.getBoundingClientRect();return {x:r.x,width:r.width};}));
  expect(after).toEqual(before);
  const arrowCell = await toggle.evaluate(el => el.closest("td")?.cellIndex);
  const titleCell = await title.evaluate(el => el.closest("td")?.cellIndex);
  expect(arrowCell).toBe(0);expect(titleCell).toBe(1);
  await toggle.press("Enter");await expect(toggle).toBeFocused();
  expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});


test("business tables: expanded attribute values reflow without horizontal scrolling at width and scale changes", async ({ page }, info) => {
  const state = await fixture(page);
  const schema = structuredClone(fixtureSchema);

  schema.schema.properties.prop_5 = { type: "boolean", title: "확인 상태를 나타내는 긴 라벨", "x-order": 50};
  await page.route("**/api/entity-types/*/schema**", route => route.fulfill({ json: schema }));
  Object.assign(state.rows.entities[0].properties, { prop_2: 240000, prop_3: "2026-10-08", prop_5: false });
  await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}`));
  const table = page.getByRole("table", { name: "검사 자료 목록", exact: true });
  const title = table.getByRole("link", { name: `${entity.title} 상세`, exact: true });
  const row = table.getByRole("row").filter({ has: page.getByRole("button", { name: entity.title, exact: true }) });
  const toggle = row.getByRole("button", { name: entity.title, exact: true });
  await toggle.click();
  const preview = await disclosureContent(page, toggle);
  await expect(preview.getByText("240,000", { exact: true })).toBeVisible();
  await expect(preview.getByText("거짓", { exact: true })).toBeVisible();
  await expect(preview.getByText("2026-10-08", { exact: true })).toBeVisible();
  await toggle.focus();
  for (const [width, scale] of [[1440, 100], [390, 100], [320, 100], [390, 200]]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(scale => document.documentElement.style.fontSize = scale + "%", scale);
    await expect(toggle).toBeFocused();await expect(title).toBeVisible();
    await expect.poll(() => table.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    await expect(preview.getByRole("term").filter({ hasText: /^확인 상태를 나타내는 긴 라벨$/ })).toBeVisible();
    expect(await preview.evaluate(el => [...el.querySelectorAll("dt,dd")].every(cell => {
      const box=cell.getBoundingClientRect(); return box.x >= 0 && box.right <= innerWidth + 1;
    }))).toBe(true);
    await table.scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`business-values-${width}-font${scale}.png`) });
  }
  expect(state.reads.filter(url => new URL(url).pathname === "/api/entities/" + encodeURIComponent(entity.id))).toHaveLength(1);
  expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});


test("business tables: search results retain snippets and return context at narrow widths", async ({ page }) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(fixtureWorkspacePath("/search?q=상담&kind=task&mode=keyword"));
  const table = page.getByRole("table", { name: "검색 결과", exact: true });
  const link = table.getByRole("link", { name: task.title, exact: true });
  await expect(link).toBeVisible();await expect(table.getByText(task.body, { exact: true })).toBeVisible();
  await expect(table.getByText("키워드", { exact: true })).toBeVisible();
  await expect.poll(() => table.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await link.click();await expect(page.getByRole("dialog")).toBeVisible();
  await closeDetail(page, task.title);
  await expect(link).toBeFocused();
  expect(new URL(page.url()).searchParams.get("q")).toBe("상담");
  expect(new URL(page.url()).searchParams.get("kind")).toBe("task");
  expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});


test("business tables: many expanded attributes keep dates readable and never omit values", async ({ page }) => {
  const state = await fixture(page);
  const schema = structuredClone(fixtureSchema);
  const projected: Record<string, string> = { prop_1: entity.title };
  for (let n=2;n<=15;n++) {
    schema.schema.properties[`prop_${n}`] = { type:"string",format:"date",title:`날짜 ${n}`,"x-order":n*10};
    projected[`prop_${n}`] = `2026-10-${String(n).padStart(2,"0")}`;
  }

  state.rows.entities[0].properties = projected;
  await page.route("**/api/entity-types/*/schema**", route=>route.fulfill({json:schema}));
  await page.setViewportSize({width:1440,height:1000});await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}`));
  const row = page.getByRole("row").filter({has:page.getByRole("button",{name:entity.title,exact:true})});
  await expect(row.getByRole("cell")).toHaveCount(2);
  const toggle = row.getByRole("button", {name:entity.title,exact:true});
  await toggle.click();
  const preview = await disclosureContent(page, toggle);
  const date = preview.getByText("2026-10-02",{exact:true});await expect(date).toBeVisible();
  expect(await date.evaluate(el=>{const range=document.createRange();range.selectNodeContents(el);return range.getClientRects().length;})).toBe(1);
  for(let n=2;n<=15;n++)await expect(preview.getByText(projected[`prop_${n}`],{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  expect(state.writes).toEqual([]);expect(state.errors).toEqual([]);
});

for (const width of [390, 1440]) for (const view of ["테이블", "카드"]) for (const [kind, label, title] of [
  ["entities", "전체 자료", entity.title], ["tasks", "할 일", task.title], ["records", "기록", record.body],
] as const) test(`제목 직접 상세 ${kind} ${view} ${width}px: 펼침과 독립·복귀·겹치지 않는 터치 영역`, async ({ page }, info) => {
  await page.setViewportSize({ width, height: 950 });
  const state = await fixture(page);
  await page.goto(fixtureWorkspacePath(`/${kind}`));
  const list = page.getByRole("region", { name: `${label} 목록`, exact: true });
  await list.getByRole("radio", { name: view, exact: true }).click();
  const link = list.getByRole("link", { name: `${title} 상세`, exact: true });
  const arrow = list.getByRole("button", { name: title, exact: true });
  await expect(list.getByRole("radio", { name: view, exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(link).toBeVisible();
  await expect(arrow).toBeVisible();
  await expect(link).toHaveText(title);
  await expect(arrow).toHaveAttribute("aria-expanded", "false");
  const detailReads = () => state.reads.filter(url => new URL(url).pathname === `/api/${kind}/${encodeURIComponent(kind === "entities" ? entity.id : kind === "tasks" ? task.id : record.id)}`).length;
  expect(detailReads()).toBe(0);
  const [a, b] = await Promise.all([arrow.boundingBox(), link.boundingBox()]);
  expect(a).not.toBeNull(); expect(b).not.toBeNull();
  expect(a!.width).toBeGreaterThanOrEqual(44); expect(a!.height).toBeGreaterThanOrEqual(44);
  expect(b!.width).toBeGreaterThanOrEqual(44); expect(b!.height).toBeGreaterThanOrEqual(44);
  expect(a!.x + a!.width <= b!.x || b!.x + b!.width <= a!.x || a!.y + a!.height <= b!.y || b!.y + b!.height <= a!.y).toBe(true);
  await link.click();
  await expect(page.getByRole("button", { name: "편집", exact: true })).toBeVisible();
  await closeDetail(page, title);
  await expect(arrow).toHaveAttribute("aria-expanded", "false");
  await expect(link).toBeFocused();
  await arrow.press("Space");
  await expect(arrow).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(list.getByRole("link", { name: `${title} 상세`, exact: true })).toHaveCount(1);
  await page.screenshot({ path: info.outputPath(`title-${kind}-${view}-${width}.png`), fullPage: true });
  await link.press("Enter");
  await closeDetail(page, title);
  await expect(arrow).toHaveAttribute("aria-expanded", "true");
  await expect(link).toBeFocused();
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});


for (const status of [403, 404]) test(`확인된 접근 불가 ${status}: 접어도 제목 링크를 되살리지 않고 재조회 성공 후 복구`, async ({ page }) => {
  const state = await fixture(page);
  let denied = true;
  await page.route(`**/api/entities/${encodeURIComponent(entity.id)}`, route => denied
    ? route.fulfill({ status, json: { code: status === 404 ? "not_found" : "forbidden", message: "접근할 수 없습니다." } })
    : route.fallback());
  await page.goto(fixtureWorkspacePath("/entities"));
  const list = page.getByRole("region", { name: "전체 자료 목록", exact: true });
  const title = list.getByRole("link", { name: `${entity.title} 상세`, exact: true });
  const arrow = list.getByRole("button", { name: entity.title, exact: true });
  await expect(title).toBeVisible();
  await arrow.click();
  await expect(list.getByText(status === 404 ? "삭제된 대상 또는 접근할 수 없는 대상입니다." : "내용을 불러오지 못했습니다.", { exact: true })).toBeVisible();
  await expect(title).toHaveCount(0);
  await arrow.click();
  await expect(arrow).toHaveAttribute("aria-expanded", "false");
  await expect(title).toHaveCount(0);
  denied = false;
  await arrow.click();
  await expect(title).toBeVisible();
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});


test("320px·200% 관계 카드: 화살표·제목·해제는 겹치지 않고 가로로 넘치지 않는다", async ({ page }, info) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 320, height: 1000 });
  await page.goto(fixtureWorkspacePath(`/entities/${entity.id}`));
  const related = page.getByRole("region", { name: "할 일 (1개)", exact: true });
  await related.getByRole("radio", { name: "카드", exact: true }).click();
  await related.getByRole("button", { name: task.title, exact: true }).click();
  const link = related.getByRole("link", { name: `${task.title} 상세`, exact: true });
  const unlink = related.getByRole("button", { name: `${task.title} 해제`, exact: true });
  await expect(unlink).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
  await expect(link).toBeVisible(); await expect(unlink).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  const [titleBox, actionBox] = await Promise.all([link.boundingBox(), unlink.boundingBox()]);
  expect(titleBox).not.toBeNull(); expect(actionBox).not.toBeNull();
  expect(actionBox!.y).toBeGreaterThanOrEqual(titleBox!.y + titleBox!.height);
  await page.screenshot({ path: info.outputPath("related-card-320-200.png"), fullPage: true });
  expect(state.writes).toEqual([]); expect(state.errors).toEqual([]);
});
