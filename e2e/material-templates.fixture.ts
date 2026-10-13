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
  await page.getByRole("button", { name: /현재 종류 기록 기본값/ }).click();
  return page.getByRole("form", { name: "현재 종류 기록 기본값", exact: true });
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
  await expect(form.getByRole("button", { name: "기록 기본값 저장", exact: true })).toBeDisabled();
  await form.getByText("기록 전용", { exact: true }).click();
  await form.getByRole("button", { name: "기록 기본값 저장", exact: true }).click();
  await expect(form.getByRole("status")).toContainText("저장했습니다");
  expect(state.writes[0].body.value.entity_types[materials.id].create).toEqual({ memo: null, tag_ids: [tag.id] });
  await form.getByLabel("메모 템플릿").fill("종류 문구");
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
  await page.getByRole("button", { name: /현재 종류 기록 기본값/ }).click();
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

test("자료 태그는 다른 태그와 같은 설정 위치에서 열고 닫기 후 초점을 돌려준다", async ({ page }) => {
  await settingsFixture(page);
  await page.goto("/settings");
  await expect(page.getByRole("form", { name: "자료 식별자 설정", exact: true })).toBeVisible();
  await expect(page.getByLabel("모델", { exact: true }).locator("option")).toHaveText(["할일", "원칙"]);
  await page.getByRole("link", { name: "자료 태그", exact: true }).click();
  await expect(page).toHaveURL(/\/tags\/entity$/);
  await page.getByRole("button", { name: "닫기", exact: true }).click();
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("link", { name: "자료 태그", exact: true })).toBeFocused();
});

test("기존 식별자 주소도 일반 설정의 식별자 섹션으로 연결한다", async ({ page }) => {
  await settingsFixture(page);
  await page.goto("/settings/entity-identity");
  await expect(page).toHaveURL(/\/settings#entity-identity-title$/);
  await expect(page.getByRole("form", { name: "자료 식별자 설정", exact: true })).toBeVisible();
});
