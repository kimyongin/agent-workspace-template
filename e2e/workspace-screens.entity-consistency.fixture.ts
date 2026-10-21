import { executionDialog } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { fixtures, form, go, linkedFixture } from "./support/workspace-screens.ts";
import { entityKey, fixtureSchema, id, stamp } from "./support/workspace-data.ts";

for (const width of [390, 1440]) {
  test(`computed entity title and ordinary properties remain readable at ${width}`, async ({ page }) => {
    const state = await fixtures(page);
    await page.setViewportSize({ width, height: 900 });
    await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
    const titleProperty = form(page).getByRole("term").filter({ hasText: /^제목$/ });
    await expect(titleProperty).toHaveCount(1);
    const properties = titleProperty.locator("xpath=ancestor::section[1]");
    const heading = properties.getByRole("heading", { name: "자료", exact: true });
    await expect(heading).toHaveCount(1);
    await expect(heading).toBeVisible();
    await expect(titleProperty.locator("..").getByRole("definition")).toHaveText("자료");
    await expect(properties.locator("dt", { hasText: "제목" })).toHaveCount(1);
    await expect(properties.locator("dt", { hasText: "자료 종류" })).toHaveCount(0);
    expect(await heading.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16);
    await expect(heading).toHaveCSS("font-weight", "600");
    await expect(properties.locator("dd", { hasText: /^0$/ })).toHaveCount(1);
    expect(state.writes).toHaveLength(0);
  });
}

test("deleted entity related task retains standard preview and detail navigation", async ({ page }) => {
  const state = await fixtures(page);
  linkedFixture(state);
  state.rows.entities[0].deleted_at = stamp;
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
  const related = form(page).getByRole("region", { name: "할 일 (1개)", exact: true });
  await related.getByRole("button", { name: "할 일", exact: true }).click();
  await expect(related).toContainText("상세 본문");
  await related.getByRole("link", { name: "할 일 상세", exact: true }).click();
  await expect(form(page)).toContainText("상세 본문");
  expect(state.writes).toHaveLength(0);
});

for (const outcome of ["success", "failed"] as const) {
  test(`related entity properties retain schema loading, ${outcome} and retry states`, async ({ page }) => {
    const state = await fixtures(page);
    linkedFixture(state);
    let release!: () => void, started!: () => void, failed = outcome === "failed";
    const held = new Promise<void>(resolve => release = resolve);
    const arrived = new Promise<void>(resolve => started = resolve);
    await page.route("**/api/entity-types/*/schema?schema_version=1", async route => {
      started();
      await held;
      await route.fulfill(failed
        ? { status: 503, json: { code: "unavailable", message: "속성 정의 일시 실패" } }
        : { json: fixtureSchema });
    });
    try {
      await go(page, `/tasks/${id(2)}`);
      const related = form(page).getByRole("region", { name: "연결된 자료 (1개)", exact: true });
      const toggle = related.getByRole("button", { name: "자료", exact: true });
      await toggle.click();
      await arrived;
      await expect(related.getByRole("status")).toHaveText("속성 정의를 불러오는 중…");
      await expect(related.getByRole("term").filter({ hasText: /^수량$/ })).toHaveCount(0);
      await expect(toggle).toBeFocused();
      release();
      if (failed) {
        await expect(related.getByRole("alert")).toHaveText("속성 정의를 불러오지 못했습니다.");
        await expect(related.getByRole("term").filter({ hasText: /^자료 식별자$/ }).locator("../dd")).toHaveText(state.rows.entities[0].identity_label);
        failed = false;
        await related.getByRole("button", { name: "속성 정의 다시 조회", exact: true }).click();
      }
      await expect(related.getByRole("term").filter({ hasText: /^수량$/ }).locator("../dd")).toHaveText("0");
      await expect(related.getByText("속성 정의를 불러오는 중…", { exact: true })).toHaveCount(0);
      await expect(toggle).toHaveAttribute("aria-expanded", "true");
      await expect(related.getByRole("link", { name: "자료 상세", exact: true })).toBeVisible();
      expect(state.writes).toHaveLength(0);
      expect(state.errors).toEqual([]);
    } finally { release(); }
  });
}

test("automatic number creation has no empty lookup or normal schema recovery actions", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, "/entities?create=1");
  await expect(form(page).getByText("저장 시 자동 발급", { exact: true })).toBeVisible();
  await expect(form(page).getByRole("button", { name: "기존 대상 확인", exact: true })).toHaveCount(0);
  await expect(form(page).getByRole("button", { name: "입력 항목 정의 다시 조회", exact: true })).toHaveCount(0);
  expect(state.writes).toHaveLength(0);
});

