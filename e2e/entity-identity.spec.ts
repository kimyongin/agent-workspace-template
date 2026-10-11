import { expect, test } from "@playwright/test";
import { devLogin, env, unique } from "./support.ts";
import { beginTabAction, saveOnce } from "./ui-actions.ts";

test("manual tuple registration previews stored data, restores links, and rekeys URL safely", async ({ page }) => {
  await devLogin(page);
  const login = await page.request.post(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, { headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY }, data: { email: env.DEV_USER_A_EMAIL, password: env.DEV_USER_A_PASSWORD } });
  const token = (await login.json()).access_token;
  const api = async (method: string, path: string, data?: unknown) => {
    const response = await page.request.fetch(`${env.VITE_API_URL}${path}`, { method, headers: { authorization: `Bearer ${token}`,...(method!=="GET"?{"Idempotency-Key":crypto.randomUUID()}:{}) }, data });
    expect(response.ok()).toBeTruthy(); return response.status() === 204 ? null : response.json();
  };
  const original = await api("GET", "/settings/business");
  const external_id = `000Ab:/한글%${unique("식별자")}`, name = unique("보관 엔터티");
  let entityId: string | undefined, taskId: string | undefined;
  try {
    await api("PATCH", "/settings/business", { id:"entity_identity", expected_version:original.versions.entity_identity, value:{ ...original.settings.entity_identity, generation:"manual", default_source:"app", sources:original.settings.entity_identity.sources.map((source:{code:string})=>({...source,generation:"manual"})) } });
    await api("PATCH", "/settings/business", { id:"record_templates", expected_version:original.versions.record_templates, value:{...original.settings.record_templates,entity:{...original.settings.record_templates?.entity,delete:{memo:"삭제 템플릿",tag_ids:[]}}} });
    const target = await api("POST", "/entities", { source: "app", external_id, prop1: name, prop2: 0, prop4: "c" });
    entityId = target.id;
    const task = await api("POST", "/tasks", { kind: "once", title: unique("연결 보존"), entity_ids: [target.id] });
    taskId = task.id;
    await api("POST", `/entities/${encodeURIComponent(target.id)}/delete`, { expected_version: 1 });
    await page.goto("/entities");
    // Hold the settings response to verify identity inputs cannot race loaded defaults.
    let releaseSettings!: () => void;
    const settingsReady = new Promise<void>(resolve => { releaseSettings = resolve; });
    await page.route("**/settings/business{,?**}", async route => {
      if (route.request().method() !== "GET") return route.continue();
      await settingsReady;
      await route.continue();
    });
    await beginTabAction(page, "엔터티 추가");
    const form = page.getByRole("dialog", { name: "엔터티 추가", exact: true });
    await expect(form.getByLabel("식별자")).toBeDisabled();
    await expect(form.getByRole("button", { name: "기존 대상 확인", exact: true })).toBeDisabled();
    releaseSettings();
    await expect(form.getByLabel("식별자")).toBeEnabled();
    await form.getByRole("button", { name: "기존 대상 확인", exact: true }).click();
    await expect(form.getByRole("status")).toHaveText("식별자는 1~200자입니다");
    await form.getByLabel("식별자").fill(external_id);
    await form.getByRole("button", { name: "기존 대상 확인", exact: true }).click();
    const restore = page.getByRole("dialog", { name: "엔터티 복원", exact: true });
    await expect(restore.getByLabel("속성 1")).toHaveValue(name);
    await expect(restore.getByLabel("속성 2")).toHaveValue("0");
    await expect(restore.getByLabel("속성 4")).toHaveValue("c");
    await restore.getByLabel("속성 3").fill("2026-10-09");
    await saveOnce(page, restore);
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    const restored = await api("GET", `/entities/${encodeURIComponent(target.id)}`);
    expect([restored.deleted_at, restored.version, restored.prop2, restored.prop4]).toEqual([null, 3, 0, "c"]);
    expect((await api("GET", `/tasks/${task.id}`)).entity_ids).toEqual([target.id]);
    await page.getByRole("button", { name: "편집", exact: true }).click();
    const rekey = page.getByRole("dialog", { name: "엔터티 편집", exact: true });
    const next = `새:/ID%${unique("변경")}`;
    await rekey.getByLabel("식별자").fill(next);
    await saveOnce(page, rekey);
    entityId = `app:${next}`;
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(entityId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect((await api("GET", `/tasks/${task.id}`)).entity_ids).toEqual([entityId]);
    await expect(page.locator(`[id="tab-${`/entities/${encodeURIComponent(target.id)}`}"]`)).toHaveCount(0);
    await expect(page.getByRole("heading", {name,exact:true})).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", {name,exact:true})).toBeVisible();
    await page.getByRole("button", {name:"편집",exact:true}).click();
    await page.getByRole("button", {name:"삭제",exact:true}).click();
    const deletion = page.locator("dialog.modal-action[open]");
    await expect(deletion.getByLabel("기록 메모", {exact:true})).toHaveValue("삭제 템플릿");
    await deletion.getByLabel("기록 메모", {exact:true}).fill("");
    const request = page.waitForRequest(value => value.method() === "POST" && value.url().endsWith("/delete"));
    await deletion.getByRole("button", {name:"삭제하고 기록",exact:true}).click();
    expect((await request).postDataJSON().change_note).toBe("");
    await expect(deletion).toHaveCount(0);
    const events = await api("GET", "/records?record_kind=change&limit=100");
    const deletionEvent = events.items.find((event:{change?:{target_id:string;action:string}}) => event.change?.target_id === entityId && event.change.action === "delete");
    expect(deletionEvent.body).not.toBe("삭제 템플릿");
    expect(deletionEvent.body).toContain(name);
  } finally {
    if (taskId) { const task = await api("GET", `/tasks/${taskId}`); await api("DELETE", `/tasks/${taskId}?expected_version=${task.version}`); }
    if (entityId) { const target = await api("GET", `/entities/${encodeURIComponent(entityId)}`); if (!target.deleted_at) await api("POST", `/entities/${encodeURIComponent(entityId)}/delete`, { expected_version: target.version }); }
    const latest = await api("GET", "/settings/business");
    await api("PATCH", "/settings/business", { id:"entity_identity", expected_version:latest.versions.entity_identity, value:original.settings.entity_identity });
    await api("PATCH", "/settings/business", { id:"record_templates", expected_version:latest.versions.record_templates, value:original.settings.record_templates??{} });
  }
});


