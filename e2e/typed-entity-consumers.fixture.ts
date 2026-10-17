import { expect, test } from "@playwright/test";
import { entity, fixtureIdentity, fixtureSchema, fixtureType, id, stamp } from "./support/workspace-data.ts";
import { openTabFilters } from "./ui-actions.ts";
const second = { ...fixtureType, id: id(901), label: "다른 자료" };
test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    if (url.pathname === "/api/entity-types") {
      return route.fulfill({ json: { items: [fixtureType, second], next_cursor: null } });
    }
    if (url.pathname.startsWith("/api/entity-types/")) {
      const selected = url.pathname.includes(second.id) ? second : fixtureType;
      if (url.pathname.endsWith("/identity")) {
        return route.fulfill({ json: fixtureIdentity(selected.id) });
      }
      if (url.pathname.endsWith("/schemas")) {
        return route.fulfill({
          json: {
            items: [{ type_id: selected.id, schema_version: fixtureSchema.schema_version, created_at: stamp }],
            next_before: null,
          },
        });
      }
      if (url.pathname.endsWith("/schema-changes")) return route.fulfill({ json: { items: [], next_before: null } });
      return route.fulfill({
        json: url.pathname.endsWith("/schema") ? { ...fixtureSchema, type_id: selected.id, type: selected } : selected,
      });
    }
    if (url.pathname === "/api/settings/business") {
      return route.fulfill({
        json: {
          settings: { record_templates: {} },
          versions: { record_templates: 0 },
        },
      });
    }
    if (url.pathname === "/api/records/prepare") {
      const body = route.request().postDataJSON();
      return route.fulfill({
        json: {
          change_note: "복원",
          change_tag_ids: [],
          missing_tag_ids: [],
          settings_version: 0,
          prepared_input: body.input,
        },
      });
    }
    if (url.pathname.endsWith("/links") && route.request().method() === "GET") {
      return route.fulfill({ json: { items: [], next_cursor: null } });
    }
    if (url.pathname.startsWith("/api/entities")) {
      return route.fulfill({
        json: url.pathname === "/api/entities" ? { items: [entity()], next_cursor: null } : entity(),
      });
    }
    if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { items: [], next_cursor: null } });
    return route.abort();
  });
  await page.addInitScript(() =>
    localStorage.setItem(
      "sb-127-auth-token",
      JSON.stringify({
        access_token: "fixture",
        refresh_token: "fixture",
        token_type: "bearer",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        user: {
          id: "00000000-0000-0000-0000-000000000001",
          aud: "authenticated",
          email: "fixture@example.test",
          app_metadata: {},
          user_metadata: { full_name: "Fixture" },
        },
      }),
    )
  );
});
test("typed list exposes current columns and AND filters, type switch clears only property conditions", async ({ page }) => {
  await page.goto(`/entities?entity_type_id=${fixtureType.id}&keyword=資料&tag_id=tag&view=table`);
  await expect(page.getByRole("heading", { name: "검사 자료", level: 1 })).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "수량" })).toBeVisible();
  await openTabFilters(page);
  await page.getByRole("button", { name: "속성 조건 추가", exact: true }).click();
  await page.getByLabel("조건 1 속성", { exact: true }).selectOption("prop_2");
  await page.getByLabel("조건 1 비교", { exact: true }).selectOption("gte");
  await page.getByLabel("조건 1 값", { exact: true }).fill("0");
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  expect(JSON.parse(new URL(page.url()).searchParams.get("property_filters")!)).toEqual([{
    key: "prop_2",
    operator: "gte",
    value: 0,
  }]);
  await page.getByLabel("정렬", { exact: true }).selectOption(JSON.stringify({ key: "prop_2", direction: "desc" }));
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await page.getByLabel("자료 종류", { exact: true }).selectOption(second.id);
  const url = new URL(page.url());
  expect(url.searchParams.has("property_filters")).toBe(false);
  expect(url.searchParams.has("sort")).toBe(false);
  expect(url.searchParams.get("keyword")).toBe("資料");
  expect(url.searchParams.get("tag_id")).toBe("tag");
});
test("manual deleted lookup opens restore confirmation without submitting archived properties", async ({ page }) => {
  const archived = {
    ...entity(),
    source: "crm",
    source_label: "고객",
    id: `crm:${fixtureType.id}:${entity().external_id}`,
    deleted_at: stamp,
    tag_ids: [id(700)],
    properties: { prop_1: "보존 이름", prop_2: 0, prop_3: null, prop_4: "b" },
  };
  await page.route("**/api/entity-types/*/identity", (route) =>
    route.fulfill({
      json: {
        ...fixtureIdentity(),
        default_source: "crm",
        sources: [{
          code: "crm",
          rule_id: fixtureType.id,
          active: true,
          referenced: false,
          source_label: "고객",
          rule_label: "고객 번호",
          generation: "direct",
        }],
      },
    }));
  const schema = structuredClone(fixtureSchema);
  schema.schema.properties.prop_4.deprecated = true;
  await page.route("**/api/entity-types/*/schema", (route) => route.fulfill({ json: schema }));
  await page.route("**/api/entities/*", (route) => route.fulfill({ json: archived }));
  const inputs: Record<string, unknown>[] = [];
  await page.route("**/api/records/prepare", (route) => {
    const body = route.request().postDataJSON();
    inputs.push(body.input);
    return route.fulfill({
      json: {
        change_note: "復元",
        change_tag_ids: [],
        missing_tag_ids: [],
        settings_version: 0,
        prepared_input: body.input,
      },
    });
  });
  await page.goto(`/entities?entity_type_id=${fixtureType.id}`);
  await page.getByRole("button", { name: "검사 자료 추가", exact: true }).click();
  const form = page.getByRole("dialog", { name: "검사 자료 추가", exact: true });
  await form.getByLabel("제목", { exact: false }).fill("임시 입력");
  await form.getByLabel("번호", { exact: true }).fill(archived.external_id);
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.locator("dialog.modal-action[open]")).toBeVisible();
  await expect.poll(() => inputs.length).toBe(1);
  expect(inputs[0].properties).toEqual({ prop_1: "보존 이름", prop_2: 0, prop_3: null });
  expect(inputs[0].expected_version).toBe(1);
  expect(inputs[0].tag_ids).toEqual([id(700)]);
});
test("template insertion uses selected type labels and immutable property keys", async ({ page }) => {
  await page.goto("/settings/records");
  await page.getByLabel("대상", { exact: true }).selectOption(
    `type:${fixtureType.id}`,
  );
  const form = page.getByRole("form", { name: "기록 자동 완성" });
  await expect(form.getByLabel("자료 종류", { exact: true })).toHaveCount(0);
  await form.getByLabel("액션", { exact: true }).selectOption("update");
  await form.getByLabel("변수 삽입", { exact: true }).selectOption("엔터티.이후.prop_2");
  const memo = form.getByLabel("메모 템플릿", { exact: true });
  await expect(memo).toContainText("수량 · 이후");
  await expect(memo).not.toContainText("prop_");
  await expect(memo.locator('[data-memo-token="$엔터티.이후.prop_2$"]')).toHaveText("수량 · 이후");
  await expect(form.getByLabel("변수 삽입", { exact: true }).locator('option[value="엔터티.이후.prop_2"]')).toHaveText(
    "수량 · 이후",
  );
});

