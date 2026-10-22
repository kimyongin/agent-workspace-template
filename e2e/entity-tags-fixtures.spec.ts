import { APP_IDENTIFIER_RULE_ID } from "../supabase/functions/_shared/contracts/entity-issuer.ts";
import { encodeIdentifierValue } from "../supabase/functions/_shared/contracts/entity-identifiers.ts";
import { installWorkspaceApi } from "./support/workspace-api.ts";
import { fixtureWorkspaceId, fixtureWorkspacePath } from "./support/workspace-scope.ts";
import {
  entity as makeEntity,
  task as makeTask,
  record as makeRecord,
  fixtureSchema,
  fixtureType,
} from "./support/workspace-data.ts";
import { settingsResponse } from "./support/preparation-api.ts";
import { executionDialog, openMainNavigation, openDetailEditor, openListEditor } from "./ui-actions.ts";
import { fillChangeMemo } from "./ui-actions.ts";
import { beginTabAction, closeDetail, saveOnce } from "./ui-actions.ts";
import { expect, type Page, test } from "@playwright/test";
const url = "/e2e/fixtures/entity-tags.html";
const tags = ["첫 태그", "다른 태그"].map((name, i) => ({ id: `00000000-0000-4000-8000-00000000000${i}`, name, version: 1, created_at: "2026-10-04T00:00:00Z", updated_at: "2026-10-04T00:00:00Z" }));
const task = { id: "20000000-0000-4000-8000-000000000000", entity_ids: [], entity_context: [], tag_ids: [], kind: "once", title: "App 할 일", body: "본문", due_on: null, recurrence: null, timezone: null, status: "open", completed_at: null, result_record_id: null, pauses: [], version: 1, created_at: tags[0].created_at, updated_at: tags[0].updated_at, occurrence: null, result_record: null };
test.beforeEach(async ({ page, isMobile }) => {
  await installWorkspaceApi(page, "**", { entities: [], tasks: [], records: [], tags: [] });
  // These probes exercise modal surfaces; docked desktop drafts are covered by detail-workspace.spec.ts.
  if(!isMobile) await page.setViewportSize({width:1024,height:720});
  await page.route("**/auth/v1/user", route => route.fulfill({json:{id:"90000000-0000-4000-8000-000000000000",aud:"authenticated",app_metadata:{},user_metadata:{}}}));
  await page.route("**/api/tags**", route => route.fulfill({ json: { items: tags, next_cursor: null } }));
  await page.route(
    "**/api/settings/business{,?**}",
    (route) =>
      route.fulfill({
        json: settingsResponse(route, {
          settings: { record_templates:{} },
          versions: { record_templates:0 },
        }),
      }),
  );
  await page.route("**/api/records/prepare", route => {
    const body=route.request().postDataJSON();
    if (body.intent === "tag-connections") {
      expect(body.action).toBe("update");
      expect(["entity", "task"]).toContain(body.model);
      expect(Object.keys(body.input)).toEqual(["tag_ids"]);
      expect(body.target_id).toBeTruthy();
      expect(body.expected_version).toBeGreaterThan(0);
    } else if (body.model === "entity") {
      expect(body.input).not.toHaveProperty("tag_ids");
    }
    return route.fulfill({json:{change_note:body.change_note??"변경 기록",change_tag_ids:[],missing_tag_ids:[],settings_version:0,prepared_input:body.input??{}}});
  });
});
// Feature-owned capability fixtures: settings authority never implies kind data access.
async function entityCapabilities(page: Page, access: "read" | "write", settings = false, readTypeId?: string) {
  await page.route(`**/api/workspaces/${fixtureWorkspaceId}`, route => route.fulfill({ json: {
    workspace: { id: fixtureWorkspaceId, name: "테스트 공간", deleted_at: null },
    membership_version: 1,
    can_manage: settings,
    grants: [
      { target_kind: "entity_type", target_id: fixtureType.id, access },
      ...(readTypeId ? [{ target_kind: "entity_type", target_id: readTypeId, access: "read" }] : []),
      ...(settings ? [{ target_kind: "settings", target_id: "*", access: "write" }] : []),
    ],
  } }));
}

