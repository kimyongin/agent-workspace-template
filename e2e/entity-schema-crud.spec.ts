import { executionDialog } from "./ui-actions.ts";
import { expect } from "@playwright/test";
import postgres from "postgres";
import { devLogin, env, mcpClient, mcpTokenViaConsent, test, unique } from "./support.ts";
import { saveOnce } from "./ui-actions.ts";
import { analyzeAndApply } from "./entity-schema-support.ts";
import { initialEntityDefinition } from "../supabase/functions/_shared/contracts/entity-type.ts";

test("다중 타입 여섯 속성을 MCP로 저장하고 웹 전체 상세 편집은 summary에 없는 값도 유지한다", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  const admin = postgres(env.LOCAL_DB_URL, { max: 1, onnotice: () => {} });
  let typeId: string | undefined, entityId: string | undefined;
  try {
    const type = await mcp.call("create_entity_type", {
      label: unique("시험 자료"),
      icon_id: "leaf",
      representative_label: "이름",
    });
    typeId = type.id;
    const definition = initialEntityDefinition("이름");
    Object.assign(definition.schema.properties, {
      prop_2: { "x-order": 20, type: ["integer", "null"], title: "개수", default: 0 },
      prop_3: { "x-order": 30, type: ["number", "null"], title: "무게" },
      prop_4: { "x-order": 40, type: ["string", "null"], format: "date", title: "확인 날짜" },
      prop_5: { "x-order": 50, type: ["boolean", "null"], title: "검사" },
      prop_6: {
        "x-order": 60,
        type: ["string", "null"],
        oneOf: [{ const: "a" }, { const: "b" }, { const: null }],
        title: "구분",
      },
    });
    ["prop_1", "prop_2", "prop_3", "prop_4", "prop_5", "prop_6"].forEach((key, index) => {
      definition.schema.properties[key]["x-order"] = (index + 1) * 10;
    });
    Object.entries(definition.schema.properties).forEach(([key, field]) => {
      field["x-show-in-list"] = ["prop_1"].includes(key);
    });
    const change = await mcp.call("create_entity_schema_change", {
      type_id: typeId,
      expected_schema_version: 1,
      edits: Object.entries(definition.schema.properties).filter(([key]) => key !== "prop_1").map(([key, field]) => ({
        op: "add_property",
        client_ref: key,
        field,
        required: false,
      })),
    });
    await analyzeAndApply(mcp, typeId!, change.id, change.version);
    const title = unique("검증 대상");
    const created = await mcp.call("create_entity", {
      entity_type_id: typeId,
      schema_version: 2,
      properties: { prop_1: title, prop_2: 0, prop_3: 1.25, prop_4: "2024-02-29", prop_5: false, prop_6: "b" },
    });
    entityId = created.id;
    const listed = await mcp.call("list_entities", { entity_type_id: typeId });
    expect(listed.items[0].display_properties).not.toHaveProperty("prop_3");
    await page.goto(`/entities/${encodeURIComponent(entityId!)}`);
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("확인 날짜", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "편집", exact: true }).click();
    const form = page.getByRole("dialog", { name: `${type.label} 편집`, exact: true });
    await expect(form.getByLabel("무게", { exact: true })).toHaveValue("1.25");
    await expect(form.getByLabel("검사", { exact: true })).toHaveValue("value:false");
    const updatedTitle = unique("수정 대상");
    await form.getByLabel("이름", { exact: false }).fill(updatedTitle);
    await form.getByLabel("무게", { exact: true }).fill("0");
    await form.getByLabel("검사", { exact: true }).selectOption("value:true");
    await saveOnce(page, form);
    const saved = await mcp.call("get_entity", { id: entityId });
    expect(saved.properties).toEqual({
      prop_1: updatedTitle,
      prop_2: 0,
      prop_3: 0,
      prop_4: "2024-02-29",
      prop_5: true,
      prop_6: "b",
    });
    expect(saved.entity_type_id).toBe(typeId);
    await page.getByRole("button", { name: "편집", exact: true }).click();
    const stale = page.getByRole("dialog", { name: `${type.label} 편집`, exact: true });
    await stale.getByLabel("이름", { exact: false }).fill("실패해도 보존할 초안");
    const currentType = await mcp.call("get_entity_type", { type_id: typeId });
    const next = await mcp.call("create_entity_schema_change", {
      type_id: typeId,
      expected_schema_version: 2,
      edits: [{
        op: "update_property",
        key: "prop_1",
        field: { ...definition.schema.properties.prop_1, description: "次の定義" },
        required: true,
      }],
    });
    await analyzeAndApply(mcp, typeId!, next.id, next.version);
    await stale.getByRole("button", { name: "저장", exact: true }).click();
    await expect(executionDialog(page).getByRole("alert")).toBeVisible();
    await executionDialog(page).getByRole("button", { name: "취소", exact: true }).click();
    await expect(stale.getByLabel("이름", { exact: false })).toHaveValue("실패해도 보존할 초안");
    expect((await mcp.call("get_entity", { id: entityId })).properties.prop_1).toBe(updatedTitle);
    await stale.getByRole("button", { name: "속성 정의 다시 조회", exact: true }).click();
    await expect(stale.getByRole("region", { name: "현재 속성 정의 검토" })).toContainText("현재 정의 버전 3");
    await expect(stale.getByLabel("이름", { exact: false })).toHaveValue("실패해도 보존할 초안");
    await stale.getByRole("button", { name: "확인한 정의로 편집", exact: true }).click();
    await expect(stale.getByRole("region", { name: "현재 속성 정의 검토" })).toHaveCount(0);
    await expect(stale.getByText("次の定義", { exact: true })).toBeVisible();
    await expect(stale.getByLabel("이름", { exact: false })).toHaveValue("실패해도 보존할 초안");
    await saveOnce(page, stale);
    const recovered = await mcp.call("get_entity", { id: entityId });
    expect(recovered.properties.prop_1).toBe("실패해도 보존할 초안");
    expect(recovered.schema_version).toBe(3);
    expect(recovered.version).toBe(saved.version + 1);
  } finally {
    await mcp.close();
    if (entityId) await admin`delete from app.entities where id=${entityId}`;
    if (typeId) await admin`delete from app.entity_types where id=${typeId}`;
    await admin.end();
  }
});
