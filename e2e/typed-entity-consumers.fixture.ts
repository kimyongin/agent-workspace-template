import { fulfillFixtureWorkspace } from "./support/workspace-scope.ts";
import { fixtureWorkspacePath } from "./support/workspace-scope.ts";
import { chooseSetting } from "./settings-actions.ts";
import { chooseEntityType } from "./ui-actions.ts";
import { executionDialog, saveOnce } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { entity, fixtureSchema, fixtureType, id, stamp } from "./support/workspace-data.ts";
import { encodeIdentifierReference, encodeIdentifierValue } from "../supabase/functions/_shared/contracts/entity-identifiers.ts";
import { openTabFilters } from "./ui-actions.ts";
import { disclosureContent } from "./table-actions.ts";
const second = { ...fixtureType, id: id(901), label: "다른 자료" };
test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (await fulfillFixtureWorkspace(route, [{ target_kind: "settings", target_id: "*", access: "write" }, { target_kind: "tasks", target_id: "*", access: "write" }, ...[fixtureType, second].map(type => ({ target_kind: "entity_type" as const, target_id: type.id, access: "write" as const }))])) return;
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    if (url.pathname === "/api/entity-types") {
      return route.fulfill({ json: { items: [fixtureType, second], next_cursor: null } });
    }
    if (url.pathname.startsWith("/api/entity-types/")) {
      const selected = url.pathname.includes(second.id) ? second : fixtureType;
      if (url.pathname.endsWith("/identity")) {
        return route.fulfill({ status: 404, json: { code: "not_found", message: "퇴역 경로" } });
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
    if (url.pathname === "/api/entities/lookup") return route.fulfill({ json: null });
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
test("typed list uses composed titles and expanded key-values with AND filters, type switch clears only property conditions", async ({ page }) => {
  await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}&keyword=資料&tag_id=tag&view=table`));
  await expect(page.getByRole("heading", { name: "검사 자료", level: 1 })).toBeVisible();
  const table = page.getByRole("table", { name: "검사 자료 목록", exact: true });
  await expect(table.getByRole("columnheader", { name: "제목", exact: true })).toBeVisible();
  await expect(table.getByRole("columnheader", { name: "수량", exact: true })).toHaveCount(0);
  const toggle = table.getByRole("button", { name: entity().title, exact: true });
  await toggle.click();
  const preview = await disclosureContent(page, toggle);
  for (const [label, value] of [["제목", "자료"], ["수량", "0"]]) {
    const property = preview.getByRole("term").filter({ hasText: new RegExp(`^${label}$`) });
    await expect(property).toHaveCount(1);
    await expect(property.locator("..").getByRole("definition")).toHaveText(value);
  }
  await toggle.click();
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
  await chooseEntityType(page, second.label);
  const url = new URL(page.url());
  expect(url.searchParams.has("property_filters")).toBe(false);
  expect(url.searchParams.has("sort")).toBe(false);
  expect(url.searchParams.get("keyword")).toBe("資料");
  expect(url.searchParams.get("tag_id")).toBe("tag");
});
test("manual deleted lookup opens restore confirmation without submitting archived properties", async ({ page }) => {
  const kindId = id(333), raw = "001:한글/😀", pair = encodeIdentifierValue(kindId, raw);
  const schema = structuredClone(fixtureSchema), selected = schema.schema["x-identity-property"]!;
  schema.schema.properties[selected]["x-identifier"] = { allowed_kind_ids: [kindId], default_kind_id: kindId };
  schema.identifier_kinds = [{ id: kindId, source: "crm", source_label: "고객", label: "고객 번호", generation: "direct", active: true, version: 1, source_version: 1 }];
  const archived = {
    ...entity(), identity_label: `고객 · 고객 번호 · ${raw}`,
    id: encodeIdentifierReference(fixtureType.id, kindId, raw), deleted_at: stamp, tag_ids: [id(700)],
    properties: { prop_1: "보존 이름", prop_2: 0, prop_3: null, prop_4: "b", [selected]: pair },
  };
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
  await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}`));
  await page.getByRole("button", { name: "검사 자료 추가", exact: true }).click();
  const form = page.getByRole("dialog", { name: "검사 자료 추가", exact: true });
  await form.getByLabel("제목", { exact: false }).fill("임시 입력");
  await form.getByRole("textbox", { name: /^식별자/ }).fill(raw);
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await expect(executionDialog(page)).toBeVisible();
  await expect.poll(() => inputs.length).toBe(1);
  expect(inputs[0].properties).toEqual({ prop_1: "보존 이름", prop_2: 0, prop_3: null, [selected]: pair });
  expect(inputs[0]).not.toHaveProperty("generate_identifiers");
  expect(inputs[0].expected_version).toBe(1);
  expect(inputs[0]).not.toHaveProperty("tag_ids");
});
test("template insertion uses selected type labels and immutable property keys", async ({ page }) => {
  await page.goto(fixtureWorkspacePath("/settings/records"));
  await chooseSetting(page, page.getByLabel("대상", { exact: true }), fixtureType.label);
  const form = page.getByRole("form", { name: "기록 자동 완성" });
  await expect(form.getByLabel("자료 종류", { exact: true })).toHaveCount(0);
  await chooseSetting(page, form.getByLabel("액션", { exact: true }), "수정");
  await chooseSetting(page, form.getByLabel("변수 삽입", { exact: true }), "수량 · 이후");
  const memo = form.getByLabel("메모 템플릿", { exact: true });
  await expect(memo).toContainText("수량 · 이후");
  await expect(memo).not.toContainText("prop_");
  await expect(memo.locator('[data-memo-token="$엔터티.이후.prop_2$"]')).toHaveText("수량 · 이후");
  const variables = form.getByLabel("변수 삽입", { exact: true });
  await variables.fill("수량 · 이후");
  await expect(page.getByRole("option", { name: "수량 · 이후", exact: true })).toBeVisible();
  await variables.press("Escape");
});

