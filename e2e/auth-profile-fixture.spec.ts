import { settingsResponse } from "./support/preparation-api.ts";
import { expect, test, type Page } from "@playwright/test";

const user = { id: "00000000-0000-0000-0000-000000000001", aud: "authenticated", email: "fixture@example.test", app_metadata: {}, user_metadata: { full_name: "기존 계정 이름", workspace_avatar_id: "person", provider_value: "preserved" } };
const other = { ...user, id: "00000000-0000-0000-0000-000000000002", email: "other@example.test", user_metadata: { workspace_avatar_id: "leaf", provider_value: "other" } };
const fixture = "/e2e/fixtures/auth-profile.html";

test("발급처 추가 충돌은 초안을 보존하고 최신값을 적용한 뒤 다시 편집한다",async({page,context})=>{
  let version=1;
  let value={generation:"short",default_source:"app",sources:[{code:"app",label:"앱"}]};
  const writes:{expected_version:number;value:typeof value}[]=[];
  let hold=false,release!:()=>void;
  const wait=new Promise<void>(resolve=>{release=resolve;});
  await context.route("**/settings/business{,?**}",async route=>{
    if(route.request().method()==="GET"&&hold)await wait;
    if(route.request().method()==="PATCH") {
      const input=route.request().postDataJSON();writes.push(input);
      if(input.expected_version!==version)return route.fulfill({status:409,json:{error:{code:"conflict",message:"같은 설정에 다른 변경이 저장되어 있습니다.",fields:[]}}});
      value=input.value;version++;
    }
    return route.fulfill({json:settingsResponse(route, {versions:{record_templates:0,entity_identity:version},settings:{record_templates:{},entity_identity:value}})});
  });
  await context.route("**/tags?**",route=>route.fulfill({json:{items:[],next_cursor:null}}));
  await page.goto(fixture);
  const identity=page.locator('section[aria-labelledby="entity-identity-title"]');
  await identity.getByLabel("발급처 1 이름").fill("내가 편집한 이름");
  value={generation:"manual",default_source:"crm",sources:[{code:"app",label:"앱"},{code:"crm",label:"다른 창에서 추가"}]};version=2;
  await identity.getByRole("button",{name:"식별자 설정 저장",exact:true}).click();
  hold=true;
  await identity.getByRole("button",{name:"최신값 확인",exact:true}).click();
  await expect(identity.getByLabel("발급처 1 이름")).toBeDisabled();
  await expect(identity.getByRole("button",{name:"추가",exact:true})).toBeDisabled();
  await expect(identity.getByRole("button",{name:"최신값 확인",exact:true})).toBeDisabled();
  release();
  await expect(identity.getByLabel("발급처 1 이름")).toBeEditable();
  await expect(identity.getByLabel("발급처 1 이름")).toHaveValue("내가 편집한 이름");
  await expect(identity.getByLabel("발급처 2 이름")).toHaveCount(0);
  await expect(identity.getByLabel("발급처 1 방식")).toHaveValue("short");
  await expect(identity.getByRole("button",{name:"식별자 설정 저장",exact:true})).toBeDisabled();
  await identity.getByRole("button",{name:"최신값으로 다시 편집",exact:true}).click();
  await expect(identity.getByLabel("발급처 1 이름")).toHaveValue("다른 창에서 추가");
  await expect(identity.getByLabel("발급처 2 이름")).toHaveValue("앱");
  await expect(identity.getByLabel("발급처 1 방식")).toHaveValue("manual");
  await identity.getByLabel("발급처 2 이름").fill("내가 편집한 이름");
  await expect(identity.getByLabel("기본 발급처")).toHaveCount(0);
  await identity.getByRole("button",{name:"식별자 설정 저장",exact:true}).click();
  await expect(identity).toContainText("식별자 설정을 저장했습니다");
  expect(writes.map(input=>input.expected_version)).toEqual([1,2]);
  expect(value.sources.map(({code,label})=>({code,label}))).toEqual([{code:"crm",label:"다른 창에서 추가"},{code:"app",label:"내가 편집한 이름"}]);
});