test("numeric filter rejects a precision-losing draft without applying or clearing its input", async ({ page }) => {
  await page.goto(`/entities?entity_type_id=${fixtureType.id}`);
  await openTabFilters(page);
  await page.getByRole("button", { name: "속성 조건 추가", exact: true }).click();
  await page.getByLabel("조건 1 속성", { exact: true }).selectOption("prop_2");
  const input = page.getByLabel("조건 1 값", { exact: true });
  await input.fill("9007199254740993");
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("조건 값과 비교");
  await expect(input).toHaveValue("9007199254740993");
  expect(new URL(page.url()).searchParams.has("property_filters")).toBe(false);
  await input.fill("42");
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("property_filters")).toBe(
    '[{"key":"prop_2","operator":"eq","value":42}]',
  );
});

test("entity numeric draft rejects precision loss before preparing a record and preserves the input", async ({ page }) => {
  let prepared = 0;
  await page.route("**/api/records/prepare", async (route) => {
    prepared++;
    return route.fulfill({ json: {} });
  });
  await page.goto(`/entities?entity_type_id=${fixtureType.id}`);
  await page.getByRole("button", { name: "검사 자료 추가", exact: true }).click();
  const form = page.getByRole("dialog", { name: "검사 자료 추가", exact: true });
  await form.getByLabel("제목", { exact: false }).fill("숫자 초안");
  const input = form.getByLabel("수량", { exact: false });
  await input.fill("9007199254740993");
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await expect(form.getByRole("alert")).toContainText("입력을 확인하세요");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(form).toContainText("정밀도");
  await expect(input).toHaveValue("9007199254740993");
  expect(prepared).toBe(0);
});

