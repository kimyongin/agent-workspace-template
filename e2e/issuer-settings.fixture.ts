import { expect, type Page, test } from "@playwright/test";
import { entity as sampleEntity } from "./support/workspace-data.ts";
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
  let registered: any = null;
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
      if (path === "/api/records/prepare") {
        return route.fulfill({
          json: {
            change_note: `${body.input.properties.prop_1} 등록`,
            change_tag_ids: [],
            missing_tag_ids: [],
            settings_version: 0,
            prepared_input: body.input,
          },
        });
      }
      if (path === "/api/entities") {
        registered = {
          ...sampleEntity(),
          ...body,
          id: `${body.source}:${typeId}:${body.external_id}`,
          entity_type_id: typeId,
          entity_type_label: "상품",
          source_label: issuers.find((i) => i.code === body.source)?.label,
          title: body.properties.prop_1,
          display_properties: body.properties,
          schema_version: 1,
        };
        return route.fulfill({ status: 201, json: registered });
      }
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
          sources: body.sources.map((s: any) => ({
            ...s,
            referenced: identity.sources.find((old) => old.code === s.code)?.referenced ?? false,
            source_label: issuers.find((i) => i.code === s.code)?.label ?? "",
            rule_label: rules.find((r) => r.id === s.rule_id)?.label ?? "",
            generation: rules.find((r) => r.id === s.rule_id)?.generation ?? "direct",
          })),
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
        if (fail === "rule-error") {
          fail = "";
          return route.fulfill({ status: 400, json: { code: "validation", message: "번호 종류 이름을 확인하세요" } });
        }
        const rule = {
          id: crypto.randomUUID(),
          source: path.split("/").at(-2)!,
          ...body,
          generation: "direct",
          active: true,
          version: 1,
        };
        rules.push(rule);
        if (key) receipts.set(key, rule);
        if (fail === "rule-lost") {
          fail = "";
          return route.abort();
        }
        return route.fulfill({ status: 201, json: rule });
      }
      if (request.method() === "DELETE") {
        const rule = path.startsWith("/api/entity-identifier-rules/")
          ? rules.find((r) => r.id === path.split("/").at(-1))
          : undefined;
        const issuer = path.startsWith("/api/entity-issuers/")
          ? issuers.find((i) => i.code === path.split("/").at(-1))
          : undefined;
        const used = rule
          ? identity.sources.some((s) => s.rule_id === rule.id)
          : rules.some((r) => r.source === issuer?.code);
        if (used) {
          return route.fulfill({
            status: 400,
            json: {
              code: "invalid_input",
              message: "연결되거나 사용된 번호 출처·번호 종류는 삭제할 수 없습니다. 사용을 중지하세요",
            },
          });
        }
        if (rule) rules.splice(rules.indexOf(rule), 1);
        if (issuer) issuers.splice(issuers.indexOf(issuer), 1);
        const response = { deleted: true };
        if (key) receipts.set(key, response);
        if (fail === "delete-lost") {
          fail = "";
          return route.abort();
        }
        return route.fulfill({ json: response });
      }
      if (path.startsWith("/api/entity-issuers/") || path.startsWith("/api/entity-identifier-rules/")) {
        const id = path.split("/").at(-1);
        const source = path.startsWith("/api/entity-issuers/")
          ? issuers.find((i) => i.code === id)!
          : rules.find((r) => r.id === id)!;
        if (body.expected_version !== source.version) {
          return route.fulfill({ status: 409, json: { code: "settings_changed", message: "설정이 변경되었습니다" } });
        }
        const blocking = identity.default_source === ("code" in source ? source.code : source.source) &&
          ("code" in source ||
            identity.sources.some((s) => s.code === identity.default_source && s.rule_id === source.id));
        if (body.active === false && blocking) {
          return route.fulfill({
            status: 400,
            json: {
              code: "invalid_input",
              message: "기본 번호 출처를 먼저 변경하세요",
              fields: [{ path: `default_types.${typeId}`, message: "상품" }],
            },
          });
        }
        Object.assign(source, { label: body.label, active: body.active, version: source.version + 1 });
        if (key) receipts.set(key, structuredClone(source));
        if (fail === "patch-lost") { fail = ""; return route.abort(); }
        return route.fulfill({ json: source });
      }
      return route.fulfill({ status: 400, json: { code: "invalid_input", message: "설정 입력 확인" } });
    }
    if (path === "/api/entities") {
      return route.fulfill({ json: { items: registered ? [registered] : [], next_cursor: null } });
    }
    if (path.startsWith("/api/entities/")) {
      return registered && decodeURIComponent(path.split("/").at(-1)!) === registered.id
        ? route.fulfill({ json: registered })
        : route.fulfill({ status: 404, json: { code: "not_found", message: "자료 없음" } });
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
    identity: () => identity,
    renameIssuer: (code: string, label: string) => {
      issuers.find((i) => i.code === code)!.label = label;
    },
    concurrentRule: () => {
      const rule = rules.find((rule) => rule.id === productRule)!;
      rule.label = "다른 창의 상품 번호";
      rule.version++;
    },
    concurrentIdentity: () => {
      identity = { ...identity, label: "다른 창의 번호", default_source: "coupang", version: 4 };
    },
    withoutApp: () => {
      identity = { ...identity, sources: identity.sources.filter((s) => s.code !== "app") };
    },
    fail: (mode: string) => {
      fail = mode;
    },
  };
}
async function identityEditor(page: Page) {
  await page.goto(`/settings/entity-types/${typeId}`);
  await page.getByRole("button", { name: "자료 번호", exact: false }).click();
  return page.getByRole("form", { name: "자료 번호 설정" });
}
test("type identity cancel and explicit conflict resolution preserve the local number label", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!), form = await identityEditor(page);
  await form.getByRole("textbox", { name: "이름 (필수)", exact: true }).fill("내 상품 번호");
  await form.getByRole("button", { name: "변경 취소", exact: true }).click();
  await expect(form.getByRole("textbox", { name: "이름 (필수)", exact: true })).toHaveValue("상품 번호");
  await form.getByRole("textbox", { name: "이름 (필수)", exact: true }).fill("내 상품 번호");
  state.fail("conflict");
  await form.getByRole("button", { name: "자료 번호 저장" }).click();
  await expect(form.getByRole("textbox", { name: "이름 (필수)", exact: true })).toHaveValue("내 상품 번호");
  await form.getByRole("button", { name: "최신 저장값 확인" }).click();
  await expect(form.getByText("최신 번호", { exact: false })).toBeVisible();
  await form.getByRole("button", { name: "입력 유지하고 최신 버전 사용" }).click();
  await form.getByRole("button", { name: "자료 번호 저장" }).click();
  await expect(page.getByText("자료 번호 설정을 저장했습니다.")).toBeVisible();
  expect(state.writes.at(-1)?.body).toMatchObject({ label: "내 상품 번호", expected_version: 4 });
});
test("referenced rules are read only and stopping support does not delete the binding or change default silently", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!), form = await identityEditor(page);
  await expect(form.getByLabel("쿠팡 번호 종류")).toHaveCount(0);
  await expect(form.getByLabel("사용 중인 번호 종류 · 변경 불가")).toBeVisible();
  await form.getByLabel("쿠팡", { exact: true }).uncheck();
  await form.getByRole("button", { name: "자료 번호 저장" }).click();
  await expect(page.getByText("자료 번호 설정을 저장했습니다.")).toBeVisible();
  expect(state.writes.at(-1)?.body).toMatchObject({
    default_source: "app",
    sources: expect.arrayContaining([{ code: "coupang", rule_id: productRule, active: false }]),
  });
});
test("issuer and rule creation dialogs return to an unchanged dirty type draft", async ({ page, baseURL }) => {
  await fixture(page, baseURL!);
  const form = await identityEditor(page);
  await form.getByRole("textbox", { name: "이름 (필수)", exact: true }).fill("편집 중인 번호");
  await form.getByRole("button", { name: "연결", exact: true }).click();
  const binding = page.getByRole("dialog", { name: "번호 출처 연결", exact: true });
  await binding.getByRole("button", { name: "번호 출처 추가" }).click();
  const create = page.getByRole("dialog", { name: "번호 출처 추가", exact: true });
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await create.getByLabel("이름").fill("새 마켓");
  await create.getByRole("button", { name: "취소", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "변경을 버릴까요?" });
  await expect(page.locator("dialog[open]")).toHaveCount(2);
  for (const button of await confirm.locator(".modal-foot button").all()) {
    expect((await button.boundingBox())!.width).toBeGreaterThanOrEqual(88);
  }
  await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(create.getByLabel("이름")).toHaveValue("새 마켓");
  await create.getByRole("button", { name: "취소", exact: true }).click();
  await page.getByRole("dialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "변경 버리기" }).click();
  await expect(binding.getByRole("button", { name: "번호 출처 추가" })).toBeFocused();
  await binding.getByRole("button", { name: "취소", exact: true }).click();
  await expect(form.getByRole("textbox", { name: "이름 (필수)", exact: true })).toHaveValue("편집 중인 번호");
});
test("issuer retry retains its hidden stable code and request key; builtin app stays read only", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto("/settings/issuers");
  await expect(page.getByRole("heading", { name: "자료 설정", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "편집", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "기본 정보", exact: false })).toHaveCount(0);
  await expect(page.getByText("자동 생성", { exact: true })).toHaveCount(1);
  await page.getByRole("button", { name: "번호 출처 추가", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "번호 출처 추가", exact: true });
  await modal.getByLabel("이름").fill("새 마켓");
  state.fail("lost");
  await modal.getByRole("button", { name: "저장하고 번호 추가", exact: true }).click();
  await expect(modal.getByRole("alert")).toContainText("저장 여부를 알 수 없습니다");
  await expect(modal.getByRole("button", { name: "취소", exact: true })).toBeDisabled();
  await modal.getByRole("button", { name: "같은 요청 다시 확인" }).click();
  await expect(modal).toHaveCount(0);
  const firstKind = page.getByRole("dialog", { name: "번호 종류 추가", exact: true });
  await expect(firstKind.getByRole("status")).toHaveText("번호 출처를 저장했습니다.");
  await firstKind.getByRole("button", { name: "나중에 추가", exact: true }).click();
  await expect(page.getByText("등록된 번호 종류가 없습니다.")).toBeVisible();
  expect(state.writes[0].key).toBe(state.writes[1].key);
  expect(state.writes[0].body).toEqual(state.writes[1].body);
  expect(state.writes[0].body.code).toMatch(/^issuer_[a-f0-9]{24}$/);
});