test("서로 다른 발급처 삭제 충돌은 활성 초안을 보존하고 최신 목록에서 다시 편집한다", async ({page,context}) => {
  let version=1;
  let failRead=false;
  let value={generation:"short",default_source:"app",sources:[{code:"app",label:"앱",deleted:false},{code:"crm",label:"고객",deleted:false}]};
  const writes: number[]=[];
  await context.route("**/settings/business{,?**}",route=>{
    if(route.request().method()==="GET"&&failRead)return route.abort("failed");
    if(route.request().method()==="PATCH") {
      const input=route.request().postDataJSON();writes.push(input.expected_version);
      if(input.expected_version!==version)return route.fulfill({status:409,json:{error:{code:"conflict",message:"버전 충돌",fields:[]}}});
      value=input.value;version++;
    }
    return route.fulfill({json:settingsResponse(route,{versions:{entity_identity:version,record_templates:0},settings:{entity_identity:value,record_templates:{}}})});
  });
  await context.route("**/tags?**",route=>route.fulfill({json:{items:[],next_cursor:null}}));
  await page.goto(fixture);
  const identity=page.locator('section[aria-labelledby="entity-identity-title"]');
  await identity.getByRole("button",{name:"앱 삭제",exact:true}).click();
  value={...value,sources:[value.sources[0],{...value.sources[1],deleted:true}]};version=2;
  await identity.getByRole("button",{name:"식별자 설정 저장",exact:true}).click();
  await expect(identity.getByRole("button",{name:"최신값으로 다시 편집",exact:true})).toBeDisabled();
  failRead=true;
  await identity.getByRole("button",{name:"최신값 확인",exact:true}).click();
  await expect(identity).toContainText("식별자 설정을 불러오지 못했습니다");
  await identity.getByLabel("발급처 1 이름").fill("고객 초안");
  await expect(identity.getByRole("button",{name:"최신값으로 다시 편집",exact:true})).toBeDisabled();
  failRead=false;
  await identity.getByRole("button",{name:"최신값 확인",exact:true}).click();
  await expect(identity).toContainText("최신 설정을 읽었습니다");
  await expect(identity.getByLabel("발급처 1 이름")).toHaveValue("고객 초안");
  await expect(identity.getByRole("button",{name:"식별자 설정 저장",exact:true})).toBeDisabled();
  await identity.getByRole("button",{name:"최신값으로 다시 편집",exact:true}).click();
  await expect(identity.getByLabel("발급처 1 이름")).toHaveValue("앱");
  await identity.getByLabel("발급처 1 이름").fill("새 앱 이름");
  await identity.getByRole("button",{name:"식별자 설정 저장",exact:true}).click();
  await expect(identity).toContainText("식별자 설정을 저장했습니다");
  expect(writes).toEqual([1,2]);
  expect(value.sources).toEqual([expect.objectContaining({code:"app",label:"새 앱 이름",deleted:false}),expect.objectContaining({code:"crm",deleted:true})]);
});

test("기록 템플릿 충돌도 초안을 보존하고 최신 템플릿을 적용한 뒤 새 버전으로 저장한다", async ({page,context}) => {
  let version=1;
  let value={entity:{create:{memo:"처음 템플릿",tag_ids:[] as string[]}},task:{create:{memo:"처음 할 일",tag_ids:[] as string[]}}};
  const writes: {id:string;expected_version:number}[]=[];
  await context.route("**/settings/business{,?**}",route=>{
    if(route.request().method()==="PATCH") {
      const input=route.request().postDataJSON();writes.push(input);
      if(input.expected_version!==version)return route.fulfill({status:409,json:{error:{code:"conflict",message:"버전 충돌",fields:[]}}});
      value=input.value;version++;
    }
    return route.fulfill({json:settingsResponse(route,{versions:{entity_identity:0,record_templates:version},settings:{entity_identity:{generation:"short",default_source:"app",sources:[{code:"app",label:"앱"}]},record_templates:value}})});
  });
  await context.route("**/tags?**",route=>route.fulfill({json:{items:[],next_cursor:null}}));
  await page.goto(fixture);
  const templates=page.getByRole("form",{name:"변경 기록 기본값"});
  await templates.getByLabel("메모 템플릿").fill("내 초안");
  value={entity:{create:{memo:"최신 엔터티",tag_ids:[]}},task:{create:{memo:"최신 할 일",tag_ids:[]}}};version=2;
  await templates.getByRole("button",{name:"기록 기본값 저장",exact:true}).click();
  await expect(templates.getByRole("button",{name:"최신값으로 다시 편집",exact:true})).toBeDisabled();
  await templates.getByRole("button",{name:"최신값 확인",exact:true}).click();
  await expect(templates).toContainText("최신 설정을 읽었습니다");
  await expect(templates.getByLabel("메모 템플릿")).toHaveValue("내 초안");
  await expect(templates.getByRole("button",{name:"기록 기본값 저장",exact:true})).toBeDisabled();
  await templates.getByRole("button",{name:"최신값으로 다시 편집",exact:true}).click();
  await expect(templates.getByLabel("메모 템플릿")).toHaveValue("최신 엔터티");
  await templates.getByLabel("메모 템플릿").fill("다시 편집한 엔터티");
  await templates.getByRole("button",{name:"기록 기본값 저장",exact:true}).click();
  await expect(templates).toContainText("기록 기본값을 저장했습니다");
  expect(writes.map(({id,expected_version})=>({id,expected_version}))).toEqual([{id:"record_templates",expected_version:1},{id:"record_templates",expected_version:2}]);
  expect(value.entity.create.memo).toBe("다시 편집한 엔터티");
  expect(value.task.create.memo).toBe("최신 할 일");
});

