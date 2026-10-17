import { expect, test } from "@playwright/test";
import { fixtures, form, go, linkedFixture } from "./support/workspace-screens.ts";
import { entityKey, fixtureIdentity, fixtureSchema, stamp } from "./support/workspace-data.ts";

for (const width of [390, 1440]) {
  test(`entity title is shown once with readable properties at ${width}`, async ({ page }) => {
    const state = await fixtures(page);
    await page.setViewportSize({ width, height: 900 });
    await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
    const properties = form(page).locator(".entity-detail-properties");
    await expect(properties.getByText("자료", { exact: true })).toHaveCount(1);
    await expect(properties.locator("dt", { hasText: "제목" })).toHaveCount(1);
    await expect(properties.locator("dt", { hasText: "자료 종류" })).toHaveCount(0);
    await expect(properties.locator(".detail-title")).toHaveCSS("font-size", "20px");
    await expect(properties.locator(".detail-title")).toHaveCSS("font-weight", "600");
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

test("automatic number creation has no empty lookup or normal schema recovery actions", async ({ page }) => {
  const state = await fixtures(page);
  await go(page, "/entities?create=1");
  await expect(form(page).getByText("등록 시 자동 발급", { exact: true })).toBeVisible();
  await expect(form(page).getByRole("button", { name: "기존 대상 확인", exact: true })).toHaveCount(0);
  await expect(form(page).getByRole("button", { name: "속성 정의 다시 조회", exact: true })).toHaveCount(0);
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
  const identity = fixtureIdentity();
  identity.default_source = "market";
  identity.sources[0] = { ...identity.sources[0], code: "market", source_label: "마켓", generation: "direct" };
  await page.route("**/api/entity-types/*/identity", (route) => route.fulfill({ json: identity }));
  await go(page, "/entities?create=1");
  const lookup = form(page).getByRole("button", { name: "기존 대상 확인", exact: true });
  await expect(form(page).getByLabel("번호", { exact: true })).toBeEditable();
  await expect(lookup).toHaveCount(0);
  await form(page).getByLabel("번호", { exact: true }).fill("12345");
  await lookup.click();
  await expect(form(page)).toContainText("새로운 자료 번호입니다.");
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
  const confirmation = page.locator("dialog.modal-action[open]");
  await expect(confirmation).toContainText("속성 정의가 변경되었습니다");
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await page.route("**/api/entity-types/*/schema", (route) => route.fulfill({ json: fixtureSchema }));
  await form(page).getByRole("button", { name: "속성 정의 다시 조회", exact: true }).click();
  await form(page).getByRole("button", { name: "확인한 정의로 편집", exact: true }).click();
  await expect(form(page).getByLabel("수량", { exact: true })).toHaveValue("10");
  expect(state.writes).toHaveLength(0);
});

test("nonrepresentative false, null and archived properties remain readable", async ({ page }) => {
  const state = await fixtures(page);
  const schema = structuredClone(fixtureSchema);
  schema.schema.properties.prop_5 = { "x-order": 50, type: "boolean", title: "판매 중" };

  schema.schema.properties["prop_4"]["deprecated"] = true;
  state.rows.entities[0].properties.prop_5 = false;
  await page.route("**/api/entity-types/*/schema?schema_version=1", (route) => route.fulfill({ json: schema }));
  await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
  const properties = form(page).locator(".entity-detail-properties");
  await expect(properties.locator("div", { has: page.locator("dt", { hasText: /^판매 중$/ }) })).toContainText("거짓");
  await expect(properties.locator("div", { has: page.locator("dt", { hasText: /^날짜$/ }) })).toContainText("값 없음");
  await expect(properties.locator("dt", { hasText: /^분류 · 보관$/ })).toBeVisible();
  expect(state.writes).toHaveLength(0);
});

for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
  test(`entity view and edit retain complete pairs and alignment at ${width}`, async ({ page }, info) => {
    const state = await fixtures(page);
    linkedFixture(state);
    const schema = structuredClone(fixtureSchema);
    schema.schema.properties.prop_4.readOnly = true;
    schema.schema.properties.prop_5 = {
      "x-order": 50,
      type: "boolean",
      title: "판매 중지 여부를 포함한 아주 긴 항목 이름",
      deprecated: true,
    };
    schema.schema.properties.prop_6 = { "x-order": 60, type: "string", title: "미입력 항목" };
    state.rows.entities[0].properties.prop_5 = false;
    state.rows.entities[0].properties.prop_1 = "이름과 번호를 포함하는 아주 긴 자료 이름".repeat(5);
    state.rows.entities[0].title = state.rows.entities[0].properties.prop_1;
    await page.route("**/api/entity-types/*/schema**", (route) => route.fulfill({ json: schema }));
    await page.setViewportSize({ width, height: 1000 });
    await go(page, `/entities/${encodeURIComponent(entityKey(1))}`);
    const detail = form(page);
    if (width === 1440) {
      const source = detail.locator("dt", { hasText: /^번호 출처$/ });
      const number = detail.locator("dt", { hasText: /^자료 번호$/ });
      await expect.poll(async () => Math.abs((await source.boundingBox())!.x - (await number.boundingBox())!.x))
        .toBeGreaterThan(200);
    }
    await expect(detail.locator("dt", { hasText: /^미입력 항목$/ })).toBeVisible();
    await expect(detail.locator("dd", { hasText: /^미입력$/ })).toBeVisible();
    const read = await detail.locator(".entity-detail-properties dt").evaluateAll((nodes) =>
      nodes.map((node) => {
        const value = node.nextElementSibling!;
        const box = value.getBoundingClientRect(), key = node.getBoundingClientRect();
        const style = getComputedStyle(value);
        return {
          label: node.textContent?.replace(/ · (읽기 전용|보관)/g, "").trim(),
          x: box.x,
          keyX: key.x,
          width: box.width,
          font: getComputedStyle(value.querySelector("h2, h3") ?? value).fontSize,
          padding: style.paddingLeft,
        };
      })
    );
    if ([390, 1440].includes(width)) await page.screenshot({ path: info.outputPath("view-pairs.png") });
    await detail.getByRole("button", { name: "편집", exact: true }).click();
    await expect(detail.getByRole("textbox", { name: /^제목/ })).toBeEditable();
    await expect(detail.locator("dt:visible", { hasText: /^분류/ })).toContainText("읽기 전용");
    await expect(detail.locator("dt:visible", { hasText: /^판매 중지/ })).toContainText("보관");
    await expect(detail.getByRole("button", { name: /할 일 작성|기록 작성|연결 해제/ })).toHaveCount(0);
    await expect(detail.getByRole("region", { name: "할 일 (1개)", exact: true })).toContainText("할 일");
    const edit = await detail.locator(
      ".key-value-grid > .field > label:visible, .key-value-grid > .key-value-static dt:visible, .tag-connection-data dt:visible",
    )
      .evaluateAll((nodes) =>
        nodes.map((node) => {
          const container = node.parentElement!;
          const value = node.tagName === "DT" ? node.nextElementSibling! : container.querySelector(".input")!;
          const box = value.getBoundingClientRect(), key = node.getBoundingClientRect();
          const style = getComputedStyle(value);
          return {
            x: box.x,
            keyX: key.x,
            width: box.width,
            font: getComputedStyle(value.querySelector("h2, h3") ?? value).fontSize,
            padding: style.paddingLeft,
          };
        })
      );
    expect(edit).toHaveLength(read.length);
    read.forEach((item, i) => {
      expect(Math.abs(item.x - edit[i].x)).toBeLessThan(1);
      expect(Math.abs(item.keyX - edit[i].keyX)).toBeLessThan(1);
      expect(Math.abs(item.width - edit[i].width)).toBeLessThan(1);
      expect(edit[i].font).toBe(item.font);
      expect(edit[i].padding).toBe(item.padding);
    });
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
  const discard = page.locator("dialog.modal-action[open]");
  if (await discard.isVisible()) await discard.getByRole("button", { name: /버리|나가/ }).click();
  await expect(detail.getByRole("button", { name: "편집", exact: true })).toBeVisible();
  await expect(detail.locator("dd:visible", { hasText: /^0$/ })).toBeVisible();
  expect(state.writes).toHaveLength(0);
});