async function revealNavigation(page: Page) {
  // Intent probes behind an editor modal still exercise the same router blocker.
  if (await page.getByRole("dialog", { name: /^(?!주 메뉴$)/ }).count()) {
    const nav = page.getByRole("navigation", { name: "주 메뉴", exact: true, includeHidden: true });
    if (!await nav.count()) await page.getByRole("button", { name: "주 메뉴 열기", exact: true, includeHidden: true }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(nav).toBeVisible();
  } else await openMainNavigation(page);
}
async function settings(page: Page) {
  const inert = await page.getByRole("dialog").count() > 0;
  await revealNavigation(page);
  const link = page.getByRole("link", { name: "기본 설정", exact: true, includeHidden: inert });
  if (inert) await link.evaluate((el: HTMLAnchorElement) => el.click()); else await link.click();
  const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true });
  await expect(page.getByRole("heading", { name: "기본 설정", exact: true, level: 1 }).or(discard)).toBeVisible();
  if (!await discard.count()) await expect(page.getByRole("dialog", { name: "주 메뉴", exact: true, includeHidden: true })).toHaveCount(0);
}
async function closeMainNavigation(page: Page) {
  // The closing confirmation temporarily aria-hides the still-open navigation Sheet.
  await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true, includeHidden: true })).toHaveCount(0);
  const menu = page.getByRole("dialog", { name: "주 메뉴", exact: true, includeHidden: true });
  if (await menu.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
  }
}
async function settingsCategory(page: Page, name: string) {
  await openMainNavigation(page);
  await page.getByRole("navigation", { name: "주 메뉴", exact: true }).getByRole("link", { name: `${name} 설정`, exact: true }).click();
}
async function tagManagement(page: Page, scope = "entity") {
  await settings(page);
  await settingsCategory(page, "태그");
  await expect(page.getByRole("heading", { name: "태그 설정", exact: true })).toBeVisible();
  if (scope !== "entity") await page.getByRole("radiogroup", {name:"관리 대상",exact:true}).getByRole("radio",{name:scope==="task"?"할 일":"기록",exact:true}).click();
}
test("태그 한 초안 선택 전환과 경로·뒤로가기 폐기 취소", async ({ page }, info) => {
  await page.goto(url + "?before=1"); await page.getByRole("link", { name: "다른 화면" ,includeHidden:true}).evaluate((el:HTMLAnchorElement)=>el.click());
  await page.getByRole("button", { name: "첫 태그 이름 변경" }).click(); await page.getByRole("textbox", { name: /태그 이름/ }).fill("초안");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("tag-editor.png"), fullPage: true });
  // Programmatic route/action probes exercise blocked intents behind a modal surface.
  await page.getByRole("button", { name: "다른 태그 이름 변경" ,includeHidden:true}).evaluate((el:HTMLButtonElement)=>el.click());
  let confirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?" }); await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveValue("초안");
  await page.goBack(); await expect(confirm).toBeVisible(); await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page).toHaveURL(/fixture=other/); await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveValue("초안");
  await page.getByRole("link", { name: "다른 화면" ,includeHidden:true}).evaluate((el:HTMLAnchorElement)=>el.click()); await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "변경 버리기" }).click();
  await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveValue("");
});
test("공통 모달 같은 경로 query 폐기는 순수 닫기만 실행하고 의도한 목적지 유지", async ({ page }) => {
  await page.goto(url);
  // fixture router의 링크로 진입해 같은 컴포넌트 재사용을 검사한다.
  await page.getByRole("link", { name: "모달 회귀" ,includeHidden:true}).evaluate((el:HTMLAnchorElement)=>el.click());
  const form = page.getByRole("dialog", { name: "경로 폐기 회귀" }); await form.getByLabel("회귀 초안").fill("폐기할 내용"); await form.getByRole("link", { name: "같은 모달 화면 이동" }).click();
  const confirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?" }); await confirm.getByRole("button", { name: "취소", exact: true }).click(); await expect(form.getByLabel("회귀 초안")).toHaveValue("폐기할 내용");
  await form.getByRole("link", { name: "같은 모달 화면 이동" }).click(); await confirm.getByRole("button", { name: "변경 버리기" }).click();
  await expect(form).not.toBeVisible(); await expect(page).toHaveURL(/\/modal-guard\?intended=1$/); await expect(page).not.toHaveURL(/ordinary-close/);
});
test("태그 중복 이름 생성/변경은 이름 정정 후 저장하며 expected_version 유지", async ({ page }) => {
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/tags**", route => {
    if (["POST", "PATCH"].includes(route.request().method())) {
      const body = route.request().postDataJSON(); writes.push(body);
      if (body.name === "중복 이름") return route.fulfill({ status: 409, json: { code: "conflict", message: "같은 이름의 태그가 있습니다" } });
      return route.fulfill({ status: 201, json: { ...tags[0], name: body.name } });
    }
    return route.fulfill({ json: { items: tags, next_cursor: null } });
  });
  await page.goto(url);
  for (const action of ["추가", "첫 태그 이름 변경"]) {
    if(action!=="추가")await page.getByRole("button", { name: action, exact: true }).click(); const name = page.getByRole("textbox", { name: /태그 이름/ }); await name.fill("중복 이름"); await saveOnce(page, page, action==="추가"?"추가":"저장");
    await expect(page.getByRole("button", { name: action==="추가"?"추가":"저장", exact: true })).toBeEnabled(); await expect(page.getByText(/취소 후 최신 태그/)).toHaveCount(0);
    await name.fill("정정한 이름"); await saveOnce(page, page, action==="추가"?"추가":"저장"); await expect(page.getByText("태그를 저장했습니다.")).toBeVisible();
  }
  expect(writes[2].expected_version).toBe(1); expect(writes[3].expected_version).toBe(1);
});
test("저장 뒤 재조회가 이전 더 보기 응답을 무시하고 새 경계 cursor 유지", async ({ page }) => {
  const tail = { ...tags[0], id: "40000000-0000-4000-8000-000000000000", name: "끝 태그" }, added = { ...tags[0], id: "50000000-0000-4000-8000-000000000000", name: "새 항목" };
  let created = false, release = () => {}, arrived = () => {}; const started = new Promise<void>(resolve => { arrived = resolve; });
  await page.route("**/api/tags**", async route => {
    if (route.request().method() === "POST") { created = true; await route.fulfill({ status: 201, json: added }); return; }
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (cursor === "old") { arrived(); await new Promise<void>(resolve => { release = resolve; }); await route.fulfill({ json: { items: [tail], next_cursor: null } }).catch(() => {}); }
    else await route.fulfill({ json: cursor === "fresh" ? { items: [tags[1], tail], next_cursor: null } : { items: created ? [added, tags[0]] : tags, next_cursor: created ? "fresh" : "old" } });
  });
  await page.goto(url); await page.getByRole("button", { name: "더 보기", exact: true }).click(); await started;
  await page.getByRole("textbox", { name: /태그 이름/ }).fill("새 항목"); await saveOnce(page, page,"추가"); await expect(page.getByText("태그를 저장했습니다.")).toBeVisible();
  await expect(page.getByRole("button", { name: "더 보기", exact: true })).toBeEnabled(); release();
  await page.getByRole("button", { name: "더 보기", exact: true }).click(); await expect(page.getByRole("button", { name: "다른 태그 이름 변경" })).toBeVisible(); await expect(page.getByRole("button", { name: "끝 태그 이름 변경" })).toBeVisible(); await expect(page.locator("button[id^='tag-']")).toHaveCount(4);
});
test("실제 App에서 태그 dirty 주 탐색·뒤로가기·앞으로가기 취소", async ({ page }) => {
  await page.route("**/api/tasks**", route => route.fulfill({ json: { items: [task], next_cursor: null } }));
  await page.route("**/api/entities**", route => route.fulfill({ json: { items: [], next_cursor: null } }));
  await page.goto("/e2e/fixtures/entity-tags-app.html"); await expect(page.getByRole("heading", { name: "할 일", level: 1, exact: true })).toBeVisible();
  await tagManagement(page);
  await page.getByRole("textbox", { name: /태그 이름/ }).fill("앱 초안");
  await revealNavigation(page);
  await page.getByRole("navigation", { name: "주 메뉴",includeHidden:true }).getByRole("link", { name: "할 일", exact: true,includeHidden:true }).evaluate((el:HTMLAnchorElement)=>el.click());
  const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?" }); await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/tags$/); await closeMainNavigation(page); await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveValue("앱 초안");
  await page.goBack(); await discard.getByRole("button", { name: "취소", exact: true }).click(); await expect(page).toHaveURL(/\/settings\/tags$/);
  // 로그아웃 진입은 설정을 먼저 거친다. 그 이동도 태그 초안을 버리지 않는다.
  await page.getByRole("textbox",{name:/태그 이름/}).focus();await settings(page);
  await discard.getByRole("button", { name: "취소", exact: true }).click(); await expect(page).toHaveURL(/\/settings\/tags$/);
  await expect(page.getByRole("link", { name: "기본 설정", exact: true })).toBeFocused();
  await closeMainNavigation(page);
  expect(await page.evaluate(() => !!localStorage.getItem("sb-127-auth-token"))).toBe(true); await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveValue("앱 초안");
  await page.goBack(); await discard.getByRole("button", { name: "변경 버리기" }).click(); await expect(page).toHaveURL(/\/settings$/);
  await page.goBack(); await expect(page).toHaveURL(/\/tasks$/);
  await beginTabAction(page,"할 일 추가");
  // Keep a real forward entry before editing the URL-aware creation form.
  await expect(page.getByRole("dialog",{name:"할 일 추가",exact:true})).toBeVisible();
  await settings(page);await expect(page).toHaveURL(/\/settings$/);await expect(page.getByRole("heading",{name:"기본 설정",exact:true})).toBeVisible();await page.goBack();
  const form = page.getByRole("dialog", { name: "할 일 추가", exact: true });await form.getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill("새 초안");
  await page.goForward(); await discard.getByRole("button", { name: "취소", exact: true }).click(); await expect(page).toHaveURL(/\/tasks\?create=1$/); await expect(form.getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("새 초안");
});
test("실제 App 공통 모달 생성·직접 편집 성공/취소·저장 중 POP 취소", async ({ page }) => {
  let current = { ...task }, hold = false, release = () => {}, arrived = () => {};
  const started = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const warnings: string[] = [];
  page.on("console", message => { if (/one blocker|Maximum update|unmounted/.test(message.text())) warnings.push(message.text()); });
  await page.route("**/api/entities**",route=>route.fulfill({json:{items:[],next_cursor:null}}));
  await page.route("**/api/tasks**", async route => {
    const request = route.request();
    if (request.method() === "POST") { if (hold) { arrived(); await new Promise<void>(resolve => { release = resolve; }); } current = { ...current, ...request.postDataJSON() }; await route.fulfill({ status: 201, json: current }); }
    else if (request.method() === "PATCH") { current = { ...current, ...request.postDataJSON(), version: current.version + 1 }; await route.fulfill({ json: current }); }
    else await route.fulfill({ json: new URL(request.url()).pathname.endsWith(current.id) ? current : { items: [current], next_cursor: null } });
  });
  await page.goto("/e2e/fixtures/entity-tags-app.html");
  await expect(page.getByRole("heading", { name: "할 일", level: 1, exact: true })).toBeVisible();
  await tagManagement(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/settings$/);
  await revealNavigation(page);
  await revealNavigation(page);
  await page.getByRole("navigation", { name: "주 메뉴" }).getByRole("link", { name: "할 일", exact: true }).click();
  await beginTabAction(page,"할 일 추가");
  let form = page.getByRole("dialog", { name: "할 일 추가", exact: true });
  await form.getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill("생성 결과");
  await form.getByLabel("본문").fill("생성 본문");
  hold = true;
  await saveOnce(page, form, "추가", false);
  await expect(executionDialog(page).getByRole("button", { name: "처리 중…", exact: true })).toBeDisabled();
  await started;
  await page.goBack();
  await expect(page).toHaveURL(/\/tasks\?create=1$/);
  await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?" })).not.toBeVisible();
  release();
  await expect.poll(() => new URL(page.url()).pathname).toBe(fixtureWorkspacePath(`/tasks/${current.id}`));
  await expect(form).not.toBeVisible();
  await closeDetail(page,"생성 결과");
  await openListEditor(page,"생성 결과");
  form = page.getByRole("dialog", { name: "할 일 편집", exact: true });
  await closeDetail(page,"생성 결과");
  await expect(page).toHaveURL(/\/tasks\?/);
  await expect(form).not.toBeVisible();
  await openListEditor(page,"생성 결과");
  await form.getByLabel("본문").fill("직접 편집 성공");
  await fillChangeMemo(page,form,"직접 편집 검증");
  await saveOnce(page, form);
  await expect(form).not.toBeVisible();
  await openDetailEditor(page);
  await expect(form.getByLabel("본문")).toHaveValue("직접 편집 성공");
  await closeDetail(page,"생성 결과");
  expect(warnings).toEqual([]);
  await page.route("**/api/entity-types**", (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith("/entity-types")
        ? {items:[fixtureType],next_cursor:null}
        : new URL(route.request().url()).pathname.endsWith("/schema")
        ? fixtureSchema
        : fixtureType,
    }));
  const entity = {
    ...makeEntity(300, {prop_1:"App 資料"}),
    id: `${fixtureType.id}:${APP_IDENTIFIER_RULE_ID}:30000000-0000-4000-8000-000000000000`,
    identity_label: "앱 · 자동 발급 · 30000000-0000-4000-8000-000000000000",
    properties: { ...makeEntity(300).properties, prop_1: "App 資料", prop_5: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "30000000-0000-4000-8000-000000000000") },
  };
  await page.route("**/api/entities**", route => {

    const path=decodeURIComponent(new URL(route.request().url()).pathname);
    if(path.endsWith("/links"))return route.fulfill({json:{items:[],next_cursor:null}});
    if(route.request().method()==="GET"&&path.includes("/entities/")&&!path.endsWith(entity.id))return route.fulfill({status:404,json:{code:"not_found",message:"없음"}});
    return route.fulfill({json:route.request().method()==="POST"||path.endsWith(entity.id)?entity:{items:[],next_cursor:null}});
  });
  await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}`));
  await beginTabAction(page,"검사 자료 추가");
  const entityForm = page.getByRole("dialog", { name: "검사 자료 추가", exact: true });
  await entityForm.getByLabel("제목").fill(entity.title);
  await saveOnce(page, entityForm);
  await expect(entityForm).not.toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/entities/${encodeURIComponent(entity.id)}`));
  await expect(page.getByRole("heading",{name:entity.title,exact:true})).toBeVisible();
});
test("실제 App 태그 폐기 승인 뒤에만 로그아웃 요청하고 로그인으로 종료", async ({ page }) => {
  let signOuts = 0;
  await page.route("**/api/tasks**", route => route.fulfill({ json: { items: [], next_cursor: null } }));
  await page.route("**/api/entities**", route => route.fulfill({ json: { items: [], next_cursor: null } }));
  await page.route("**/auth/v1/logout**", route => { signOuts++; return route.fulfill({ status: 200, json: {} }); });
  await page.goto("/e2e/fixtures/entity-tags-app.html"); await expect(page.getByRole("heading", { name: "할 일", level: 1, exact: true })).toBeVisible();
  await tagManagement(page); await page.getByRole("textbox", { name: /태그 이름/ }).fill("로그아웃 초안");
  await settings(page);
  await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?" })).toBeVisible(); expect(signOuts).toBe(0);
  await page.getByRole("alertdialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "취소", exact: true }).click();
  await closeMainNavigation(page);
  await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveValue("로그아웃 초안"); expect(signOuts).toBe(0);
  await settings(page); await page.getByRole("alertdialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" }).click();
  await expect(page).toHaveURL(/\/settings$/); expect(signOuts).toBe(0);
  // 새 위치의 로그아웃도 미저장 선택의 취소/승인을 지켜야 한다.
  await page.getByRole("radio", { name: "별", exact: true }).click(); await revealNavigation(page); await openMainNavigation(page); await page.getByRole("link", { name: "로그아웃", exact: true }).click();
  await page.getByRole("alertdialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "취소", exact: true }).click();
  await closeMainNavigation(page);
  await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked(); expect(signOuts).toBe(0);
  await revealNavigation(page); await openMainNavigation(page); await page.getByRole("link", { name: "로그아웃", exact: true }).click();
  await page.getByRole("alertdialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" }).click(); await expect(page).toHaveURL(/\/login$/); expect(signOuts).toBe(1);
  expect(await page.evaluate(() => !!localStorage.getItem("sb-127-auth-token"))).toBe(false); await expect(page.getByRole("navigation", { name: "주 메뉴" })).toHaveCount(0);
});
test("불확정 이름 변경은 같은 요청 키·버전으로 당시 성공 결과를 확인", async ({ page }) => {
  let patches = 0, updated = false; const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/tags**", route => {
    if (route.request().method() === "PATCH") { patches++; bodies.push(route.request().postDataJSON()); updated = true; return patches === 1 ? route.abort() : route.fulfill({headers:{"Idempotency-Replayed":"true"},json:{...tags[0],name:"정정 이름",version:2}}); }
    if (updated && patches === 1) return route.fulfill({ status: 503, json: { code: "internal", message: "조회 장애" } });
    return route.fulfill({ json: { items: tags.map(t => updated && t.id === tags[0].id ? { ...t, name: "정정 이름", version: 2 } : t), next_cursor: null } });
  });
  await page.goto(url); await page.getByRole("button", { name: "첫 태그 이름 변경" }).click(); await page.getByRole("textbox", { name: /태그 이름/ }).fill("정정 이름"); await saveOnce(page, page);
  await page.getByRole("button", { name: "같은 내용 다시 시도" }).click(); await expect(page.getByText("태그를 저장했습니다.")).toBeVisible(); expect(patches).toBe(2); expect(bodies[1]).toEqual(bodies[0]); expect(bodies[0].expected_version).toBe(1);
});
test("불확정 생성 같은 요청 키 재시도와 성공 뒤 목록 실패 구분", async ({ page }) => {
  let calls = 0; const bodies: Record<string, unknown>[] = []; let saved = false;
  await page.route(/\/api\/tags(?:\?.*)?$/, async route => {
    if (route.request().method() === "POST") { bodies.push(route.request().postDataJSON()); calls++; if (calls === 1) await route.abort(); else { saved = true; await route.fulfill({ status: 201, json: { ...tags[0],id:"50000000-0000-4000-8000-000000000000", name: "새 태그" } }); } }
    else await route.fulfill(saved ? { status: 503, json: { code: "internal", message: "목록 실패" } } : { json: { items: tags, next_cursor: null } });
  });
  await page.goto(url); await page.getByRole("textbox", { name: /태그 이름/ }).fill("새 태그"); await saveOnce(page, page,"추가");
  await expect(page.getByText(/저장 여부를 알 수 없습니다/)).toBeVisible(); await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveAttribute("readonly", "");
  await page.getByRole("button", { name: "같은 내용 다시 시도" }).click();
  await expect(page.getByText("태그를 저장했습니다.")).toBeVisible(); await expect(page.getByText(/태그 목록을 불러오지 못했습니다/)).toBeVisible(); expect(bodies[1]).toEqual(bodies[0]);
  await expect(page.getByRole("button", { name: "새 태그 이름 변경" })).toBeFocused();
});
test("이름 충돌 초안 보존과 삭제 실패·성공", async ({ page }) => {
  let failedDelete = true, conflicted = false;
  await page.route(/\/api\/tags(?:\?.*)?$/, route => route.fulfill({ json: { items: tags.map(t => conflicted && t.id === tags[0].id ? { ...t, version: 2 } : t), next_cursor: null } }));
  await page.route("**/api/tags/*", route => { if (route.request().method() === "PATCH") { conflicted = true; return route.fulfill({ status: 409, json: { code: "conflict", message: "다른 변경" } }); } return failedDelete ? route.fulfill({ status: 409, json: { code: "conflict", message: "삭제 충돌" } }) : route.fulfill({ status: 204 }); });
  await page.goto(url); await page.getByRole("button", { name: "첫 태그 이름 변경" }).click(); await page.getByRole("textbox", { name: /태그 이름/ }).fill("초안 유지"); await saveOnce(page, page);
  await expect(page.getByText(/다른 변경이 저장되었습니다/)).toBeVisible(); await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveValue("초안 유지");
  await page.getByRole("button", { name: "취소", exact: true }).click(); await page.getByRole("alertdialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" }).click();
  await page.getByRole("button", { name: "첫 태그 삭제" }).click(); await executionDialog(page).getByRole("button", { name: "삭제하고 기록", exact: true }).click(); await expect(executionDialog(page).getByText(/삭제 충돌/)).toBeVisible();
  failedDelete = false; await executionDialog(page).getByRole("button", { name: "삭제하고 기록", exact: true }).click(); await expect(page.getByText("태그를 삭제했습니다.")).toBeVisible();
});
test("태그 목록 삭제 반영 후 응답 유실도 이유·같은 버전 재시도를 유지", async ({ page }) => {
  const deletions: string[] = [],keys:(string|undefined)[]=[];
  let reads=0;
  await page.route(/\/api\/tags(?:\?.*)?$/, route => {reads++;return route.fulfill({ json: { items: deletions.length?tags.slice(1):tags, next_cursor: null } });});
  await page.route("**/api/tags/*", route => {
    deletions.push(route.request().url());keys.push(route.request().headers()["idempotency-key"]);
    return deletions.length === 1 ? route.abort() : route.fulfill({ status:204,headers:{"Idempotency-Replayed":"true"} });
  });
  await page.goto(url);
  await page.getByRole("button", { name: "첫 태그 삭제" }).click();
  const dialog = executionDialog(page);
  await dialog.getByRole("textbox", { name: /기록 메모/ }).fill("분류 통합");
  await dialog.getByRole("button", { name: "삭제하고 기록", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: /기록 메모/ })).toHaveValue("분류 통합");
  await expect(dialog.getByRole("textbox", { name: /기록 메모/ })).toBeDisabled();
  await dialog.getByRole("button", { name: "같은 내용 다시 시도" }).click();
  await expect(dialog).toHaveCount(0);await expect(page.getByText("태그를 삭제했습니다.")).toBeVisible();
  expect(deletions).toHaveLength(2);
  expect(deletions[1]).toBe(deletions[0]);expect(keys[1]).toBe(keys[0]);expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
  expect(new URL(deletions[0]).searchParams.get("expected_version")).toBe("1");
  expect(new URL(deletions[0]).searchParams.get("change_note")).toBe("분류 통합");
  await expect(page.getByRole("button",{name:"첫 태그 삭제",exact:true})).toHaveCount(0);
});