for (const width of [390,1440]) test(`업무 설정 ${width}px: 독립 저장·초안 보존·발급처 삭제/복원·행 추가·순서 변경`, async ({page,context}, info)=>{
  const versions = {record_templates:0,entity_identity:0};
  const settings = {record_templates:{},entity_identity:{generation:"short",default_source:"app",sources:[{code:"app",label:"앱"},{code:"crm",label:"고객"}]}};
  const writes: {id:keyof typeof settings;expected_version:number;value:unknown}[]=[];
  await context.route("**/settings/business{,?**}",route=>{
    if(route.request().method()==="PATCH") {
      const input=route.request().postDataJSON();writes.push(input);
      expect(input.expected_version).toBe(versions[input.id as keyof typeof versions]);
      settings[input.id as keyof typeof settings]=input.value;versions[input.id as keyof typeof versions]++;
    }
    return route.fulfill({json:settingsResponse(route, {versions,settings})});
  });
  await context.route("**/tags?**",route=>route.fulfill({json:{items:[],next_cursor:null}}));
  await page.setViewportSize({width,height:1000});await page.goto(fixture);
  const templates=page.getByRole("form",{name:"변경 기록 기본값"});
  const identity=page.locator('section[aria-labelledby="entity-identity-title"]');
  await expect(templates.getByLabel("메모 템플릿")).toHaveValue("$대상$ $액션$");
  await expect(templates.getByRole("button",{name:"기록 기본값 저장",exact:true})).toBeDisabled();
  expect(writes).toHaveLength(0);
  await templates.getByLabel("액션",{exact:true}).selectOption("update");
  await expect(templates.getByLabel("메모 템플릿")).toHaveValue("$대상$ $액션$ ($변경항목$)");
  await expect(templates.getByRole("button",{name:"기록 기본값 저장",exact:true})).toBeDisabled();
  await templates.getByLabel("액션",{exact:true}).selectOption("create");
  await templates.getByLabel("메모 템플릿").fill("기본 ${액션$}");
  await identity.getByLabel("발급처 1 방식").selectOption("manual");
  await templates.getByRole("button",{name:"기록 기본값 저장",exact:true}).click();
  await expect(templates).toContainText("기록 기본값을 저장했습니다");
  await expect(identity.getByLabel("발급처 1 방식")).toHaveValue("manual");
  await identity.getByRole("button",{name:"식별자 설정 저장",exact:true}).click();
  await expect(identity).toContainText("식별자 설정을 저장했습니다");
  expect(writes.map(({id,expected_version})=>({id,expected_version}))).toEqual([{id:"record_templates",expected_version:0},{id:"entity_identity",expected_version:0}]);
  await expect(identity.getByRole("button",{name:"최신값 확인",exact:true})).toHaveCount(0);
  await identity.getByRole("button",{name:"고객 삭제",exact:true}).click();
  await expect(identity.getByRole("button",{name:"앱 삭제",exact:true})).toBeDisabled();
  await identity.getByRole("button",{name:"식별자 설정 저장",exact:true}).click();
  await expect(identity).toContainText("식별자 설정을 저장했습니다");
  expect(settings.entity_identity.sources.find(source=>source.code==="crm")).toMatchObject({deleted:true});
  await identity.getByText("삭제된 발급처 (1개)",{exact:true}).click();
  await identity.getByRole("button",{name:"고객 복원",exact:true}).click();
  await identity.getByRole("button",{name:"식별자 설정 저장",exact:true}).click();
  await expect(identity).toContainText("식별자 설정을 저장했습니다");
  expect(settings.entity_identity.sources.find(source=>source.code==="crm")).toMatchObject({deleted:false});
  await identity.getByRole("button",{name:"추가",exact:true}).click();
  await identity.getByLabel("발급처 3 이름").fill("임시");
  await expect(identity.getByLabel("발급처 3 방식")).toHaveValue("short");
  await identity.getByLabel("발급처 3 방식").selectOption("manual");
  await identity.getByRole("button",{name:"임시 위로 이동",exact:true}).click();
  await identity.getByRole("button",{name:"임시 위로 이동",exact:true}).click();
  await expect(identity.getByLabel("발급처 1 이름")).toHaveValue("임시");
  await expect(identity.getByRole("button",{name:"임시 위로 이동",exact:true})).toBeDisabled();
  await identity.getByRole("button",{name:"임시 아래로 이동",exact:true}).click();
  await identity.getByRole("button",{name:"임시 아래로 이동",exact:true}).click();
  await identity.getByRole("button",{name:"임시 삭제",exact:true}).click();
  await expect(identity.getByRole("button",{name:"식별자 설정 저장",exact:true})).toBeDisabled();
  expect(writes).toHaveLength(4);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:info.outputPath(`settings-sections-${width}.png`),fullPage:true});
});
function token(id: string) {
  const encode = (data: object) => Buffer.from(JSON.stringify(data)).toString("base64url");
  return `${encode({ alg: "HS256", typ: "JWT" })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600, sub: id })}.fixture`;
}
async function sdkState(page: Page) {
  return page.evaluate(async () => {
    const path = "/src/lib/supabase.ts"; const { supabase } = await import(path);
    const { data } = await supabase.auth.getSession();
    const serialized = localStorage.getItem("sb-127-auth-token");
    const stored = JSON.parse(serialized ?? "null");
    return { sdk: data.session?.user.id ?? null, stored: stored?.user.id ?? null, icon: stored?.user.user_metadata.workspace_avatar_id ?? null, serialized };
  });
}
async function switchAccount(page: Page) {
  await page.evaluate(async access_token => {
    const path = "/src/lib/supabase.ts"; const { supabase } = await import(path);
    const { error } = await supabase.auth.setSession({ access_token, refresh_token: "other-refresh" });
    if (error) throw error;
  }, token(other.id));
}
async function logout(page: Page) {
  await page.evaluate(async () => {
    const path = "/src/lib/supabase.ts"; const { supabase } = await import(path);
    const { error } = await supabase.auth.signOut(); if (error) throw error;
  });
}
test.beforeEach(async ({ context, baseURL }) => {
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/auth/v1/user") && route.request().method() === "GET") {
      const jwt = route.request().headers().authorization?.split(" ")[1];
      const id = jwt ? JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).sub : null;
      return route.fulfill({ json: id === other.id ? other : user });
    }
    if (url.pathname.endsWith("/auth/v1/logout")) return route.fulfill({ status: 204 });
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    return route.abort();
  });
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ user, access_token }) => {
    if (sessionStorage.getItem("auth-fixture-started")) return;
    sessionStorage.setItem("auth-fixture-started", "true");
    localStorage.setItem("sb-127-auth-token", JSON.stringify({ access_token, refresh_token: "first-refresh", token_type: "bearer", expires_at: Math.floor(Date.now() / 1000) + 3600, user }));
  }, { user, access_token: token(user.id) });
});

