import { expect, test } from "@playwright/test";
import { defaultEntityIdentitySettings } from "../supabase/functions/_shared/contracts/entity-identity.ts";
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

async function settingsFixture(page: import("@playwright/test").Page, initial: any = {}) {
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
    const id = new URL(route.request().url()).searchParams.get("id");
    return route.fulfill({
      json: {
        settings: {
          ...(id !== "record_templates" ? { entity_identity: defaultEntityIdentitySettings } : {}),
          ...(id !== "entity_identity" ? { record_templates: value } : {}),
        },
        versions: { entity_identity: 0, record_templates: version },
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
  await page.goto(`/settings/entity-types/${materials.id}`);
  await page.getByRole("button", { name: /기록 자동 완성/ }).click();
  return page.getByRole("form", { name: "기록 자동 완성", exact: true });
}

test("미설정과 null은 고정 문구를 표시하고 되돌리기는 다른 종류와 태그를 보존한다", async ({ page }) => {
  const tag = { id: "00000000-0000-4000-8000-000000000010", name: "기록 전용", scope: "record", version: 1 };
  await page.route("**/api/tags**", (route) => route.fulfill({ json: { items: [tag], next_cursor: null } }));
  const state = await settingsFixture(page, {
    task: { create: { memo: "할 일 유지", tag_ids: [] } },
    entity_types: { [products.id]: { create: { memo: "상품 유지", tag_ids: [] } } },
  });
  const form = await openTyped(page);
  await expect(form.getByLabel("메모 템플릿")).toHaveValue("$대상$ $액션$");
  await expect(form.getByRole("button", { name: "기본 문구로 되돌리기", exact: true })).toHaveCount(0);
  await expect(form.getByLabel("기록 메모 예시")).toHaveCount(0);
  await expect(form.getByText(/속성 버전/)).toHaveCount(0);
  const variableBox = await form.getByLabel("변수 삽입").boundingBox();
  const memoBox = await form.getByLabel("메모 템플릿").boundingBox();
  expect(variableBox!.y + variableBox!.height).toBeLessThan(memoBox!.y);
  await expect(form.getByRole("button", { name: "기록 기본값 저장", exact: true })).toBeDisabled();
  await form.getByLabel("변수 삽입").selectOption("대상");
  await expect(form.getByLabel("메모 템플릿")).toBeFocused();
  await expect(form.getByLabel("메모 템플릿")).toHaveValue(/\$대상\$/);
  await form.getByRole("button", { name: "기본 문구로 되돌리기", exact: true }).click();

  await form.getByText("기록 전용", { exact: true }).click();
  await form.getByRole("button", { name: "기록 기본값 저장", exact: true }).click();
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

  await form.getByRole("button", { name: "기록 기본값 저장", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("저장했습니다");
  await form.getByRole("button", { name: "기본 문구로 되돌리기", exact: true }).click();
  await form.getByRole("button", { name: "기록 기본값 저장", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("저장했습니다");
  expect(state.writes[2].body.value.entity_types[materials.id].create).toEqual({ memo: null, tag_ids: [tag.id] });
  expect(state.writes[2].body.value.entity_types[products.id].create.memo).toBe("상품 유지");
  expect(state.writes[2].body.value.task.create.memo).toBe("할 일 유지");
  expect(state.writes[2].body.value).not.toHaveProperty("entity");
  await page.reload();
  await page.getByRole("button", { name: /기록 자동 완성/ }).click();
  await expect(form.getByLabel("메모 템플릿")).toHaveValue("$대상$ $액션$");
  await expect(form.getByText("기본 문구 사용 중", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "공통 설정", exact: true })).toHaveCount(0);
});

test("종류 문구 저장 충돌은 초안을 보존하고 응답 유실은 같은 입력과 키로 재시도한다", async ({ page }) => {
  const state = await settingsFixture(page);
  const form = await openTyped(page);
  await form.getByLabel("메모 템플릿").fill("충돌 초안");
  state.fail("conflict");
  await form.getByRole("button", { name: "기록 기본값 저장", exact: true }).click();
  await expect(form.getByLabel("메모 템플릿")).toHaveValue("충돌 초안");
  await form.getByRole("button", { name: "최신값 확인", exact: true }).click();
  await form.getByRole("button", { name: "최신값으로 다시 편집", exact: true }).click();
  await form.getByLabel("메모 템플릿").fill("유실 초안");
  state.fail("lost");
  await form.getByRole("button", { name: "기록 기본값 저장", exact: true }).click();
  await form.getByRole("button", { name: "같은 내용 다시 시도", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("저장했습니다");
  expect(state.writes[2]).toEqual(state.writes[1]);
});

test("태그 관리는 설정 링크 하나에서 같은 화면의 대상을 전환한다", async ({ page }) => {
  await settingsFixture(page);
  await page.goto("/settings");
  await expect(page.getByRole("link", { name: "태그 관리", exact: true })).toHaveCount(1);
  for (const name of ["자료 태그", "할 일 태그", "기록 태그"]) {
    await expect(page.getByRole("link", { name, exact: true })).toHaveCount(0);
  }
  await page.getByRole("link", { name: "태그 관리", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/tags$/);
  await expect(page.getByRole("heading", { name: "태그 관리", exact: true })).toBeVisible();
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

test("기존 식별자 주소도 일반 설정의 식별자 섹션으로 연결한다", async ({ page }) => {
  await settingsFixture(page);
  await page.goto("/settings/entity-identity");
  await expect(page).toHaveURL(/\/settings#entity-identity-title$/);
  await expect(page.getByRole("form", { name: "자료 식별자 설정", exact: true })).toBeVisible();
});

test("공유 기록 설정은 본문 조회만 작은 버튼으로 표시하고 저장 버튼을 유지한다", async ({ page }) => {
  const fixture = await settingsFixture(page);
  await page.goto("/settings");
  const form = page.getByRole("form", { name: "변경 기록 기본값", exact: true });
  await expect(form).toBeVisible();
  await form.getByLabel("메모 템플릿").fill("기록 설정 버튼 검증");
  fixture.fail("conflict");
  const save = form.getByRole("button", { name: "기록 기본값 저장", exact: true });
  await save.click();
  const reload = form.getByRole("button", { name: "최신값 확인", exact: true });
  await expect(reload).toBeVisible();
  expect(await reload.locator(".body-action-face").evaluate((el) => getComputedStyle(el).fontSize)).toBe("12px");
  expect(
    await save.evaluate((el) => ({ font: getComputedStyle(el).fontSize, height: el.getBoundingClientRect().height })),
  ).toEqual({ font: "14px", height: 44 });
  await reload.click();
  await expect(form.getByLabel("메모 템플릿")).toHaveValue("기록 설정 버튼 검증");
  await expect(form.getByRole("button", { name: "최신값으로 다시 편집", exact: true })).toBeEnabled();
  await form.getByRole("button", { name: "최신값으로 다시 편집", exact: true }).click();
  await expect(reload).toHaveCount(0);
  await expect(form.getByLabel("메모 템플릿")).toBeVisible();
});