test("numeric filter rejects a precision-losing draft without applying or clearing its input", async ({ page }) => {
  await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}`));
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
  await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}`));
  await page.getByRole("button", { name: "검사 자료 추가", exact: true }).click();
  const form = page.getByRole("dialog", { name: "검사 자료 추가", exact: true });
  await form.getByLabel("제목", { exact: false }).fill("숫자 초안");
  const input = form.getByLabel("수량", { exact: false });
  await input.fill("9007199254740993");
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await expect(form.getByRole("alert").filter({ hasText: "입력을 확인하세요" })).toContainText("입력을 확인하세요");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(form).toContainText("정밀도");
  await expect(input).toHaveValue("9007199254740993");
  expect(prepared).toBe(0);
});

test(
  "read-only initial name default is visible and permits creation without a user value",
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
    await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}`));
    await page.getByRole("button", { name: "검사 자료 추가", exact: true }).click();
    const form = page.getByRole("dialog", { name: "검사 자료 추가", exact: true });
    const title = form.getByRole("term").filter({ hasText: /^제목 · 읽기 전용$/ });
    await expect(title).toBeVisible();
    await expect(title.locator("..").getByRole("definition")).toHaveText("Auto");
    await form.screenshot({ path: testInfo.outputPath("readonly-name-property-default.png") });
    await form.getByRole("button", { name: "저장", exact: true }).click();
    await expect.poll(() => preparedInputs.length).toBe(1);
    expect(preparedInputs[0].properties).not.toHaveProperty("prop_1");
    const confirmation = executionDialog(page);
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
    await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}`));
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
    await executionDialog(page).getByRole("button", { name: "등록하고 저장", exact: true }).click();
    await expect.poll(() => savedInputs.length).toBe(1);
    expect((savedInputs[0].properties as Record<string, unknown>).prop_2).toBeNull();
    await expect(form).not.toBeVisible();
  });
}