for (const phase of ["profile", "read"]) for (const crossTab of [false, true]) for (const action of ["logout", "switch"] as const) {
  test(`늦은 ${phase} 성공 뒤 ${crossTab ? "다른 탭" : "같은 탭"} ${action}의 provider·SDK 저장소 유지`, async ({ page, context }, info) => {
    let release!: () => void; let arrived!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { arrived = resolve; });
    let written = false; let refreshes = 0;
    await page.route("**/auth/v1/user", async route => {
      if (route.request().method() !== "PUT") {
        const access = route.request().headers().authorization?.split(" ")[1];
        if (access && JSON.parse(Buffer.from(access.split(".")[1], "base64url").toString()).sub === other.id) return route.fallback();
        if (!written) return route.fallback();
        if (phase === "read") { arrived(); await waiting; }
        return route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "sun" } } });
      }
      expect(route.request().postDataJSON().data).toEqual({ workspace_avatar_id: "sun" });
      if (phase === "profile") { arrived(); await waiting; }
      written = true;
      await route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "sun" } } });
    });
    await page.route("**/auth/v1/token*", async route => {
      refreshes++;
      await route.fulfill({ json: { access_token: token(user.id), refresh_token: "rotated-first-refresh", token_type: "bearer", expires_in: 3600,
        user: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "sun" } } } });
    });
    await page.goto(fixture); await expect(page.getByTestId("provider-account")).toHaveText(user.id);
    const actor = crossTab ? await context.newPage() : page;
    if (crossTab) { await actor.goto(fixture); await expect(actor.getByTestId("provider-account")).toHaveText(user.id); }
    await page.getByRole("button", { name: "지연 저장 검사" }).click(); await started;
    if (action === "logout") await logout(actor); else await switchAccount(actor);
    const expected = action === "logout" ? null : other.id;
    await expect(page.getByTestId("provider-account")).toHaveText(expected ?? "signed-out");
    expect(await sdkState(page)).toMatchObject({ sdk: expected, stored: expected });
    const before = (await sdkState(page)).serialized;
    release(); await expect(page.getByTestId("save-result")).toHaveText("rejected");
    await info.attach("after-delayed-profile", { contentType: "application/json", body: JSON.stringify({ provider: await page.getByTestId("provider-account").textContent(), ...await sdkState(page) }) });
    await expect(page.getByTestId("provider-account")).toHaveText(expected ?? "signed-out");
    expect(await sdkState(page)).toMatchObject({ sdk: expected, stored: expected });
    expect((await sdkState(page)).serialized).toBe(before);
    if (crossTab) { await expect(actor.getByTestId("provider-account")).toHaveText(expected ?? "signed-out"); expect(await sdkState(actor)).toMatchObject({ sdk: expected, stored: expected }); }
    expect(refreshes).toBe(0);
  });
}