test("자료 연결 작성·실패 초안·성공 후 조회 실패와 모달 뒤로가기 보호", async ({ page }) => {
  await page.route("**/api/entity-types**", (route) =>
    route.fulfill({
      json: new URL(route.request().url()).pathname.endsWith("/entity-types")
        ? {items:[fixtureType],next_cursor:null}
        : new URL(route.request().url()).pathname.endsWith("/schema")
        ? fixtureSchema
        : fixtureType,
    }));
  const entity = {
    ...makeEntity(100, {prop_1:"文脈資料",prop_2:3,prop_3:"2026-10-04",prop_4:"b"}),
    id: `${fixtureType.id}:${APP_IDENTIFIER_RULE_ID}:10000000-0000-4000-8000-000000000000`, identity_label: "앱 · 자동 발급 · 10000000-0000-4000-8000-000000000000",
    properties: { ...makeEntity(100).properties, prop_1: "文脈資料", prop_2: 3, prop_3: "2026-10-04", prop_4: "b", prop_5: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "10000000-0000-4000-8000-000000000000") },
    version:7,
  };
  let saved = false, failSave = true;
  const bodies: Record<string, unknown>[] = [];
  await page.route("**/api/entities**", route => route.fulfill(decodeURIComponent(new URL(route.request().url()).pathname).endsWith(entity.id) ? saved ? { status: 503, json: { code: "internal", message: "관련 자료 조회 실패" } } : { json: entity } : { json: { items: [entity], next_cursor: null } }));
  await page.route("**/api/tasks", route => { bodies.push(route.request().postDataJSON()); if (failSave) return route.fulfill({ status: 400, json: { code: "validation", message: "저장 실패" } }); saved = true; return route.fulfill({ status: 201, json: { id: "created" } }); });
  await page.goto(url);
  await page.getByRole("link", { name: "자료 fixture", exact: true ,includeHidden:true}).evaluate((el:HTMLAnchorElement)=>el.click());
  await expect(page.getByText("버전 7")).toHaveCount(0);
  await page.getByRole("button", { name: "할 일 작성" }).click();
  const form = page.getByRole("dialog", { name: "할 일 추가", exact: true });
  await expect(form.getByRole("button", { name: entity.title+" 해제", exact: true })).toBeVisible();
  await form.getByRole("textbox",{name:/^제목(?: \(필수\))?$/}).fill("연결된 초안");
  await form.getByLabel("본문").fill("문맥 유지");
  await page.goBack();
  const confirm=page.getByRole("alertdialog",{name:"변경을 버릴까요?"});
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button",{name:"취소",exact:true}).click();
  await expect(form.getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("연결된 초안");
  await saveOnce(page, form, "추가");
  const action=executionDialog(page);
  await expect(action.getByText("저장 실패", { exact: true })).toBeVisible();
  await action.getByRole("button",{name:"취소",exact:true}).click();
  await expect(form.getByRole("textbox",{name:/^제목(?: \(필수\))?$/})).toHaveValue("연결된 초안");
  failSave = false;
  await saveOnce(page, form, "추가");
  await expect(form).not.toBeVisible();
  await expect(page.getByText("할 일을 추가했습니다.")).toHaveCount(0);
  await expect(page.getByText("관련 자료 조회 실패")).toBeVisible();
  expect(bodies[1].entity_ids).toEqual([entity.id]);
  await expect(page.getByRole("heading",{name:entity.title,level:2,exact:true})).toBeVisible();
  await page.getByRole("button",{name:"할 일 작성",exact:true}).click();
  const record = page.getByRole("dialog", { name: "할 일 추가", exact: true });
  await expect(record.getByRole("button", { name: entity.title+" 해제", exact: true })).toBeVisible();
  await record.getByRole("textbox", { name: /^제목/ }).fill("추가 할 일 초안");
  await record.getByLabel("본문").fill("할 일 초안");
  await record.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("alertdialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "취소", exact: true }).click();
  await expect(record.getByLabel("본문")).toHaveValue("할 일 초안");
  await record.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("alertdialog",{name:"변경을 버릴까요?"}).getByRole("button",{name:"변경 버리기"}).click();
  await expect(page.getByRole("button", { name: "할 일 작성", exact: true })).toBeFocused();
  await page.getByRole("button",{name:"할 일 작성",exact:true}).click();
  await record.getByRole("textbox", { name: /^제목/ }).fill("추가 연결 할 일");
  await record.getByLabel("본문").fill("연결 업무\n엔터티 문맥");
  await saveOnce(page, record, "추가");
  await expect(record).not.toBeVisible();
  await expect(page.getByText("기록을 저장했습니다.")).toHaveCount(0);
  expect(bodies.at(-1)?.entity_ids).toEqual([entity.id]);
});

test("태그 설정의 인라인 초안은 대상 전환·탐색 취소와 history 왕복에서도 유지한다", async ({page}, info)=>{
  await page.route("**/api/tasks**",route=>route.fulfill({json:{items:[task],next_cursor:null}}));
  await page.route("**/api/entities**",route=>route.fulfill({json:{items:[],next_cursor:null}}));
  await page.goto("/e2e/fixtures/entity-tags-app.html");
  await tagManagement(page, "task");
  const manager = page.getByRole("region", { name: "할 일 태그 관리", exact: true });
  const target = page.getByRole("radiogroup", {name:"관리 대상",exact:true});
  await expect(manager.getByRole("form", { name: "태그 추가", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await manager.getByRole("button", { name: "첫 태그 이름 변경", exact: true }).click();
  const name = manager.getByRole("textbox", { name: /태그 이름/ });
  await name.fill("대상 전환 초안");
  await expect(manager.getByRole("form", { name: "태그 이름 변경", exact: true })).toBeVisible();
  await page.screenshot({path:info.outputPath("tag-management-inline.png")});
  await target.getByRole("radio",{name:"할 일",exact:true}).focus();
  await target.getByRole("radio",{name:"기록",exact:true}).click();
  const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(target.getByRole("radio",{name:"할 일",exact:true})).toBeChecked();
  await expect.poll(() => target.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await expect(name).toHaveValue("대상 전환 초안");
  await target.getByRole("radio",{name:"기록",exact:true}).click();
  await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await expect(target.getByRole("radio",{name:"기록",exact:true})).toBeChecked();
  await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveValue("");
  await page.goBack();
  await expect(target.getByRole("radio",{name:"할 일",exact:true})).toBeChecked();
  await page.goForward();
  await expect(target.getByRole("radio",{name:"기록",exact:true})).toBeChecked();
  await page.reload();
  await expect(target.getByRole("radio",{name:"기록",exact:true})).toBeChecked();
  await page.getByRole("textbox", { name: /태그 이름/ }).fill("탐색 보존 초안");
  await settingsCategory(page, "기본");
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("navigation", { name: "주 메뉴", exact: true }).getByRole("link", { name: "기본 설정", exact: true })).toBeFocused();
  await closeMainNavigation(page);
  await expect(page.getByRole("textbox", { name: /태그 이름/ })).toHaveValue("탐색 보존 초안");
  await settingsCategory(page, "기본");
  await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "기본 설정", exact: true })).toBeVisible();
});

test("기존 자료 태그 직접 주소는 모달 닫기 후 자료 화면으로 돌아간다", async ({ page }) => {
  await page.route("**/api/entities**", route => route.fulfill({ json: { items: [], next_cursor: null } }));
  await page.goto("/e2e/fixtures/entity-tags-app.html");
  await page.goto(fixtureWorkspacePath("/tags/entity"));
  const manager = page.getByRole("dialog", { name: "자료 태그 관리", exact: true });
  await expect(manager.getByRole("form", { name: "태그 추가", exact: true })).toBeVisible();
  await manager.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page).toHaveURL(/\/entities$/);
});