test("new issuer and number rule are created above the retained type draft and then explicitly connected", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!), form = await identityEditor(page);
  await form.getByRole("textbox", { name: "이름 (필수)", exact: true }).fill("새 상품 번호");
  await form.getByRole("button", { name: "연결", exact: true }).click();
  const binding = page.getByRole("dialog", { name: "번호 출처 연결", exact: true });
  await binding.getByRole("button", { name: "번호 출처 추가" }).click();
  const issuer = page.getByRole("dialog", { name: "번호 출처 추가", exact: true });
  await issuer.getByLabel("이름").fill("새 마켓");
  await issuer.getByRole("button", { name: "저장하고 번호 추가", exact: true }).click();
  const rule = page.getByRole("dialog", { name: "번호 종류 추가", exact: true });
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await rule.getByLabel("이름").fill("상품 ID");
  await rule.getByRole("button", { name: "저장", exact: true }).click();
  await binding.getByRole("button", { name: "연결", exact: true }).click();
  await expect(form.getByRole("textbox", { name: "이름 (필수)", exact: true })).toHaveValue("새 상품 번호");
  await expect(form.getByLabel("새 마켓", { exact: true })).toBeChecked();
  await expect(form.getByRole("radio", { name: "앱 기본 번호 출처", exact: true })).toBeChecked();
  await form.getByRole("button", { name: "자료 번호 저장" }).click();
  await expect(page.getByText("자료 번호 설정을 저장했습니다.")).toBeVisible();
  expect(state.writes.find((w) => w.path.endsWith("/rules"))?.body).toEqual({ label: "상품 ID", meaning: "상품 ID" });
  expect(state.writes.at(-1)?.body.label).toBe("새 상품 번호");
});