test("date property calendar closes with Escape without closing the editor or writing its unchanged leap-day draft", async ({ page }) => {
  const schema = structuredClone(fixtureSchema);
  schema.schema.properties.prop_5 = {
    "x-order": 50,
    type: ["string", "null"],
    format: "date",
    title: "확인 날짜",
  };
  const saved = { ...entity(), properties: { ...entity().properties, prop_5: "2024-02-29" } };
  await page.route("**/api/entity-types/*/schema", (route) => route.fulfill({ json: schema }));
  await page.route("**/api/entities/*", (route) => route.fulfill({ json: saved }));
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/") && request.method() !== "GET") {
      writes.push(request.method());
    }
  });
  await page.goto(fixtureWorkspacePath(`/entities/${encodeURIComponent(saved.id)}`));
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const form = page.getByRole("dialog", { name: "검사 자료 편집", exact: true });
  const input = form.getByLabel("확인 날짜", { exact: true });
  await expect(input).toHaveValue("2024-02-29");
  await form.getByRole("button", { name: "확인 날짜 달력 열기", exact: true }).click();
  const calendar = page.getByRole("dialog", { name: "확인 날짜 달력", exact: true });
  await expect(calendar.getByRole("gridcell", { selected: true })).toContainText("29");
  await calendar.press("Escape");
  await expect(calendar).toHaveCount(0);
  await expect(form).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveValue("2024-02-29");
  await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?" })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test("date calendar keeps its popup within a narrow enlarged screen without shrinking day targets", async ({ page }) => {
  const schema = structuredClone(fixtureSchema);
  schema.schema.properties.prop_5 = { "x-order": 50, type: ["string", "null"], format: "date", title: "확인 날짜" };
  const saved = { ...entity(), properties: { ...entity().properties, prop_5: "2024-02-29" } };
  await page.route("**/api/entity-types/*/schema", (route) => route.fulfill({ json: schema }));
  await page.route("**/api/entities/*", (route) => route.fulfill({ json: saved }));
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(fixtureWorkspacePath(`/entities/${encodeURIComponent(saved.id)}`));
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await page.evaluate(() => { document.documentElement.style.zoom = "2"; });
  const form = page.getByRole("dialog", { name: "검사 자료 편집", exact: true });
  await form.getByRole("button", { name: "확인 날짜 달력 열기", exact: true }).click();
  const calendar = page.getByRole("dialog", { name: "확인 날짜 달력", exact: true });
  await expect(calendar.getByRole("grid")).toBeVisible();

  await expect.poll(async () => {
    const box = await calendar.boundingBox();
    return !!box && box.x >= -1 && box.x + box.width <= 321 && box.y >= -1 && box.y + box.height <= 801;
  }).toBe(true);
  const selected = calendar.getByRole("gridcell", { selected: true }).getByRole("button");
  const target = await selected.boundingBox();
  expect(target?.width).toBeGreaterThanOrEqual(87);
  expect(target?.height).toBeGreaterThanOrEqual(87);
  await selected.focus();
  const box = await selected.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width).toBeLessThanOrEqual(321);
  await expect.poll(() => selected.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return [[box.left + 2, box.top + box.height / 2], [box.right - 2, box.top + box.height / 2],
      [box.left + box.width / 2, box.top + 2], [box.left + box.width / 2, box.bottom - 2]].every(([x, y]) =>
      node.contains(document.elementFromPoint(x, y)));
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("date-calendar-320-zoom2.png"), animations: "disabled" });
  await page.setViewportSize({ width: 320, height: 568 });
  await expect(calendar.getByRole("grid")).toBeVisible();
  await expect.poll(async () => {
    const box = await calendar.boundingBox();
    return !!box && box.x >= -1 && box.x + box.width <= 321 && box.y >= -1 && box.y + box.height <= 569;
  }).toBe(true);
  await selected.focus();

  await expect.poll(() => selected.evaluate((node) => {
    const box = node.getBoundingClientRect();
    return [[box.left + 2, box.top + box.height / 2], [box.right - 2, box.top + box.height / 2],
      [box.left + box.width / 2, box.top + 2], [box.left + box.width / 2, box.bottom - 2]].every(([x, y]) =>
      node.contains(document.elementFromPoint(x, y)));
  })).toBe(true);
  await page.screenshot({ path: test.info().outputPath("date-calendar-320-short-zoom2.png"), animations: "disabled" });
  await selected.press("Escape");
  await expect(calendar).toHaveCount(0);
  await expect(form.getByLabel("확인 날짜", { exact: true })).toHaveValue("2024-02-29");
});

test("date calendar navigation preserves the supported civil-year boundaries", async ({ page }) => {
  await page.goto(fixtureWorkspacePath(`/entities/${encodeURIComponent(entity().id)}`));
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const form = page.getByRole("dialog", { name: "검사 자료 편집", exact: true });
  const input = form.getByLabel("날짜", { exact: true });
  await input.fill("2024-02-29");
  await form.getByRole("button", { name: "날짜 달력 열기", exact: true }).click();
  const yearCalendar = page.getByRole("dialog", { name: "날짜 달력", exact: true });
  await yearCalendar.getByRole("gridcell", { selected: true }).getByRole("button").press("Shift+PageDown");
  await page.keyboard.press("Enter");
  await expect(input).toHaveValue("2025-02-28");
  await input.fill("9999-12-31");
  await form.getByRole("button", { name: "날짜 달력 열기", exact: true }).click();
  const calendar = page.getByRole("dialog", { name: "날짜 달력", exact: true });
  await expect(calendar.getByRole("gridcell", { selected: true })).toContainText("31");
  await expect(calendar.getByRole("gridcell", { selected: true }).getByRole("button")).toBeEnabled();
  await expect(calendar.getByRole("button", { name: "다음 달", exact: true })).toBeDisabled();
  await calendar.press("Escape");
  await expect(calendar).toHaveCount(0);
  await input.fill("0001-01-01");
  await form.getByRole("button", { name: "날짜 달력 열기", exact: true }).click();
  await expect(calendar.getByRole("gridcell", { selected: true })).toContainText("1");
  await expect(calendar.getByRole("gridcell", { selected: true }).getByRole("button")).toBeEnabled();
  await expect(calendar.getByRole("button", { name: "이전 달", exact: true })).toBeDisabled();
  await calendar.press("Escape");
  await expect(input).toHaveValue("0001-01-01");
});

