import { entityIdentityLabel } from "../supabase/functions/_shared/contracts/entity-identity.ts";
import { businessRows, entryDetails } from "./table-actions.ts";
import { closeMainNavigation, openMainNavigation } from "./ui-actions.ts";
import { expect } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, test, unique, ownedWorkspace, workspacePath} from "./support.ts";
import { schemaAnalysisTick } from "./entity-schema-support.ts";
test("값 변환 준비: 저장된 직접 링크·실패 행 보완·재분석·MCP 결과·stale·모바일 초안 보존", async ({ page }) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  let typeId: string | undefined, entityId: string | undefined;
  try {
    const type = await mcp.call("create_entity_type", { label: unique("변환 준비") });
    await workspace.grantKind(type.id);
    typeId = type.id;
    const entity = await mcp.call("create_entity", {
      entity_type_id: typeId,
      schema_version: 1,
      properties: { prop_1: "001" },
    });
    entityId = entity.id;
    const current = await mcp.call("get_entity_schema", { type_id: typeId });
    const plan = await mcp.call("create_entity_schema_change", {
      type_id: typeId,
      expected_schema_version: 1,
      edits: [{
        op: "update_property",
        key: "prop_1",
        field: { ...current.schema.properties.prop_1, maxLength: 2 },
        required: true,
      }],
    });
    const path = workspacePath(workspace.id, `/settings/entity-types/${typeId}/migrations?change_id=${plan.id}`);
    await page.goto(path);
    await expect(page.getByRole("heading", { name: "변경 검토" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "변경 검토" })).toBeVisible();
    await page.getByRole("button", { name: "변경 검토", exact: true }).click();
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_change", { type_id: typeId, change_id: plan.id })).analysis?.status;
    }, { timeout: 30000 }).toBe("succeeded");
    const row = businessRows(page.getByRole("table", { name: "자료 값 변환 결과 목록", exact: true })).filter({
      has: page.getByRole("cell", { name: `${entity.title} · ${entityIdentityLabel({ id: entity.id })}`, exact: true }),
    });
    await expect(row.getByText("변환 실패", { exact: true })).toBeVisible();
    const correction = entryDetails(row);
    await expect(row).toBeVisible();
    await expect(row).toContainText("001");
    await correction.getByRole("button", { name: "보완값 지정", exact: true }).click();
    await correction.getByRole("textbox", { name: "보완값", exact: true }).fill("01");
    const beforeNavigation = page.url();
    await openMainNavigation(page);
    const tasksLink = page.getByRole("navigation", { name: "주 메뉴", exact: true }).getByRole("link", { name: "할 일", exact: true });
    await expect(tasksLink).toHaveAttribute("href", workspacePath(workspace.id, "/tasks"));
    await tasksLink.click();
    const dialog = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "취소", exact: true }).click();
    await expect(page).toHaveURL(beforeNavigation);
    await closeMainNavigation(page);
    await expect(correction.getByRole("textbox", { name: "보완값", exact: true })).toHaveValue("01");
    const reviewed = page.waitForResponse((response) =>
      response.url().endsWith("/analyze") && response.request().method() === "POST" && response.status() === 202
    );
    await page.getByRole("button", { name: "보완 내용 검토", exact: true }).click();
    await reviewed;
    await expect(page.getByRole("region", { name: "입력 항목 변경 요약", exact: true })).toHaveAttribute(
      "data-change-version",
      "2",
    );
    await expect(page.getByRole("heading", { name: "변경 검토" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: "변경 검토" })).toBeVisible();
    const httpRows = page.waitForResponse((r) =>
      r.url().includes(`/schema-changes/${plan.id}/rows?`) && r.status() === 200
    );
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
    expect(rows.items[0].before).toEqual(entity.properties);
    expect(rows.items[0].after).toEqual({ ...entity.properties, prop_1: "01" });
    expect(fresh.analysis.changed).toBe(1);
    expect((await mcp.call("get_entity", { id: entity.id })).properties).toEqual(entity.properties);
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
  }
});

test("늦은 전체 결과가 새 실패 필터의 분석 페이지를 덮어쓰지 않는다", async ({ page }) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  let typeId: string | undefined;
  const ids: string[] = [];
  let release = () => {};
  try {
    const type = await mcp.call("create_entity_type", { label: unique("페이지 경쟁") });
    await workspace.grantKind(type.id);
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
    const current = await mcp.call("get_entity_schema", { type_id: typeId });
    const plan = await mcp.call("create_entity_schema_change", {
      type_id: typeId,
      expected_schema_version: 1,
      edits: [{
        op: "update_property",
        key: "prop_1",
        field: { ...current.schema.properties.prop_1, maxLength: 2 },
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
    let finishDelayed!: () => void;
    const delayedFinished = new Promise<void>((resolve) => finishDelayed = resolve);
    let intercepted = false;
    await page.route(`**/schema-changes/${plan.id}/rows?**`, async (route) => {
      if (!intercepted && route.request().url().includes("failures_only=false")) {
        intercepted = true;
        const response = await route.fetch();
        await delayed;
        try {
          await route.fulfill({ response });
        } catch {
          /* Aborted response must not update the page. */
        } finally {
          finishDelayed();
        }
      } else await route.continue();
    });
    await page.goto(workspacePath(workspace.id, `/settings/entity-types/${typeId}/migrations?change_id=${plan.id}`));
    await expect.poll(() => intercepted).toBe(true);
    await page.getByLabel("실패한 자료만 보기").check();
    await page.getByRole("button", { name: "필터 적용", exact: true }).click();
    const resultRows = businessRows(page.getByRole("table", { name: "자료 값 변환 결과 목록", exact: true }));
    const failedRow = resultRows.filter({ has: page.getByRole("cell", {
      name: `${bad.title} · ${entityIdentityLabel({ id: bad.id })}`, exact: true,
    }) });
    const unchangedRow = resultRows.filter({ has: page.getByRole("cell", {
      name: `${good.title} · ${entityIdentityLabel({ id: good.id })}`, exact: true,
    }) });
    await expect(resultRows).toHaveCount(1);
    await expect(failedRow.getByRole("cell", { name: "변환 실패", exact: true })).toBeVisible();
    await expect(unchangedRow).toHaveCount(0);
    release();
    await delayedFinished;
    await page.evaluate(() =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    );
    await expect(resultRows).toHaveCount(1);
    await expect(failedRow.getByRole("cell", { name: "변환 실패", exact: true })).toBeVisible();
    await expect(unchangedRow).toHaveCount(0);
  } finally {
    release();
    await mcp.close();
  }
});
