import { APP_IDENTIFIER_RULE_ID } from "../supabase/functions/_shared/contracts/entity-issuer.ts";
import { decodeIdentifierReference, encodeIdentifierValue } from "../supabase/functions/_shared/contracts/entity-identifiers.ts";
import { chooseSetting } from "./settings-actions.ts";
import { openMainNavigation } from "./ui-actions.ts";
import { expect } from "@playwright/test";
import { devLogin, test, unique, ownedWorkspace, workspacePath } from "./support.ts";
import { closeDetail, saveOnce } from "./ui-actions.ts";

// Real API/Auth/DB consumer round-trip. Run only in the serial integration environment.
test("settings type creation opens typed entity creation, immutable detail, and list return", async ({ page }) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const label = unique("탐색 자료"), title = unique("작성 자료");
  let typeId: string | undefined;
  await page.goto(workspacePath(workspace.id, "/settings"));
  await openMainNavigation(page);
  await page.getByRole("navigation", { name: "주 메뉴", exact: true }).getByRole("link", { name: "자료 설정",
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
  await workspace.grantKind(typeId!);
  await page.goto(workspacePath(workspace.id, `/entities?entity_type_id=${typeId}&keyword=${encodeURIComponent(title)}`));
  await expect(page.getByRole("heading", { name: label, level: 1, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `${label} 추가`, exact: true }).click();
  const form = page.getByRole("dialog", { name: `${label} 추가`, exact: true });
  await expect(form.getByLabel("자료 종류", { exact: true })).toHaveValue(label);
  await form.getByLabel("이름", { exact: false }).fill(title);
  await expect(form.getByText("저장 시 자동 발급", { exact: true })).toBeVisible();
  await saveOnce(page, form);
  await expect(page).toHaveURL(/\/entities\//);
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  const entityId = decodeURIComponent(new URL(page.url()).pathname.split("/").pop()!);
  const saved = await workspace.fetch("GET", `/entities/${encodeURIComponent(entityId)}`);
  expect(saved.ok()).toBe(true);
  const stored = await saved.json();
  const identifier = decodeIdentifierReference(entityId);
  expect(identifier).toMatchObject({ entity_type_id: typeId, kind_id: APP_IDENTIFIER_RULE_ID });
  expect(identifier.raw).toBeTruthy();
  expect(stored).toMatchObject({ entity_type_id: typeId, properties: { prop_1: title, prop_2: encodeIdentifierValue(APP_IDENTIFIER_RULE_ID, identifier.raw) } });
  expect(stored).not.toHaveProperty("external_id");
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const editing = page.getByRole("dialog", { name: `${label} 편집`, exact: true });
  await expect(editing.getByLabel("자료 종류", { exact: true })).toHaveCount(0);
  await expect(editing.locator("dt:visible", { hasText: /^식별자 · 자료 식별자$/ }).locator("../dd")).toHaveText(stored.identity_label);
  await expect(editing.getByRole("textbox", { name: /^(식별자|번호|자료 번호|번호 출처)$/ })).toHaveCount(0);
  const updatedTitle = `${title} 수정`;
  await editing.getByRole("textbox", { name: "이름 (필수)", exact: true }).fill(updatedTitle);
  await saveOnce(page, editing);
  await expect(editing).not.toBeVisible();
  const updated = await workspace.fetch("GET", `/entities/${encodeURIComponent(entityId)}`);
  expect(updated.ok()).toBe(true);
  const changed = await updated.json();
  expect(changed).toMatchObject({
    id: entityId,
    entity_type_id: typeId,
    properties: { prop_1: updatedTitle, prop_2: stored.properties.prop_2 },
    version: stored.version + 1,
  });
  await closeDetail(page, updatedTitle);
  await expect(page).toHaveURL(new RegExp(`entity_type_id=${typeId}`));
  expect(new URL(page.url()).searchParams.get("keyword")).toBe(title);
  await openMainNavigation(page);
  await page.getByRole("link", { name: "기본 설정", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("heading", { name: "기본 설정", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "주 메뉴", exact: true, includeHidden: true })).toHaveCount(0);
  await openMainNavigation(page);
  await page.getByRole("navigation", { name: "주 메뉴", exact: true }).getByRole("link", { name: "자료 설정",
    exact: true,
  }).click();
  await chooseSetting(page, page.getByLabel("자료 종류 선택", { exact: true }), label);
  await expect(page).toHaveURL(new RegExp(`/settings/entity-types/${typeId}$`));
  await page.reload();
  await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(label);
});
