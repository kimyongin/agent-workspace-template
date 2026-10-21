import { businessRows, disclosureContent } from "./table-actions.ts";
import { detailDialog, executionDialog } from "./ui-actions.ts";
import { expect } from "@playwright/test";
import { devLogin, mcpClient, mcpTokenViaConsent, test, unique, ownedWorkspace, workspacePath} from "./support.ts";
import { schemaAnalysisTick } from "./entity-schema-support.ts";
test("웹 속성 초안·분석·게시 후 기존 자료 표시와 MCP 생성·이전 폼 충돌이 같은 정의를 사용한다", async ({ page, context }) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  let typeId: string | undefined;
  const entityIds: string[] = [];
  try {
    const type = await mcp.call("create_entity_type", {
      label: unique("속성 편집"),
      initial_property_label: "이름",
    });
    await workspace.grantKind(type.id);
    typeId = type.id;
    const existing = await mcp.call("create_entity", {
      entity_type_id: typeId,
      schema_version: 1,
      properties: { prop_1: unique("기존 자료") },
    });
    entityIds.push(existing.id);
    const oldPage = await context.newPage();
    await oldPage.goto(workspacePath(workspace.id, `/entities/${encodeURIComponent(existing.id)}`));
    await oldPage.getByRole("button", { name: "편집", exact: true }).click();
    const oldForm = oldPage.getByRole("dialog", {
      name: `${type.label} 편집`,
      exact: true,
    });
    await oldForm.getByLabel("이름", { exact: false }).fill(
      "충돌 뒤 유지할 초안",
    );
    await page.goto(workspacePath(workspace.id, `/settings/entity-types/${typeId}`));
    const inputSection = page.getByRole("region", { name: "입력 항목", exact: true });
    await page.getByRole("button", { name: "입력 항목", exact: true }).click();
    await page.getByRole("button", { name: /^이름 항목 (?:펼치기|접기)$/, exact: true }).click();
    await page.getByRole("region", { name: "이름 입력 항목", exact: true }).getByLabel("항목 이름", { exact: true }).fill(
      "자료 이름",
    );
    await page.getByRole("button", { name: /^변경 이력/ }).click();
    await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?" })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "자료 이름 입력 항목", exact: true }).getByLabel("항목 이름", { exact: true }),
    ).toHaveValue("자료 이름");
    await page.getByRole("button", { name: "항목 추가", exact: true }).click();
    const field = page.getByRole("region", {
      name: "새 항목 입력 항목",
      exact: true,
    });
    await field.getByLabel("항목 이름", { exact: true }).fill("수량");
    const count = page.getByRole("region", { name: "수량 입력 항목", exact: true });
    await count.getByLabel("데이터 타입", { exact: true }).selectOption(
      "integer",
    );
    await count.getByText("추가 설정", { exact: true }).click();
    await count.getByLabel("생성 기본값 (기존 자료에는 채우지 않음)", {
      exact: true,
    }).selectOption("value");
    await expect(count.getByLabel("기본값", { exact: true })).toHaveValue("0");
    await page.getByRole("button", { name: "변경 검토", exact: true }).click();
    await expect(inputSection).toBeVisible();
    await expect(page.getByRole("button", { name: "변경 검토", exact: true })).toBeDisabled();
    const plans = await mcp.call("list_entity_schema_changes", {
      type_id: typeId,
    });
    const planId = plans.items[0].id;
    const draft = await mcp.call("get_entity_schema_change", {
      type_id: typeId,
      change_id: planId,
    });
    expect(draft.reservations).toEqual({
      [Object.keys(draft.reservations)[0]]: "prop_2",
    });
    expect(
      (await mcp.call("get_entity_schema", { type_id: typeId })).schema_version,
    ).toBe(1);
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_change", {
        type_id: typeId,
        change_id: planId,
      })).status;
    }, { timeout: 30000 }).toBe("ready");
    await expect(inputSection.getByRole("button", { name: "변경 적용", exact: true })).toBeEnabled();
    let lost = false;
    await page.route(
      `**/entity-types/${typeId}/schema-changes/${planId}/apply`,
      async (route) => {
        if (!lost) {
          lost = true;
          const response = await route.fetch();
          expect(response.status()).toBe(200);
          await route.abort("failed");
        } else await route.continue();
      },
    );
    await inputSection.getByRole("button", { name: "변경 적용", exact: true }).click();
    await expect(
      inputSection.getByRole("button", { name: "같은 요청 다시 확인", exact: true }),
    ).toBeVisible();
    await inputSection.getByRole("button", { name: "같은 요청 다시 확인", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: /^입력 항목/, level: 2 }))
      .toBeVisible();
    const current = await mcp.call("get_entity", { id: existing.id });
    expect(current.schema_version).toBe(1);
    expect(current.version).toBe(existing.version);
    expect(current.properties).not.toHaveProperty("prop_2");
    await oldForm.getByRole("button", { name: "저장", exact: true }).click();
    await expect(
      executionDialog(oldPage).getByRole("alert"),
    ).toBeVisible();
    await executionDialog(oldPage).getByRole("button", {
      name: "취소",
      exact: true,
    }).click();
    await expect(oldForm.getByLabel("이름", { exact: false })).toHaveValue(
      "충돌 뒤 유지할 초안",
    );
    await oldPage.close();
    const created = await mcp.call("create_entity", {
      entity_type_id: typeId,
      schema_version: 2,
      properties: { prop_1: unique("新資料") },
    });
    entityIds.push(created.id);
    expect(created.properties.prop_2).toBe(0);
    const assertCurrentProperties = async (title: string, quantity: string) => {
      const viewer = detailDialog(page);
      await expect(viewer.getByRole("heading", { name: title, exact: true })).toHaveText(title);
      // The name property uses the same schema-driven definition list as every other property.
      await expect(viewer.getByRole("term").filter({ hasText: /^이름$/ })).toHaveCount(0);
      const nameProperty = viewer.getByRole("term").filter({ hasText: /^자료 이름$/ });
      await expect(nameProperty).toHaveCount(1);
      await expect(nameProperty.locator("..").getByRole("definition")).toHaveText(title);
      const count = viewer.getByRole("term").filter({ hasText: /^수량$/ });
      await expect(count).toHaveCount(1);
      await expect(count.locator("..").getByRole("definition")).toHaveText(quantity);
    };
    await page.goto(workspacePath(workspace.id, `/entities/${encodeURIComponent(existing.id)}`));
    await assertCurrentProperties(existing.title, "미입력");
    await page.goto(workspacePath(workspace.id, `/entities/${encodeURIComponent(created.id)}`));
    await assertCurrentProperties(created.title, "0");
    await page.goto(workspacePath(workspace.id, `/settings/entity-types/${typeId}/versions`));
    const initialVersion = businessRows(page.getByRole("table", { name: "입력 항목 변경 이력", exact: true })).filter({
      has: page.getByRole("button", { name: /버전 2 · 적용됨$/ }),
    });
    await initialVersion.getByRole("button", { name: /버전 2 · 적용됨$/ })
      .click();
    const initialContent = await disclosureContent(page, initialVersion.getByRole("button", { name: /버전 2 · 적용됨$/ }));
    await expect(initialContent.locator("input, select, textarea")).toHaveCount(
      0,
    );
    await expect(page.getByRole("region", { name: "버전 차이", exact: true }))
      .toContainText("수량");
    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    expect(
      await page.evaluate(() =>
        document.documentElement.scrollWidth <=
          document.documentElement.clientWidth
      ),
    )
      .toBe(true);
  } finally {
    await mcp.close();
  }
});

