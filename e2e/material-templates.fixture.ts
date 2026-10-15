import { fixtureIdentity } from "./support/workspace-data.ts";
import { expect, test } from "@playwright/test";
import { type EntityType, initialEntityDefinition } from "../supabase/functions/_shared/contracts/entity-type.ts";
import { fulfillPreparation } from "./support/preparation-api.ts";
const type = (n: number, label: string, archived = false): EntityType => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  label,
  archived,
  icon_id: "leaf",
  version: 1,
  schema_version: 1,
  next_property_number: 2,
  created_at: `2026-10-${String(n).padStart(2, "0")}T00:00:00Z`,
  updated_at: "2026-10-12T00:00:00Z",
});
const materials = type(1, "재료"),
  products = type(2, "상품"),
  retired = type(3, "보관 자료", true);
const user = {
  id: "00000000-0000-0000-0000-000000000001",
  aud: "authenticated",
  email: "fixture@example.test",
  app_metadata: {},
  user_metadata: { full_name: "Fixture" },
};
test.beforeEach(async ({ page, baseURL }) => {
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === new URL(baseURL!).origin) return route.continue();
    if (url.pathname === "/api/entity-types") {
      return route.fulfill({
        json: { items: [materials, products, retired], next_cursor: null },
      });
    }
    const selected = [materials, products, retired].find((value) =>
      url.pathname.startsWith(`/api/entity-types/${value.id}`)
    );
    if (selected) {
      if (url.pathname.endsWith("/identity")) {
        return route.fulfill({ json: fixtureIdentity(selected.id) });
      }
      if (
        url.pathname.endsWith("/schemas") ||
        url.pathname.endsWith("/schema-changes")
      ) return route.fulfill({ json: { items: [], next_before: null } });
      return route.fulfill({
        json: url.pathname.endsWith("/schema")
          ? {
            type: selected,
            type_id: selected.id,
            schema_version: 1,
            ...initialEntityDefinition("이름"),
          }
          : selected,
      });
    }
    if (await fulfillPreparation(route)) return;
    if (url.pathname.startsWith("/api/")) {
      return route.fulfill({ json: { items: [], next_cursor: null } });
    }
    return route.abort();
  });
  await page.addInitScript(
    (user) =>
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: "ui-fixture",
          refresh_token: "ui-fixture",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user,
        }),
      ),
    user,
  );
});

async function settingsFixture(
  page: import("@playwright/test").Page,
  initial: any = {},
) {
  let value = initial, version = 4;
  const writes: any[] = [];
  let fail = "";
  await page.route("**/api/settings/business**", (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      writes.push({ body, key: route.request().headers()["idempotency-key"] });
      if (fail === "conflict") {
        fail = "";
        version++;
        return route.fulfill({ status: 409, json: { code: "conflict", message: "동시 변경" } });
      }
      if (fail === "lost") {
        fail = "";
        return route.abort();
      }
      expect(body.expected_version).toBe(version);
      value = body.value;
      version++;
    }
    return route.fulfill({
      json: {
        settings: { record_templates: value },
        versions: { record_templates: version },
      },
    });
  });
  return {
    writes,
    fail: (next: string) => {
      fail = next;
    },
  };
}
async function openTyped(page: import("@playwright/test").Page) {
  await page.goto("/settings/records");
  await page.getByLabel("대상", { exact: true }).selectOption(`type:${materials.id}`);
  return page.getByRole("form", { name: "기록 자동 완성", exact: true });
}

