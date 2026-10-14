import { expect } from "@playwright/test";
import postgres from "postgres";
import { devLogin, env, mcpClient, mcpTokenViaConsent, test, unique } from "./support.ts";

test("자료 종류를 웹에서 만들고 이름·아이콘·보관과 게시 버전을 MCP로 확인한다", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  const label = unique("자료 종류");
  let typeId: string | undefined;
  let releaseDestination: (() => void) | undefined;
  try {
    await page.goto("/settings/entity-types");
    await expect(page.getByRole("heading", { name: "자료 설정", exact: true })).toBeVisible();
    const creation = page.getByRole("form", { name: "자료 종류 만들기", exact: true });
    await expect(creation).toBeVisible();
    await expect(page.getByLabel("자료 종류 선택", { exact: true })).toHaveValue("");
    await creation.getByRole("radio", { name: "별", exact: true }).check();
    await page.getByRole("link", { name: "할 일", exact: true }).click();
    const initialConfirm = page.getByRole("dialog", { name: "변경을 버릴까요?" });
    await expect(initialConfirm).toBeVisible();
    await initialConfirm.getByRole("button", { name: "취소", exact: true }).click();
    await creation.getByRole("button", { name: "변경 취소", exact: true }).click();
    await expect(creation.getByRole("radio", { name: "상자", exact: true })).toBeChecked();
    await creation.getByLabel("대표 속성 이름", { exact: true }).fill("초안 이름");
    await expect(creation.getByRole("button", { name: "변경 취소", exact: true })).toBeEnabled();
    await creation.getByRole("button", { name: "변경 취소", exact: true }).click();
    await expect(creation.getByLabel("대표 속성 이름", { exact: true })).toHaveValue("이름");
    await creation.getByLabel("자료 종류 이름", { exact: true }).fill(label);
    await creation.getByLabel("대표 속성 이름", { exact: true }).fill("대표 이름");
    await creation.getByRole("radio", { name: "잎", exact: true }).check();
    const destinationGate = new Promise<void>((resolve) => {
      releaseDestination = resolve;
    });
    await page.route("**/functions/v1/api/entity-types/*", async (route) => {
      if (
        route.request().method() === "GET" && /\/entity-types\/[^/]+$/.test(new URL(route.request().url()).pathname)
      ) await destinationGate;
      await route.continue();
    });
    await creation.getByRole("button", { name: "자료 종류 만들기", exact: true }).click();
    await expect(page).toHaveURL(/\/settings\/entity-types\/[^/?]+$/);
    const types = await mcp.call("list_entity_types", { include_archived: true, limit: 100 });
    const created = types.items.find((value: { label: string }) => value.label === label);
    expect(created).toBeTruthy();
    typeId = created.id;
    expect(created.icon_id).toBe("leaf");
    const original = await mcp.call("get_entity_schema", { type_id: typeId });
    expect(original.schema.required).toEqual(["prop_1"]);
    expect(original.schema.properties.prop_1.title).toBe("대표 이름");
    await expect(page).toHaveURL(new RegExp(`/settings/entity-types/${typeId}$`));
    await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveCount(0);
    releaseDestination!();
    await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
    await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(label);
    const changedLabel = unique("이름 변경");
    await page.getByLabel("자료 종류 이름", { exact: true }).fill(changedLabel);
    await page.getByRole("link", { name: "종류 추가", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "변경을 버릴까요?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "취소", exact: true }).click();
    await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(changedLabel);
    await page.getByRole("radio", { name: "별", exact: true }).check();
    await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
    await expect(page.locator(".settings").getByRole("status")).toContainText("자료 종류를 저장했습니다");
    const renamed = await mcp.call("get_entity_type", { type_id: typeId });
    expect(renamed.label).toBe(changedLabel);
    expect(renamed.icon_id).toBe("star");
    expect(renamed.version).toBe(2);
    expect(renamed.schema_version).toBe(1);
    const history = page.getByRole("region", { name: "변경 이력", exact: true });
    await history.getByRole("button", { name: /^변경 이력/ }).click();
    const row = history.locator(".schema-history-row").filter({ hasText: "버전 1 · 적용됨" });
    await expect(row).toHaveCount(1);
    await row.getByRole("button", { name: /^최초 생성/ }).click();
    await expect(page).toHaveURL(/schema_version=1/);
    const assertPublishedDefinition = async () => {
      const definition = history.getByRole("region", { name: "입력 항목 정의", exact: true });
      const field = definition.getByRole("region", { name: "대표 이름 정의", exact: true });
      await expect(field).toBeVisible();
      for (
        const [name, value] of [
          ["데이터 타입", "텍스트"],
          ["필수 입력", "예"],
          ["목록에 표시", "예"],
          ["자료 이름", "사용"],
          ["최소 길이", "1자"],
          ["최대 길이", "4096자"],
        ]
      ) {
        await expect(field.locator("dl > div").filter({ has: page.getByText(name, { exact: true }) }).locator("dd"))
          .toHaveText(value);
      }
      await expect(definition.locator("input,select,textarea")).toHaveCount(0);
      await expect(row.getByRole("region", { name: "변경 결과", exact: true })).toContainText("버전 1 · 최초 생성");
      const published = await mcp.call("get_entity_schema", { type_id: typeId, schema_version: 1 });
      expect({
        type_id: published.type_id,
        schema_version: published.schema_version,
        schema: published.schema,
        display: published.display,
        created_at: published.created_at,
      }).toEqual({
        type_id: original.type_id,
        schema_version: original.schema_version,
        schema: original.schema,
        display: original.display,
        created_at: original.created_at,
      });
    };
    await assertPublishedDefinition();
    await page.reload();
    await expect(page).toHaveURL(/schema_version=1/);
    await assertPublishedDefinition();
    await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
    await page.getByRole("checkbox", { name: /자료 종류 보관/ }).check();
    await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
    await expect(page.locator(".settings").getByRole("status")).toContainText("자료 종류를 저장했습니다");
    expect((await mcp.call("get_entity_type", { type_id: typeId })).archived).toBe(true);
    await page.getByRole("checkbox", { name: /자료 종류 보관/ }).uncheck();
    await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
    await expect(page.locator(".settings").getByRole("status")).toContainText("자료 종류를 저장했습니다");
    expect((await mcp.call("get_entity_type", { type_id: typeId })).archived).toBe(false);
    await page.setViewportSize({ width: 320, height: 640 });
    await page.evaluate(() => {
      document.documentElement.style.zoom = "2";
    });
    await expect(page.getByRole("button", { name: "기본 정보 저장", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
      .toBe(true);
  } finally {
    releaseDestination?.();
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

test("자료 종류 생성의 성공 응답 유실은 초안·같은 요청을 보존하고 재시도로 하나만 생성한다", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  const label = unique("응답 유실 자료");
  let typeId: string | undefined;
  const keys: string[] = [];
  let lose = true;
  await page.route("**/functions/v1/api/entity-types", async (route) => {
    if (route.request().method() !== "POST") return route.continue();
    keys.push(route.request().headers()["idempotency-key"]);
    if (lose) {
      lose = false;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    } else await route.continue();
  });
  try {
    await page.goto("/settings/entity-types");
    const creation = page.getByRole("form", { name: "자료 종류 만들기", exact: true });
    await expect(creation).toBeVisible();
    await creation.getByLabel("자료 종류 이름", { exact: true }).fill(label);
    await creation.getByRole("button", { name: "자료 종류 만들기", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("저장 여부를 알 수 없습니다");
    await expect(page.getByRole("alert")).toContainText("새로고침");
    await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(label);
    await expect(creation.getByLabel("자료 종류 이름", { exact: true })).toBeDisabled();
    await expect(creation.getByRole("button", { name: "변경 취소", exact: true })).toBeDisabled();
    const committed = await mcp.call("list_entity_types", { include_archived: true, limit: 100 });
    const before = committed.items.filter((value: { label: string }) => value.label === label);
    expect(before).toHaveLength(1);
    typeId = before[0].id;
    await page.getByRole("button", { name: "같은 요청 다시 확인", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/settings/entity-types/${typeId}$`));
    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
    const current = await mcp.call("list_entity_types", { include_archived: true, limit: 100 });
    expect(current.items.filter((value: { label: string }) => value.label === label)).toHaveLength(1);
    await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
    await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(label);
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
