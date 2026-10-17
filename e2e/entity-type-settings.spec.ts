import { entitySchemaPresentation } from "../supabase/functions/_shared/contracts/entity-type.ts";
import { expect } from "@playwright/test";
import postgres from "postgres";
import { devLogin, mcpClient, mcpTokenViaConsent, test, unique, requiredEnv } from "./support.ts";
import { analyzeAndApply, schemaAnalysisTick } from "./entity-schema-support.ts";
import { revealSetting } from "./ui-actions.ts";

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
    const initialConfirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
    await expect(initialConfirm).toBeVisible();
    await initialConfirm.getByRole("button", { name: "취소", exact: true }).click();
    await creation.getByRole("button", { name: "변경 취소", exact: true }).click();
    await expect(creation.getByRole("radio", { name: "상자", exact: true })).toBeChecked();
    await creation.getByLabel("대표 입력 항목 이름", { exact: true }).fill("초안 이름");
    await expect(creation.getByRole("button", { name: "변경 취소", exact: true })).toBeEnabled();
    await creation.getByRole("button", { name: "변경 취소", exact: true }).click();
    await expect(creation.getByLabel("대표 입력 항목 이름", { exact: true })).toHaveValue("이름");
    await creation.getByLabel("자료 종류 이름", { exact: true }).fill(label);
    await creation.getByLabel("대표 입력 항목 이름", { exact: true }).fill("대표 이름");
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
    const confirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "취소", exact: true }).click();
    await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(changedLabel);
    await page.getByRole("radio", { name: "별", exact: true }).check();
    const concurrentLabel = unique("다른 화면 이름");
    const concurrent = await mcp.call("update_entity_type", {
      type_id: typeId,
      expected_schema_version: created.schema_version,
      label: concurrentLabel,
      icon_id: "book",
    });
    expect(concurrent.schema_version).toBe(2);
    const conflictResponse = page.waitForResponse((response) =>
      response.request().method() === "PATCH" && response.url().endsWith(`/entity-types/${typeId}`)
    );
    await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
    const rejected = await conflictResponse;
    expect(rejected.status()).toBe(409);
    expect(await rejected.json()).toMatchObject({ code: "schema_changed", current: { schema_version: 2 } });
    await expect(page.getByRole("alert")).toContainText("최신 기본 정보를 확인");
    await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(changedLabel);
    await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
    await page.getByRole("button", { name: "최신 기본 정보 확인", exact: true }).click();
    await expect(page.getByText(`최신 저장값: ${concurrentLabel}`, { exact: false })).toBeVisible();
    await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(changedLabel);
    await expect(page.getByRole("radio", { name: "별", exact: true })).toBeChecked();
    await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("자료 종류를 저장했습니다");
    const renamed = await mcp.call("get_entity_type", { type_id: typeId });
    expect(renamed.label).toBe(changedLabel);
    expect(renamed.icon_id).toBe("star");
    expect(renamed.schema_version).toBe(3);
    expect(renamed.schema_version).toBe(3);
    const history = page.getByRole("region", { name: "변경 이력", exact: true });
    await history.getByRole("button", { name: /^변경 이력/ }).click();
    const row = history.getByRole("list", { name: "입력 항목 변경 이력", exact: true }).getByRole("listitem").filter({ hasText: "버전 1 · 적용됨" });
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
          ["자료 이름으로 사용", "사용"],
          ["최소 길이", "1자"],
          ["최대 길이", "4096자"],
        ]
      ) {
        await expect(field.locator("dl > div").filter({ has: page.getByText(name, { exact: true }) }).locator("dd"))
          .toHaveText(value);
      }
      await expect(definition.locator("input,select,textarea")).toHaveCount(0);
      await expect(row.getByRole("region", { name: "변경 결과", exact: true }).getByRole("term").filter({ hasText: /^버전$/ }).locator("..").getByRole("definition")).toHaveText("1 · 최초 생성");
      const published = await mcp.call("get_entity_schema", { type_id: typeId, schema_version: 1 });
      expect({
        type_id: published.type_id,
        schema_version: published.schema_version,
        schema: published.schema,
        created_at: published.created_at,
      }).toEqual({
        type_id: original.type_id,
        schema_version: original.schema_version,
        schema: original.schema,
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
    await expect(page.getByRole("status")).toContainText("자료 종류를 저장했습니다");
    expect((await mcp.call("get_entity_type", { type_id: typeId })).archived).toBe(true);
    await page.getByRole("checkbox", { name: /자료 종류 보관/ }).uncheck();
    await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("자료 종류를 저장했습니다");
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
      const admin = postgres(requiredEnv("LOCAL_DB_URL"), { max: 1, onnotice: () => {} });
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
      const admin = postgres(requiredEnv("LOCAL_DB_URL"), { max: 1, onnotice: () => {} });
      try {
        await admin`delete from app.entity_types where id=${typeId}`;
      } finally {
        await admin.end();
      }
    }
  }
});