test("다른 탭의 같은 계정 프로필 갱신은 미저장 선택·이동 보호를 유지하고 취소는 최신값 복원", async ({ page, context }) => {
  let icon = "person";
  await context.route("**/auth/v1/user", route => {
    if (route.request().method() === "PUT") icon = "leaf";
    return route.fulfill({ json: { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: icon } } });
  });
  await page.goto(fixture); await page.getByRole("radio", { name: "별", exact: true }).check();
  const second = await context.newPage(); await second.goto(fixture);
  await second.evaluate(async () => { const path = "/src/lib/supabase.ts"; const { supabase } = await import(path); const { error } = await supabase.auth.updateUser({ data: { workspace_avatar_id: "leaf" } }); if (error) throw error; });
  await expect(page.getByTestId("provider-icon")).toHaveText("leaf");
  await expect(second.getByRole("radio", { name: "잎", exact: true })).toBeChecked();
  await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name:"프로필 저장", exact: true })).toBeEnabled();
  await page.getByRole("link", { name: "전체 자료", exact: true }).click();
  await page.getByRole("dialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
  await page.getByRole("form",{name:"프로필 설정"}).getByRole("button",{name:"변경 취소", exact: true }).click();
  await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked();
  await expect(page.getByRole("button", { name:"프로필 저장", exact: true })).toBeDisabled();
});

test("외부 갱신 뒤 로컬 저장은 응답 정본을 채택하고 다른 탭의 깨끗한 선택도 갱신한다", async ({ page, context }) => {
  let icon = "person";
  const responseUser = () => ({ ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: icon } });
  await context.route("**/auth/v1/user", route => route.fulfill({ json: responseUser() }));
  await context.route("**/auth/v1/token*", route => route.fulfill({ json: { access_token: token(user.id), refresh_token: "rotated-first-refresh", token_type: "bearer", expires_in: 3600, user: responseUser() } }));
  await page.goto(fixture); await page.getByRole("radio", { name: "별", exact: true }).check();
  const second = await context.newPage(); await second.goto(fixture);
  icon = "leaf";
  await second.evaluate(async () => { const path = "/src/lib/supabase.ts"; const { supabase } = await import(path); await supabase.auth.updateUser({ data: { workspace_avatar_id: "leaf" } }); });
  await expect(page.getByTestId("provider-icon")).toHaveText("leaf");
  await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
  // 서버가 정규화하거나 다른 쓰기가 뒤따른 경우에도 확인한 최신 응답이 정본이다.
  icon = "sun"; await page.getByRole("button", { name:"프로필 저장", exact: true }).click();
  await expect(page.getByRole("form", { name: "프로필 설정" }).getByRole("status")).toContainText("저장했습니다");
  for (const tab of [page, second]) {
    await expect(tab.getByTestId("provider-icon")).toHaveText("sun");
    await expect(tab.getByRole("radio", { name: "해바라기", exact: true })).toBeChecked();
    await expect(tab.getByRole("button", { name:"프로필 저장", exact: true })).toBeDisabled();
    // 프로필 표시와 달리 SDK 세션은 마지막 Auth 이벤트 값 그대로다.
    expect(await sdkState(tab)).toMatchObject({ sdk: user.id, stored: user.id, icon: "leaf" });
  }
  await page.reload();
  await expect(page.getByTestId("provider-icon")).toHaveText("sun");
  await expect(page.getByRole("radio", { name: "해바라기", exact: true })).toBeChecked();
  expect(await sdkState(page)).toMatchObject({ icon: "leaf" });
  await logout(page);
  await page.evaluate(async access_token => {
    const path = "/src/lib/supabase.ts"; const { supabase } = await import(path);
    const { error } = await supabase.auth.setSession({ access_token, refresh_token: "relogin-refresh" }); if (error) throw error;
  }, token(user.id));
  await expect(page.getByTestId("provider-icon")).toHaveText("sun");
  await expect(page.getByRole("radio", { name: "해바라기", exact: true })).toBeChecked();
});

test("프로필 저장 성공·표시 재조회 실패를 구분하고 초안으로 재시도한다", async ({ page }) => {
  const updated = { ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: "star" } };
  let fail = true; let written = false;
  await page.route("**/auth/v1/user", route => {
    if (route.request().method() === "PUT") { written = true; return route.fulfill({ json: updated }); }
    if (!written) return route.fallback();
    return route.fulfill(fail ? { status: 400, json: { msg: "fixture read failure" } } : { json: updated });
  });
  await page.goto(fixture); await page.getByRole("radio", { name: "별", exact: true }).check(); await page.getByRole("button", { name:"프로필 저장", exact: true }).click();
  await expect(page.getByRole("form",{name:"프로필 설정"}).getByRole("alert")).toContainText("설정은 저장했지만 계정 표시를 새로 불러오지 못했습니다");
  await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
  expect(await sdkState(page)).toMatchObject({ sdk: user.id, stored: user.id, icon: "person" });
  fail = false; await page.getByRole("button", { name:"프로필 저장", exact: true }).click();
  await expect(page.getByRole("form", { name: "프로필 설정" }).getByRole("status")).toContainText("저장했습니다");
  await expect(page.getByRole("button", { name:"프로필 저장", exact: true })).toBeDisabled();
  await expect(page.getByTestId("provider-icon")).toHaveText("star");
  expect(await sdkState(page)).toMatchObject({ icon: "person" });
});