test("후속 페이지 태그 URL은 이름 변경 행을 복원하고 삭제 불확정 닫기는 한 번만 폐기",async({page})=>{
  await page.route("**/api/tags**",route=>route.fulfill({json:new URL(route.request().url()).searchParams.has("cursor")?{items:[tags[1]],next_cursor:null}:{items:[tags[0]],next_cursor:"second"}}));
  await page.goto(url+`?edit=${tags[1].id}`);
  const manager=page.getByRole("dialog");
  await expect(manager.getByRole("form",{name:"태그 이름 변경"})).toBeVisible();
  await expect(manager.getByRole("textbox",{name:/태그 이름/})).toHaveValue(tags[1].name);
  await page.reload();await expect(manager.getByRole("textbox",{name:/태그 이름/})).toHaveValue(tags[1].name);
  await manager.getByRole("button",{name:"취소",exact:true}).click();
  await page.route("**/api/tags/*",route=>route.abort());
  await manager.getByRole("button",{name:"첫 태그 삭제"}).click();
  const action = executionDialog(page);
  await action.getByRole("textbox",{name:/기록 메모/}).fill("분류 변경");
  await action.getByRole("button",{name:"삭제하고 기록",exact:true}).click();
  await expect(action.getByRole("button",{name:"같은 내용 다시 시도"})).toBeVisible();
  await page.keyboard.press("Escape");await expect(executionDialog(page)).toHaveCount(0);await page.keyboard.press("Escape");
  const confirm=page.getByRole("alertdialog",{name:"변경을 버릴까요?"});await expect(confirm).toBeVisible();
  await confirm.getByRole("button",{name:"취소",exact:true}).click();
  await manager.getByRole("button",{name:"첫 태그 삭제"}).click();await expect(action.getByRole("textbox",{name:/기록 메모/})).toHaveValue("분류 변경");
});

for(const [path,label,scope] of [["entities","전체 자료","entity"],["records","기록","record"]] as const)test(`${label} 화면에서 태그 설정으로 이동하고 관리 대상을 선택한다`,async({page})=>{
  await page.route("**/api/tasks**",route=>route.fulfill({json:{items:[],next_cursor:null}}));
  await page.route("**/api/entities**",route=>route.fulfill({json:{items:[],next_cursor:null}}));
  await page.route("**/api/records**",route=>route.fulfill({json:{items:[],next_cursor:null}}));
  await page.goto("/e2e/fixtures/entity-tags-app.html");
  await page.goto(fixtureWorkspacePath(`/${path}?pages=1`));
  await expect(page.getByRole("button",{name:`${label} 작업 메뉴`})).toHaveCount(0);
  await tagManagement(page, scope);
  await expect(page.getByRole("radiogroup", { name:"관리 대상",exact:true }).getByRole("radio",{ name:scope==="entity"?"자료":"기록",exact:true })).toBeChecked();
  await expect(page.getByRole("form", { name: "태그 추가", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await settingsCategory(page, "기본");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "기본 설정", exact: true })).toBeVisible();
});

test("#229 태그 삭제 확인도 서버 메모 오류를 입력에 표시하고 수정 가능", async ({page}) => {
  const submitted: URL[] = [];
  await page.route("**/api/tags/*", route => {
    submitted.push(new URL(route.request().url()));
    return submitted.length === 1
      ? route.fulfill({status:422,json:{code:"invalid_input",message:"기록 메모를 확인하세요",fields:[{path:"change_note",message:"삭제 근거를 보완하세요"}]}})
      : route.fulfill({status:204});
  });
  await page.goto(url);
  await page.getByRole("button", {name:"첫 태그 삭제",exact:true}).click();
  const dialog = executionDialog(page);
  await dialog.getByLabel("기록 메모",{exact:true}).fill("초안 메모");
  await dialog.getByRole("button", {name:"삭제하고 기록",exact:true}).click();
  await expect(dialog.getByLabel("기록 메모",{exact:true})).toHaveAttribute("aria-invalid","true");
  await expect(dialog.getByText("삭제 근거를 보완하세요",{exact:true})).toBeVisible();
  await expect(dialog.getByLabel("기록 메모",{exact:true})).toBeEnabled();
  await dialog.getByLabel("기록 메모",{exact:true}).fill("보완한 근거");
  await dialog.getByRole("button", {name:"삭제하고 기록",exact:true}).click();
  await expect(page.getByText("태그를 삭제했습니다.",{exact:true})).toBeVisible();
  expect(submitted.map(url => url.searchParams.get("change_note"))).toEqual(["초안 메모","보완한 근거"]);
  expect(submitted[1].searchParams.get("expected_version")).toBe(submitted[0].searchParams.get("expected_version"));
});

test("#370 사전의 없는 ID는 삭제로 단정하지 않고 화면 복귀 때 목록 단위로 재확인한다", async ({ page }) => {
  let current: typeof tags = [], reads = 0;
  await page.route("**/api/tags**", (route) => {
    if (new URL(route.request().url()).searchParams.get("scope") === "entity") reads++;
    return route.fulfill({ json: { items: current, next_cursor: null } });
  });
  await page.goto(url + "?dictionary=1");
  const names = page.getByRole("region", { name: "자료 이름 확인" });
  await expect(names.getByText("태그 확인 필요", { exact: true })).toHaveCount(20);
  await expect(page.getByText("삭제된 태그", { exact: true })).toHaveCount(0);
  const before = reads;
  current = tags;
  await page.getByRole("button", { name: "화면 복귀", exact: true }).click();
  await expect(names.getByText("첫 태그", { exact: true })).toHaveCount(20);
  expect(reads - before).toBe(1);
});