test("keyboard calendar selection changes only the date draft until explicit save and survives reopen", async ({ page }) => {
  let current = entity(1, { prop_3: "2024-02-29" });
  const writes: Record<string, unknown>[] = [];
  await page.route("**/api/entities/*", async (route) => {
    if (route.request().method() === "PATCH") {
      const input = route.request().postDataJSON();
      writes.push(input);
      current = { ...current, properties: { ...current.properties, ...input.properties }, version: current.version + 1 };
    }
    return route.fulfill({ json: current });
  });
  await page.goto(fixtureWorkspacePath(`/entities/${encodeURIComponent(current.id)}`));
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const form = page.getByRole("dialog", { name: "검사 자료 편집", exact: true });
  await form.getByRole("button", { name: "날짜 달력 열기", exact: true }).click();
  const calendar = page.getByRole("dialog", { name: "날짜 달력", exact: true });
  await calendar.getByRole("gridcell", { selected: true }).getByRole("button").press("ArrowRight");
  await page.keyboard.press("Enter");
  await expect(calendar).toHaveCount(0);
  await expect(form.getByLabel("날짜", { exact: true })).toHaveValue("2024-03-01");
  expect(writes).toEqual([]);
  await saveOnce(page, form);
  await expect.poll(() => writes.length).toBe(1);
  expect((writes[0].properties as Record<string, unknown>).prop_3).toBe("2024-03-01");
  expect((writes[0].properties as Record<string, unknown>).prop_2).toBe(0);
  await page.reload();
  await page.getByRole("button", { name: "편집", exact: true }).click();
  await expect(form.getByLabel("날짜", { exact: true })).toHaveValue("2024-03-01");
});

test.describe("date-only values independent of browser timezone", () => {
  test.use({ timezoneId: "Pacific/Apia" });
  test("calendar retains a civil day even when that day is absent from the browser timezone", async ({ page }) => {
    await page.goto(fixtureWorkspacePath(`/entities/${encodeURIComponent(entity().id)}`));
    await page.getByRole("button", { name: "편집", exact: true }).click();
    const form = page.getByRole("dialog", { name: "검사 자료 편집", exact: true });
    const input = form.getByLabel("날짜", { exact: true });
    await input.fill("2011-12-30");
    await form.getByRole("button", { name: "날짜 달력 열기", exact: true }).click();
    const calendar = page.getByRole("dialog", { name: "날짜 달력", exact: true });
    await expect(calendar.getByRole("gridcell", { selected: true })).toContainText("30");
    await calendar.getByRole("gridcell", { selected: true }).getByRole("button").press("Enter");
    await expect(calendar).toHaveCount(0);
    await expect(input).toHaveValue("2011-12-30");
  });
});

test("calendar loading failure keeps the raw editor draft available for manual correction", async ({ page }) => {
  const blocked = "**/src/components/DateCalendar.tsx*";
  await page.route(blocked, (route) => route.abort("failed"));
  let current = entity();
  const patches: Record<string, unknown>[] = [];
  await page.route("**/api/entities/*", (route) => {
    if (route.request().method() === "PATCH") {
      const patch = route.request().postDataJSON();
      patches.push(patch);
      current = { ...current, title: patch.properties.prop_1, properties: { ...current.properties, ...patch.properties }, version: current.version + 1 };
    }
    return route.fulfill({ json: current });
  });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/") && request.method() !== "GET") writes.push(request.method());
  });
  await page.goto(fixtureWorkspacePath(`/entities/${encodeURIComponent(entity().id)}`));
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const form = page.getByRole("dialog", { name: "검사 자료 편집", exact: true });
  const title = form.getByRole("textbox", { name: /^제목/ });
  await title.fill("로딩 실패에도 남길 초안");
  const date = form.getByLabel("날짜", { exact: true });
  await date.fill("2024-02-29");
  await form.getByRole("button", { name: "날짜 달력 열기", exact: true }).click();
  const calendar = page.getByRole("dialog", { name: "날짜 달력", exact: true });
  await expect(calendar.getByRole("alert")).toContainText("달력 화면을 불러오지 못했습니다");
  await expect(title).toHaveValue("로딩 실패에도 남길 초안");
  await expect(date).toHaveValue("2024-02-29");
  expect(writes).toEqual([]);
  await calendar.press("Escape");
  await expect(date).toBeFocused();
  await expect(title).toHaveValue("로딩 실패에도 남길 초안");
  expect(writes).toEqual([]);
  await date.fill("2024-03-01");
  await saveOnce(page, form);
  await expect.poll(() => patches.length).toBe(1);
  expect((patches[0].properties as Record<string, unknown>).prop_3).toBe("2024-03-01");
});