for (const hydration of ["completed", "pending"] as const) for (const writer of ["sdk-event", "profile-save"] as const) {
  test(`이전 저장 GET 뒤 ${writer}의 ${hydration} canonical 조회를 따르고 취소는 최신값 복원`, async ({ page, context }, info) => {
    let icon = "person", written = false, held = false, refreshes = 0;
    let releaseOld!: () => void, releaseNew!: () => void, oldArrived!: () => void, newArrived!: () => void;
    const oldGate = new Promise<void>(resolve => { releaseOld = resolve; });
    const newGate = new Promise<void>(resolve => { releaseNew = resolve; });
    const oldStarted = new Promise<void>(resolve => { oldArrived = resolve; });
    const newStarted = new Promise<void>(resolve => { newArrived = resolve; });
    const response = (value: string) => ({ ...user, user_metadata: { ...user.user_metadata, workspace_avatar_id: value } });
    await context.route("**/auth/v1/token*", route => { refreshes++; return route.abort(); });
    await context.route("**/auth/v1/user", async route => {
      if (route.request().method() === "PUT") {
        icon = route.request().postDataJSON().data.workspace_avatar_id; written = true;
        return route.fulfill({ json: response(icon) });
      }
      const captured = icon;
      if (route.request().frame().page() === page && written) {
        if (!held) { held = true; oldArrived(); await oldGate; }
        else if (captured === "leaf") { newArrived(); if (hydration === "pending") await newGate; }
      }
      return route.fulfill({ json: response(captured) });
    });
    await page.goto(fixture);
    const second = await context.newPage(); await second.goto(fixture);
    for (const tab of [page, second]) await expect(tab.getByTestId("provider-icon")).toHaveText("person");
    await page.getByRole("radio", { name: "별", exact: true }).check();
    await page.getByRole("button", { name:"프로필 저장", exact: true }).click(); await oldStarted;
    if (writer === "sdk-event") {
      await second.evaluate(async () => {
        const path = "/src/lib/supabase.ts"; const { supabase } = await import(path);
        const { error } = await supabase.auth.updateUser({ data: { workspace_avatar_id: "leaf" } }); if (error) throw error;
      });
    } else {
      await second.getByRole("radio", { name: "잎", exact: true }).check();
      await second.getByRole("button", { name:"프로필 저장", exact: true }).click();
      await expect(second.getByRole("form", { name: "프로필 설정" }).getByRole("status")).toContainText("저장했습니다");
    }
    await newStarted;
    if (hydration === "completed") await expect(page.getByTestId("provider-icon")).toHaveText("leaf");
    // 외부 갱신은 저장 중인 로컬 선택도 덮어쓰지 않는다.
    await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
    const before = (await sdkState(page)).serialized;
    let staleDelivered!: () => void;
    const delivered = new Promise<void>(resolve => { staleDelivered = resolve; });
    page.on("response", response => {
      if (response.url().endsWith("/auth/v1/user") && response.request().method() === "GET") {
        void response.json().then(body => { if (body.user_metadata?.workspace_avatar_id === "star") staleDelivered(); });
      }
    });
    releaseOld(); await delivered;
    if (hydration === "pending") {
      // 처리된 오래된 응답으로 완료하지 않고 진행 중 최신 조회를 기다린다.
      await page.waitForTimeout(100);
      await expect(page.getByRole("button", { name:"프로필 저장" })).toBeDisabled();
      await expect(page.getByTestId("provider-icon")).not.toHaveText("star");
      await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
      releaseNew();
    }
    await expect(page.getByRole("form", { name: "프로필 설정" }).getByRole("status")).toContainText("저장했습니다");
    await expect(page.getByTestId("provider-icon")).toHaveText("leaf");
    await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked();
    await expect(page.getByRole("button", { name:"프로필 저장", exact: true })).toBeDisabled();
    expect(icon).toBe("leaf"); expect(refreshes).toBe(0);
    expect((await sdkState(page)).serialized).toBe(before);
    await page.getByRole("radio", { name: "해바라기", exact: true }).check();
    await page.getByRole("form",{name:"프로필 설정"}).getByRole("button",{name:"변경 취소", exact: true }).click();
    await expect(page.getByRole("radio", { name: "잎", exact: true })).toBeChecked();
    await page.reload(); await expect(page.getByTestId("provider-icon")).toHaveText("leaf");
    await info.attach("canonical-read-order", { contentType: "application/json", body: JSON.stringify({ hydration, writer, server: icon, provider: await page.getByTestId("provider-icon").textContent(), ...await sdkState(page), refreshes }) });
  });
}