test("미설정과 null은 고정 문구를 표시하고 되돌리기는 다른 종류와 태그를 보존한다", async ({ page }, info) => {
  const tag = { id: "00000000-0000-4000-8000-000000000010", name: "기록 전용", scope: "record", version: 1 };
  await page.route("**/api/tags**", (route) => route.fulfill({ json: { items: [tag], next_cursor: null } }));
  const state = await settingsFixture(page, {
    task: { create: { memo: "할 일 유지", tag_ids: [] } },
    entity_types: { [products.id]: { create: { memo: "상품 유지", tag_ids: [] } } },
  });
  const form = await openTyped(page);
  await expect(form.getByLabel("메모 템플릿")).toHaveText("대상 액션");
  await expect(form.getByRole("button", { name: "기본 문구로 되돌리기", exact: true })).toHaveCount(0);
  await expect(form.getByLabel("기록 메모 예시")).toHaveCount(0);
  await expect(form.getByText(/속성 버전/)).toHaveCount(0);
  const variableBox = await form.getByLabel("변수 삽입").boundingBox();
  const memoBox = await form.getByLabel("메모 템플릿").boundingBox();
  expect(variableBox!.y + variableBox!.height).toBeLessThan(memoBox!.y);
  await expect(form.getByRole("button", { name: "기록 자동 완성 저장", exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath("record-settings.png"), fullPage: true });
  await form.getByLabel("변수 삽입").selectOption("대상");
  await expect(form.getByLabel("메모 템플릿")).toBeFocused();
  await expect(form.getByLabel("메모 템플릿")).toHaveText(/대상/);
  await form.getByRole("button", { name: "기본 문구로 되돌리기", exact: true }).click();

  await form.getByText("기록 전용", { exact: true }).click();
  await form.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("저장했습니다");
  expect(state.writes[0].body.value.entity_types[materials.id].create).toEqual({ memo: null, tag_ids: [tag.id] });
  await form.getByLabel("메모 템플릿").fill("종류 문구");
  await page.setViewportSize({ width: 320, height: 900 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const resetAlignment = await form.locator(".record-template-defaults").evaluate((el) => {
    const button = el.querySelector("button")!.getBoundingClientRect();
    return Math.abs(button.right - el.getBoundingClientRect().right);
  });
  expect(resetAlignment).toBeLessThanOrEqual(1);
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });

  await form.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("저장했습니다");
  await form.getByRole("button", { name: "기본 문구로 되돌리기", exact: true }).click();
  await form.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("저장했습니다");
  expect(state.writes[2].body.value.entity_types[materials.id].create).toEqual({ memo: null, tag_ids: [tag.id] });
  expect(state.writes[2].body.value.entity_types[products.id].create.memo).toBe("상품 유지");
  expect(state.writes[2].body.value.task.create.memo).toBe("할 일 유지");
  expect(state.writes[2].body.value).not.toHaveProperty("entity");
  await page.reload();
  await page.getByLabel("대상", { exact: true }).selectOption(`type:${materials.id}`);
  await expect(form.getByLabel("메모 템플릿")).toHaveText("대상 액션");
  await expect(form.getByRole("button", { name: "기본 문구로 되돌리기", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "공통 설정", exact: true })).toHaveCount(0);
});

test("종류 문구 저장 충돌은 초안을 보존하고 응답 유실은 같은 입력과 키로 재시도한다", async ({ page }) => {
  const state = await settingsFixture(page);
  const form = await openTyped(page);
  await form.getByLabel("메모 템플릿").fill("충돌 초안");
  state.fail("conflict");
  await form.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
  await expect(form.getByLabel("메모 템플릿")).toHaveText("충돌 초안");
  await form.getByRole("button", { name: "최신값 확인", exact: true }).click();
  await form.getByRole("button", { name: "최신값으로 다시 편집", exact: true }).click();
  await form.getByLabel("메모 템플릿").fill("유실 초안");
  state.fail("lost");
  await form.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
  await form.getByRole("button", { name: "같은 내용 다시 시도", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("저장했습니다");
  expect(state.writes[2]).toEqual(state.writes[1]);
});

test("태그 관리는 설정 링크 하나에서 같은 화면의 대상을 전환한다", async ({ page }) => {
  await settingsFixture(page);
  await page.goto("/settings");
  await page.getByRole("button", { name: "설정 메뉴", exact: true }).click();
  await expect(page.getByRole("link", { name: "태그", exact: true })).toHaveCount(1);
  for (const name of ["자료 태그", "할 일 태그", "기록 태그"]) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  await page.getByRole("navigation", { name: "설정 메뉴" }).getByRole("link", { name: "태그", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/tags$/);
  await expect(page.getByRole("heading", { name: "태그 설정", exact: true })).toBeVisible();
  const target = page.getByLabel("관리 대상", { exact: true });
  await expect(target.locator("option")).toHaveText(["자료", "할 일", "기록"]);
  for (const scope of ["task", "record", "entity"]) {
    await target.selectOption(scope);
    await expect(page).toHaveURL(new RegExp(`\\/settings\\/tags\\?scope=${scope}$`));
    await expect(page.getByText("아직 태그가 없습니다.", { exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("통합 태그의 초안은 대상 전환 취소 시 보존하고 확인 시 버린다", async ({ page }) => {
  await page.goto("/settings/tags");
  const name = page.getByRole("textbox", { name: "태그 이름 (필수)", exact: true });
  await name.fill("저장 전 초안");
  await page.getByLabel("관리 대상", { exact: true }).selectOption("task");
  await page.getByRole("dialog").getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByLabel("관리 대상", { exact: true })).toHaveValue("entity");
  await expect(name).toHaveValue("저장 전 초안");
  await page.getByLabel("관리 대상", { exact: true }).selectOption("record");
  await page.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await expect(page.getByLabel("관리 대상", { exact: true })).toHaveValue("record");
  await expect(name).toHaveValue("");
});

test("통합 태그는 저장 중 전환을 막고 대상별 사전에 같은 이름을 저장한다", async ({ page }) => {
  const dictionaries: Record<string, any[]> = { entity: [], task: [], record: [] };
  let release: (() => void) | undefined;
  await page.route("**/api/tags**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "GET") {
      return route.fulfill({ json: { items: dictionaries[url.searchParams.get("scope")!], next_cursor: null } });
    }
    const body = request.postDataJSON();
    if (body.scope === "entity") {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    const tag = {
      id: `00000000-0000-4000-8000-00000000000${Object.keys(dictionaries).indexOf(body.scope) + 1}`,
      ...body,
      version: 1,
    };
    dictionaries[body.scope].push(tag);
    await route.fulfill({ status: 201, json: tag });
  });
  await page.goto("/settings/tags");
  const name = page.getByRole("textbox", { name: "태그 이름 (필수)", exact: true });
  await name.fill("공통 이름");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await expect(page.getByLabel("관리 대상", { exact: true })).toBeDisabled();
  await expect.poll(() => !!release).toBe(true);
  release!();
  await expect(page.getByText("공통 이름", { exact: true })).toBeVisible();
  await page.getByLabel("관리 대상", { exact: true }).selectOption("task");
  await expect(page.getByText("공통 이름", { exact: true })).toHaveCount(0);
  await name.fill("공통 이름");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await expect(page.getByText("공통 이름", { exact: true })).toBeVisible();
  expect(dictionaries.entity).toHaveLength(1);
  expect(dictionaries.task).toHaveLength(1);
  expect(dictionaries.record).toHaveLength(0);
});

test("통합 태그는 접힌 섹션에도 조회 오류와 저장 미확정 상태를 남긴다", async ({ page }) => {
  let readFailed = true;
  await page.route("**/api/tags**", (route) => {
    if (route.request().method() !== "GET") return route.abort();
    if (readFailed) return route.fulfill({ status: 503, json: { code: "unavailable", message: "조회 실패" } });
    return route.fulfill({ json: { items: [], next_cursor: null } });
  });
  await page.goto("/settings/tags");
  await expect(page.getByText("태그 목록을 불러오지 못했습니다. 기존 목록은 유지합니다.")).toBeVisible();
  const section = page.getByRole("heading", { level: 2 }).getByRole("button");
  await section.click();
  await expect(section).toHaveAttribute("aria-expanded", "false");
  await expect(section).toContainText("오류");
  await section.click();
  readFailed = false;
  await page.getByRole("button", { name: "목록 다시 시도", exact: true }).click();
  await expect(page.getByText("아직 태그가 없습니다.", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "태그 이름 (필수)", exact: true }).fill("응답 미확정");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await expect(section).toContainText("결과 확인 필요");
  await section.click();
  await expect(section).toHaveAttribute("aria-expanded", "false");
  await expect(section).toContainText("결과 확인 필요");
});

test("통합 태그는 삭제 실패 후 접혀도 오류와 기존 행을 유지한다", async ({ page }) => {
  const tag = { id: "00000000-0000-4000-8000-000000000010", name: "삭제 실패 태그", scope: "entity", version: 1 };
  await page.route(
    "**/api/tags**",
    (route) =>
      route.request().method() === "DELETE"
        ? route.fulfill({ status: 400, json: { code: "validation", message: "삭제 실패" } })
        : route.fulfill({ json: { items: [tag], next_cursor: null } }),
  );
  await page.goto("/settings/tags");
  await page.getByRole("button", { name: "삭제 실패 태그 삭제", exact: true }).click();
  const confirmation = page.locator("dialog.modal-action[open]");
  await confirmation.getByRole("button", { name: "삭제하고 기록", exact: true }).click();
  await expect(confirmation).toContainText("삭제 실패");
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  const section = page.getByRole("heading", { level: 2 }).getByRole("button");
  await section.click();
  await expect(section).toContainText("오류");
  await section.click();
  await expect(page.getByText("삭제 실패 태그", { exact: true })).toBeVisible();
});

test("공유 기록 설정은 본문 조회만 작은 버튼으로 표시하고 저장 버튼을 유지한다", async ({ page }) => {
  const fixture = await settingsFixture(page);
  await page.goto("/settings/records");
  const form = page.getByRole("form", { name: "기록 자동 완성", exact: true });
  await expect(form).toBeVisible();
  await form.getByLabel("메모 템플릿").fill("기록 설정 버튼 검증");
  fixture.fail("conflict");
  const save = form.getByRole("button", { name: "기록 자동 완성 저장", exact: true });
  await save.click();
  const reload = form.getByRole("button", { name: "최신값 확인", exact: true });
  await expect(reload).toBeVisible();
  expect(await reload.locator(".body-action-face").evaluate((el) => getComputedStyle(el).fontSize)).toBe("13px");
  expect(
    await save.evaluate((el) => ({ font: getComputedStyle(el).fontSize, height: el.getBoundingClientRect().height })),
  ).toEqual({ font: "14px", height: 44 });
  await reload.click();
  await expect(form.getByLabel("메모 템플릿")).toHaveText("기록 설정 버튼 검증");
  await expect(form.getByRole("button", { name: "최신값으로 다시 편집", exact: true })).toBeEnabled();
  await form.getByRole("button", { name: "최신값으로 다시 편집", exact: true }).click();
  await expect(reload).toHaveCount(0);
  await expect(form.getByLabel("메모 템플릿")).toBeVisible();
});

test("기록 대상과 액션 전환은 초안을 보존하고 대상별 저장은 다른 입력을 유지한다", async ({ page }) => {
  const fixture = await settingsFixture(page);
  await page.goto("/settings/records");
  const target = page.getByLabel("대상", { exact: true });
  const form = page.getByRole("form", { name: "기록 자동 완성", exact: true });
  await form.getByLabel("메모 템플릿").fill("할 일 초안");
  await form.getByLabel("액션", { exact: true }).selectOption("update");
  await form.getByLabel("메모 템플릿").fill("수정 초안");
  await target.selectOption(`type:${materials.id}`);
  await form.getByLabel("메모 템플릿").fill("재료 저장");
  await form.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("저장했습니다");
  expect(fixture.writes[0].body.value).not.toHaveProperty("task");
  await target.selectOption("task");
  await expect(form.getByLabel("액션", { exact: true })).toHaveValue("update");
  await expect(form.getByLabel("메모 템플릿")).toHaveText("수정 초안");
  await form.getByLabel("액션", { exact: true }).selectOption("create");
  await expect(form.getByLabel("메모 템플릿")).toHaveText("할 일 초안");
  await page.getByRole("button", { name: "설정 메뉴", exact: true }).click();
  await page.getByRole("navigation", { name: "설정 메뉴" }).getByRole("link", { name: "기본", exact: true }).click();
  await page.getByRole("dialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "취소", exact: true })
    .click();
  await expect(form.getByLabel("메모 템플릿")).toHaveText("할 일 초안");
  await form.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("저장했습니다");
  expect(fixture.writes[1].body.value.entity_types[materials.id].create.memo).toBe("재료 저장");
});

test("action switches expose hidden errors and all changed actions before a scoped save", async ({ page }, info) => {
  const state = await settingsFixture(page, { task: { create: { memo: "다른 대상 유지", tag_ids: [] } } });
  const form = await openTyped(page);
  await form.getByLabel("메모 템플릿").fill("$없는변수$");
  await form.getByLabel("액션", { exact: true }).selectOption("delete");
  await expect(form.getByLabel("액션", { exact: true }).locator('option[value="create"]')).toContainText("오류");
  await expect(form.getByLabel("저장할 변경", { exact: true })).toHaveText("변경: 등록");
  await form.getByRole("button", { name: "오류 항목 보기", exact: true }).click();
  await expect(form.getByLabel("액션", { exact: true })).toHaveValue("create");
  await expect(form.getByLabel("메모 템플릿")).toBeFocused();
  await form.getByLabel("메모 템플릿").fill("등록할 때 남길 문구");
  await form.getByLabel("액션", { exact: true }).selectOption("delete");
  await form.getByLabel("메모 템플릿").fill("삭제할 때 남길 문구");
  await expect(form.getByLabel("저장할 변경", { exact: true })).toHaveText("변경: 등록 · 삭제");
  await page.screenshot({ path: info.outputPath("record-changed-actions.png"), fullPage: true });
  await form.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
  await expect(form).toContainText("기록 자동 완성을 저장했습니다.");
  expect(state.writes.at(-1)?.body.value).toMatchObject({
    task: { create: { memo: "다른 대상 유지" } },
    entity_types: {
      [materials.id]: {
        create: { memo: "등록할 때 남길 문구" },
        delete: { memo: "삭제할 때 남길 문구" },
      },
    },
  });
  await expect(form.getByLabel("저장할 변경", { exact: true })).toHaveCount(0);
});

test("editing another action retains hidden server validation errors and their jump target", async ({ page }) => {
  const state = await settingsFixture(page);
  const editor = await openTyped(page);
  await editor.getByLabel("메모 템플릿").fill("등록 초안");
  await editor.getByLabel("액션", { exact: true }).selectOption("delete");
  await editor.getByLabel("메모 템플릿").fill("삭제 초안");
  let reject = true;
  await page.route("**/api/settings/business**", (route) => {
    if (route.request().method() === "PATCH" && reject) {
      reject = false;
      return route.fulfill({
        status: 400,
        json: {
          code: "invalid_input",
          message: "문구를 확인하세요",
          fields: [{
            path: `value.entity_types.${materials.id}.create.memo`,
            message: "등록 문구를 확인하세요",
          }],
        },
      });
    }
    return route.fallback();
  });
  await editor.getByRole("button", { name: "기록 자동 완성 저장", exact: true })
    .click();
  await expect(
    editor.getByRole("button", { name: "오류 항목 보기", exact: true }),
  ).toBeVisible();
  await editor.getByLabel("메모 템플릿").fill("삭제 초안 수정");
  await expect(
    editor.getByLabel("액션", { exact: true }).locator(
      'option[value="create"]',
    ),
  ).toContainText("오류");
  await editor.getByRole("button", { name: "오류 항목 보기", exact: true })
    .click();
  await expect(editor.getByLabel("메모 템플릿")).toBeFocused();
  await expect(editor.getByText("등록 문구를 확인하세요", { exact: true }))
    .toBeVisible();
  await editor.getByLabel("메모 템플릿").fill("등록 문구 수정");
  await editor.getByRole("button", { name: "기록 자동 완성 저장", exact: true })
    .click();
  await expect(editor.getByRole("status")).toContainText("저장했습니다");
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0].body.value.entity_types[materials.id]).toMatchObject({
    create: { memo: "등록 문구 수정" },
    delete: { memo: "삭제 초안 수정" },
  });
});

async function namedTemplateProperties(page: import("@playwright/test").Page) {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { type: "string", title: "가격" };
  definition.schema.properties.prop_3 = { type: "string", title: "가격" };
  definition.schema.properties.prop_4 = { type: "string", title: "특수 $ . ${이름$}" };
  definition.display.order.push("prop_2", "prop_3", "prop_4");
  await page.route(`**/api/entity-types/${materials.id}/schema`, (route) =>
    route.fulfill({
      json: {
        type: materials,
        type_id: materials.id,
        schema_version: 1,
        ...definition,
      },
    }));
}

test("속성 변수는 이름으로 읽고 선택 위치에 삽입하며 canonical 번호로 저장한다", async ({ page }, info) => {
  const state = await settingsFixture(page, {
    entity_types: {
      [materials.id]: {
        create: {
          memo: "${엔터티.이후.prop_2$} / $엔터티.이후.prop_3$ / $엔터티.이후.prop_4$ / $$대상$$",
          tag_ids: [],
        },
      },
    },
  });
  await namedTemplateProperties(page);
  const form = await openTyped(page), memo = form.getByRole("textbox", { name: "메모 템플릿", exact: true });
  await expect(memo).toHaveAttribute("contenteditable", "true");
  expect(await memo.evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(100);
  await expect(memo.locator(".template-variable-token")).toHaveCount(3);
  await expect(memo).not.toContainText("prop_");
  await expect(memo).toContainText("특수 $ . ${이름$}");
  await page.screenshot({ path: info.outputPath("named-variable-tokens.png"), fullPage: true });
  expect(
    await memo.locator(".template-variable-token").evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLElement).dataset.memoToken)
    ),
  ).toEqual([
    "${엔터티.이후.prop_2$}",
    "$엔터티.이후.prop_3$",
    "$엔터티.이후.prop_4$",
  ]);
  await memo.focus();
  await memo.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await memo.press("!");
  await form.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
  expect(state.writes[0].body.value.entity_types[materials.id].create.memo).toBe(
    "${엔터티.이후.prop_2$} / $엔터티.이후.prop_3$ / $엔터티.이후.prop_4$ / $$대상$$!",
  );
  await memo.fill("앞 뒤");
  await memo.evaluate((el) => {
    const range = document.createRange();
    range.setStart(el.firstChild!, 2);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await form.getByLabel("변수 삽입").selectOption("엔터티.이후.prop_2");
  await expect(memo.locator(".template-variable-token")).toHaveAttribute("aria-label", "변수: 가격 · 이후 (1)");
  await expect(memo).toHaveText("앞 가격 · 이후 (1)뒤");
  await form.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
  expect(state.writes[1].body.value.entity_types[materials.id].create.memo).toBe("앞 $엔터티.이후.prop_2$뒤");
});

test("변수 붙여넣기와 복사·잘라내기·실행 취소는 원문과 줄바꿈을 유지한다", async ({ page }) => {
  const state = await settingsFixture(page, {
    entity_types: { [materials.id]: { create: { memo: "앞 ", tag_ids: [] } } },
  });
  await namedTemplateProperties(page);
  const form = await openTyped(page), memo = form.getByRole("textbox", { name: "메모 템플릿", exact: true });
  await memo.focus();
  await memo.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  const raw = "${엔터티.이후.prop_2$} / $$대상$$\n$엔터티.이후.prop_4$";
  await memo.evaluate((el, raw) => {
    const data = new DataTransfer();
    data.setData("text/plain", raw);
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, raw);
  await expect(memo.locator(".template-variable-token")).toHaveCount(2);
  await memo.press("ControlOrMeta+z");
  await expect(memo).toHaveText("앞 ");
  await memo.press("ControlOrMeta+Shift+z");
  await expect(memo.locator(".template-variable-token")).toHaveCount(2);
  expect(
    await memo.locator(".template-variable-token").evaluateAll((nodes) =>
      nodes.every((node) => (node as HTMLElement).contentEditable === "false")
    ),
  ).toBe(true);
  expect(await memo.evaluate(() => {
    const anchor = window.getSelection()?.anchorNode;
    return !(anchor instanceof Element ? anchor : anchor?.parentElement)?.closest("[data-memo-token]");
  })).toBe(true);
  const copied = await memo.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData("text/plain");
  });
  expect(copied).toBe("앞 " + raw);
  await form.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
  expect(state.writes[0].body.value.entity_types[materials.id].create.memo).toBe("앞 " + raw);
  await expect(form).toHaveAttribute("aria-busy", "false");
  await expect(memo).toHaveAttribute("contenteditable", "true");
  await memo.focus();
  await memo.evaluate((el) => {
    const range = document.createRange();
    range.selectNode(el.querySelector(".template-variable-token")!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await memo.press("Backspace");
  await expect(memo.locator(".template-variable-token")).toHaveCount(1);
  await memo.press("ControlOrMeta+z");
  await expect(memo.locator(".template-variable-token")).toHaveCount(2);
  await memo.focus();
  await memo.evaluate((el) => {
    const range = document.createRange();
    range.selectNode(el.querySelector(".template-variable-token")!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent("cut", { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(memo.locator(".template-variable-token")).toHaveCount(1);
  await memo.press("ControlOrMeta+z");
  await expect(memo.locator(".template-variable-token")).toHaveCount(2);
});

test("알 수 없는 변수와 조합 입력은 임의 치환 없이 원문을 보존한다", async ({ page }) => {
  const state = await settingsFixture(page, {
    entity_types: { [materials.id]: { create: { memo: "원문", tag_ids: [] } } },
  });
  await namedTemplateProperties(page);
  const form = await openTyped(page), memo = form.getByRole("textbox", { name: "메모 템플릿", exact: true });
  const save = form.getByRole("button", { name: "기록 자동 완성 저장", exact: true });
  await expect(save).toBeDisabled();
  await memo.focus();
  await memo.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true }));
    el.textContent = "조합 중";
    el.dispatchEvent(new InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText" }));
  });
  await expect(save).toBeDisabled();
  await memo.evaluate((el) =>
    el.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true, data: "조합 중" }))
  );
  await expect(save).toBeEnabled();
  await memo.fill("첫 줄");
  await memo.press("End");
  await memo.press("Enter");
  await memo.press("Enter");
  await memo.pressSequentially("끝 줄");
  await save.click();
  await expect(form.getByRole("status").filter({ hasText: "기록 자동 완성을 저장했습니다." })).toBeVisible();
  expect(state.writes[0].body.value.entity_types[materials.id].create.memo).toBe("첫 줄\n\n끝 줄");
  await memo.fill("첫 줄");
  await memo.press("End");
  await memo.press("Shift+Enter");
  await memo.pressSequentially("끝 줄");
  await save.click();
  expect(state.writes[1].body.value.entity_types[materials.id].create.memo).toBe("첫 줄\n끝 줄");
  await memo.fill("$자료.이후.가격$ $없는변수$ $$엔터티.이후.prop_2$$");
  await expect(memo.locator(".template-variable-token")).toHaveCount(0);
  await save.click();
  await expect(form.getByText("사용할 수 없는 변수", { exact: false }).first()).toBeVisible();
  await expect(memo).toHaveText("$자료.이후.가격$ $없는변수$ $$엔터티.이후.prop_2$$");
});

test("속성 정의를 기다리거나 실패한 동안 변수·편집·저장을 막고 재조회로 초안을 복원한다", async ({ page }) => {
  const raw = "$엔터티.이후.prop_1$ 보존";
  const state = await settingsFixture(page, {
    entity_types: { [materials.id]: { create: { memo: raw, tag_ids: [] } } },
  });
  let release: (() => void) | undefined;
  let fail = true;
  await page.route(`**/api/entity-types/${materials.id}/schema`, async (route) => {
    if (fail) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      fail = false;
      return route.fulfill({ status: 500, json: { code: "unavailable", message: "fixture read failed" } });
    }
    return route.fulfill({
      json: { type: materials, type_id: materials.id, schema_version: 1, ...initialEntityDefinition("이름") },
    });
  });
  const form = await openTyped(page);
  await expect(form.getByRole("status").filter({ hasText: "속성 정의를 읽는 중…" })).toBeVisible();
  await expect(form.getByRole("textbox", { name: "메모 템플릿", exact: true })).toHaveCount(0);
  await expect(form).not.toContainText("prop_1");
  await expect(form.getByLabel("변수 삽입")).toBeDisabled();
  await expect(form.getByRole("button", { name: "기록 자동 완성 저장", exact: true })).toBeDisabled();
  release!();
  await expect(form.getByText("속성 정의를 읽지 못했습니다.", { exact: false })).toBeVisible();
  await expect(form.getByRole("textbox", { name: "메모 템플릿", exact: true })).toHaveCount(0);
  await form.getByRole("button", { name: "속성 정의 다시 조회", exact: true }).click();
  const memo = form.getByRole("textbox", { name: "메모 템플릿", exact: true });
  await expect(memo).toHaveText("이름 · 이후 보존");
  await expect(form.getByLabel("변수 삽입")).toBeEnabled();
  expect(state.writes).toHaveLength(0);
  await memo.focus();
  await memo.evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
  });
  await memo.press("!");
  await form.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
  expect(state.writes[0].body.value.entity_types[materials.id].create.memo).toBe(raw + "!");
});

test("실행 취소는 다른 액션과 대상의 보존한 초안을 바꾸지 않는다", async ({ page }) => {
  const state = await settingsFixture(page, {
    task: { create: { memo: "할 일 기준", tag_ids: [] } },
    entity_types: {
      [materials.id]: { create: { memo: "등록 기준", tag_ids: [] }, update: { memo: "수정 기준", tag_ids: [] } },
      [products.id]: { create: { memo: "상품 기준", tag_ids: [] } },
    },
  });
  const form = await openTyped(page), target = page.getByLabel("대상", { exact: true });
  const memo = form.getByRole("textbox", { name: "메모 템플릿", exact: true });
  await memo.fill("등록 초안");
  await form.getByLabel("액션", { exact: true }).selectOption("update");
  await memo.focus();
  await memo.press("ControlOrMeta+z");
  await expect(memo).toHaveText("수정 기준");
  await form.getByLabel("액션", { exact: true }).selectOption("create");
  await expect(memo).toHaveText("등록 초안");
  await target.selectOption(`type:${products.id}`);
  const productForm = page.getByRole("form", { name: "기록 자동 완성", exact: true });
  const productMemo = productForm.getByRole("textbox", { name: "메모 템플릿", exact: true });
  await productMemo.focus();
  await productMemo.press("ControlOrMeta+z");
  await expect(productMemo).toHaveText("상품 기준");
  await target.selectOption(`type:${materials.id}`);
  await expect(memo).toHaveText("등록 초안");
  await target.selectOption("task");
  const taskMemo = page.getByRole("form", { name: "기록 자동 완성", exact: true }).getByRole("textbox", {
    name: "메모 템플릿",
    exact: true,
  });
  await taskMemo.focus();
  await taskMemo.press("ControlOrMeta+z");
  await expect(taskMemo).toHaveText("할 일 기준");
  await taskMemo.fill("문장 ");
  await taskMemo.press("ControlOrMeta+b");
  await taskMemo.pressSequentially("B");
  await taskMemo.press("ControlOrMeta+i");
  await taskMemo.pressSequentially("I");
  await taskMemo.press("ControlOrMeta+u");
  await taskMemo.pressSequentially("U");
  await expect(taskMemo.locator("b,strong,i,em,u,font,[style]")).toHaveCount(0);
  await page.getByRole("form", { name: "기록 자동 완성", exact: true }).getByRole("button", {
    name: "기록 자동 완성 저장",
    exact: true,
  }).click();
  expect(state.writes[0].body.value.task.create.memo).toBe("문장 BIU");
  await target.selectOption(`type:${materials.id}`);
  await expect(memo).toHaveText("등록 초안");
});

test("변수 삽입 직후 그대로 문장을 입력하고 다음 변수를 이어 붙인다", async ({ page }) => {
  const state = await settingsFixture(page);
  await namedTemplateProperties(page);
  const form = await openTyped(page);
  await form.getByLabel("액션", { exact: true }).selectOption("update");
  const memo = form.getByRole("textbox", { name: "메모 템플릿", exact: true });
  await memo.fill("수량 ");
  await form.getByLabel("변수 삽입", { exact: true }).selectOption("엔터티.이전.prop_2");
  expect(
    await memo.evaluate((root) => {
      const selection = window.getSelection(), anchor = selection?.anchorNode;
      const parent = anchor instanceof Element ? anchor : anchor?.parentElement;
      return document.activeElement === root && selection?.isCollapsed && !parent?.closest("[data-memo-token]");
    }),
  ).toBe(true);
  await page.keyboard.insertText(" → ");
  await expect(memo).toHaveText("수량 가격 · 이전 (1) → ");
  await form.getByLabel("변수 삽입", { exact: true }).selectOption("엔터티.이후.prop_2");
  await expect(memo).toHaveText("수량 가격 · 이전 (1) → 가격 · 이후 (1)");
  await form.getByRole("button", { name: "기록 자동 완성 저장", exact: true }).click();
  expect(state.writes[0].body.value.entity_types[materials.id].update.memo).toBe(
    "수량 $엔터티.이전.prop_2$ → $엔터티.이후.prop_2$",
  );
});
