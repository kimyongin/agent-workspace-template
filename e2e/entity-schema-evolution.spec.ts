import { expect } from "@playwright/test";
import postgres from "postgres";
import { devLogin, env, mcpClient, mcpTokenViaConsent, test, unique } from "./support.ts";
import { schemaAnalysisTick } from "./entity-schema-support.ts";
test("웹 속성 초안·분석·게시 후 기존 자료 표시와 MCP 생성·이전 폼 충돌이 같은 정의를 사용한다", async ({ page, context }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  const admin = postgres(env.LOCAL_DB_URL, { max: 1, onnotice: () => {} });
  let typeId: string | undefined;
  const entityIds: string[] = [];
  try {
    const type = await mcp.call("create_entity_type", {
      label: unique("속성 편집"),
      representative_label: "이름",
    });
    typeId = type.id;
    const existing = await mcp.call("create_entity", {
      entity_type_id: typeId,
      schema_version: 1,
      properties: { prop_1: unique("기존 자료") },
    });
    entityIds.push(existing.id);
    const oldPage = await context.newPage();
    await oldPage.goto(`/entities/${encodeURIComponent(existing.id)}`);
    await oldPage.getByRole("button", { name: "편집", exact: true }).click();
    const oldForm = oldPage.getByRole("dialog", {
      name: `${type.label} 편집`,
      exact: true,
    });
    await oldForm.getByLabel("이름", { exact: false }).fill(
      "충돌 뒤 유지할 초안",
    );
    await page.goto(`/settings/entity-types/${typeId}`);
    await page.getByRole("button", { name: "입력 항목", exact: true }).click();
    await page.getByRole("button", { name: "이름 속성 편집", exact: true }).click();
    await page.getByRole("region", { name: "이름 속성", exact: true }).getByLabel("항목 이름", { exact: true }).fill(
      "자료 이름",
    );
    await page.getByRole("button", { name: /^변경 이력/ }).click();
    await expect(page.getByRole("dialog", { name: "변경을 버릴까요?" })).toHaveCount(0);
    await expect(
      page.getByRole("region", { name: "자료 이름 속성", exact: true }).getByLabel("항목 이름", { exact: true }),
    ).toHaveValue("자료 이름");
    await page.getByRole("button", { name: "항목 추가", exact: true }).click();
    const field = page.getByRole("region", {
      name: "새 항목 속성",
      exact: true,
    });
    await field.getByLabel("항목 이름", { exact: true }).fill("수량");
    const count = page.getByRole("region", { name: "수량 속성", exact: true });
    await count.getByLabel("데이터 타입", { exact: true }).selectOption(
      "integer",
    );
    await count.getByText("추가 설정", { exact: true }).click();
    await count.getByLabel("생성 기본값 (기존 자료에는 채우지 않음)", {
      exact: true,
    }).selectOption("value");
    await expect(count.getByLabel("기본값", { exact: true })).toHaveValue("0");
    await page.getByRole("button", { name: "변경 검토", exact: true }).click();
    await expect(page.getByRole("heading", { name: "변경 검토" }))
      .toBeVisible();
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
    await expect(page.getByRole("button", { name: "변경 적용", exact: true })).toBeEnabled();
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
    await page.getByRole("button", { name: "변경 적용", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "같은 요청 다시 확인", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "같은 요청 다시 확인", exact: true })
      .click();
    await expect(page.getByRole("heading", { name: /^입력 항목/, level: 2 }))
      .toBeVisible();
    const current = await mcp.call("get_entity", { id: existing.id });
    expect(current.schema_version).toBe(1);
    expect(current.version).toBe(existing.version);
    expect(current.properties).not.toHaveProperty("prop_2");
    await oldForm.getByRole("button", { name: "저장", exact: true }).click();
    await expect(
      oldPage.locator("dialog.modal-action[open]").getByRole("alert"),
    ).toBeVisible();
    await oldPage.locator("dialog.modal-action[open]").getByRole("button", {
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
    await page.goto(`/entities/${encodeURIComponent(existing.id)}`);
    await expect(page.getByText("자료 이름", { exact: true })).toBeVisible();
    await expect(page.getByText("수량", { exact: true })).toBeVisible();
    await expect(page.getByText("미입력", { exact: true })).toBeVisible();
    await page.goto(`/entities/${encodeURIComponent(created.id)}`);
    await expect(page.getByText("자료 이름", { exact: true })).toBeVisible();
    await expect(page.getByText("0", { exact: true })).toBeVisible();
    await page.goto(`/settings/entity-types/${typeId}/versions`);
    const initialVersion = page.locator(".schema-history-row").filter({
      has: page.getByRole("button", { name: /버전 2 · 적용됨$/ }),
    });
    await initialVersion.getByRole("button", { name: /버전 2 · 적용됨$/ })
      .click();
    await expect(initialVersion.locator("input, select, textarea")).toHaveCount(
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
    if (entityIds.length) {
      await admin`delete from app.entities where id=any(${entityIds}::text[])`;
    }
    if (typeId) await admin`delete from app.entity_types where id=${typeId}`;
    await admin.end();
  }
});