test("returning from issuer creation keeps the connection selection and protects its discard", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!), form = await identityEditor(page);
  await form.getByRole("button", { name: "연결", exact: true }).click();
  const binding = page.getByRole("dialog", { name: "번호 출처 연결", exact: true });
  await binding.getByLabel("번호 출처", { exact: true }).selectOption("naver");
  await binding.getByRole("button", { name: "번호 출처 추가", exact: true }).click();
  const create = page.getByRole("dialog", { name: "번호 출처 추가", exact: true });
  await expect(page.locator("dialog[open]")).toHaveCount(1);
  await create.getByRole("button", { name: "취소", exact: true }).click();
  await expect(binding.getByLabel("번호 출처", { exact: true })).toHaveValue("naver");
  await expect(binding.getByRole("button", { name: "번호 출처 추가", exact: true })).toBeFocused();
  await binding.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "변경을 버릴까요?", exact: true })).toBeVisible();
  expect(state.writes).toEqual([]);
});
test("default policy refusal preserves the draft and resolves affected types without a version-conflict detour", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  state.concurrentIdentity();
  await page.goto("/settings/issuers");
  await page.getByRole("button", { name: "쿠팡", exact: true }).click();
  await page.getByRole("button", { name: "쿠팡 편집", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "번호 출처 편집", exact: true });
  await modal.getByLabel("이름").fill("내 쿠팡");
  await modal.getByLabel("사용", { exact: true }).uncheck();
  await modal.getByRole("button", { name: "저장", exact: true }).click();
  let confirm = page.getByRole("dialog", { name: "사용을 중지할까요?" });
  await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(modal.getByLabel("이름")).toHaveValue("내 쿠팡");
  await expect(modal.getByLabel("사용", { exact: true })).not.toBeChecked();
  await modal.getByRole("button", { name: "저장", exact: true }).click();
  confirm = page.getByRole("dialog", { name: "사용을 중지할까요?" });
  await confirm.getByRole("button", { name: "중지하고 저장" }).click();
  await expect(modal.getByRole("alert")).toContainText("기본 번호 출처를 먼저 변경하세요");
  await expect(modal.getByLabel("이름")).toHaveValue("내 쿠팡");
  await expect(modal.getByRole("button", { name: "최신 저장값 확인" })).toHaveCount(0);
  await modal.getByRole("button", { name: "상품 기본 번호 출처 변경", exact: true }).click();
  await expect(modal.getByLabel("상품 기본 번호 출처", { exact: true })).toBeFocused();
  await modal.getByLabel("상품 기본 번호 출처", { exact: true }).selectOption("app");
  await modal.getByRole("button", { name: "기본 번호 출처 변경", exact: true }).click();
  await expect(modal.getByRole("button", { name: "상품 기본 번호 출처 변경", exact: true })).toHaveCount(0);
  await expect(modal.getByLabel("이름")).toHaveValue("내 쿠팡");
  await expect(modal.getByLabel("이름")).toBeFocused();
  await modal.getByRole("button", { name: "저장", exact: true }).click();
  await page.getByRole("dialog", { name: "사용을 중지할까요?" }).getByRole("button", { name: "중지하고 저장" }).click();
  await expect(modal).not.toBeVisible();
  expect(state.identity().default_source).toBe("app");
  expect(state.writes.map((w) => w.path)).toEqual([
    "/api/entity-issuers/coupang",
    `/api/entity-types/${typeId}/identity`,
    "/api/entity-issuers/coupang",
  ]);
});

test("selecting the current settings category closes its menu without leaving the page", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto("/settings/issuers");
  await expect(page.getByRole("heading", { name: "자료 설정", exact: true })).toBeVisible();
  const url = page.url(), trigger = page.getByRole("button", { name: "설정 메뉴", exact: true });
  await trigger.click();
  const current = page.getByRole("menu", { name: "설정 메뉴", exact: true })
    .getByRole("link", { name: "자료", exact: true });
  await expect(current).toHaveAttribute("aria-current", "page");
  await current.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(page.getByRole("menu", { name: "설정 메뉴", exact: true })).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page).toHaveURL(url);
  expect(state.writes).toEqual([]);
});