test("새 입력 항목의 첫 웹 검토가 순서·대표 이름·선택 표시를 MCP 변경안과 게시 정의에 그대로 저장한다", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const type = await mcp.call("create_entity_type", { label: unique("첫 항목 검토") });
    await page.goto(`/settings/entity-types/${type.id}`);
    await page.getByRole("button", { name: "입력 항목", exact: true }).click();
    await page.getByRole("button", { name: "항목 추가", exact: true }).click();
    let field = page.getByRole("region", { name: "새 항목 입력 항목", exact: true });
    await field.getByLabel("항목 이름", { exact: true }).fill("판매 상태");
    field = page.getByRole("region", { name: "판매 상태 입력 항목", exact: true });
    await field.getByLabel("데이터 타입", { exact: true }).selectOption("select");
    await field.getByLabel("선택 항목 1", { exact: true }).fill("판매 중");
    await revealSetting(field.getByLabel("판매 상태 목록에 표시", { exact: true }));
    await field.getByLabel("판매 상태 목록에 표시", { exact: true }).check();
    await page.getByRole("button", { name: "항목 추가", exact: true }).click();
    field = page.getByRole("region", { name: "새 항목 입력 항목", exact: true });
    await field.getByLabel("항목 이름", { exact: true }).fill("상품명");
    field = page.getByRole("region", { name: "상품명 입력 항목", exact: true });
    await revealSetting(field.getByLabel("필수 입력", { exact: true }));
    await field.getByLabel("필수 입력", { exact: true }).check();
    await field.getByRole("radio", { name: "상품명 자료 이름으로 사용", exact: true }).check();
    await page.getByRole("button", { name: "상품명 위로", exact: true }).click();
    await page.getByRole("button", { name: "상품명 위로", exact: true }).click();
    const saveResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().endsWith(`/entity-types/${type.id}/schema-changes`)
    );
    await page.getByRole("button", { name: "변경 검토", exact: true }).click();
    const response = await saveResponse;
    expect(response.status()).toBe(201);
    const saved = await response.json();
    const stored = await mcp.call("get_entity_schema_change", { type_id: type.id, change_id: saved.id });
    const fields = Object.entries(stored.target.schema.properties) as Array<[string, { title?: string }]>;
    const statusKey = fields.find(([, value]) => value.title === "판매 상태")![0];
    const nameKey = fields.find(([, value]) => value.title === "상품명")![0];
    expect(entitySchemaPresentation(stored.target.schema)).toEqual({
      representative: nameKey,
      order: [nameKey, "prop_1", statusKey],
      list_columns: ["prop_1", statusKey],
      archived: [],
      option_labels: { [statusKey]: { option_1: "판매 중" } },
    });
    expect(stored.target.schema.required).toContain(nameKey);
    const history = page.getByRole("region", { name: "변경 이력", exact: true });
    await expect(history.getByRole("button", { name: "변경 적용", exact: true })).toBeEnabled();
    await history.getByRole("button", { name: "변경 적용", exact: true }).click();
    await expect.poll(async () =>
      (await mcp.call("get_entity_schema_change", { type_id: type.id, change_id: saved.id })).status
    ).toBe("applied");
    const published = await mcp.call("get_entity_schema", { type_id: type.id });
    expect(published.schema_version).toBe(2);
    expect(entitySchemaPresentation(published.schema)).toEqual(entitySchemaPresentation(stored.target.schema));
    await expect(history.getByRole("button", { name: "변경 이력 다시 조회", exact: true })).toBeEnabled();
    const inputToggle = page.getByRole("button", { name: "입력 항목", exact: true });
    if (await inputToggle.getAttribute("aria-expanded") === "false") await inputToggle.click();
    const renderedFields = page.getByRole("list", { name: "입력 항목 목록", exact: true }).getByRole("region");
    await expect(renderedFields).toHaveCount(3);
    await expect(renderedFields.nth(0)).toHaveAttribute("aria-label", "상품명 입력 항목");
    await expect(renderedFields.nth(1)).toHaveAttribute("aria-label", "이름 입력 항목");
    await expect(renderedFields.nth(2)).toHaveAttribute("aria-label", "판매 상태 입력 항목");
  } finally {
    await mcp.close();
  }
});