test("identity settings recovers from an initial read failure and preserves edits on refresh", async ({page}) => {
  await devLogin(page);
  let failSettings = true;
  await page.route("**/settings/business{,?**}", async route => {
    if (route.request().method() === "GET" && failSettings) return route.abort("failed");
    await route.continue();
  });
  await page.goto("/settings");
  const section = page.locator('section[aria-labelledby="entity-identity-title"]');
  await expect(section).toContainText("식별자 설정을 불러오지 못했습니다.");
  await expect(section.getByRole("form", {name:"엔터티 식별자 설정"})).toHaveCount(0);
  failSettings = false;
  await section.getByRole("button", {name:"다시 시도",exact:true}).click();
  const generation = section.getByLabel("발급처 1 방식");
  await expect(generation).toBeVisible();
  const previous = await generation.inputValue();
  const changed = previous === "short" ? "manual" : "short";
  await generation.selectOption(changed);
  await expect(section.getByRole("button", {name:"최신값 확인",exact:true})).toHaveCount(0);
  await page.route("**/settings/business{,?**}", async route => {
    if(route.request().method()==="PATCH") return route.fulfill({status:409,json:{error:{code:"conflict",message:"같은 설정에 다른 변경이 저장되어 있습니다.",fields:[]}}});
    return route.continue();
  });
  await section.getByRole("button", {name:"식별자 설정 저장",exact:true}).click();
  await section.getByRole("button", {name:"최신값 확인",exact:true}).click();
  await expect(section).toContainText("최신 설정을 읽었습니다. 초안을 보존했습니다.");
  await expect(generation).toHaveValue(changed);
  await expect(section.getByRole("button", {name:"식별자 설정 저장",exact:true})).toBeDisabled();
  await section.getByRole("button", {name:"최신값으로 다시 편집",exact:true}).click();
  await expect(generation).toHaveValue(previous);
});