test("계정 저장: 실패 초안·폐기 보호·기존 metadata·다른 탭·새로고침·기기 기본값", async ({ page, context }, info) => {
  let timezone: string | null = null, fail = true;
  const writes: unknown[] = [];
  const responseUser = () => ({...user,user_metadata:{...user.user_metadata,workspace_timezone:timezone}});
  await context.route("**/auth/v1/user", async route => {
    if (route.request().method() === "PUT") {
      writes.push(route.request().postDataJSON().data);
      if (fail) return route.fulfill({status:503,json:{msg:"fixture failure"}});
      timezone = route.request().postDataJSON().data.workspace_timezone;
    }
    return route.fulfill({json:responseUser()});
  });
  await page.setViewportSize({width:390,height:844});
  await page.goto(fixture);
  const setting = page.getByRole("form", {name:"날짜와 시각 설정"});
  await setting.getByLabel("표시 시간대").selectOption("America/New_York");
  await page.getByRole("link", {name:"기록",exact:true}).click();
  await page.getByRole("dialog", {name:"변경을 버릴까요?"}).getByRole("button",{name:"취소",exact:true}).click();
  await expect(setting.getByLabel("표시 시간대")).toHaveValue("America/New_York");
  await setting.getByRole("button", {name:"날짜와 시각 저장",exact:true}).click();
  await expect(setting.getByRole("alert")).toContainText("입력한 설정을 유지");
  await expect(setting.getByLabel("표시 시간대")).toHaveValue("America/New_York");
  const otherTab = await context.newPage(); await otherTab.goto(fixture);
  await otherTab.getByLabel("표시 시간대").selectOption("Asia/Tokyo");
  fail = false;
  const before = (await sdkState(page)).serialized;
  await setting.getByRole("button", {name:"날짜와 시각 저장",exact:true}).click();
  await expect(setting.getByRole("status")).toContainText("설정을 저장했습니다");
  await expect(page.getByTestId("display-timezone")).toHaveText("America/New_York");
  await expect(otherTab.getByTestId("display-timezone")).toHaveText("America/New_York");
  await expect(otherTab.getByLabel("표시 시간대")).toHaveValue("Asia/Tokyo");
  await otherTab.getByRole("form",{name:"날짜와 시각 설정"}).getByRole("button",{name:"변경 취소"}).click();
  await expect(otherTab.getByLabel("표시 시간대")).toHaveValue("America/New_York");
  expect((await sdkState(page)).serialized).toBe(before);
  expect(writes).toEqual([{workspace_timezone:"America/New_York"},{workspace_timezone:"America/New_York"}]);
  await expect(page.getByTestId("display-date")).toContainText("2026. 10. 7.");
  await page.screenshot({path:info.outputPath("timezone-settings-390.png"),fullPage:true});
  await page.reload(); await expect(page.getByLabel("표시 시간대")).toHaveValue("America/New_York");
  await expect(page.getByRole("radio",{name:"기본",exact:true})).toBeChecked();
  expect(responseUser().user_metadata.provider_value).toBe("preserved");
  await page.getByLabel("표시 시간대").selectOption("");
  await page.getByRole("button",{name:"날짜와 시각 저장",exact:true}).click();
  await expect(otherTab.getByLabel("표시 시간대")).toHaveValue("");
  expect(timezone).toBeNull();
  await expect(page.getByTestId("display-timezone")).toHaveText(await page.evaluate(()=>Intl.DateTimeFormat().resolvedOptions().timeZone));
});