test("#370 공유 사전은 다른 태그 범위를 대신하지 않으며 실패 후 다시 읽을 수 있다", async ({ page }) => {
  let fail = false;
  await page.route("**/api/tags**", (route) => {
    const scope = new URL(route.request().url()).searchParams.get("scope");
    if (fail && scope === "entity") {
      return route.fulfill({ status: 503, json: { code: "internal", message: "조회 실패" } });
    }
    return route.fulfill({
      json: { items: [{ ...tags[0], name: scope === "record" ? "기록 태그명" : "자료 태그명" }], next_cursor: null },
    });
  });
  await page.goto(url + "?dictionary=1");
  await expect(page.getByRole("region", { name: "자료 이름 확인" }).getByText("자료 태그명", { exact: true }))
    .toHaveCount(20);
  await expect(page.getByRole("region", { name: "다른 범위 확인" }).getByText("기록 태그명", { exact: true }))
    .toBeVisible();
  fail = true;
  await page.getByRole("button", { name: "화면 복귀", exact: true }).click();
  await expect(page.getByText("태그 사전을 불러오지 못했습니다. 조건과 기존 행은 유지합니다.", { exact: true }))
    .toBeVisible();
  await expect(page.getByText("태그 이름 조회 실패", { exact: true })).toHaveCount(20);
  fail = false;
  await page.getByRole("button", { name: "태그 다시 시도", exact: true }).click();
  await expect(page.getByRole("region", { name: "자료 이름 확인" }).getByText("자료 태그명", { exact: true }))
    .toHaveCount(20);
});

test("#370 늦은 이전 사전 응답이 새 이름을 덮어쓰지 않는다", async ({ page }) => {
  let reads = 0, release = () => {}, arrived = () => {};
  const started = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  await page.route("**/api/tags**", async (route) => {
    const scope = new URL(route.request().url()).searchParams.get("scope");
    if (scope === "entity") reads++;
    if (scope === "entity" && reads === 2) {
      arrived();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ json: { items: [{ ...tags[0], name: "느린 이전 이름" }], next_cursor: null } }).catch(
        () => {},
      );
      return;
    }
    await route.fulfill({
      json: { items: [{ ...tags[0], name: reads >= 3 ? "최신 이름" : "최초 이름" }], next_cursor: null },
    });
  });
  try {
    await page.goto(url + "?dictionary=1");
    const names = page.getByRole("region", { name: "자료 이름 확인" });
    await expect(names.getByText("최초 이름", { exact: true })).toHaveCount(20);
    await page.getByRole("button", { name: "화면 복귀", exact: true }).click();
    await started;
    await page.getByRole("button", { name: "화면 복귀", exact: true }).click();
    await expect(names.getByText("최신 이름", { exact: true })).toHaveCount(20);
    release();
    await expect(names.getByText("느린 이전 이름", { exact: true })).toHaveCount(0);
  } finally {
    release();
  }
});

test("새 자료는 태그 선택 없이 저장하고 보기에서 독립 연결한다", async ({ page }, info) => {
  await entityCapabilities(page, "write");
  const capture = async (name: string) => {
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === "running" && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
    const path = info.outputPath(`${name}.png`);
    await page.screenshot({ path, fullPage: true });
    await info.attach(name, { path, contentType: "image/png" });
  };
  let current = { ...makeEntity(301, { prop_1: "독립 태그 자료" }), tag_ids: [] as string[] };
  const creations: Record<string, unknown>[] = [], connections: Record<string, unknown>[] = [];
  const history = [{ id: "tag-fixture-create", body: "최초 등록 기록", updated_at: current.updated_at, record_kind: "change", occurred_at: current.created_at }];
  await page.route("**/api/entity-types**", route => route.fulfill({
    json: new URL(route.request().url()).pathname.endsWith("/schema") ? fixtureSchema
      : new URL(route.request().url()).pathname.endsWith("/entity-types") ? { items: [fixtureType], next_cursor: null } : fixtureType,
  }));
  await page.route("**/api/entities**", route => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname);
    if (path.endsWith("/links")) return route.fulfill({ json: { items: [], next_cursor: null } });
    if (route.request().method() === "POST") {
      expect(route.request().headers()["x-workspace-id"]).toBe(fixtureWorkspaceId);
      creations.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: current });
    }
    return route.fulfill({ json: path.endsWith(current.id) ? { ...current, tasks: { count: 0, items: [] }, records: { count: history.length, items: history } } : { items: [], next_cursor: null } });
  });
  await page.route("**/api/tag-connections", route => {
    const input = route.request().postDataJSON();
    expect(route.request().headers()["x-workspace-id"]).toBe(fixtureWorkspaceId);
    connections.push(input);
    history.push({ id: "tag-fixture-connect", body: "태그 연결 변경 기록", updated_at: current.updated_at, record_kind: "change", occurred_at: current.updated_at });
    current = { ...current, tag_ids: input.tag_ids, version: current.version + 1 };
    return route.fulfill({ json: { tag_ids: current.tag_ids, version: current.version, updated_at: current.updated_at } });
  });
  await page.goto("/e2e/fixtures/entity-tags-app.html");
  await page.goto(`/w/${fixtureWorkspaceId}/entities?entity_type_id=${fixtureType.id}`);
  await beginTabAction(page, "검사 자료 추가");
  const form = page.getByRole("dialog", { name: "검사 자료 추가", exact: true });
  await expect(form.getByRole("button", { name: "태그 선택", exact: true })).toHaveCount(0);
  await expect(form.getByText("식별자 종류와 원본 값을 확인하고, 자료의 입력 항목을 작성합니다.", { exact: true })).toBeVisible();
  await form.getByLabel("제목").fill(current.title);
  await capture("new-entity-without-tag-selector");
  await saveOnce(page, form);
  await expect(form).not.toBeVisible();
  expect(creations).toHaveLength(1);
  expect(creations[0]).not.toHaveProperty("tag_ids");
  const region = page.getByRole("region", { name: "태그 연결" });
  await expect(region.getByText("연결된 태그 없음", { exact: true })).toBeVisible();
  await expect(page.getByText("기록 (1개)", { exact: true })).toBeVisible();
  await capture("saved-entity-before-tag-connection");
  await region.getByRole("button", { name: "태그 연결", exact: true }).click();
  await region.getByRole("button", { name: "태그 선택", exact: true }).click();
  await page.getByRole("option", { name: "첫 태그", exact: true }).click();
  await page.getByRole("button", { name: "선택 완료", exact: true }).click();
  await region.getByRole("button", { name: "연결 적용", exact: true }).click();
  await executionDialog(page).getByRole("button", { name: "연결하고 저장", exact: true }).click();
  await expect(region.getByText("첫 태그", { exact: true })).toBeVisible();
  // Independent tag writes append a parent change record on the server; the
  // detail must refresh that history without another mutation or a page reload.
  await expect(page.getByText("기록 (2개)", { exact: true })).toBeVisible();
  await expect(page.getByText("태그 연결 변경 기록", { exact: true })).toBeVisible();
  await expect(region.getByRole("button", { name: "태그 연결", exact: true })).toBeFocused();
  await expect(page).toHaveURL(new RegExp(`/w/${fixtureWorkspaceId}/entities/`));
  await capture("saved-entity-after-tag-connection");
  expect(connections).toHaveLength(1);
  expect(connections[0]).toMatchObject({ target_kind: "entity", target_id: current.id, expected_version: 1, tag_ids: [tags[0].id] });
  expect(connections[0]).not.toHaveProperty("schema_version");
  expect(creations).toHaveLength(1);
});

test("보기에서 태그 연결 초안을 취소하거나 독립 적용한다", async ({ page }) => {
  let current = { ...makeEntity(1, { prop_5: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "10000000-0000-4000-8000-000000000000") }), id: `${fixtureType.id}:${APP_IDENTIFIER_RULE_ID}:10000000-0000-4000-8000-000000000000`, identity_label: "앱 · 자동 발급 · 10000000-0000-4000-8000-000000000000", tag_ids: [] as string[] };
  const writes: Record<string, unknown>[] = [];
  await page.route(/\/api\/(?:entities\/.*|tag-connections)$/, async route => {
    if (new URL(route.request().url()).pathname.endsWith("/links")) return route.fulfill({json:{items:[],next_cursor:null}});
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON(); writes.push(input);
      current = { ...current, tag_ids: input.tag_ids ?? current.tag_ids, version: current.version + 1 };
    }
    await route.fulfill({ json: { ...current, tasks: { count: 0, items: [] }, records: { count: 0, items: [] } } });
  });
  await page.route("**/api/entity-types**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/schema") ? fixtureSchema : new URL(route.request().url()).pathname.endsWith("/entity-types") ? { items: [fixtureType], next_cursor: null } : fixtureType }));
  await page.goto(url);
  await page.getByRole("link", { name: "자료 fixture", exact: true ,includeHidden:true}).evaluate((el:HTMLAnchorElement) => el.click());
  const region = page.getByRole("region", { name: "태그 연결" });
  await region.getByRole("button", { name: "태그 연결", exact: true }).click();
  await region.getByRole("button", { name: "태그 선택", exact: true }).click();
  await page.getByRole("option", { name: "첫 태그", exact: true }).click();
  await page.getByRole("button", { name: "선택 완료", exact: true }).click();
  expect(writes).toHaveLength(0);
  await region.getByRole("button", { name: "연결 취소", exact: true }).click();
  await expect(region.getByText("연결된 태그 없음", { exact: true })).toBeVisible();
  await region.getByRole("button", { name: "태그 연결", exact: true }).click();
  await region.getByRole("button", { name: "태그 선택", exact: true }).click();
  await page.getByRole("option", { name: "첫 태그", exact: true }).click();
  await page.getByRole("button", { name: "선택 완료", exact: true }).click();
  await region.getByRole("button", { name: "연결 적용", exact: true }).click();
  await executionDialog(page).getByRole("button", { name: "연결하고 저장", exact: true }).click();
  await expect(region.getByText("첫 태그",{exact:true})).toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ target_kind: "entity", target_id: current.id, tag_ids: [tags[0].id], expected_version: 1 });
  expect(writes[0]).not.toHaveProperty("properties");
});