test("자료 설정 안에서 종류·연결·번호와 전체 파일 교환을 찾고 폭에 맞게 표시한다", async ({ page, baseURL }, info) => {
  const state = await fixture(page, baseURL!);
  await page.goto("/settings/issuers");
  const navigation = page.getByRole("tablist", { name: "자료 설정 항목", exact: true });
  await expect(navigation.getByRole("link")).toHaveText(["자료 종류", "연결 설정", "번호 설정", "일괄 설정"]);
  await expect(page.locator(".page-heading").getByRole("link")).toHaveCount(0);
  await expect(navigation.getByRole("tab", { name: "번호 설정", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("번호 출처는 쿠팡·옥션처럼 구분하고, 번호 종류는 상품 번호·주문 번호처럼 용도를 나눕니다.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "설정 메뉴", exact: true }).click();
  const menu = page.getByRole("menu", { name: "설정 메뉴", exact: true });
  await expect(menu.getByRole("link")).toHaveText(["기본", "자료", "태그", "기록"]);
  await menu.getByRole("link", { name: "자료", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/issuers$/);
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("tab", { name: "일괄 설정", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: info.project.name === "mobile" ? 320 : 1440, height: 1000 });
  await page.screenshot({ path: info.outputPath("number-settings.png"), fullPage: true });
  await navigation.getByRole("tab", { name: "자료 종류", exact: true }).click();
  await expect(navigation.getByRole("tab", { name: "자료 종류", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("상품·주문·재료·레시피처럼 관리할 자료를 구분합니다.", { exact: true })).toBeVisible();
  await page.getByRole("combobox", { name: "자료 종류 선택", exact: true }).selectOption(typeId);
  await expect(page.getByRole("region", { name: "자료 번호", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("material-types.png"), fullPage: true });
  await navigation.getByRole("tab", { name: "연결 설정", exact: true }).click();
  await expect(navigation.getByRole("tab", { name: "연결 설정", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("어떤 자료끼리 연결할 수 있는지와 연결할 개수를 정합니다.", { exact: true })).toBeVisible();
  await navigation.getByRole("tab", { name: "일괄 설정", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/data-model$/);
  await expect(navigation.getByRole("tab", { name: "일괄 설정", exact: true })).toHaveAttribute("aria-current", "page");
  expect(state.writes).toEqual([]);
});

test("자료 설정 탭 이동도 미저장 번호 초안을 보호한다", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!), form = await identityEditor(page);
  await form.getByRole("textbox", { name: "이름 (필수)", exact: true }).fill("보존할 상품 번호");
  await page.getByRole("tab", { name: "번호 설정", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "변경을 버릴까요?", exact: true });
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await expect(form.getByRole("textbox", { name: "이름 (필수)", exact: true })).toHaveValue("보존할 상품 번호");
  await page.getByRole("tab", { name: "번호 설정", exact: true }).click();
  await confirmation.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/issuers$/);
  expect(state.writes).toEqual([]);
});

test("settings menu supports directional keys and visibly identifies the current category", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto("/settings/issuers");
  const trigger = page.getByRole("button", { name: "설정 메뉴", exact: true });
  await trigger.focus();
  await trigger.press("ArrowDown");
  const menu = page.getByRole("menu", { name: "설정 메뉴", exact: true });
  const first = menu.getByRole("menuitem", { name: "기본", exact: true });
  const current = menu.getByRole("link", { name: "자료", exact: true });
  await expect(first).toBeFocused();
  await first.press("ArrowDown");
  await expect(current).toBeFocused();
  await expect(current).toHaveAttribute("aria-current", "page");
  expect(await current.evaluate((node) => getComputedStyle(node).backgroundColor))
    .not.toBe(await first.evaluate((node) => getComputedStyle(node).backgroundColor));
  await current.press("End");
  const last = menu.getByRole("menuitem", { name: "기록", exact: true });
  await expect(last).toBeFocused();
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
  await first.press("ArrowUp");
  await expect(last).toBeFocused();
  await last.press("ArrowDown");
  await expect(first).toBeFocused();
  await first.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  expect(state.writes).toEqual([]);
});

test("settings menu destination remains mounted during discard confirmation and cancel restores the originating link focus", async ({ page, baseURL }) => {
  await fixture(page, baseURL!);
  const form = await identityEditor(page);
  await form.getByRole("textbox", { name: "이름 (필수)", exact: true }).fill("보존할 번호");
  await page.getByRole("button", { name: "설정 메뉴", exact: true }).click();
  const menu = page.getByRole("menu", { name: "설정 메뉴", exact: true }),
    entry = menu.getByRole("menuitem", { name: "기록", exact: true });
  await entry.click();
  const confirm = page.getByRole("dialog", { name: "변경을 버릴까요?", exact: true });
  await expect(confirm).toBeVisible();
  await expect(
    page.getByRole("menu", { name: "설정 메뉴", exact: true, includeHidden: true })
      .getByRole("link", { name: "기록", exact: true, includeHidden: true }),
  ).toBeAttached();
  await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(entry).toBeFocused();
  await expect(menu).toBeVisible();
  await expect(form.getByRole("textbox", { name: "이름 (필수)", exact: true })).toHaveValue("보존할 번호");
  await expect(page).toHaveURL(new RegExp(`/settings/entity-types/${typeId}$`));
  await entry.click();
  await page.getByRole("dialog", { name: "변경을 버릴까요?", exact: true }).getByRole("button", {
    name: "변경 버리기",
    exact: true,
  }).click();
  await expect(page).toHaveURL(/\/settings\/records$/);
  await expect(page.getByRole("button", { name: "설정 메뉴", exact: true })).toHaveAttribute("aria-expanded", "false");
});

test("nested issuer save detects a concurrent identity change and requires explicit reconciliation", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!), form = await identityEditor(page);
  await form.getByRole("textbox", { name: "이름 (필수)", exact: true }).fill("내 번호 초안");
  // Another tab saves the type identity while this tab retains its complete draft.
  state.concurrentIdentity();
  await form.getByRole("button", { name: "쿠팡 편집", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "번호 출처 편집", exact: true });
  await modal.getByLabel("이름").fill("쿠팡 표시 이름");
  await modal.getByRole("button", { name: "저장", exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(page.getByRole("alert").filter({ hasText: "같은 자료 번호 설정이 변경되었습니다" })).toBeVisible();
  await expect(form.getByRole("textbox", { name: "이름 (필수)", exact: true })).toHaveValue("내 번호 초안");
  await expect(form.getByRole("button", { name: "자료 번호 저장", exact: true })).toBeDisabled();
  await expect(form.getByRole("radio", { name: "앱 기본 번호 출처", exact: true })).toBeChecked();
  expect(state.writes.filter((w) => w.path.endsWith("/identity"))).toEqual([]);
  await form.getByRole("button", { name: "입력 유지하고 최신 버전 사용" }).click();
  await form.getByRole("button", { name: "자료 번호 저장", exact: true }).click();
  await expect(page.getByText("자료 번호 설정을 저장했습니다.")).toBeVisible();
  expect(state.writes.at(-1)?.body.expected_version).toBe(4);
});

test("closing settings menu on a noninteractive background restores its trigger focus", async ({ page, baseURL }) => {
  await fixture(page, baseURL!);
  await page.goto("/settings/issuers");
  const trigger = page.getByRole("button", { name: "설정 메뉴", exact: true });
  await trigger.click();
  await trigger.press("ArrowDown");
  await expect(page.getByRole("menu", { name: "설정 메뉴", exact: true }).getByRole("link").first())
    .toBeFocused();
  await page.getByRole("heading", { name: "자료 설정", exact: true }).click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(trigger).toBeFocused();
  await trigger.click();
  // The menu overlays the row's right side on a narrow viewport.
  await page.getByRole("button", { name: "네이버", exact: true }).click({ position: { x: 12, y: 22 } });
  await expect(page.getByRole("button", { name: "네이버", exact: true })).toBeFocused();
});

test("first number failure and unknown result preserve the saved issuer and retry only the number", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto("/settings/issuers");
  await page.getByRole("button", { name: "번호 출처 추가", exact: true }).click();
  const issuer = page.getByRole("dialog", { name: "번호 출처 추가", exact: true });
  await issuer.getByLabel("번호 출처 이름").fill("새 마켓");
  await issuer.getByRole("button", { name: "저장하고 번호 추가" }).click();
  const number = page.getByRole("dialog", { name: "번호 종류 추가", exact: true });
  await number.getByLabel("번호 종류 이름").fill("상품 번호");
  state.fail("rule-error");
  await number.getByRole("button", { name: "저장", exact: true }).click();
  await expect(number.getByRole("alert")).toContainText("번호 종류 이름을 확인하세요");
  await expect(number.getByLabel("번호 종류 이름")).toHaveValue("상품 번호");
  state.fail("rule-lost");
  await number.getByRole("button", { name: "저장", exact: true }).click();
  await expect(number.getByRole("button", { name: "나중에 추가", exact: true })).toBeDisabled();
  await number.getByRole("button", { name: "같은 요청 다시 확인" }).click();
  await expect(number).toHaveCount(0);
  expect(state.writes.filter((w) => w.path === "/api/entity-issuers")).toHaveLength(1);
  const attempts = state.writes.filter((w) => w.path.endsWith("/rules"));
  expect(attempts).toHaveLength(3);
  expect(attempts[1].key).toBe(attempts[2].key);
  await expect(page.getByText("상품 번호", { exact: true })).toHaveCount(1);
});

test(
  "issuer management through type connection reaches direct registration with an unchanged leading-zero number",
  async ({ page, baseURL }, info) => {
    const state = await fixture(page, baseURL!);
    await page.goto("/settings/issuers");
    await page.getByRole("button", { name: "번호 출처 추가", exact: true }).click();
    const issuer = page.getByRole("dialog", { name: "번호 출처 추가", exact: true });
    await issuer.getByLabel("번호 출처 이름").fill("새 마켓");
    await issuer.getByRole("button", { name: "저장하고 번호 추가" }).click();
    const number = page.getByRole("dialog", { name: "번호 종류 추가", exact: true });
    await number.getByLabel("번호 종류 이름").fill("상품 ID");
    await number.getByRole("button", { name: "저장", exact: true }).click();
    await page.screenshot({ path: info.outputPath("issuer-created.png"), fullPage: true });
    const form = await identityEditor(page);
    await form.getByRole("button", { name: "연결", exact: true }).click();
    const binding = page.getByRole("dialog", { name: "번호 출처 연결", exact: true });
    const createdSource = state.writes.find((w) => w.path === "/api/entity-issuers")!.body.code;
    await binding.getByLabel("번호 출처", { exact: true }).selectOption(createdSource);
    await binding.getByRole("button", { name: "연결", exact: true }).click();
    await form.getByRole("radio", { name: "새 마켓 기본 번호 출처", exact: true }).check();
    await form.getByLabel("앱", { exact: true }).uncheck();
    await form.getByLabel("쿠팡", { exact: true }).uncheck();
    await page.screenshot({ path: info.outputPath("type-default-choice.png"), fullPage: true });
    await form.getByRole("button", { name: "자료 번호 저장", exact: true }).click();
    await expect(page.getByText("자료 번호 설정을 저장했습니다.")).toBeVisible();
    await page.goto(`/entities?entity_type_id=${typeId}&create=1`);
    const create = page.getByRole("dialog", { name: "상품 추가", exact: true });
    await expect(create.getByRole("combobox", { name: "번호 출처", exact: true })).toHaveCount(0);
    await expect(create.getByText("새 마켓", { exact: true })).toBeVisible();
    await create.getByLabel("상품 번호", { exact: true }).fill("000Ab-9");
    await create.getByLabel("이름", { exact: false }).fill("테스트 상품");
    await page.screenshot({ path: info.outputPath("direct-register.png"), fullPage: true });
    await create.getByRole("button", { name: "저장", exact: true }).click();
    const confirm = page.getByRole("dialog", { name: "등록하시겠습니까?", exact: true });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "등록하고 저장", exact: true }).click();
    await expect(create).toHaveCount(0);
    expect(state.writes.find((w) => w.path === "/api/entities")?.body).toMatchObject({
      source: createdSource,
      external_id: "000Ab-9",
      entity_type_id: typeId,
      properties: { prop_1: "테스트 상품" },
    });
  },
);

test("default radio stays unselected when its source is disabled until another source is explicitly chosen", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!), form = await identityEditor(page);
  await form.getByLabel("앱", { exact: true }).uncheck();
  await expect(form.getByRole("radio", { name: "앱 기본 번호 출처", exact: true })).not.toBeChecked();
  await expect(form.getByRole("radio", { name: "쿠팡 기본 번호 출처", exact: true })).not.toBeChecked();
  await expect(form.getByText("기본 번호 출처를 선택하세요.")).toBeVisible();
  await form.getByRole("radio", { name: "쿠팡 기본 번호 출처", exact: true }).check();
  await form.getByRole("button", { name: "자료 번호 저장", exact: true }).click();
  await expect(page.getByText("자료 번호 설정을 저장했습니다.")).toBeVisible();
  expect(state.identity().default_source).toBe("coupang");
});

test(
  "issuer list keeps disclosures and actions usable at narrow widths and 200 percent display scale",
  async ({ page, baseURL }, info) => {
    const state = await fixture(page, baseURL!);
    const label = "쿠팡마켓상품번호 출처".repeat(6);
    state.renameIssuer("coupang", label);
    await page.goto("/settings/issuers");
    await page.getByRole("button", { name: label, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-expanded", "true");
    for (const width of [320, 390, 640, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      for (const scale of [1, 2]) {
        await page.evaluate((scale) => document.documentElement.style.zoom = String(scale), scale);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth))
          .toBe(true);
        const add = page.getByRole("button", { name: "번호 종류 추가", exact: true });
        await expect(add).toBeVisible();
      }
    }
    await page.evaluate(() => document.documentElement.style.zoom = "1");
    await page.setViewportSize({ width: info.project.name === "mobile" ? 390 : 1280, height: 900 });
    await page.screenshot({ path: info.outputPath("issuer-long-label.png"), fullPage: true });
    expect(state.writes).toHaveLength(0);
  },
);

test(
  "issuer and number reads offer recovery without an empty successful state or writes",
  async ({ page, baseURL }, info) => {
    const state = await fixture(page, baseURL!);
    let listFail = true, numberFail = true;
    await page.route("**/api/entity-issuers", (route) => {
      if (!listFail) return route.fallback();
      listFail = false;
      return route.fulfill({ status: 503, json: { code: "internal", message: "번호 출처 조회 실패" } });
    });
    await page.route("**/api/entity-issuers/coupang/rules", (route) => {
      if (!numberFail) return route.fallback();
      numberFail = false;
      return route.fulfill({ status: 503, json: { code: "internal", message: "번호 조회 실패" } });
    });
    await page.goto("/settings/issuers");
    await expect(page.getByRole("alert")).toContainText("번호 출처 조회 실패");
    await expect(page.getByText("번호 출처가 없습니다.", { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "다시 조회", exact: true }).click();
    await page.getByRole("button", { name: "쿠팡", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("번호 조회 실패");
    await expect(page.getByRole("button", { name: "번호 종류 추가", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "다시 조회", exact: true }).click();
    await expect(page.getByText("판매자 번호", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "번호 종류 추가", exact: true })).toBeEnabled();
    await page.setViewportSize({ width: info.project.name === "mobile" ? 390 : 1280, height: 900 });
    await page.screenshot({ path: info.outputPath("issuer-list.png"), fullPage: true });
    expect(state.writes).toHaveLength(0);
  },
);

test("skipping first number before its slow read completes restores focus to the active source selector", async ({ page, baseURL }) => {
  await fixture(page, baseURL!);
  let release!: () => void, started!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requested = new Promise<void>((resolve) => {
    started = resolve;
  });
  await page.route("**/api/entity-issuers/issuer_*/rules", async (route) => {
    started();
    await pending;
    await route.fulfill({ json: { items: [] } });
  });
  try {
    const form = await identityEditor(page);
    await form.getByRole("textbox", { name: "이름 (필수)", exact: true }).fill("유지할 번호");
    await form.getByRole("button", { name: "연결", exact: true }).click();
    const binding = page.getByRole("dialog", { name: "번호 출처 연결", exact: true });
    await binding.getByRole("button", { name: "번호 출처 추가", exact: true }).click();
    const issuer = page.getByRole("dialog", { name: "번호 출처 추가", exact: true });
    await issuer.getByLabel("번호 출처 이름").fill("새 번호 출처");
    await issuer.getByRole("button", { name: "저장하고 번호 추가" }).click();
    await requested;
    await page.getByRole("dialog", { name: "번호 종류 추가", exact: true }).getByRole("button", { name: "나중에 추가" })
      .click();
    await expect(binding.getByLabel("번호 출처", { exact: true })).toBeFocused();
    await expect(binding.getByRole("button", { name: "번호 종류 추가", exact: true })).toBeDisabled();
    await binding.getByRole("button", { name: "취소", exact: true }).click();
    await page.getByRole("dialog", { name: "변경을 버릴까요?", exact: true }).getByRole("button", {
      name: "변경 버리기",
    }).click();
    await expect(form.getByRole("textbox", { name: "이름 (필수)", exact: true })).toHaveValue(
      "유지할 번호",
    );
  } finally {
    release();
  }
});

test("unused number kind and issuer can be removed, confirmation cancels and a lost response replays the same deletion", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto("/settings/issuers");
  await page.getByRole("button", { name: "네이버", exact: true }).click();
  await page.getByRole("button", { name: "상품 ID 편집", exact: true }).click();
  let editor = page.getByRole("region", { name: "번호 종류 편집", exact: true });
  await editor.getByRole("button", { name: "번호 종류 삭제", exact: true }).click();
  let confirm = page.getByRole("dialog", { name: "번호 종류를 삭제할까요?" });
  await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(editor).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await editor.getByRole("button", { name: "번호 종류 삭제", exact: true }).click();
  state.fail("delete-lost");
  await page.getByRole("dialog", { name: "번호 종류를 삭제할까요?" }).getByRole("button", { name: "삭제", exact: true })
    .click();
  await editor.getByRole("button", { name: "삭제 결과 다시 확인", exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(state.writes[0]).toEqual(state.writes[1]);
  await page.getByRole("button", { name: "네이버 편집", exact: true }).click();
  editor = page.getByRole("dialog", { name: "번호 출처 편집", exact: true });
  await editor.getByRole("button", { name: "번호 출처 삭제", exact: true }).click();
  await page.getByRole("dialog", { name: "번호 출처를 삭제할까요?" }).getByRole("button", { name: "삭제", exact: true })
    .click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole("button", { name: "네이버", exact: true })).toHaveCount(0);
});

test("linked number deletion refuses without losing the editor draft", async ({ page, baseURL }) => {
  await fixture(page, baseURL!);
  await page.goto("/settings/issuers");
  await page.getByRole("button", { name: "쿠팡", exact: true }).click();
  await page.getByRole("button", { name: "상품 ID 편집", exact: true }).click();
  const editor = page.getByRole("region", { name: "번호 종류 편집", exact: true });
  await editor.getByLabel("이름").fill("내 상품 번호");
  await editor.getByRole("button", { name: "번호 종류 삭제", exact: true }).click();
  await page.getByRole("dialog", { name: "번호 종류를 삭제할까요?" }).getByRole("button", { name: "삭제", exact: true })
    .click();
  await expect(editor.getByRole("alert")).toContainText("연결되거나 사용된");
  await expect(editor.getByLabel("이름")).toHaveValue("내 상품 번호");
  await expect(editor.getByRole("button", { name: "최신 저장값 확인" })).toHaveCount(0);
});

test(
  "default repair offers app automatic numbering when its unreferenced mapping was removed, and an unknown write can only retry identically",
  async ({ page, baseURL }, testInfo) => {
    const state = await fixture(page, baseURL!);
    state.concurrentIdentity();
    state.withoutApp();
    await page.goto("/settings/issuers");
    await page.getByRole("button", { name: "쿠팡", exact: true }).click();
    await page.getByRole("button", { name: "쿠팡 편집", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "번호 출처 편집", exact: true });
    await modal.getByLabel("사용", { exact: true }).uncheck();
    await modal.getByRole("button", { name: "저장", exact: true }).click();
    await page.getByRole("dialog", { name: "사용을 중지할까요?" }).getByRole("button", { name: "중지하고 저장" })
      .click();
    await modal.getByRole("button", { name: "상품 기본 번호 출처 변경", exact: true }).click();
    await modal.getByLabel("상품 기본 번호 출처", { exact: true }).selectOption("app");
    await page.screenshot({ path: testInfo.outputPath("default-issuer-repair.png") });
    state.fail("lost");
    await modal.getByRole("button", { name: "기본 번호 출처 변경", exact: true }).click();
    await expect(modal.getByLabel("상품 기본 번호 출처", { exact: true })).toBeDisabled();
    await expect(modal.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    await modal.getByRole("button", { name: "같은 요청 다시 확인", exact: true }).click();
    expect(state.writes[1]).toEqual(state.writes[2]);
    expect(state.identity().sources.find((s) => s.code === "app")?.active).toBe(true);
    await expect(modal.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
  },
);

test(
  "inline number editing protects cancel, collapse, other numbers, sources and tabs",
  async ({ page, baseURL }, info) => {
    const state = await fixture(page, baseURL!);
    await page.goto("/settings/issuers");
    const source = page.getByRole("region", { name: "쿠팡", exact: true });
    const toggle = page.getByRole("button", { name: "쿠팡", exact: true });
    await toggle.click();
    const edit = source.getByRole("button", {
      name: "상품 ID 편집",
      exact: true,
    });
    await edit.click();
    const editor = source.getByRole("region", { name: "번호 종류 편집" });
    const input = editor.getByLabel("번호 종류 이름");
    await expect(input).toBeFocused();
    await expect(editor.getByText("입력 방식", { exact: true })).toBeVisible();
    await expect(editor.getByRole("combobox")).toHaveCount(0);
    await expect(
      editor.getByText("사용을 중지해도 기존 자료의 번호는 유지됩니다."),
    ).toBeVisible();
    await expect(page.getByRole("dialog", { name: "번호 종류 편집" }))
      .toHaveCount(0);
    await input.fill("내 상품 번호");
    const discard = page.getByRole("dialog", { name: "변경을 버릴까요?" });
    const actions = [
      editor.getByRole("button", { name: "취소", exact: true }),
      edit,
      toggle,
      source.getByRole("button", { name: "판매자 번호 편집", exact: true }),
      page.getByRole("button", { name: "네이버", exact: true }),
      source.getByRole("button", { name: "쿠팡 편집", exact: true }),
      page.getByRole("tab", { name: "자료 종류", exact: true }),
    ];
    for (const action of actions) {
      await action.click();
      await expect(discard).toBeVisible();
      await discard.getByRole("button", { name: "취소", exact: true }).click();
      await expect(input).toHaveValue("내 상품 번호");
      await expect(action).toBeFocused();
    }
    expect(state.writes).toHaveLength(0);
    for (const width of [320, 390, 640, 1024, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(
        await page.evaluate(() =>
          document.documentElement.scrollWidth <= innerWidth
        ),
      ).toBe(true);
      for (
        const control of await editor.locator(
          "button, input:not([type=checkbox])",
        ).all()
      ) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
    }
    await page.setViewportSize({
      width: info.project.name === "mobile" ? 320 : 1440,
      height: 1000,
    });
    await page.screenshot({
      path: info.outputPath("number-inline-editor.png"),
      fullPage: true,
    });
    await editor.getByRole("button", { name: "취소", exact: true }).click();
    await discard.getByRole("button", { name: "변경 버리기" }).click();
    await expect(edit).toBeFocused();
    await edit.click();
    await expect(input).toHaveValue("상품 ID");
    await input.fill("내 상품 번호");
    await editor.getByRole("button", { name: "저장", exact: true }).click();
    await expect(editor).not.toBeVisible();
    await expect(source.getByText("내 상품 번호", { exact: true }))
      .toBeVisible();
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].body).toEqual({
      label: "내 상품 번호",
      active: true,
      expected_version: 1,
    });
  },
);

test("inline number conflict preserves draft and an unknown save blocks navigation until identical retry", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto("/settings/issuers");
  await page.getByRole("button", { name: "쿠팡", exact: true }).click();
  await page.getByRole("button", { name: "상품 ID 편집", exact: true }).click();
  const editor = page.getByRole("region", { name: "번호 종류 편집" });
  const input = editor.getByLabel("번호 종류 이름");
  await input.fill("유지할 이름");
  state.concurrentRule();
  await editor.getByRole("button", { name: "저장", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText("입력을 유지했습니다");
  await editor.getByRole("button", { name: "최신 저장값 확인" }).click();
  await expect(editor.getByText(/최신 저장값: 다른 창의 상품 번호/))
    .toBeVisible();
  await editor.getByRole("button", { name: "입력 유지하고 최신 버전 사용" })
    .click();
  await expect(input).toHaveValue("유지할 이름");
  state.fail("patch-lost");
  await editor.getByRole("button", { name: "저장", exact: true }).click();
  await expect(editor.getByRole("alert")).toContainText(
    "저장 여부를 알 수 없습니다",
  );
  await expect(input).toBeDisabled();
  await expect(editor.getByRole("button", { name: "취소", exact: true }))
    .toBeDisabled();
  await expect(page.getByRole("button", { name: "네이버", exact: true }))
    .toBeDisabled();
  await page.getByRole("tab", { name: "자료 종류", exact: true }).click();
  await expect(page).toHaveURL(/settings\/issuers$/);
  await expect(editor).toBeVisible();
  await editor.getByRole("button", { name: "같은 요청 다시 확인" }).click();
  await expect(editor).not.toBeVisible();
  expect(state.writes[1]).toEqual(state.writes[2]);
  expect(state.writes[1].body.expected_version).toBe(2);
});

test("inline number stop retains its draft through default repair and a pending save blocks leaving", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  state.concurrentIdentity();
  await page.goto("/settings/issuers");
  await page.getByRole("button", { name: "쿠팡", exact: true }).click();
  await page.getByRole("button", { name: "상품 ID 편집", exact: true }).click();
  const editor = page.getByRole("region", { name: "번호 종류 편집" });
  await editor.getByLabel("번호 종류 이름").fill("중지할 상품 번호");
  await editor.getByLabel("사용", { exact: true }).uncheck();
  await editor.getByRole("button", { name: "저장", exact: true }).click();
  const confirm = page.getByRole("dialog", { name: "사용을 중지할까요?" });
  await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(editor.getByLabel("사용", { exact: true })).not.toBeChecked();
  expect(state.writes).toHaveLength(0);
  await editor.getByRole("button", { name: "저장", exact: true }).click();
  await confirm.getByRole("button", { name: "중지하고 저장" }).click();
  await editor.getByRole("button", { name: "상품 기본 번호 출처 변경", exact: true }).click();
  await editor.getByLabel("상품 기본 번호 출처", { exact: true }).selectOption("app");
  await editor.getByRole("button", { name: "기본 번호 출처 변경", exact: true }).click();
  await expect(editor.getByLabel("번호 종류 이름")).toHaveValue("중지할 상품 번호");
  let release!: () => void;
  const wait = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/entity-identifier-rules/${productRule}`, async (route) => { await wait; await route.fallback(); });
  try {
    await editor.getByRole("button", { name: "저장", exact: true }).click();
    await confirm.getByRole("button", { name: "중지하고 저장" }).click();
    await expect(editor.getByRole("button", { name: "저장 중…" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "네이버", exact: true })).toBeDisabled();
    await page.getByRole("tab", { name: "자료 종류", exact: true }).click();
    await expect(page).toHaveURL(/settings\/issuers$/);
    expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
  } finally { release(); }
  await expect(editor).not.toBeVisible();
  await expect(page.getByText("사용 중지", { exact: false })).toBeVisible();
  expect(state.identity().default_source).toBe("app");
});

test("inline discard switches to the requested number and allows confirmed tab navigation", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto("/settings/issuers");
  await page.getByRole("button", { name: "쿠팡", exact: true }).click();
  await page.getByRole("button", { name: "상품 ID 편집", exact: true }).click();
  const editor = page.getByRole("region", { name: "번호 종류 편집" });
  await editor.getByLabel("번호 종류 이름").fill("버릴 변경");
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
  await page.getByRole("button", { name: "판매자 번호 편집", exact: true }).click();
  const discard = page.getByRole("dialog", { name: "변경을 버릴까요?" });
  await discard.getByRole("button", { name: "변경 버리기" }).click();
  await expect(editor.getByLabel("번호 종류 이름")).toHaveValue("판매자 번호");
  await expect(editor.getByLabel("번호 종류 이름")).toBeFocused();
  await editor.getByLabel("번호 종류 이름").fill("이것도 버릴 변경");
  await page.getByRole("tab", { name: "자료 종류", exact: true }).click();
  await discard.getByRole("button", { name: "변경 버리기" }).click();
  await expect(page).toHaveURL(/settings\/materials$/);
  expect(state.writes).toHaveLength(0);
});