test("기록 템플릿이 바뀌면 같은 이력 행에서 변환 초안을 유지해 최신 기준의 새 변경안을 검토한다", async ({ page }) => {
  await devLogin(page);
  const mcp = await mcpClient(await mcpTokenViaConsent(page));
  try {
    const type = await mcp.call("create_entity_type", { label: unique("템플릿 변경 재검토") });
    const addition = await mcp.call("create_entity_schema_change", {
      type_id: type.id,
      expected_schema_version: 1,
      edits: [{
        op: "add_property",
        client_ref: "price",
        field: { "x-order": 20, type: ["integer", "null"], title: "가격" },
      }],
    });
    await analyzeAndApply(mcp, type.id, addition.id, addition.version);
    const priceKey = addition.reservations.price;
    await mcp.call("create_entity", {
      entity_type_id: type.id,
      schema_version: 2,
      properties: { prop_1: "원본 상품", [priceKey]: 0 },
    });
    const change = await mcp.call("create_entity_schema_change", {
      type_id: type.id,
      expected_schema_version: 2,
      edits: [{
        op: "update_property",
        key: priceKey,
        field: { "x-order": 30, type: ["string", "null"], title: "가격" },
        required: false,
      }],
    });
    await mcp.call("analyze_entity_schema_change", {
      type_id: type.id,
      change_id: change.id,
      expected_change_version: change.version,
    });
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return await mcp.call("get_entity_schema_change", { type_id: type.id, change_id: change.id });
    }, { timeout: 30000 }).toMatchObject({
      status: "ready",
      analysis: { status: "succeeded", failed: 1 },
      executable: false,
    });
    await page.goto(`/settings/entity-types/${type.id}?change_id=${change.id}`);
    const history = page.getByRole("region", { name: "변경 이력", exact: true });
    await history.getByLabel("가격 변환 방식", { exact: true }).selectOption("convert");
    const before = await mcp.call("get_business_settings", { id: "record_templates" });
    const templates = before.settings.record_templates ?? {};
    await mcp.call("update_business_settings", {
      id: "record_templates",
      expected_version: before.versions.record_templates,
      value: {
        ...templates,
        entity_types: {
          ...templates.entity_types,
          [type.id]: { ...templates.entity_types?.[type.id], update: { memo: "변환 확인 $대상$", tag_ids: [] } },
        },
      },
    });
    const savedTemplates =
      (await mcp.call("get_business_settings", { id: "record_templates" })).settings.record_templates;
    expect({ ...savedTemplates, entity_types: { ...savedTemplates.entity_types, [type.id]: undefined } }).toEqual({
      ...templates,
      entity_types: { ...templates.entity_types, [type.id]: undefined },
    });
    const rejectedResponse = page.waitForResponse((response) =>
      response.request().method() === "PATCH" && response.url().endsWith(`/schema-changes/${change.id}`)
    );
    await history.getByRole("button", { name: "보완 내용 검토", exact: true }).click();
    const rejected = await rejectedResponse;
    expect(rejected.status()).toBe(409);
    expect(await rejected.json()).toMatchObject({ code: "schema_plan_stale" });
    await expect(page.getByRole("alert").filter({ hasText: "기록 템플릿이 변경되었습니다" })).toBeVisible();
    await expect(history.getByLabel("가격 변환 방식", { exact: true })).toHaveValue("convert");
    const recreatedResponse = page.waitForResponse((response) =>
      response.request().method() === "POST" && response.url().endsWith(`/entity-types/${type.id}/schema-changes`)
    );
    await history.getByRole("button", { name: "최신 기준으로 다시 검토", exact: true }).click();
    const recreated = await recreatedResponse;
    expect(recreated.status()).toBe(201);
    const next = await recreated.json();
    expect(next.id).not.toBe(change.id);
    const stored = await mcp.call("get_entity_schema_change", { type_id: type.id, change_id: next.id });
    expect(stored.target.schema.properties[priceKey].type).toEqual(["string", "null"]);
    expect(stored.migration.rules).toEqual([{ op: "convert", key: priceKey, to: "string" }]);
    expect(stored.source_template_fingerprint).not.toBe(change.source_template_fingerprint);
    expect((await mcp.call("get_entity_schema_change", { type_id: type.id, change_id: change.id })).status).toBe(
      "stale",
    );
    await expect(history).toContainText("기존 변경안은 이력에 유지됩니다");
    await expect(history.getByRole("link", { name: "이 변경안 직접 링크", exact: true })).toHaveAttribute(
      "href",
      new RegExp(`change_id=${next.id}`),
    );
    await expect.poll(async () => {
      await schemaAnalysisTick();
      return (await mcp.call("get_entity_schema_change", { type_id: type.id, change_id: next.id })).executable;
    }, { timeout: 30000 }).toBe(true);
    await expect(history.getByRole("button", { name: "값 변환 시작", exact: true })).toBeEnabled();
    expect((await mcp.call("get_entity_schema", { type_id: type.id })).schema_version).toBe(2);
  } finally {
    // The support fixture removes only this test's new type and its own entity_types template path.
    await mcp.close();
  }
});