for (const kind of ["entity", "task", "record"] as const) {
  test(`${kind} 일반 편집은 태그를 읽기 전용으로 보존하고 부분 저장에서 생략한다`, async ({ page }) => {
    const base = kind === "entity" ? makeEntity(1, { prop_5: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "10000000-0000-4000-8000-000000000000") }) : kind === "task" ? makeTask(2) : makeRecord(3);
    const targetId = kind === "entity" ? `${fixtureType.id}:${APP_IDENTIFIER_RULE_ID}:10000000-0000-4000-8000-000000000000` : kind === "task" ? task.id : "30000000-0000-4000-8000-000000000000";
    let current = { ...base, id: targetId, ...(kind === "entity" ? { identity_label: "앱 · 자동 발급 · 10000000-0000-4000-8000-000000000000" } : {}), tag_ids: [tags[0].id] };
    const writes: Record<string, unknown>[] = [];
    await page.route("**/api/entity-types**", route => route.fulfill({json:new URL(route.request().url()).pathname.endsWith("/schema") ? fixtureSchema : new URL(route.request().url()).pathname.endsWith("/entity-types") ? {items:[fixtureType],next_cursor:null} : fixtureType}));
    await page.route(`**/api/${kind === "entity" ? "entities" : kind + "s"}/**`, async route => {
      const path = new URL(route.request().url()).pathname;
      if (path.endsWith("/links")) return route.fulfill({json:{items:[],next_cursor:null}});
      if (route.request().method() === "PATCH") {
        const input = route.request().postDataJSON(); writes.push(input);
        current = {...current,...input,version:current.version+1};
      }
      await route.fulfill({json:current});
    });
    await page.route("**/api/records?**", route => route.fulfill({json:{items:[],next_cursor:null}}));
    await page.goto(url);
    await page.getByRole("link", {name:kind === "entity" ? "자료 fixture" : kind === "task" ? "할 일 fixture" : "기록 fixture",exact:true,includeHidden:true}).evaluate((el:HTMLAnchorElement)=>el.click());
    await openDetailEditor(page);
    const form = page.getByRole("dialog", { name: `${kind === "entity" ? fixtureType.label : kind === "task" ? "할 일" : "기록"} 편집`, exact: true });
    await expect(form.getByRole("button", {name:"태그 선택",exact:true})).toHaveCount(0);
    await expect(form.getByRole("term").filter({hasText:/^태그$/}).locator("..").getByText("첫 태그",{exact:true})).toBeVisible();
    await (kind === "entity" ? form.getByRole("textbox", {name:/^제목/}) : form.getByRole("textbox", {name:/^본문/})).fill("본문 수정");
    await saveOnce(page, form);
    await expect(page.getByRole("button",{name:"편집",exact:true})).toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).not.toHaveProperty("tag_ids");
    await expect(page.getByRole("region", {name:"태그 연결"}).getByText("첫 태그",{exact:true})).toBeVisible();
  });
}

test("기록 태그 연결 응답 불명은 같은 입력·버전·요청 키로만 재확인한다", async ({ page }) => {
  const record = {...makeRecord(3),id:"30000000-0000-4000-8000-000000000000",tag_ids:[tags[0].id]};
  const requests: {body:Record<string,unknown>;key:string|undefined}[] = [];
  await page.route(/\/api\/(?:records\/.*|tag-connections)$/, async route => {
    if(route.request().method()==="POST") {
      requests.push({body:route.request().postDataJSON(),key:route.request().headers()["idempotency-key"]});
      if(requests.length===1)return route.abort();
      return route.fulfill({headers:{"Idempotency-Replayed":"true"},json:{...record,tag_ids:[],version:2}});
    }
    await route.fulfill({json:record});
  });
  await page.goto(url);
  await page.getByRole("link",{name:"기록 fixture",exact:true,includeHidden:true}).evaluate((el:HTMLAnchorElement)=>el.click());
  const region=page.getByRole("region",{name:"태그 연결"});
  await region.getByRole("button",{name:"첫 태그 연결 해제",exact:true}).click();
  await region.getByRole("button",{name:"연결 적용",exact:true}).click();
  await expect(region.getByText(/저장 여부를 알 수 없습니다/)).toBeVisible();
  await expect(region.getByRole("button",{name:"태그 선택",exact:true})).toBeDisabled();
  await expect(region.getByRole("button",{name:"연결 취소",exact:true})).toBeDisabled();
  await region.getByRole("button",{name:"같은 내용 다시 시도",exact:true}).click();
  await expect(region.getByText("연결된 태그 없음",{exact:true})).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toEqual(requests[0]);
  expect(requests[0].key).toBeTruthy();
  expect(requests[0].body).toEqual({target_kind:"record",target_id:record.id,tag_ids:[],expected_version:1});
});

test("기록 태그 연결 버전 충돌은 원문과 선택 초안을 보존한다", async ({ page }) => {
  const record={...makeRecord(3),id:"30000000-0000-4000-8000-000000000000",tag_ids:[tags[0].id]};
  let writes=0;
  await page.route(/\/api\/(?:records\/.*|tag-connections)$/, route => {
    if(route.request().method()==="POST") {writes++;return route.fulfill({status:409,json:{code:"conflict",message:"다른 변경이 저장되었습니다."}});}
    return route.fulfill({json:record});
  });
  await page.goto(url);
  await page.getByRole("link",{name:"기록 fixture",exact:true,includeHidden:true}).evaluate((el:HTMLAnchorElement)=>el.click());
  const region=page.getByRole("region",{name:"태그 연결"});
  await region.getByRole("button",{name:"태그 연결",exact:true}).click();
  await region.getByRole("button",{name:"태그 선택",exact:true}).click();
  await page.getByRole("option",{name:"다른 태그",exact:true}).click();
  await page.getByRole("button",{name:"선택 완료",exact:true}).click();
  await region.getByRole("button",{name:"연결 적용",exact:true}).click();
  await expect(region.getByText(/다른 변경이 저장되었습니다/)).toBeVisible();
  await expect(region.getByRole("button",{name:"첫 태그 선택 해제",exact:true})).toBeVisible();
  await expect(region.getByRole("button",{name:"다른 태그 선택 해제",exact:true})).toBeVisible();
  expect(writes).toBe(1);
  await region.getByRole("button",{name:"연결 취소",exact:true}).click();
  await expect(region.getByText("첫 태그",{exact:true})).toBeVisible();
  await expect(page.getByRole("definition").filter({hasText:record.body})).toContainText(record.body);
  await expect(region.getByRole("button",{name:"태그 연결",exact:true})).toBeFocused();
});

test("태그 충돌 초안 취소는 최신 자료를 읽고 새 버전으로 연결을 다시 시작한다", async ({ page }) => {
  let current = {
    ...makeEntity(1, { prop_5: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, "10000000-0000-4000-8000-000000000000") }),
    id: `${fixtureType.id}:${APP_IDENTIFIER_RULE_ID}:10000000-0000-4000-8000-000000000000`, identity_label: "앱 · 자동 발급 · 10000000-0000-4000-8000-000000000000",
    tag_ids: [tags[0].id],
  };
  const writes: Record<string, unknown>[] = [];
  await page.route(
    "**/api/entity-types**",
    (route) =>
      route.fulfill({
        json: new URL(route.request().url()).pathname.endsWith("/schema")
          ? fixtureSchema
          : { items: [fixtureType], next_cursor: null },
      }),
  );
  await page.route(/\/api\/(?:entities\/.*|tag-connections)$/, async (route) => {
    if (route.request().method() === "POST") {
      const input = route.request().postDataJSON();
      writes.push(input);
      if (writes.length === 1) {
        current = {
          ...current,
          title: "외부에서 바뀐 자료",
          properties: { ...current.properties, prop_1: "외부에서 바뀐 자료" },
          tag_ids: [tags[1].id],
          version: 2,
        };
        return route.fulfill({ status: 409, json: { code: "conflict", message: "다른 변경이 저장되었습니다." } });
      }
      current = { ...current, tag_ids: input.tag_ids, version: 3 };
    }
    return route.fulfill({ json: current });
  });
  await page.goto(url);
  await page.getByRole("link", { name: "자료 fixture", exact: true ,includeHidden:true}).evaluate((el: HTMLAnchorElement) => el.click());
  const region = page.getByRole("region", { name: "태그 연결" });
  await region.getByRole("button", { name: "첫 태그 연결 해제", exact: true }).click();
  await region.getByRole("button", { name: "연결 적용", exact: true }).click();
  const action = executionDialog(page);
  await action.getByRole("button", { name: "연결하고 저장", exact: true }).click();
  await expect(action).toContainText("다른 변경이 저장되었습니다.");
  await action.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("heading", { name: "외부에서 바뀐 자료", exact: true })).toHaveCount(0);
  await expect(region.getByRole("button", { name: "첫 태그 선택 해제", exact: true })).toHaveCount(0);
  await region.getByRole("button", { name: "연결 취소", exact: true }).click();
  await expect(page.getByRole("heading", { name: "외부에서 바뀐 자료", exact: true })).toBeVisible();
  await expect(region.getByText("다른 태그",{exact:true})).toBeVisible();
  await expect(region.getByRole("button", { name: "태그 연결", exact: true })).toBeFocused();
  await region.getByRole("button", { name: "다른 태그 연결 해제", exact: true }).click();
  await region.getByRole("button", { name: "연결 적용", exact: true }).click();
  await action.getByRole("button", { name: "연결하고 저장", exact: true }).click();
  await expect(region.getByText("연결된 태그 없음", { exact: true })).toBeVisible();
  expect(writes.map((input) => input.expected_version)).toEqual([1, 2]);
  expect(current.properties.prop_1).toBe("외부에서 바뀐 자료");
});

