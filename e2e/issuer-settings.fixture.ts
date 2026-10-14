import { expect, type Page, test } from "@playwright/test";
import { initialEntityDefinition } from "../supabase/functions/_shared/contracts/entity-type.ts";
const typeId = "11111111-1111-4111-8111-111111111111",
  appRule = "00000000-0000-4000-8000-000000000001",
  productRule = "22222222-2222-4222-8222-222222222222";
const user = {
  id: "00000000-0000-0000-0000-000000000001",
  aud: "authenticated",
  email: "fixture@example.test",
  app_metadata: {},
  user_metadata: { full_name: "Fixture" },
};
async function fixture(page: Page, baseURL: string) {
  let identity = {
    type_id: typeId,
    label: "상품 번호",
    default_source: "app",
    version: 3,
    sources: [{
      code: "app",
      rule_id: appRule,
      active: true,
      referenced: false,
      source_label: "앱",
      rule_label: "자동 발급",
      generation: "automatic",
    }, {
      code: "coupang",
      rule_id: productRule,
      active: true,
      referenced: true,
      source_label: "쿠팡",
      rule_label: "상품 ID",
      generation: "direct",
    }],
  };
  const issuers = [{ code: "app", label: "앱", active: true, system: true, version: 1 }, {
    code: "coupang",
    label: "쿠팡",
    active: true,
    system: false,
    version: 1,
  }, { code: "naver", label: "네이버", active: true, system: false, version: 1 }];
  const rules = [{
    id: appRule,
    source: "app",
    label: "자동 발급",
    meaning: "앱 번호",
    generation: "automatic",
    active: true,
    version: 1,
  }, {
    id: productRule,
    source: "coupang",
    label: "상품 ID",
    meaning: "상품 등록 번호",
    generation: "direct",
    active: true,
    version: 1,
  }, {
    id: "33333333-3333-4333-8333-333333333333",
    source: "coupang",
    label: "판매자 번호",
    meaning: "판매자 번호",
    generation: "direct",
    active: true,
    version: 1,
  }, {
    id: "44444444-4444-4444-8444-444444444444",
    source: "naver",
    label: "상품 ID",
    meaning: "네이버 상품",
    generation: "direct",
    active: true,
    version: 1,
  }];
  const material = {
    id: typeId,
    label: "상품",
    icon_id: "box",
    archived: false,
    version: 1,
    schema_version: 1,
    next_property_number: 2,
    created_at: "2026-10-15T00:00:00Z",
    updated_at: "2026-10-15T00:00:00Z",
  };
  const writes: { path: string; key: string | undefined; body: any }[] = [];
  let fail = "";
  const receipts = new Map<string, unknown>();
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
  await page.route("**/*", async (route) => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (url.origin === new URL(baseURL).origin) return route.continue();
    if (path.startsWith("/api/") && request.method() !== "GET") {
      const body = request.postDataJSON(), key = request.headers()["idempotency-key"];
      writes.push({ path, key, body });
      if (key && receipts.has(key)) return route.fulfill({ json: receipts.get(key) });
      if (path.endsWith("/identity")) {
        if (fail === "conflict") {
          fail = "";
          identity = { ...identity, label: "최신 번호", version: 4 };
          return route.fulfill({ status: 409, json: { code: "settings_changed", message: "동시 변경" } });
        }
        expect(body.expected_version).toBe(identity.version);
        identity = {
          ...identity,
          ...body,
          version: identity.version + 1,
          sources: body.sources.map((s: any) => ({ ...identity.sources.find((old) => old.code === s.code), ...s })),
        };
        if (key) receipts.set(key, structuredClone(identity));
        if (fail === "lost") {
          fail = "";
          return route.abort();
        }
        return route.fulfill({ json: identity });
      }
      if (path === "/api/entity-issuers") {
        const source = { ...body, active: true, system: false, version: 1 };
        issuers.push(source);
        if (key) receipts.set(key, source);
        if (fail === "lost") {
          fail = "";
          return route.abort();
        }
        return route.fulfill({ status: 201, json: source });
      }
      if (path.endsWith("/rules")) {
        const rule = {
          id: crypto.randomUUID(),
          source: path.split("/").at(-2)!,
          ...body,
          generation: "direct",
          active: true,
          version: 1,
        };
        rules.push(rule);
        return route.fulfill({ status: 201, json: rule });
      }
      return route.fulfill({ status: 409, json: { code: "conflict", message: "기본 발급처를 먼저 변경하세요" } });
    }
    if (path === "/api/entity-issuers") return route.fulfill({ json: { items: issuers } });
    if (path.startsWith("/api/entity-issuers/") && path.endsWith("/rules")) {
      return route.fulfill({ json: { items: rules.filter((r) => r.source === path.split("/").at(-2)) } });
    }
    if (path === `/api/entity-types/${typeId}/identity`) return route.fulfill({ json: identity });
    if (path === "/api/entity-types") {
      return route.fulfill({ json: { items: [{ ...material, identity }], next_cursor: null } });
    }
    if (path.endsWith("/schema")) {
      return route.fulfill({
        json: {
          type: material,
          type_id: typeId,
          schema_version: 1,
          type_version: 1,
          ...initialEntityDefinition("이름"),
          identity,
        },
      });
    }
    if (path === `/api/entity-types/${typeId}`) return route.fulfill({ json: { ...material, identity } });
    if (path.startsWith("/api/")) return route.fulfill({ json: { items: [], next_before: null, next_cursor: null } });
    return route.abort();
  });
  return {
    writes,
    fail: (mode: string) => {
      fail = mode;
    },
  };
}
async function identityEditor(page: Page) {
  await page.goto(`/settings/entity-types/${typeId}`);
  await page.getByRole("button", { name: "식별자", exact: false }).click();
  return page.getByRole("form", { name: "식별자 설정" });
}
test("type identity cancel and explicit conflict resolution preserve the local number label", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!), form = await identityEditor(page);
  await form.getByLabel("이름").fill("내 상품 번호");
  await form.getByRole("button", { name: "변경 취소", exact: true }).click();
  await expect(form.getByLabel("이름")).toHaveValue("상품 번호");
  await form.getByLabel("이름").fill("내 상품 번호");
  state.fail("conflict");
  await form.getByRole("button", { name: "식별자 저장" }).click();
  await expect(form.getByLabel("이름")).toHaveValue("내 상품 번호");
  await form.getByRole("button", { name: "최신 저장값 확인" }).click();
  await expect(form.getByText("최신 번호", { exact: false })).toBeVisible();
  await form.getByRole("button", { name: "입력 유지하고 최신 버전 사용" }).click();
  await form.getByRole("button", { name: "식별자 저장" }).click();
  await expect(page.getByText("식별자 설정을 저장했습니다.")).toBeVisible();
  expect(state.writes.at(-1)?.body).toMatchObject({ label: "내 상품 번호", expected_version: 4 });
});
test("referenced rules are read only and stopping support does not delete the binding or change default silently", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!), form = await identityEditor(page);
  await expect(form.getByLabel("쿠팡 번호 규칙")).toHaveCount(0);
  await expect(form.getByLabel("참조된 규칙 · 변경 불가")).toBeVisible();
  await form.getByLabel("쿠팡", { exact: true }).uncheck();
  await form.getByRole("button", { name: "식별자 저장" }).click();
  await expect(page.getByText("식별자 설정을 저장했습니다.")).toBeVisible();
  expect(state.writes.at(-1)?.body).toMatchObject({
    default_source: "app",
    sources: expect.arrayContaining([{ code: "coupang", rule_id: productRule, active: false }]),
  });
});
test("issuer and rule creation dialogs return to an unchanged dirty type draft", async ({ page, baseURL }) => {
  await fixture(page, baseURL!);
  const form = await identityEditor(page);
  await form.getByLabel("이름").fill("편집 중인 번호");
  await form.getByRole("button", { name: "연결", exact: true }).click();
  const binding = page.getByRole("dialog", { name: "지원 발급처 연결", exact: true });
  await binding.getByRole("button", { name: "발급처 추가" }).click();
  const create = page.getByRole("dialog", { name: "발급처 추가", exact: true });
  await create.getByLabel("이름").fill("새 마켓");
  await create.getByRole("button", { name: "취소", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "변경을 버릴까요?" });
  await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(create.getByLabel("이름")).toHaveValue("새 마켓");
  await create.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("dialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" }).click();
  await binding.getByRole("button", { name: "취소", exact: true }).click();
  await expect(form.getByLabel("이름")).toHaveValue("편집 중인 번호");
});
test("issuer retry retains its hidden stable code and request key; builtin app stays read only", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto("/settings/issuers");
  await expect(page.getByRole("heading", { name: "발급처 설정", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "편집", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "발급처 추가", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "발급처 추가", exact: true });
  await modal.getByLabel("이름").fill("새 마켓");
  state.fail("lost");
  await modal.getByRole("button", { name: "저장", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("저장 여부를 알 수 없습니다");
  await expect(modal.getByRole("button", { name: "취소", exact: true })).toBeDisabled();
  await modal.getByRole("button", { name: "같은 요청 다시 확인" }).click();
  await expect(modal).toHaveCount(0);
  expect(state.writes[0].key).toBe(state.writes[1].key);
  expect(state.writes[0].body).toEqual(state.writes[1].body);
  expect(state.writes[0].body.code).toMatch(/^issuer_[a-f0-9]{24}$/);
});