test("late archived lookup preserves newer identity and same-identity property edits", async ({ page }) => {
  await devLogin(page);
  await page.goto("/entities");
  await beginTabAction(page, "엔터티 추가");
  const form = () => page.getByRole("dialog", { name: "엔터티 추가", exact: true });
  await expect(form().getByLabel("식별자")).toBeEnabled();
  const source = await form().getByLabel("발급처").inputValue();
  const identity = unique("지연 식별자");
  const held: (() => Promise<void>)[] = [];
  let lookupNumber = 0;
  await page.route("**/entities/*", async route => {
    if (route.request().method() !== "GET") return route.continue();
    const number = ++lookupNumber;
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let delivered!: () => void;
    const done = new Promise<void>(resolve => { delivered = resolve; });
    held.push(async () => { release(); await done; });
    await gate;
    await route.fulfill({ json: {
      id: `${source}:${identity}`, source, external_id: identity, prop1: `보관된 값 ${number}`, prop2: 0,
      prop3: null, prop4: "a", tag_ids: [], version: 2, deleted_at: "2026-10-10T00:00:00Z",
      created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-10T00:00:00Z",
    } });
    delivered();
  });
  const start = async () => {
    const requested = page.waitForRequest(value => value.method() === "GET" && value.url().includes("/entities/"));
    await form().getByRole("button", { name: "기존 대상 확인", exact: true }).click();
    await requested;
    await expect.poll(() => held.length).toBeGreaterThan(0);
  };
  const settle = async (index = 0) => {
    await held.splice(index, 1)[0]();
    // Let React commit the response before checking the still-current input.
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  };
  await form().getByLabel("식별자").fill(identity);
  await start();
  await form().getByLabel("식별자").fill("다른 식별자");
  await form().getByLabel("속성 1").fill("새 입력");
  await settle();
  await expect(form().getByLabel("식별자")).toHaveValue("다른 식별자");
  await expect(form().getByLabel("속성 1")).toHaveValue("새 입력");

  await form().getByLabel("식별자").fill(identity);
  await start();
  await form().getByLabel("속성 1").fill("같은 식별자에서 수정");
  await settle();
  await expect(form().getByLabel("속성 1")).toHaveValue("같은 식별자에서 수정");
  await start();
  await start();
  await settle(1);
  const restore = page.getByRole("dialog", { name: "엔터티 복원", exact: true });
  await expect(restore.getByLabel("속성 1")).toHaveValue("보관된 값 4");
  await settle();
  await expect(restore.getByLabel("속성 1")).toHaveValue("보관된 값 4");
  await restore.getByRole("button", { name: "취소", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "변경을 버릴까요?" });
  if (await discard.isVisible()) await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await beginTabAction(page, "엔터티 추가");
  await expect(form().getByLabel("식별자")).toBeEnabled();
  await form().getByLabel("식별자").fill(identity);
  await start();
  await form().getByRole("button", { name: "취소", exact: true }).click();
  if (await discard.isVisible()) await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await beginTabAction(page, "엔터티 추가");
  await expect(form().getByLabel("식별자")).toBeEnabled();
  const newIdentity = await form().getByLabel("식별자").inputValue();
  await settle();
  await expect(form().getByLabel("식별자")).toHaveValue(newIdentity);
  await expect(form().getByLabel("속성 1")).toHaveValue("");
});

test("manual lookup pending before confirmation cannot replace the prepared entity", async ({ page }) => {
  await devLogin(page);
  await page.goto("/entities");
  await beginTabAction(page, "엔터티 추가");
  const form = page.getByRole("dialog", { name: "엔터티 추가", exact: true });
  await expect(form.getByLabel("식별자")).toBeEnabled();
  const source = await form.getByLabel("발급처").inputValue();
  const identity = unique("확인 중 조회"), title = unique("지킬 입력");
  await form.getByLabel("식별자").fill(identity);
  await form.getByLabel("속성 1").fill(title);
  let release!: () => void, delivered!: () => void, reads = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const done = new Promise<void>(resolve => { delivered = resolve; });
  await page.route("**/entities/*", async route => {
    if (route.request().method() !== "GET" || ++reads !== 1) return route.continue();
    await gate;
    await route.fulfill({ json: {
      id: `${source}:${identity}`, source, external_id: identity, prop1: "옛 보관값", prop2: 0,
      prop3: null, prop4: "a", tag_ids: [], version: 2, deleted_at: "2026-10-10T00:00:00Z",
      created_at: "2026-10-10T00:00:00Z", updated_at: "2026-10-10T00:00:00Z",
    } });
    delivered();
  });
  const started = page.waitForRequest(value => value.method() === "GET" && value.url().includes("/entities/"));
  await form.getByRole("button", { name: "기존 대상 확인", exact: true }).click();
  await started;
  const prepared = page.waitForResponse(value => value.request().method() === "POST" && value.url().endsWith("/records/prepare"));
  await form.getByRole("button", { name: "저장", exact: true }).click();
  const defaults = await (await prepared).json();
  const confirmation = page.locator("dialog.modal-action[open]");
  await expect(confirmation.getByLabel("기록 메모", { exact: true })).toHaveValue(defaults.change_note);
  release();
  await done;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await expect(confirmation.getByRole("button", { name: "등록하고 저장", exact: true })).toBeEnabled();
  await expect(confirmation.getByRole("heading")).toContainText(title);
  await expect(confirmation.getByLabel("기록 메모", { exact: true })).toHaveValue(defaults.change_note);
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await expect(form.getByLabel("속성 1")).toHaveValue(title);
});
