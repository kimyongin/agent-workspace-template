import { expect, test } from "@playwright/test";
import { devLogin, env, unique } from "./support.ts";
import { beginTabAction, saveOnce } from "./ui-actions.ts";

test("manual tuple registration previews stored data, restores links, and rekeys URL safely", async ({ page }) => {
  await devLogin(page);
  const login = await page.request.post(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, { headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY }, data: { email: env.DEV_USER_A_EMAIL, password: env.DEV_USER_A_PASSWORD } });
  const token = (await login.json()).access_token;
  const api = async (method: string, path: string, data?: unknown) => {
    const response = await page.request.fetch(`${env.VITE_API_URL}${path}`, { method, headers: { authorization: `Bearer ${token}` }, data });
    expect(response.ok()).toBeTruthy(); return response.status() === 204 ? null : response.json();
  };
  const original = await api("GET", "/settings/business");
  const external_id = `000Ab:/한글%${unique("식별자")}`, name = unique("보관 엔터티");
  let entityId: string | undefined, taskId: string | undefined;
  try {
    await api("PATCH", "/settings/business", { expected_version: original.version, sections: { entity_identity: { ...original.settings.entity_identity, generation: "manual", default_source: "app" } } });
    const target = await api("POST", "/entities", { source: "app", external_id, prop1: name, prop2: 0, prop4: "c" });
    entityId = target.id;
    const task = await api("POST", "/tasks", { id: crypto.randomUUID(), kind: "once", title: unique("연결 보존"), entity_ids: [target.id] });
    taskId = task.id;
    await api("POST", `/entities/${encodeURIComponent(target.id)}/delete`, { expected_version: 1 });
    await page.goto("/entities");
    // Hold the settings response to verify identity inputs cannot race loaded defaults.
    let releaseSettings!: () => void;
    const settingsReady = new Promise<void>(resolve => { releaseSettings = resolve; });
    await page.route("**/settings/business", async route => {
      if (route.request().method() !== "GET") return route.continue();
      await settingsReady;
      await route.continue();
    });
    await beginTabAction(page, "엔터티 추가");
    const form = page.getByRole("dialog", { name: "엔터티 추가", exact: true });
    await expect(form.getByLabel("외부 식별자")).toBeDisabled();
    await expect(form.getByRole("button", { name: "기존 대상 확인", exact: true })).toBeDisabled();
    releaseSettings();
    await expect(form.getByLabel("외부 식별자")).toBeEnabled();
    await form.getByRole("button", { name: "기존 대상 확인", exact: true }).click();
    await expect(form.getByRole("status")).toHaveText("식별자는 1~200자입니다");
    await form.getByLabel("외부 식별자").fill(external_id);
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
    await page.getByRole("button", { name: "식별 정보 변경", exact: true }).click();
    const rekey = page.getByRole("dialog", { name: "식별 정보 변경", exact: true });
    const next = `새:/ID%${unique("변경")}`;
    await rekey.getByLabel("외부 식별자").fill(next);
    await saveOnce(page, rekey, "변경");
    entityId = `app:${next}`;
    await expect(page).toHaveURL(new RegExp(encodeURIComponent(entityId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    expect((await api("GET", `/tasks/${task.id}`)).entity_ids).toEqual([entityId]);
  } finally {
    if (taskId) { const task = await api("GET", `/tasks/${taskId}`); await api("DELETE", `/tasks/${taskId}?expected_version=${task.version}`); }
    if (entityId) { const target = await api("GET", `/entities/${encodeURIComponent(entityId)}`); if (!target.deleted_at) await api("POST", `/entities/${encodeURIComponent(entityId)}/delete`, { expected_version: target.version }); }
    const latest = await api("GET", "/settings/business");
    await api("PATCH", "/settings/business", { expected_version: latest.version, sections: { entity_identity: original.settings.entity_identity } });
  }
});


test("identity settings recovers from an initial read failure and preserves edits on refresh", async ({page}) => {
  await devLogin(page);
  let failSettings = true;
  await page.route("**/settings/business", async route => {
    if (route.request().method() === "GET" && failSettings) return route.abort("failed");
    await route.continue();
  });
  await page.goto("/settings");
  const section = page.locator('section[aria-labelledby="entity-identity-title"]');
  await expect(section).toContainText("식별자 설정을 불러오지 못했습니다.");
  await expect(section.getByRole("form", {name:"엔터티 식별자 설정"})).toHaveCount(0);
  failSettings = false;
  await section.getByRole("button", {name:"최신 설정 조회",exact:true}).click();
  const generation = section.getByLabel("새 엔터티 식별자 발급 방식");
  await expect(generation).toBeVisible();
  const previous = await generation.inputValue();
  const changed = previous === "uuid" ? "manual" : "uuid";
  await generation.selectOption(changed);
  await section.getByRole("button", {name:"최신 설정 조회",exact:true}).click();
  await expect(section).toContainText("최신 버전을 불러왔습니다. 입력은 유지했습니다.");
  await expect(generation).toHaveValue(changed);
  await section.getByRole("button", {name:"변경 취소",exact:true}).click();
  await expect(generation).toHaveValue(previous);
});
