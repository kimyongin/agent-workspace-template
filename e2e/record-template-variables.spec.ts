import { chooseSetting } from "./settings-actions.ts";
import { expect } from "@playwright/test";
import { createFixtureEntity, scalarFixtureType } from "./entity-schema-support.ts";
import { devLogin, mcpClient, mcpTokenViaConsent, test } from "./support.ts";

test("속성 이름으로 작성한 문구는 안정 키로 저장되고 MCP의 실제 변경 메모에 사용된다", async ({ page }, info) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const type = await scalarFixtureType(mcp);
    const entity = await createFixtureEntity(mcp, { prop_1: "문구 검사", prop_2: 0 });
    await page.goto("/settings/records");
    await chooseSetting(page, page.getByLabel("대상", { exact: true }), type.label);
    let form = page.getByRole("form", { name: "기록 자동 완성", exact: true });
    await chooseSetting(page, form.getByLabel("액션", { exact: true }), "수정");
    let memo = form.getByRole("textbox", { name: "메모 템플릿", exact: true });
    await memo.fill("수량 ");
    await chooseSetting(page, form.getByLabel("변수 삽입", { exact: true }), "수량 · 이전");
    await page.keyboard.insertText(" → ");
    await chooseSetting(page, form.getByLabel("변수 삽입", { exact: true }), "수량 · 이후");
    await expect(memo).toHaveText("수량 수량 · 이전 → 수량 · 이후");
    await expect(memo).not.toContainText("prop_");
    await form.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
    await expect(form).toContainText("기록 자동 완성을 저장했습니다.");
    const settings = await mcp.call("get_business_settings", { id: "record_templates" });
    expect(settings.settings.record_templates.entity_types[type.id].update.memo)
      .toBe("수량 $엔터티.이전.prop_2$ → $엔터티.이후.prop_2$");

    await page.reload();
    await chooseSetting(page, page.getByLabel("대상", { exact: true }), type.label);
    form = page.getByRole("form", { name: "기록 자동 완성", exact: true });
    await chooseSetting(page, form.getByLabel("액션", { exact: true }), "수정");
    memo = form.getByRole("textbox", { name: "메모 템플릿", exact: true });
    await expect(memo).toHaveText("수량 수량 · 이전 → 수량 · 이후");
    const input = {
      schema_version: type.schema_version,
      properties: { prop_2: 2 },
    };
    const prepared = await mcp.call("prepare_record_memo", {
      model: "entity",
      action: "update",
      target_id: entity.id,
      expected_version: entity.version,
      input,
    });
    expect(prepared.change_note).toBe("수량 0 → 2");
    const updated = await mcp.call("update_entity", {
      id: entity.id,
      expected_version: entity.version,
      ...input,
      change_note: prepared.change_note,
    });
    expect(updated.properties.prop_2).toBe(2);
    const records = await mcp.call("list_records", { record_kind: "change", limit: 100 });
    const change = records.items.find((record: { change?: { target_id: string; action: string } }) => {
      const metadata = record.change;
      return !!metadata && metadata.target_id === entity.id && metadata.action === "update";
    });
    expect(change?.body).toBe("수량 0 → 2");
    await page.screenshot({ path: info.outputPath("readable-template-saved.png"), fullPage: true });
  } finally {
    await mcp.close();
  }
});