test(
  "read-only representative default is visible and permits creation without a user value",
  async ({ page }, testInfo) => {
    const definition = structuredClone(fixtureSchema);
    Object.assign(definition.schema.properties.prop_1, { readOnly: true, default: "Auto" });
    await page.route("**/api/entity-types/*/schema", (route) => route.fulfill({ json: definition }));
    const preparedInputs: Record<string, unknown>[] = [], savedInputs: Record<string, unknown>[] = [];
    await page.route("**/api/records/prepare", (route) => {
      const body = route.request().postDataJSON();
      preparedInputs.push(body.input);
      return route.fulfill({
        json: {
          change_note: "등록",
          change_tag_ids: [],
          missing_tag_ids: [],
          settings_version: 0,
          prepared_input: body.input,
        },
      });
    });
    await page.route("**/api/entities", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      savedInputs.push(route.request().postDataJSON());
      return route.fulfill({ json: entity(1, { prop_1: "Auto" }) });
    });
    await page.goto(`/entities?entity_type_id=${fixtureType.id}`);
    await page.getByRole("button", { name: "검사 자료 추가", exact: true }).click();
    const form = page.getByRole("dialog", { name: "검사 자료 추가", exact: true });
    await expect(form.locator("dt", { hasText: /^제목 · 읽기 전용$/ }).locator("../dd")).toHaveText("Auto");
    await expect(form.getByRole("heading", { name: "Auto", exact: true })).toBeVisible();
    await expect(form.getByRole("textbox", { name: /^제목/ })).toHaveCount(0);
    await form.screenshot({ path: testInfo.outputPath("readonly-representative-default.png") });
    await form.getByRole("button", { name: "저장", exact: true }).click();
    await expect.poll(() => preparedInputs.length).toBe(1);
    expect(preparedInputs[0].properties).not.toHaveProperty("prop_1");
    const confirmation = page.locator("dialog.modal-action[open]");
    await expect(confirmation).toContainText("Auto");
    await confirmation.getByRole("button", { name: "등록하고 저장", exact: true }).click();
    await expect.poll(() => savedInputs.length).toBe(1);
    expect(savedInputs[0].properties).not.toHaveProperty("prop_1");
    await expect(form).not.toBeVisible();
  },
);

for (const serverDefault of [true, false]) {
  test(`required nullable choice ${serverDefault ? "default" : "selection"} creates with explicit null and keeps choice labels`, async ({ page }) => {
    const definition = structuredClone(fixtureSchema);
    definition.schema.properties.prop_2 = {
      type: ["string", "null"],
      "x-order": 20,
      title: "진행 상태",
      oneOf: [{ const: "a", title: "진행" }, { const: null, title: "미정" }, { const: "null", title: "문자 코드" }],
      ...(serverDefault ? { default: null } : {}),
    };
    definition.schema.required.push("prop_2");
    await page.route("**/api/entity-types/*/schema", (route) => route.fulfill({ json: definition }));
    const preparedInputs: Record<string, unknown>[] = [], savedInputs: Record<string, unknown>[] = [];
    await page.route("**/api/records/prepare", (route) => {
      const body = route.request().postDataJSON();
      preparedInputs.push(body.input);
      return route.fulfill({
        json: {
          change_note: "등록",
          change_tag_ids: [],
          missing_tag_ids: [],
          settings_version: 0,
          prepared_input: body.input,
        },
      });
    });
    await page.route("**/api/entities", (route) => {
      if (route.request().method() !== "POST") return route.fallback();
      savedInputs.push(route.request().postDataJSON());
      return route.fulfill({ json: entity(1, { prop_1: "명시적 null", prop_2: null }) });
    });
    await page.goto(`/entities?entity_type_id=${fixtureType.id}`);
    await page.getByRole("button", { name: "검사 자료 추가", exact: true }).click();
    const form = page.getByRole("dialog", { name: "검사 자료 추가", exact: true });
    await form.getByLabel("제목", { exact: false }).fill("명시적 null");
    const status = form.getByLabel("진행 상태", { exact: false });
    await expect(status.locator("option")).toHaveText(["미입력", "진행", "미정", "문자 코드"]);
    await expect(status).toHaveValue(serverDefault ? "null" : "unset");
    if (!serverDefault) {
      await form.getByRole("button", { name: "저장", exact: true }).click();
      await expect(status).toHaveAttribute("aria-invalid", "true");
      expect(preparedInputs).toHaveLength(0);
      await status.selectOption("value:null");
      await expect(status.locator("option:checked")).toHaveText("문자 코드");
      await status.selectOption("null");
    }
    await form.getByRole("button", { name: "저장", exact: true }).click();
    await expect.poll(() => preparedInputs.length).toBe(1);
    expect((preparedInputs[0].properties as Record<string, unknown>).prop_2).toBeNull();
    await page.locator("dialog.modal-action[open]").getByRole("button", { name: "등록하고 저장", exact: true }).click();
    await expect.poll(() => savedInputs.length).toBe(1);
    expect((savedInputs[0].properties as Record<string, unknown>).prop_2).toBeNull();
    await expect(form).not.toBeVisible();
  });
}
