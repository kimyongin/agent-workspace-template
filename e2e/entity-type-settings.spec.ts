import { expect, test } from "@playwright/test";
import postgres from "postgres";
import { devLogin, env, mcpClient, mcpTokenViaConsent, unique } from "./support.ts";

test("자료 종류를 웹에서 만들고 이름·아이콘·보관과 게시 버전을 MCP로 확인한다", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  const label = unique("자료 종류");
  let typeId: string | undefined;
  try {
    await page.goto("/settings/entity-types");
    await expect(page.getByRole("heading", { name: "자료 종류·속성", exact: true })).toBeVisible();
    await page.getByLabel("자료 종류 이름", { exact: true }).fill(label);
    await page.getByLabel("대표 속성 이름", { exact: true }).fill("대표 이름");
    await page.getByLabel("아이콘", { exact: true }).selectOption("leaf");
    await page.getByRole("button", { name: "자료 종류 만들기", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("자료 종류를 저장했습니다");
    const types = await mcp.call("list_entity_types", { include_archived: true, limit: 100 });
    const created = types.items.find((value: { label: string }) => value.label === label);
    expect(created).toBeTruthy();
    typeId = created.id;
    expect(created.icon_id).toBe("leaf");
    const original = await mcp.call("get_entity_schema", { type_id: typeId });
    expect(original.schema.required).toEqual(["prop_1"]);
    expect(original.schema.properties.prop_1.title).toBe("대표 이름");
    await page.getByRole("link", { name: label, exact: false }).click();
    await expect(page).toHaveURL(new RegExp(`/settings/entity-types/${typeId}$`));
    const changedLabel = unique("이름 변경");
    await page.getByLabel("자료 종류 이름", { exact: true }).fill(changedLabel);
    await page.getByRole("link", { name: "자료 종류 목록", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "변경을 버릴까요?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "취소", exact: true }).click();
    await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(changedLabel);
    await page.getByLabel("아이콘", { exact: true }).selectOption("star");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("자료 종류를 저장했습니다");
    const renamed = await mcp.call("get_entity_type", { type_id: typeId });
    expect(renamed.label).toBe(changedLabel);
    expect(renamed.icon_id).toBe("star");
    expect(renamed.version).toBe(2);
    expect(renamed.schema_version).toBe(1);
    await page.getByRole("link", { name: "버전", exact: true }).click();
    await page.getByText(/^버전 1 ·/).click();
    await page.getByRole("button", { name: "이 버전 보기" }).click();
    await expect(page.getByText("선택한 버전 1: 대표 이름", { exact: true })).toBeVisible();
    expect((await mcp.call("get_entity_schema", { type_id: typeId, schema_version: 1 })).schema).toEqual(
      original.schema,
    );
    await page.reload();
    await expect(page.getByRole("heading", { name: "게시 버전", exact: true })).toBeVisible();
    await page.getByRole("link", { name: "속성·표시", exact: true }).click();
    await page.getByRole("checkbox", { name: /자료 종류 보관/ }).check();
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("자료 종류를 저장했습니다");
    expect((await mcp.call("get_entity_type", { type_id: typeId })).archived).toBe(true);
    await page.getByRole("checkbox", { name: /자료 종류 보관/ }).uncheck();
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("자료 종류를 저장했습니다");
    expect((await mcp.call("get_entity_type", { type_id: typeId })).archived).toBe(false);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect(page.getByRole("button", { name: "저장", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
  } finally {
    await mcp.close();
    if (typeId) {
      const admin = postgres(env.LOCAL_DB_URL, { max: 1, onnotice: () => {} });
      try {
        await admin`delete from app.entity_types where id=${typeId}`;
      } finally {
        await admin.end();
      }
    }
  }
});
