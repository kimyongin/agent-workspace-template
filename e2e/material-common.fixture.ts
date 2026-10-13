import { expect, test } from "@playwright/test";
import { entityDetail } from "../supabase/functions/_shared/contracts/entity.ts";
import { defaultEntityIdentitySettings } from "../supabase/functions/_shared/contracts/entity-identity.ts";
import { type EntityType, initialEntityDefinition } from "../supabase/functions/_shared/contracts/entity-type.ts";
import { fulfillPreparation } from "./support/preparation-api.ts";
import { closeDetail } from "./ui-actions.ts";
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

test("종류와 공통 기록 초안은 독립 저장하고 다른 템플릿을 보존한다", async ({ page }) => {
  let value = {
    entity: { create: { memo: "공통 저장값", tag_ids: [] } },
    task: { create: { memo: "할 일 유지", tag_ids: [] } },
    entity_types: {
      [products.id]: { create: { memo: "상품 유지", tag_ids: [] } },
    },
  };
  let version = 4;
  const writes: any[] = [];
  await page.route("**/api/settings/business**", (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      writes.push(body);
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
  await page.goto(`/settings/entity-types/${materials.id}`);
  await page.getByRole("button", { name: /현재 종류 기록 기본값/ }).click();
  const typed = page.getByRole("form", {
    name: "현재 종류 기록 기본값",
    exact: true,
  });
  await typed.getByLabel("메모 템플릿").fill("종류 초안");
  await page.getByRole("button", { name: "공통 설정", exact: true }).click();
  const common = page.getByRole("form", {
    name: "자료 공통 기록 기본값",
    exact: true,
  });
  await common.getByLabel("메모 템플릿").fill("공통 초안");
  await page.getByRole("button", { name: "공통 설정 닫기", exact: true })
    .click();
  await typed.getByRole("button", { name: "기록 기본값 저장", exact: true })
    .click();
  await expect(typed.getByRole("status")).toContainText("저장했습니다");
  await page.getByRole("button", { name: "공통 설정", exact: true }).click();
  expect(writes[0].value.entity.create.memo).toBe("공통 저장값");
  expect(writes[0].value.task.create.memo).toBe("할 일 유지");
  expect(writes[0].value.entity_types[products.id].create.memo).toBe(
    "상품 유지",
  );
  await expect(common.getByLabel("메모 템플릿")).toHaveValue("공통 초안");
  await common.getByRole("button", { name: "기록 기본값 저장", exact: true })
    .click();
  await expect(common.getByRole("status")).toContainText("저장했습니다");
  expect(writes[1].value.entity_types[materials.id].create.memo).toBe(
    "종류 초안",
  );
});

test("공통 설정에서 자료를 확인하고 돌아오면 종류 초안과 보조 영역 및 초점을 보존한다", async ({ page }) => {
  const entity = {
    id: "app:ready",
    source: "app",
    external_id: "ready",
    entity_type_id: materials.id,
    schema_version: 1,
    properties: { prop_1: "확인 자료" },
    title: "확인 자료",
    type: materials,
    source_label: "앱",
    current_schema_version: 1,
    display_properties: { prop_1: "확인 자료" },
    tasks: { items: [], count: 0 },
    records: { items: [], count: 0 },
    version: 1,
    tag_ids: [],
    deleted_at: null,
    created_at: materials.created_at,
    updated_at: materials.updated_at,
  };
  await page.route(
    "**/api/entities",
    (route) => route.fulfill({ json: { items: [entity], next_cursor: null } }),
  );
  await page.route(
    "**/api/entities/app%3Aready",
    (route) => route.fulfill({ json: entity }),
  );
  await page.goto(`/settings/entity-types/${materials.id}?schema_version=1`);
  await page.getByRole("button", { name: /기본 정보/ }).click();
  await page.getByLabel("자료 종류 이름", { exact: true }).fill(
    "돌아올 종류 초안",
  );
  await page.getByRole("button", { name: "공통 설정", exact: true }).click();
  const launch = page.getByRole("link", {
    name: "확인 자료 자료 확인",
    exact: true,
  });
  await launch.click();
  await expect(
    page.getByRole("dialog", { name: "변경을 버릴까요?", exact: true }),
  ).toHaveCount(0);
  await closeDetail(page, "확인 자료");
  await expect(page).toHaveURL(
    `/settings/entity-types/${materials.id}?schema_version=1`,
  );
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue(
    "돌아올 종류 초안",
  );
  await expect(
    page.getByRole("region", { name: "자료 공통 설정", exact: true }),
  ).toBeVisible();
  await expect(launch).toBeFocused();
  await page.getByLabel("자료 종류 선택", { exact: true }).selectOption(
    products.id,
  );
  await expect(
    page.getByRole("dialog", { name: "변경을 버릴까요?", exact: true }),
  ).toBeVisible();
});

test("기록 기본값 충돌과 응답 유실은 다른 범위 초안을 지키고 동일 요청으로만 재시도한다", async ({ page }) => {
  let version = 2,
    fail = "conflict",
    value: any = { entity: { create: { memo: "서버 공통", tag_ids: [] } } };
  const requests: any[] = [];
  await page.route("**/api/settings/business**", (route) => {
    const id = new URL(route.request().url()).searchParams.get("id");
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON();
      requests.push({
        body,
        key: route.request().headers()["idempotency-key"],
      });
      if (fail === "conflict") {
        fail = "";
        version = 3;
        return route.fulfill({
          status: 409,
          json: { code: "conflict", message: "동시 변경" },
        });
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
        settings: {
          ...(id !== "record_templates" ? { entity_identity: defaultEntityIdentitySettings } : {}),
          ...(id !== "entity_identity" ? { record_templates: value } : {}),
        },
        versions: { entity_identity: 0, record_templates: version },
      },
    });
  });
  await page.goto(`/settings/entity-types/${materials.id}`);
  await page.getByRole("button", { name: /현재 종류 기록 기본값/ }).click();
  const typed = page.getByRole("form", {
    name: "현재 종류 기록 기본값",
    exact: true,
  });
  await typed.getByLabel("메모 템플릿").fill("충돌 초안");
  await page.getByRole("button", { name: "공통 설정", exact: true }).click();
  const common = page.getByRole("form", {
    name: "자료 공통 기록 기본값",
    exact: true,
  });
  await common.getByLabel("메모 템플릿").fill("다른 범위 초안");
  await page.getByRole("button", { name: "공통 설정 닫기", exact: true })
    .click();
  await typed.getByRole("button", { name: "기록 기본값 저장", exact: true })
    .click();
  await expect(typed.getByRole("button", { name: "최신값 확인", exact: true }))
    .toBeVisible();
  await typed.getByRole("button", { name: "최신값 확인", exact: true }).click();
  await typed.getByRole("button", { name: "최신값으로 다시 편집", exact: true })
    .click();
  await page.getByRole("button", { name: "공통 설정", exact: true }).click();
  await expect(common.getByLabel("메모 템플릿")).toHaveValue("다른 범위 초안");
  await page.getByRole("button", { name: "공통 설정 닫기", exact: true })
    .click();
  await typed.getByLabel("메모 템플릿").fill("유실 재시도 초안");
  fail = "lost";
  await typed.getByRole("button", { name: "기록 기본값 저장", exact: true })
    .click();
  await expect(
    typed.getByRole("button", { name: "같은 내용 다시 시도", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "공통 설정", exact: true }).click();
  await expect(
    common.getByRole("button", { name: "같은 내용 다시 시도", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "공통 설정 닫기", exact: true })
    .click();
  await typed.getByRole("button", { name: "같은 내용 다시 시도", exact: true })
    .click();
  await expect(typed.getByRole("status")).toContainText("저장했습니다");
  expect(requests[2]).toEqual(requests[1]);
  await page.getByRole("button", { name: "공통 설정", exact: true }).click();
  await expect(common.getByLabel("메모 템플릿")).toHaveValue("다른 범위 초안");
});

test("공통 보조 영역의 태그 CRUD는 범위를 구분하고 초안을 보존하며 중첩 모달 없이 복귀한다", async ({ page }) => {
  const tags: any[] = [];
  const scopes: string[] = [];
  await page.route("**/api/tags**", (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      scopes.push(body.scope);
      const tag = {
        id: `00000000-0000-4000-8000-0000000000${tags.length + 10}`,
        name: body.name,
        scope: body.scope,
        version: 1,
      };
      tags.push(tag);
      return route.fulfill({ json: tag });
    }
    return route.fulfill({
      json: {
        items: tags.filter((tag) => tag.scope === url.searchParams.get("scope")),
        next_cursor: null,
      },
    });
  });
  await page.goto(`/settings/entity-types/${materials.id}`);
  await page.getByRole("button", { name: "공통 설정", exact: true }).click();
  const common = page.getByRole("form", {
    name: "자료 공통 기록 기본값",
    exact: true,
  });
  await common.getByLabel("메모 템플릿").fill("관리 뒤 돌아올 공통 초안");
  await page.getByRole("button", { name: "자료 태그 관리", exact: true })
    .click();
  await page.getByRole("form", { name: "태그 추가", exact: true }).getByLabel(
    "태그 이름",
    { exact: false },
  ).fill("자료 전용");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await expect(page.getByText("태그를 저장했습니다.", { exact: true }))
    .toBeVisible();
  await expect(page.locator("dialog[open]")).toHaveCount(0);
  await page.getByRole("button", { name: "태그 관리 닫기", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "자료 태그 관리", exact: true }),
  ).toBeFocused();
  await expect(common.getByLabel("메모 템플릿")).toHaveValue(
    "관리 뒤 돌아올 공통 초안",
  );
  await page.getByRole("button", { name: "기록 태그 관리", exact: true })
    .click();
  await page.getByRole("form", { name: "태그 추가", exact: true }).getByLabel(
    "태그 이름",
    { exact: false },
  ).fill("기록 전용");
  await page.getByRole("button", { name: "추가", exact: true }).click();
  await expect(page.getByText("태그를 저장했습니다.", { exact: true }))
    .toBeVisible();
  await page.getByRole("button", { name: "태그 관리 닫기", exact: true })
    .click();
  expect(scopes).toEqual(["entity", "record"]);
  await expect(common.getByText("기록 전용", { exact: true })).toBeVisible();
  await expect(common.getByText("자료 전용", { exact: true })).toHaveCount(0);
});