test("미적용 입력 항목 변경안의 폐기 취소·확정은 현재 자료와 정의를 유지한다", async ({ page }) => {
  await devLogin(page);
  const workspace = await ownedWorkspace(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page), { workspaceId: workspace.id });
  try {
    const type = await mcp.call("create_entity_type", { label: unique("폐기 확인") });
    await workspace.grantKind(type.id);
    const entity = await mcp.call("create_entity", {
      entity_type_id: type.id,
      schema_version: 1,
      properties: { prop_1: "보존할 자료" },
    });
    const change = await mcp.call("create_entity_schema_change", {
      type_id: type.id,
      expected_schema_version: 1,
      edits: [{
        op: "add_property",
        client_ref: "note",
        field: { "x-order": 20, type: ["string", "null"], title: "메모" },
        required: false,
      }],
    });
    await page.goto(workspacePath(workspace.id, `/settings/entity-types/${type.id}/migrations?change_id=${change.id}`));
    await page.getByRole("button", { name: "폐기", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "변경안을 폐기할까요?", exact: true });
    await confirm.getByRole("button", { name: "취소", exact: true }).click();
    expect((await mcp.call("get_entity_schema_change", { type_id: type.id, change_id: change.id })).status).toBe(
      "draft",
    );
    await page.getByRole("button", { name: "폐기", exact: true }).click();
    await confirm.getByRole("button", { name: "폐기", exact: true }).click();
    await expect.poll(async () =>
      (await mcp.call("get_entity_schema_change", { type_id: type.id, change_id: change.id })).status
    ).toBe("cancelled");
    const current = await mcp.call("get_entity", { id: entity.id });
    expect([current.version, current.schema_version, current.properties]).toEqual([
      entity.version,
      1,
      entity.properties,
    ]);
    expect((await mcp.call("get_entity_schema", { type_id: type.id })).schema_version).toBe(1);
    await page.reload();
    const discarded = businessRows(page.getByRole("table", { name: "입력 항목 변경 이력", exact: true })).filter({
      has: page.getByRole("button", { name: /상태 폐기됨$/ }),
    });
    await expect(discarded).toHaveCount(1);
    await expect(discarded.getByRole("button", { name: /상태 폐기됨$/ })).toHaveAttribute("aria-expanded", "true");
    const discardedContent = await disclosureContent(page, discarded.getByRole("button", { name: /상태 폐기됨$/ }));
    await expect(discardedContent.locator(`a[href*="change_id=${change.id}"]`)).toHaveCount(1);
    await expect(page.getByRole("button", { name: "변경 적용", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "입력 항목", exact: true }).click();
    await expect(businessRows(page.getByRole("table", { name: "입력 항목 목록", exact: true })))
      .toHaveCount(1);
    await expect(page.getByRole("region", { name: "메모 입력 항목", exact: true })).toHaveCount(0);
  } finally {
    await mcp.close();
  }
});