test("empty type scope is not a failed filter and keyword reset retains the type", async ({ page }) => {
  const state = await fixtures(page);
  state.rows.entities.length = 0;
  await go(page, "/entities");
  await expect(page.getByText("아직 자료가 없습니다.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "검색 조건 해제", exact: true })).toHaveCount(0);
  await go(page, "/entities?keyword=없는상품");
  await expect(page.getByText("조건에 맞는 자료가 없습니다.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "검색 조건 해제", exact: true }).click();
  await expect(page).toHaveURL(/entity_type_id=00000000-0000-4000-8000-000000000900/);
  await expect(page.getByText("아직 자료가 없습니다.", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("keyword")).toBe(false);
  expect(state.writes).toHaveLength(0);
});

test("direct identifier lookup appears after input and reports a new identifier", async ({ page }) => {
  const state = await fixtures(page);
  const schema = structuredClone(fixtureSchema), kindId = id(31);
  const key = schema.schema["x-identity-property"]!;
  schema.schema.properties[key]["x-identifier"] = { allowed_kind_ids: [kindId], default_kind_id: kindId };
  schema.identifier_kinds = [{ id: kindId, source: "market", source_label: "마켓", label: "원본 번호", generation: "direct", active: true, version: 1, source_version: 1 }];
  await page.route("**/api/entity-types/*/schema", route => route.fulfill({ json: schema }));
  await go(page, "/entities?create=1");
  const lookup = form(page).getByRole("button", { name: "기존 대상 확인", exact: true });
  await expect(form(page).getByRole("textbox", { name: /^식별자/ })).toBeEditable();
  await expect(lookup).toHaveCount(0);
  await form(page).getByRole("textbox", { name: /^식별자/ }).fill("12345");
  await lookup.click();
  await expect(form(page)).toContainText("새로운 자료 식별자입니다.");
  expect(state.writes).toHaveLength(0);
});

test("schema retry preserves property input after a conflict", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}?edit=1`);
  await form(page).getByLabel("수량", { exact: true }).fill("10");
  await page.route(
    "**/api/records/prepare",
    (route) =>
      route.fulfill({
        status: 409,
        json: {
          code: "schema_changed",
          message: "속성 정의가 변경되었습니다",
          retryable: false,
          fields: [{ path: "schema_version", message: "최신 정의를 확인하세요" }],
        },
      }),
  );
  await form(page).getByRole("button", { name: "저장", exact: true }).click();
  const confirmation = executionDialog(page);
  await expect(confirmation).toContainText("속성 정의가 변경되었습니다");
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await page.route("**/api/entity-types/*/schema", (route) => route.fulfill({ json: fixtureSchema }));
  await form(page).getByRole("button", { name: "속성 정의 다시 조회", exact: true }).click();
  await form(page).getByRole("button", { name: "확인한 정의로 편집", exact: true }).click();
  await expect(form(page).getByLabel("수량", { exact: true })).toHaveValue("10");
  expect(state.writes).toHaveLength(0);
});

test("false, null and archived property values remain readable beside the computed title", async ({ page }) => {
  const state = await fixtures(page);
  const schema = structuredClone(fixtureSchema);
  schema.schema.properties.prop_6 = { "x-order": 50, type: "boolean", title: "판매 중" };

  schema.schema.properties["prop_4"]["deprecated"] = true;
  state.rows.entities[0].properties.prop_6 = false;
  await page.route("**/api/entity-types/*/schema?schema_version=1", (route) => route.fulfill({ json: schema }));
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
  const properties = form(page).getByRole("term").filter({ hasText: /^제목$/ }).first().locator("xpath=ancestor::section[1]");
  await expect(properties.locator("div", { has: page.locator("dt", { hasText: /^판매 중$/ }) })).toContainText("거짓");
  await expect(properties.locator("div", { has: page.locator("dt", { hasText: /^날짜$/ }) })).toContainText("값 없음");
  await expect(properties.locator("dt", { hasText: /^분류 · 보관$/ })).toBeVisible();
  expect(state.writes).toHaveLength(0);
});

for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
  test(`entity view and edit retain complete pairs without overflow at ${width}`, async ({ page }, info) => {
    const state = await fixtures(page);
    linkedFixture(state);
    const schema = structuredClone(fixtureSchema);
    schema.schema.properties.prop_4.readOnly = true;
    schema.schema.properties.prop_6 = {
      "x-order": 60,
      type: "boolean",
      title: "판매 중지 여부를 포함한 아주 긴 항목 이름",
      deprecated: true,
    };
    schema.schema.properties.prop_7 = { "x-order": 70, type: "string", title: "미입력 항목" };
    state.rows.entities[0].properties.prop_6 = false;
    state.rows.entities[0].properties.prop_1 = "이름과 번호를 포함하는 아주 긴 자료 이름".repeat(5);
    state.rows.entities[0].title = state.rows.entities[0].properties.prop_1;
    await page.route("**/api/entity-types/*/schema**", (route) => route.fulfill({ json: schema }));
    await page.setViewportSize({ width, height: 1000 });
    await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
    const detail = form(page);
    if (width === 1440) {
      const source = detail.locator("dt", { hasText: /^수량$/ });
      const number = detail.locator("dt", { hasText: /^식별자 · 자료 식별자$/ });
      await expect.poll(async () => Math.abs((await source.boundingBox())!.x - (await number.boundingBox())!.x))
        .toBeLessThan(2);
      for (const key of [source, number]) {
        const value = key.locator("..").locator("dd");
        expect((await value.boundingBox())!.x).toBeGreaterThan((await key.boundingBox())!.x);
      }
    }
    await expect(detail.locator("dt", { hasText: /^미입력 항목$/ })).toBeVisible();
    await expect(detail.locator("dd", { hasText: /^미입력$/ })).toBeVisible();
    const primary = detail.getByRole("term").filter({ hasText: /^제목$/ }).first().locator("xpath=ancestor::section[1]");
    const read = await primary.getByRole("term").allTextContents();
    expect(read).toHaveLength(8);
    const labels = read.map(label => label.replace(/ · (읽기 전용|보관|자료 식별자)/g, "").trim());
    expect(labels).toEqual(expect.arrayContaining(["제목", "식별자", "수량", "날짜", "분류", "판매 중지 여부를 포함한 아주 긴 항목 이름", "미입력 항목", "태그"]));
    if ([390, 1440].includes(width)) await page.screenshot({ path: info.outputPath("view-pairs.png") });
    await detail.getByRole("button", { name: "편집", exact: true }).click();
    await expect(detail.getByRole("textbox", { name: /^제목/ })).toBeEditable();
    await expect(detail.locator("dt:visible", { hasText: /^분류/ })).toContainText("읽기 전용");
    await expect(detail.locator("dt:visible", { hasText: /^판매 중지/ })).toContainText("보관");
    await expect(detail.getByRole("button", { name: /할 일 작성|기록 작성|연결 해제/ })).toHaveCount(0);
    await expect(detail.getByRole("region", { name: "할 일 (1개)", exact: true })).toContainText("할 일");
    let editedPairs = 0;
    for (const label of labels) {
      const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const control = detail.getByLabel(new RegExp(`^${escaped}(?:\\s*\\*?\\s*\\(필수\\))?$`)).filter({ visible: true });
      if (await control.count()) {
        await expect(control.first()).toBeVisible();
        const box = (await control.first().boundingBox())!;
        expect(box.width).toBeGreaterThan(0); expect(box.height).toBeGreaterThanOrEqual(44);
        if (label === "제목") await expect(control.first()).toHaveValue(state.rows.entities[0].title);
        if (label === "수량") await expect(control.first()).toHaveValue("0");
      } else {
        const key = detail.getByRole("term").filter({ hasText: new RegExp(`^${escaped}(?: ·|$)`) }).filter({ visible: true }).first();
        await expect(key).toBeVisible(); await expect(key.locator("..").getByRole("definition")).toBeVisible();
      }
      editedPairs++;
    }
    expect(editedPairs).toBe(read.length);
    expect(await detail.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    if ([390, 1440].includes(width)) await page.screenshot({ path: info.outputPath("edit-pairs.png") });
    expect(state.writes).toHaveLength(0);
  });
}

test("entity pairs reflow at 200 percent and preserve keyboard editing and cancellation", async ({ page }, info) => {
  const state = await fixtures(page);
  await page.setViewportSize({ width: 768, height: 1000 });
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
  await page.evaluate(() => document.documentElement.style.zoom = "2");
  const detail = form(page);
  await expect(detail.locator("dt", { hasText: /^제목$/ })).toBeVisible();
  expect(await detail.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await detail.getByRole("button", { name: "편집", exact: true }).click();
  const quantity = detail.getByRole("textbox", { name: "수량", exact: true });
  await quantity.focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("13");
  await expect(quantity).toHaveValue("13");
  expect(await detail.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("zoom-200-edit.png") });
  await detail.getByRole("button", { name: "취소", exact: true }).click();
  const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true });
  await expect(discard).toBeVisible();
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(quantity).toHaveValue("13");
  await detail.getByRole("button", { name: "취소", exact: true }).click();
  await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await expect(detail.getByRole("button", { name: "편집", exact: true })).toBeVisible();
  await expect(detail.locator("dd:visible", { hasText: /^0$/ })).toBeVisible();
  expect(state.writes).toHaveLength(0);
});
