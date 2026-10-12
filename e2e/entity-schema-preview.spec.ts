import { expect } from "@playwright/test";
import postgres from "postgres";
import { test, devLogin, env, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";
import { schemaAnalysisTick } from "./entity-schema-support.ts";
test("값 변환 준비: 저장된 직접 링크·실패 행 보완·재분석·MCP 결과·stale·모바일 초안 보존", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page)),
    admin = postgres(env.LOCAL_DB_URL, { max: 1, onnotice: () => {} });
  let typeId: string | undefined, entityId: string | undefined;
  try {
    const type = await mcp.call("create_entity_type", { label: unique("변환 준비") });
    typeId = type.id;
    const entity = await mcp.call("create_entity", {
      entity_type_id: typeId,
      schema_version: 1,
      properties: { prop_1: "001" },
    });
    entityId = entity.id;
    const plan = await mcp.call("create_entity_schema_change", {
      type_id: typeId,
      expected_type_version: 1,
      expected_schema_version: 1,
      edits: [{
        op: "update_property",
        key: "prop_1",
        field: { type: "string", title: "이름", minLength: 1, maxLength: 2 },
        required: true,
      }],
    });
    const path = `/settings/entity-types/${typeId}/migrations?change_id=${plan.id}`;
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "변경 요약 · 초안 버전 1" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "변경 요약 · 초안 버전 1" })).toBeVisible();
    await page.getByRole("button", { name: "영향 분석", exact: true }).click();
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: plan.id })).analysis?.status;
    }, { timeout: 30000 }).toBe("succeeded");
    const row = page.locator("article").filter({
      has: page.getByRole("heading", { name: `${entity.id} · 변환 실패` }),
    });
    await expect(row).toBeVisible();
    await expect(row).toContainText('"001"');
    await row.getByRole("button", { name: "보완값 지정", exact: true }).click();
    await row.getByRole("textbox", { name: "보완값", exact: true }).fill("01");
    await page.getByRole("link", { name: "속성·표시로 돌아가기" }).click();
    const dialog = page.getByRole("dialog", { name: "변경을 버릴까요?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    await expect(row.getByRole("textbox", { name: "보완값", exact: true })).toHaveValue("01");
    await page.getByRole("button", { name: "변경 초안 저장", exact: true }).click();
    await expect(page.getByRole("heading", { name: "변경 요약 · 초안 버전 2" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "변경 요약 · 초안 버전 2" })).toBeVisible();
    const httpRows = page.waitForResponse((r) =>
      r.url().includes(`/schema-changes/${plan.id}/rows?`) && r.status() === 200
    );
    await page.getByRole("button", { name: "영향 분석", exact: true }).click();
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: plan.id })).executable;
    }, { timeout: 30000 }).toBe(true);
    const fresh = await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: plan.id });
    const rows = await mcp.call("list_entity_schema_analysis_rows", {
      type_id: typeId,
      change_id: plan.id,
      analysis_id: fresh.analysis.id,
    });
    expect(await (await httpRows).json()).toEqual(rows);
    expect(rows.items[0].before).toEqual({ prop_1: "001" });
    expect(rows.items[0].after).toEqual({ prop_1: "01" });
    expect(fresh.analysis.changed).toBe(1);
    expect((await mcp.call("get_entity", { id: entity.id })).properties).toEqual({ prop_1: "001" });
    await mcp.call("update_entity", {
      id: entity.id,
      expected_version: entity.version,
      schema_version: 1,
      properties: { prop_1: "002" },
    });
    expect((await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: plan.id })).status).toBe("stale");
    await page.reload();
    await expect(page.getByText("정의나 자료가 변경되었습니다. 최신 정의를 확인하고 새 변경을 만드세요."))
      .toBeVisible();
    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
  } finally {
    await mcp.close();
    if (entityId) await admin`delete from app.entities where id=${entityId}`;
    if (typeId) await admin`delete from app.entity_types where id=${typeId}`;
    await admin.end();
  }
});

test("늦은 전체 결과가 새 실패 필터의 분석 페이지를 덮어쓰지 않는다", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page)),
    admin = postgres(env.LOCAL_DB_URL, { max: 1, onnotice: () => {} });
  let typeId: string | undefined;
  const ids: string[] = [];
  let release = () => {};
  try {
    const type = await mcp.call("create_entity_type", { label: unique("페이지 경쟁") });
    typeId = type.id;
    const bad = await mcp.call("create_entity", {
        entity_type_id: typeId,
        schema_version: 1,
        properties: { prop_1: "too long" },
      }),
      good = await mcp.call("create_entity", {
        entity_type_id: typeId,
        schema_version: 1,
        properties: { prop_1: "OK" },
      });
    ids.push(bad.id, good.id);
    const plan = await mcp.call("create_entity_schema_change", {
      type_id: typeId,
      expected_type_version: 1,
      expected_schema_version: 1,
      edits: [{
        op: "update_property",
        key: "prop_1",
        field: { type: "string", minLength: 1, maxLength: 2 },
        required: true,
      }],
    });
    await mcp.call("analyze_entity_schema_change", { type_id: typeId, change_id: plan.id, expected_change_version: 1 });
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: plan.id })).analysis?.status;
    }).toBe("succeeded");
    const delayed = new Promise<void>((resolve) => {
      release = resolve;
    });
    let intercepted = false;
    await page.route(`**/schema-changes/${plan.id}/rows?**`, async (route) => {
      if (!intercepted && route.request().url().includes("failures_only=false")) {
        intercepted = true;
        const response = await route.fetch();
        await delayed;
        try {
          await route.fulfill({ response });
        } catch { /* Aborted response must not update the page. */ }
      } else await route.continue();
    });
    await page.goto(`/settings/entity-types/${typeId}/migrations?change_id=${plan.id}`);
    await expect.poll(() => intercepted).toBe(true);
    await page.getByLabel("실패한 자료만 보기").check();
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article")).toContainText(bad.id);
    release();
    await expect(page.locator("article")).toHaveCount(1);
    await expect(page.locator("article")).not.toContainText(good.id);
  } finally {
    release();
    await mcp.close();
    if (ids.length) await admin`delete from app.entities where id=any(${ids}::text[])`;
    if (typeId) await admin`delete from app.entity_types where id=${typeId}`;
    await admin.end();
  }
});