for (const width of [320, 390, 1440]) test(`프로필 ${width}px: 두 줄 스크롤·20개 선택·키보드·닉네임·팝오버·섹션별 저장`, async ({ page, context }, info) => {
  let metadata: Record<string, unknown> = { ...user.user_metadata, full_name: "기존 계정 이름", workspace_nickname: "별빛고양이", workspace_avatar_id: "cat", workspace_timezone: "Asia/Seoul" };
  let fail = true;
  const writes: Record<string, unknown>[] = [];
  await context.route("**/auth/v1/user", route => {
    if (route.request().method() === "PUT") {
      const changes = route.request().postDataJSON().data; writes.push(changes);
      if (fail) return route.fulfill({ status: 503, json: { msg: "fixture failure" } });
      metadata = { ...metadata, ...changes };
    }
    return route.fulfill({ json: { ...user, user_metadata: metadata } });
  });
  await page.setViewportSize({ width, height: 900 }); await page.goto(fixture);
  await expect(page.getByLabel("닉네임", {exact:true})).toHaveValue("별빛고양이");
  await expect(page.getByRole("radio")).toHaveCount(20);
  const choices = page.locator(".profile-choices");
  expect(await choices.evaluate(node => node.clientHeight)).toBe(128);
  const overflows = await choices.evaluate(node => node.scrollHeight > node.clientHeight);
  for (const box of await page.locator(".profile-choice").evaluateAll(nodes => nodes.map(node => { const r=node.getBoundingClientRect();return {w:r.width,h:r.height}; }))) { expect(box.w).toBeGreaterThanOrEqual(44);expect(box.h).toBeGreaterThanOrEqual(44); }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("radio", {name:"기본",exact:true}).focus();
  for(let i=0;i<19;i++)await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("radio",{name:"과녁",exact:true})).toBeChecked();
  if (overflows) expect(await choices.evaluate(node=>node.scrollTop)).toBeGreaterThan(0);
  else expect(await choices.evaluate(node=>node.scrollTop)).toBe(0);
  await page.getByLabel("닉네임", {exact:true}).fill("긴".repeat(40));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByLabel("닉네임", {exact:true}).fill("새 닉네임");
  await page.getByLabel("표시 시간대").selectOption("UTC");
  const otherTab=await context.newPage();await otherTab.goto(fixture);
  await otherTab.getByLabel("닉네임",{exact:true}).fill("다른 탭 초안");
  await page.getByRole("button",{name:"프로필 저장",exact:true}).click();
  await expect(page.getByRole("form",{name:"프로필 설정"}).getByRole("alert")).toContainText("입력한 설정을 유지");
  await expect(page.getByLabel("닉네임",{exact:true})).toHaveValue("새 닉네임");
  await expect(page.getByRole("radio",{name:"과녁",exact:true})).toBeChecked();
  fail=false; await page.getByRole("button",{name:"프로필 저장",exact:true}).click();
  await expect(page.getByRole("form",{name:"프로필 설정"}).getByRole("status")).toContainText("설정을 저장했습니다");
  expect(writes).toEqual(Array(2).fill({workspace_avatar_id:"target",workspace_nickname:"새 닉네임"}));
  await expect(page.getByLabel("표시 시간대")).toHaveValue("UTC");
  expect(metadata.workspace_timezone).toBe("Asia/Seoul");
  await page.getByRole("button",{name:"날짜와 시각 저장",exact:true}).click();
  await expect(page.getByRole("form",{name:"날짜와 시각 설정"}).getByRole("status")).toContainText("설정을 저장했습니다");
  expect(writes.at(-1)).toEqual({workspace_timezone:"UTC"});
  expect(metadata.provider_value).toBe("preserved");
  await expect(otherTab.getByLabel("닉네임",{exact:true})).toHaveValue("다른 탭 초안");
  await expect(otherTab.getByRole("radio",{name:"과녁",exact:true})).toBeChecked();
  await otherTab.getByRole("form",{name:"프로필 설정"}).getByRole("button",{name:"변경 취소",exact:true}).click();
  await expect(otherTab.getByLabel("닉네임",{exact:true})).toHaveValue("새 닉네임");
  await page.reload(); await expect(page.getByLabel("닉네임",{exact:true})).toHaveValue("새 닉네임");
  await page.getByRole("button",{name:/^내 프로필(?: · .+)?$/,exact:true}).click();
  const popup=page.locator("#nav-profile-options");await expect(popup).toContainText("새 닉네임");await expect(popup).not.toContainText(user.email);await expect(popup.locator(".profile-icon")).toHaveText("🎯");
  await page.screenshot({path:info.outputPath(`profile-popup-${width}.png`)});
  await page.keyboard.press("Escape");
  await page.getByLabel("닉네임",{exact:true}).fill(" ");await page.getByRole("button",{name:"프로필 저장",exact:true}).click();await expect(page.getByRole("form",{name:"프로필 설정"}).getByRole("status")).toContainText("설정을 저장했습니다");
  expect(writes.at(-1)).toEqual({workspace_nickname:null});
  await page.getByRole("button",{name:/^내 프로필(?: · .+)?$/,exact:true}).click();await expect(popup).toContainText("기존 계정 이름");
});

test("발급처 순서 저장 후 다시 읽어도 첫 행 기본값과 개별 방식을 유지한다",async({page,context})=>{
  let value={generation:"short",default_source:"app",sources:[{code:"app",label:"앱",generation:"short"},{code:"crm",label:"고객",generation:"manual"}]};
  let version=0;
  await context.route("**/settings/business{,?**}",route=>{
    if(route.request().method()==="PATCH"){value=route.request().postDataJSON().value;version++;}
    return route.fulfill({json:settingsResponse(route, {versions:{record_templates:0,entity_identity:version},settings:{record_templates:{},entity_identity:value}})});
  });
  await context.route("**/tags?**",route=>route.fulfill({json:{items:[],next_cursor:null}}));
  await page.goto(fixture);
  const section=page.locator('section[aria-labelledby="entity-identity-title"]');
  await section.getByRole("button",{name:"고객 위로 이동",exact:true}).click();
  await section.getByRole("button",{name:"식별자 설정 저장",exact:true}).click();
  await expect(section).toContainText("식별자 설정을 저장했습니다");
  expect(value.default_source).toBe("crm");
  await page.reload();
  await expect(section.getByLabel("발급처 1 이름")).toHaveValue("고객");
  await expect(section.getByLabel("발급처 1 방식")).toHaveValue("manual");
  await expect(section.getByLabel("발급처 2 방식")).toHaveValue("short");
  await section.getByRole("button",{name:"추가",exact:true}).click();
  await expect(section.getByLabel("발급처 3 이름")).toBeFocused();
});