test("태그 연결 초안은 닫기·뒤로가기·경로 이동 취소에서 선택과 초점을 지키고 승인한 경로만 이동한다", async ({ page }) => {
  const record = { ...makeRecord(3), id: "30000000-0000-4000-8000-000000000000", tag_ids: [tags[0].id] };
  await page.route("**/api/records/**", (route) => route.fulfill({ json: record }));
  await page.goto(url);
  await page.getByRole("link", { name: "기록 fixture", exact: true ,includeHidden:true}).evaluate((el: HTMLAnchorElement) => el.click());
  const region = page.getByRole("region", { name: "태그 연결" });
  await region.getByRole("button", { name: "첫 태그 연결 해제", exact: true }).click();
  const chooser = region.getByRole("button", { name: "태그 선택", exact: true });
  const surface = page.getByRole("dialog").filter({visible:true});
  const close = surface.getByRole("button", { name: "닫기", exact: true });
  const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
  await close.click();
  await expect(discard).toHaveCount(1);
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(close).toBeFocused();
  await expect(region.getByRole("button", { name: "첫 태그 선택 해제", exact: true })).toHaveCount(0);
  await chooser.focus();
  await page.goBack();
  await expect(discard).toHaveCount(1);
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page).toHaveURL(/\/records\/30000000/);
  await expect(chooser).toBeFocused();
  const destination = page.getByRole("link", { name: "다른 화면", exact: true, includeHidden: true });
  await destination.evaluate((el: HTMLAnchorElement) => el.click());
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(chooser).toBeFocused();
  await destination.evaluate((el: HTMLAnchorElement) => el.click());
  await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await expect(page).toHaveURL(/entity-tags\.html\?fixture=other$/);
  await expect(discard).toHaveCount(0);
  await page.getByRole("link", { name: "기록 fixture", exact: true ,includeHidden:true}).evaluate((el: HTMLAnchorElement) => el.click());
  await expect(region.getByText("첫 태그",{exact:true})).toBeVisible();
  await expect(page.getByRole("definition").filter({hasText:record.body})).toContainText(record.body);
});

test("태그 연결 처리 중과 응답 불명은 Escape·뒤로가기를 막고 같은 시도만 재확인한다", async ({ page }) => {
  const record = { ...makeRecord(3), id: "30000000-0000-4000-8000-000000000000", tag_ids: [tags[0].id] };
  let release = () => {}, arrived = () => {};
  const started = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const requests: { body: Record<string, unknown>; key: string | undefined }[] = [];
  await page.route(/\/api\/(?:records\/.*|tag-connections)$/, async (route) => {
    if (route.request().method() !== "POST") return route.fulfill({ json: record });
    requests.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
    if (requests.length === 1) {
      arrived();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return route.abort();
    }
    return route.fulfill({ json: { ...record, tag_ids: [], version: 2 } });
  });
  try {
    await page.goto(url);
    await page.getByRole("link", { name: "기록 fixture", exact: true ,includeHidden:true}).evaluate((el: HTMLAnchorElement) => el.click());
    const region = page.getByRole("region", { name: "태그 연결" });
    await region.getByRole("button", { name: "첫 태그 연결 해제", exact: true }).click();
    await region.getByRole("button", { name: "연결 적용", exact: true }).click();
    await started;
    for (const phase of ["busy", "uncertain"]) {
      await expect(region.getByRole("button", { name: "연결 취소", exact: true })).toBeDisabled();
      await page.keyboard.press("Escape");
      await page.goBack();
      await expect(page).toHaveURL(/\/records\/30000000/);
      await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?" })).toHaveCount(0);
      await expect(region).toBeVisible();
      if (phase === "busy") {
        release();
        await expect(region.getByText(/저장 여부를 알 수 없습니다/)).toBeVisible();
      }
    }
    await region.getByRole("button", { name: "같은 내용 다시 시도", exact: true }).click();
    await expect(region.getByText("연결된 태그 없음", { exact: true })).toBeVisible();
    expect(requests).toHaveLength(2);
    expect(requests[1]).toEqual(requests[0]);
    await page.getByRole("dialog").filter({visible:true}).getByRole("button", { name: "닫기", exact: true }).click();
    await expect(region).toHaveCount(0);
    await expect(page).toHaveURL(/\/records$/);
    await expect(page.getByRole("heading", { name: "기록 목록 fixture", exact: true })).toBeVisible();
    await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?" })).toHaveCount(0);
  } finally {
    release();
  }
});


