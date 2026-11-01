import { expect } from "@playwright/test";
import {
  devLogin,
  env,
  mcpClient,
  mcpTokenViaConsent,
  ownedWorkspace,
  test,
  unique,
  workspacePath,
} from "./support.ts";
import { detailDialog, executionDialog, saveOnce } from "./ui-actions.ts";

test(
  "actual material text: publish a field, preserve multiline creation and cancelled confirmation through public reads",
  async ({ page }, info) => {
    await devLogin(page);
    const workspace = await ownedWorkspace(page);
    const client = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
    try {
      const type = await client.call("create_entity_type", {
        label: unique("절차 검증"),
        icon_id: "book",
        initial_property_label: "기준명",
      });
      await workspace.grantKind(type.id);
      await page.goto(workspacePath(workspace.id, `/settings/entity-types/${type.id}`));
      await page.getByRole("button", { name: "입력 항목", exact: true }).click();
      await page.getByRole("button", { name: "다음 항목 추가", exact: true }).click();
      const added = page.getByRole("region", { name: "새 항목 입력 항목", exact: true });
      await expect(added.getByRole("textbox", { name: "항목 이름", exact: true })).toBeFocused();
      await added.getByRole("textbox", { name: "항목 이름", exact: true }).fill("점검 절차");
      await page.getByRole("button", { name: "변경 검토", exact: true }).click();
      const inputs = page.getByRole("region", { name: "입력 항목", exact: true });
      await inputs.getByRole("button", { name: "변경 적용", exact: true }).click();
      await expect(inputs.getByRole("button", { name: "다음 항목 추가", exact: true })).toBeEnabled();
      const definition = await client.call("get_entity_schema", { type_id: type.id });
      expect(definition.schema.properties.prop_3.title).toBe("점검 절차");

      await page.goto(workspacePath(workspace.id, `/entities?entity_type_id=${type.id}`));
      await page.getByRole("button", { name: `${type.label} 추가`, exact: true }).click();
      const title = unique("공통 안전 점검");
      const procedure = "1. 전원 차단\n2. 잠금 표찰 확인\n3. φ25 씰·가드 복구 — 정상 😀";
      await detailDialog(page).getByRole("textbox", { name: "기준명 (필수)", exact: true }).fill(title);
      await detailDialog(page).getByRole("textbox", { name: "점검 절차", exact: true }).fill(procedure);
      const createdResponse = page.waitForResponse((response) =>
        response.request().method() === "POST" && response.url() === `${env.VITE_API_URL}/entities`
      ).then(async (response) => ({ response, body: await response.json() }));
      await saveOnce(page, detailDialog(page));
      const { response, body: created } = await createdResponse;
      expect(response.ok()).toBeTruthy();
      expect(response.request().headers()["x-workspace-id"]).toBe(workspace.id);
      const stored = await client.call("get_entity", { id: created.id });
      expect(stored.properties.prop_3).toBe(procedure);
      await detailDialog(page).getByRole("button", { name: "편집", exact: true }).click();
      const updated = procedure + "\n4. 담당자 입회하에 시험 운전";
      const field = detailDialog(page).getByRole("textbox", { name: "점검 절차", exact: true });
      await expect(field).toHaveValue(procedure);
      await field.fill(updated);
      await detailDialog(page).getByRole("button", { name: "저장", exact: true }).click();
      await executionDialog(page).getByRole("button", { name: "취소", exact: true }).click();
      await expect(field).toHaveValue(updated);
      expect((await client.call("get_entity", { id: created.id })).properties.prop_3).toBe(procedure);
      await saveOnce(page, detailDialog(page));
      const saved = await client.call("get_entity", { id: created.id });
      expect(saved.id).toBe(created.id);
      expect(saved.properties.prop_3).toBe(updated);
      expect(saved.properties.prop_2).toBe(stored.properties.prop_2);
      await expect(detailDialog(page).getByRole("button", { name: "편집", exact: true })).toBeVisible();
      await page.screenshot({ path: info.outputPath("actual-multiline-saved.png"), fullPage: true });
    } finally {
      await client.close();
    }
  },
);
