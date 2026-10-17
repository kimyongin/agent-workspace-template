import postgres from "postgres";
import { expect } from "@playwright/test";
import { devLogin, env, test, unique } from "./support.ts";
import { closeDetail, saveOnce } from "./ui-actions.ts";

// Real API/Auth/DB consumer round-trip. Run only in the serial integration environment.
test("settings type creation opens typed entity creation, immutable detail, and list return", async ({ page }) => {
  await devLogin(page);
  const login = await page.request.post(`${env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    headers: { apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY },
    data: { email: env.DEV_USER_A_EMAIL, password: env.DEV_USER_A_PASSWORD },
  });
  expect(login.ok()).toBe(true);
  const token = (await login.json()).access_token;
  const label = unique("탐색 자료"), title = unique("작성 자료");
  let typeId: string | undefined;
  try {
    await page.goto("/settings");
    await page.getByRole("button", { name: "설정 메뉴", exact: true }).click();
    await page.getByRole("navigation", { name: "설정 메뉴", exact: true }).getByRole("link", {
      name: "자료",
      exact: true,
    }).click();
    await page.getByLabel("자료 종류 이름", { exact: true }).fill(label);
    const creating = page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/entity-types") && response.request().method() === "POST"
    );
    await page.getByRole("button", { name: "자료 종류 만들기", exact: true }).click();
    const created = await creating;
    expect(created.ok()).toBe(true);
    typeId = (await created.json()).id;
    await page.goto(`/entities?entity_type_id=${typeId}&keyword=${encodeURIComponent(title)}`);
    await expect(page.getByRole("heading", { name: label, level: 1, exact: true })).toBeVisible();
    await page.getByRole("button", { name: `${label} 추가`, exact: true }).click();
    const form = page.getByRole("dialog", { name: `${label} 추가`, exact: true });
    await expect(form.getByLabel("자료 종류", { exact: true })).toHaveValue(typeId!);
    await form.getByLabel("이름", { exact: false }).fill(title);
    await expect(form.getByText("등록 시 자동 발급", { exact: true })).toBeVisible();
    await saveOnce(page, form);
    await expect(page).toHaveURL(/\/entities\//);
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    const entityId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
    const saved = await page.request.get(`${env.VITE_API_URL}/entities/${encodeURIComponent(entityId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(saved.ok()).toBe(true);
    const stored = await saved.json();
    expect(stored).toMatchObject({ entity_type_id: typeId, source: "app", properties: { prop_1: title } });
    expect(stored.external_id).toBeTruthy();
    expect(entityId).toBe(`app:${typeId}:${stored.external_id}`);
    await page.getByRole("button", { name: "편집", exact: true }).click();
    const editing = page.getByRole("dialog", { name: `${label} 편집`, exact: true });
    await expect(editing.getByLabel("자료 종류", { exact: true })).toHaveCount(0);
    await expect(editing.locator("dt:visible", { hasText: /^자료 번호$/ }).locator("../dd")).toHaveText(stored.external_id);
    await expect(editing.locator("dt:visible", { hasText: /^번호 출처$/ }).locator("../dd")).toHaveText(
      stored.source_label,
    );
    await expect(editing.getByRole("textbox", { name: /^(번호|자료 번호|번호 출처)$/ })).toHaveCount(0);
    const updatedTitle = `${title} 수정`;
    await editing.getByRole("textbox", { name: "이름 (필수)", exact: true }).fill(updatedTitle);
    await saveOnce(page, editing);
    await expect(editing).not.toBeVisible();
    const updated = await page.request.get(`${env.VITE_API_URL}/entities/${encodeURIComponent(entityId)}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(updated.ok()).toBe(true);
    const changed = await updated.json();
    expect(changed).toMatchObject({
      id: entityId,
      entity_type_id: typeId,
      source: stored.source,
      external_id: stored.external_id,
      properties: { prop_1: updatedTitle },
      version: stored.version + 1,
    });
    await closeDetail(page, updatedTitle);
    await expect(page).toHaveURL(new RegExp(`entity_type_id=${typeId}`));
    expect(new URL(page.url()).searchParams.get("keyword")).toBe(title);
    await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true }).click();
    await page.getByRole("link", { name: "설정", exact: true }).click();
    await page.getByRole("button", { name: "설정 메뉴", exact: true }).click();
    await page.getByRole("navigation", { name: "설정 메뉴", exact: true }).getByRole("link", {
      name: "자료",
      exact: true,
    }).click();
    await page.getByLabel("자료 종류 선택", { exact: true }).selectOption(typeId!);
    await expect(page).toHaveURL(new RegExp(`/settings/entity-types/${typeId}$`));
    await expect(page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true })).toHaveAttribute(
      "data-current",
      "true",
    );
    await page.reload();
    await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
    await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(label);
  } finally {
    if (typeId) {
      const database = postgres(env.LOCAL_DB_URL, { max: 1, onnotice: () => {} });
      try {
        await database`delete from app.entities where entity_type_id=${typeId}`;
        await database`delete from app.entity_types where id=${typeId}`;
      } finally {
        await database.end();
      }
    }
  }
});