test("넓은 App에서 자료 직접 추가는 공간 경로와 종류 조건을 유지한다", async ({ page, isMobile }) => {
  test.skip(isMobile, "desktop retained WorkspaceRoutes query navigation seam");
  await page.setViewportSize({ width: 1440, height: 900 });
  await entityCapabilities(page, "write");
  await page.goto("/e2e/fixtures/entity-tags-app.html");
  const list = `/w/${fixtureWorkspaceId}/entities?entity_type_id=${fixtureType.id}`;
  await page.goto(list);
  // Match the actual business-only user's direct primary action. The wide
  // retained list uses WorkspaceRoutes' business-relative location override.
  await page.getByRole("button", { name: `${fixtureType.label} 추가`, exact: true }).click();
  await expect(page).toHaveURL(new URL(`${list}&create=1`, page.url()).href);
  const form = page.getByRole("dialog", { name: `${fixtureType.label} 추가`, exact: true });
  await expect(form).toBeVisible();
  await expect(form.getByLabel("제목", { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { name: "페이지를 찾을 수 없습니다.", exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(form).not.toBeVisible();
  await expect(page).toHaveURL(new URL(list, page.url()).href);
});

for (const settings of [false, true]) {
  test(`자료 종류 READ는 설정 ${settings ? "WRITE가 있어도" : "권한 없이도"} 보기만 제공한다`, async ({ page }) => {
    await entityCapabilities(page, "read", settings);
    const current = { ...makeEntity(1), tag_ids: [tags[0].id] };
    await page.route("**/api/entities**", route => {
      const path = decodeURIComponent(new URL(route.request().url()).pathname);
      if (path.endsWith("/links")) return route.fulfill({ json: { items: [], next_cursor: null } });
      return route.fulfill({ json: path.endsWith(current.id)
        ? { ...current, tasks: { count: 0, items: [] }, records: { count: 0, items: [] } }
        : { items: [current], next_cursor: null } });
    });
    await page.goto("/e2e/fixtures/entity-tags-app.html");
    const list = `/w/${fixtureWorkspaceId}/entities?entity_type_id=${fixtureType.id}`;
    await page.goto(list);
    await expect(page.getByRole("region", { name: `${fixtureType.label} 목록`, exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: `${fixtureType.label} 추가`, exact: true })).toHaveCount(0);
    // A manually supplied mode query does not open a writer surface.
    await page.goto(`${list}&create=1`);
    await expect(page.getByRole("region", { name: `${fixtureType.label} 목록`, exact: true })).toBeVisible();
    await expect(page.getByRole("dialog", { name: `${fixtureType.label} 추가`, exact: true })).toHaveCount(0);
    const detail = `/w/${fixtureWorkspaceId}/entities/${encodeURIComponent(current.id)}`;
    await page.goto(detail);
    const region = page.getByRole("region", { name: "태그 연결", exact: true });
    await expect(region.getByText(tags[0].name, { exact: true })).toBeVisible();
    await expect(region.getByRole("button", { name: "태그 연결", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "편집", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "기록 작성", exact: true })).toHaveCount(0);
    await page.goto(`${detail}?edit=1`);
    await expect(region.getByText(tags[0].name, { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "저장", exact: true })).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "제목", exact: false })).toHaveCount(0);
  });
}


test("전체 자료 작성의 종류 선택은 설정 WRITE와 별개로 종류 WRITE만 제공한다", async ({ page }) => {
  const readable = { ...fixtureType, id: "00000000-0000-4000-8000-000000000901", label: "조회만 하는 자료" };
  await entityCapabilities(page, "write", true, readable.id);
  await page.route("**/api/entity-types**", route => route.fulfill({ json:
    new URL(route.request().url()).pathname.endsWith("/entity-types") ? { items: [fixtureType, readable], next_cursor: null }
      : new URL(route.request().url()).pathname.endsWith("/schema") ? fixtureSchema
      : fixtureType,
  }));
  await page.goto("/e2e/fixtures/entity-tags-app.html");
  await page.goto(`/w/${fixtureWorkspaceId}/entities`);
  await page.getByRole("button", { name: "자료 추가", exact: true }).click();
  const form = page.getByRole("dialog", { name: "자료 추가", exact: true });
  await expect(form).toBeVisible();
  await form.getByRole("combobox", { name: "자료 종류", exact: true }).click();
  await expect(page.getByRole("option", { name: fixtureType.label, exact: true })).toBeVisible();
  await expect(page.getByRole("option", { name: readable.label, exact: true })).toHaveCount(0);
  await page.getByRole("option", { name: fixtureType.label, exact: true }).click();
  await expect(page.getByRole("dialog", { name: `${fixtureType.label} 추가`, exact: true }).getByLabel("제목", { exact: false })).toBeEnabled();
});


test("열린 자료 태그 초안은 WRITE에서 READ로 바뀌면 잠기고 미확정 요청은 같은 시도만 보존한다", async ({ page }) => {
  let access = "write", membership = 1;
  await page.route(`**/api/workspaces/${fixtureWorkspaceId}`, route => route.fulfill({ json: {
    workspace: { id: fixtureWorkspaceId, name: "태그 권한 전환 공간", deleted_at: null },
    can_manage: false, membership_version: membership,
    grants: access === "none" ? [] : [{ target_kind: "entity_type", target_id: fixtureType.id, access }],
  } }));
  let current = { ...makeEntity(351, { prop_1: "권한 갱신 자료" }), tag_ids: [tags[0].id] };
  await page.route("**/api/entity-types**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/schema") ? fixtureSchema : new URL(route.request().url()).pathname.endsWith("/entity-types") ? { items: [fixtureType], next_cursor: null } : fixtureType }));
  await page.route("**/api/entities**", route => route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/links") ? { items: [], next_cursor: null } : { ...current, tasks: { count: 0, items: [] }, records: { count: 0, items: [] } } }));
  let release = () => {}, arrived = () => {};
  const started = new Promise<void>(resolve => arrived = resolve);
  const writes: { body: unknown; key?: string }[] = [];
  await page.route("**/api/tag-connections", async route => {
    writes.push({ body: route.request().postDataJSON(), key: route.request().headers()["idempotency-key"] });
    if (writes.length === 1) {
      arrived();
      await new Promise<void>(resolve => release = resolve);
      return route.abort();
    }
    current = { ...current, tag_ids: route.request().postDataJSON().tag_ids, version: 2 };
    return route.fulfill({ json: current });
  });
  const refresh = async (next: string) => {
    access = next; membership++;
    const response = page.waitForResponse(response => new URL(response.url()).pathname === `/api/workspaces/${fixtureWorkspaceId}`);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await response;
  };
  try {
    await page.goto("/e2e/fixtures/entity-tags-app.html");
    await page.goto(`/w/${fixtureWorkspaceId}/entities/${encodeURIComponent(current.id)}`);
    const region = page.getByRole("region", { name: "태그 연결" });
    await region.getByRole("button", { name: "태그 연결", exact: true }).click();
    const picker = region.getByRole("button", { name: "태그 선택", exact: true });
    await picker.click();
    const chooser = page.getByRole("dialog", { name: "태그 선택", exact: true });
    await expect(chooser.getByRole("option", { name: "첫 태그", exact: true })).toHaveAttribute("aria-checked", "true");
    await refresh("none");
    await expect(chooser).not.toBeVisible();
    await expect(page.getByRole("option", { name: "첫 태그", exact: true })).toHaveCount(0);
    expect(writes).toHaveLength(0);
    await refresh("read");
    await expect(chooser).toBeVisible();
    await expect(chooser.getByRole("option", { name: "첫 태그", exact: true })).toHaveAttribute("aria-checked", "true");
    await expect(chooser.getByRole("option", { name: "다른 태그", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(chooser).toHaveCount(0);
    await expect(region).toBeFocused();
    await expect(picker).toBeDisabled();
    await expect(region.getByText("첫 태그", { exact: true })).toBeVisible();
    await expect(region.getByRole("button", { name: "연결 적용", exact: true })).toBeDisabled();
    expect(writes).toHaveLength(0);
    await refresh("write");
    await region.getByRole("button", { name: "연결 적용", exact: true }).click();
    const confirmation = executionDialog(page);
    await expect(confirmation.getByRole("button", { name: "연결하고 저장", exact: true })).toBeEnabled();
    await refresh("read");
    await expect(confirmation.getByRole("button", { name: "연결하고 저장", exact: true })).toBeDisabled();
    await expect(confirmation.getByRole("textbox", { name: "기록 메모", exact: true })).toBeDisabled();
    await confirmation.getByRole("button", { name: "취소", exact: true }).click();
    await expect(picker).toBeDisabled();
    await region.getByRole("button", { name: "연결 취소", exact: true }).click();
    await expect(region).toBeFocused();
    await expect(region.getByRole("button", { name: "태그 연결", exact: true })).toHaveCount(0);
    await expect(region.getByText("첫 태그", { exact: true })).toBeVisible();
    await refresh("write");
    await region.getByRole("button", { name: "태그 연결", exact: true }).click();
    await picker.click();
    await page.getByRole("option", { name: "다른 태그", exact: true }).click();
    await page.getByRole("button", { name: "선택 완료", exact: true }).click();
    await region.getByRole("button", { name: "연결 적용", exact: true }).click();
    await confirmation.getByRole("button", { name: "연결하고 저장", exact: true }).click();
    await started;
    await refresh("read");
    expect(writes).toHaveLength(1);
    release();
    await expect(confirmation.getByRole("button", { name: "같은 내용 다시 시도", exact: true })).toBeDisabled();
    await expect(confirmation.getByText(/저장 여부를 알 수 없습니다/)).toBeVisible();
    await confirmation.getByRole("button", { name: "취소", exact: true }).click();
    await expect(region.getByRole("button", { name: "같은 내용 다시 시도", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape");
    await expect(region).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/w/${fixtureWorkspaceId}/entities/`));
    await refresh("write");
    await region.getByRole("button", { name: "같은 내용 다시 시도", exact: true }).click();
    await expect.poll(() => writes.length).toBe(2);
    await expect(region.getByRole("button", { name: "태그 연결", exact: true })).toBeVisible();
    await expect(region.getByText("태그 연결을 저장했습니다.", { exact: true })).toBeVisible();
    await expect(region.getByText("첫 태그", { exact: true })).toBeVisible();
    expect(writes[1]).toEqual(writes[0]);
  } finally { release(); }
});


for (const mode of ["create", "edit"] as const) {
  test(`미확정 자료 ${mode} 폼은 WRITE에서 READ 갱신 뒤에도 초안과 원래 재시도를 보존한다`, async ({ page }) => {
    let access = "write", membership = 1;
    await page.route(`**/api/workspaces/${fixtureWorkspaceId}`, route => route.fulfill({ json: {
      workspace: { id: fixtureWorkspaceId, name: "자료 폼 권한 전환 공간", deleted_at: null },
      can_manage: false, membership_version: membership,
      grants: access === "none" ? [] : [{ target_kind: "entity_type", target_id: fixtureType.id, access }],
    } }));
    let current = { ...makeEntity(361, { prop_1: "원래 자료" }), tag_ids: [] as string[] };
    await page.route("**/api/entity-types**", route => {
      const path = new URL(route.request().url()).pathname;
      if (access === "none") return route.fulfill(path.endsWith("/entity-types")
        ? { json: { items: [], next_cursor: null } }
        : { status: 404, json: { code: "not_found", message: "자료 종류를 찾을 수 없습니다." } });
      return route.fulfill({ json: path.endsWith("/schema") ? fixtureSchema : path.endsWith("/entity-types") ? { items: [fixtureType], next_cursor: null } : fixtureType });
    });
    const writes: { body: any; key?: string }[] = [];
    await page.route("**/api/entities**", route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      if (request.method() !== "GET") {
        writes.push({ body: request.postDataJSON(), key: request.headers()["idempotency-key"] });
        if (writes.length === 1) {
          current = { ...current, properties: writes[0].body.properties, title: writes[0].body.properties.prop_1, version: 2 };
          return route.abort();
        }
        return route.fulfill({ json: current });
      }
      if (access === "none") return route.fulfill(path.endsWith("/entities") || path.endsWith("/links")
        ? { json: { items: [], next_cursor: null } }
        : { status: 404, json: { code: "not_found", message: "자료를 찾을 수 없습니다." } });
      return route.fulfill({ json: path.endsWith("/links") ? { items: [], next_cursor: null } : path.endsWith("/entities") ? { items: [current], next_cursor: null } : { ...current, tasks: { count: 0, items: [] }, records: { count: 0, items: [] } } });
    });
    const refresh = async (next: string) => {
      access = next; membership++;
      const response = page.waitForResponse(response => new URL(response.url()).pathname === `/api/workspaces/${fixtureWorkspaceId}`);
      await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await response;
    };
    await page.goto("/e2e/fixtures/entity-tags-app.html");
    await page.goto(`/w/${fixtureWorkspaceId}/entities${mode === "create" ? `?entity_type_id=${fixtureType.id}` : `/${encodeURIComponent(current.id)}`}`);
    if (mode === "create") await beginTabAction(page, `${fixtureType.label} 추가`);
    else await openDetailEditor(page);
    const form = page.getByRole("dialog", { name: `${fixtureType.label} ${mode === "create" ? "추가" : "편집"}`, exact: true });
    const draft = `미확정 ${mode}`;
    await form.getByRole("textbox", { name: "제목 (필수)", exact: true }).fill(draft);
    await form.getByRole("button", { name: "저장", exact: true }).click();
    const confirmation = executionDialog(page);
    await confirmation.getByRole("button", { name: mode === "create" ? "등록하고 저장" : "수정하고 저장", exact: true }).click();
    await expect(confirmation.getByRole("button", { name: "같은 내용 다시 시도", exact: true })).toBeVisible();
    await expect(confirmation.getByText(draft, { exact: true })).toBeVisible();
    await refresh("read");
    await expect(confirmation.getByText(draft, { exact: true })).toBeVisible();
    await expect(confirmation.getByRole("button", { name: "같은 내용 다시 시도", exact: true })).toBeDisabled();
    await confirmation.getByRole("button", { name: "취소", exact: true }).click();
    await expect(confirmation).toHaveCount(0);
    await expect(form.getByRole("textbox", { name: "제목 (필수)", exact: true })).toHaveValue(draft);
    await expect(form.getByRole("textbox", { name: "제목 (필수)", exact: true })).toBeDisabled();
    await refresh("write");
    await form.getByRole("button", { name: "같은 내용 다시 시도", exact: true }).click();
    await expect(confirmation.getByText(draft, { exact: true })).toBeVisible();
    expect(writes).toHaveLength(1);
    await refresh("read");
    await expect(confirmation.getByRole("button", { name: "같은 내용 다시 시도", exact: true })).toBeDisabled();
    await refresh("none");
    await expect(page.getByRole("textbox", { name: "제목 (필수)", exact: true })).toHaveCount(0);
    await expect(confirmation).not.toBeVisible();
    await refresh("read");
    await expect(confirmation.getByText(draft, { exact: true })).toBeVisible();
    await expect(confirmation.getByRole("button", { name: "같은 내용 다시 시도", exact: true })).toBeDisabled();
    expect(writes).toHaveLength(1);
    await refresh("write");
    await confirmation.getByRole("button", { name: "같은 내용 다시 시도", exact: true }).click();
    await expect.poll(() => writes.length).toBe(2);
    await expect(confirmation).toHaveCount(0);
    expect(writes[1]).toEqual(writes[0]);
    await expect(page).toHaveURL(new RegExp(`/w/${fixtureWorkspaceId}/entities/`));
  });
}
