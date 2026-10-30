import { openMainNavigation } from "./ui-actions.ts";
import { fulfillFixtureWorkspace } from "./support/workspace-scope.ts";
import { fixtureWorkspacePath } from "./support/workspace-scope.ts";
import { chooseSetting } from "./settings-actions.ts";
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
  const definition = initialEntityDefinition("이름");
  let identityChangeAllowed = false;
  for (const [property, title] of [["prop_3", "고객 번호"], ["prop_4", "주문 번호"]]) {
    definition.schema.properties[property] = {
      type: ["string", "null"],
      title,
      "x-order": Number(property.slice(5)) * 10,
      "x-identifier": { allowed_kind_ids: [appRule, productRule], default_kind_id: productRule },
    };
  }
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
    next_property_number: 5,
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
    if (
      await fulfillFixtureWorkspace(route, [{ target_kind: "settings", target_id: "*", access: "write" }, {
        target_kind: "entity_type",
        target_id: typeId,
        access: "write",
      }])
    ) return;
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
          ? Object.values(definition.schema.properties).some((field) =>
            field["x-identifier"]?.allowed_kind_ids.includes(rule.id)
          )
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
        const blocked = Object.entries(definition.schema.properties).filter(([, field]) => {
          const id = field["x-identifier"]?.default_kind_id;
          return "code" in source ? rules.find((rule) => rule.id === id)?.source === source.code : id === source.id;
        });
        const blocking = blocked.length > 0;
        if (body.active === false && blocking) {
          return route.fulfill({
            status: 400,
            json: {
              code: "invalid_input",
              message: "기본 번호 출처를 먼저 변경하세요",
              fields: blocked.map(([property, field]) => ({
                path: `default_fields.${typeId}.${property}`,
                message: `상품 · ${field.title}`,
              })),
            },
          });
        }
        Object.assign(source, { label: body.label, active: body.active, version: source.version + 1 });
        if (key) receipts.set(key, structuredClone(source));
        if (fail === "patch-lost") {
          fail = "";
          return route.abort();
        }
        return route.fulfill({ json: source });
      }
      return route.fulfill({ status: 400, json: { code: "invalid_input", message: "설정 입력 확인" } });
    }
    if (path === "/api/entity-issuers") return route.fulfill({ json: { items: issuers } });
    if (path.startsWith("/api/entity-issuers/") && path.endsWith("/rules")) {
      return route.fulfill({ json: { items: rules.filter((r) => r.source === path.split("/").at(-2)) } });
    }
    if (path === "/api/entity-types") {
      return route.fulfill({ json: { items: [material], next_cursor: null } });
    }
    if (path.endsWith("/schema")) {
      return route.fulfill({
        json: {
          type: material,
          type_id: typeId,
          schema_version: 1,
          ...definition,
          identity_change_allowed: identityChangeAllowed,
          identifier_kinds: rules.map((rule) => ({
            ...rule,
            source_label: issuers.find((issuer) => issuer.code === rule.source)!.label,
            source_version: 1,
          })),
        },
      });
    }
    if (path === `/api/entity-types/${typeId}`) return route.fulfill({ json: material });
    if (path.startsWith("/api/")) return route.fulfill({ json: { items: [], next_before: null, next_cursor: null } });
    return route.abort();
  });
  return {
    writes,
    definition,
    allowIdentityChange: () => {
      identityChangeAllowed = true;
    },
    renameIssuer: (code: string, label: string) => {
      issuers.find((i) => i.code === code)!.label = label;
    },
    concurrentRule: () => {
      const rule = rules.find((rule) => rule.id === productRule)!;
      rule.label = "다른 창의 상품 번호";
      rule.version++;
    },
    fail: (mode: string) => {
      fail = mode;
    },
  };
}
async function fieldEditor(page: Page, property = "prop_3", title = "고객 번호") {
  await page.goto(fixtureWorkspacePath(`/settings/entity-types/${typeId}?property=${property}`));
  return page.locator(`#schema-field-${property}`);
}

test("번호 종류 조회 실패는 같은 출처에서 복구하고 부모 항목 초안을 유지한다", async ({ page, baseURL }, info) => {
  const state = await fixture(page, baseURL!), field = await fieldEditor(page);
  await field.getByLabel("항목 이름", { exact: true }).fill("유지할 고객 번호");
  await expect(field.getByRole("checkbox", { name: "네이버 · 상품 ID", exact: true })).toBeEnabled();
  let failures = 2;
  await page.route(
    "**/api/entity-issuers/coupang/rules",
    (route) =>
      failures-- > 0
        ? route.fulfill({ status: 503, json: { code: "internal", message: "번호 종류 일시 조회 실패" } })
        : route.fallback(),
  );
  await field.getByRole("button", { name: "식별자 종류 추가", exact: true }).click();
  const binding = page.getByRole("dialog", { name: "식별자 종류 추가", exact: true });
  await binding.getByLabel("번호 출처", { exact: true }).selectOption("coupang");
  await expect(binding.getByRole("alert")).toContainText("번호 종류 일시 조회 실패");
  await page.screenshot({ path: info.outputPath("identifier-retry.png"), fullPage: true });
  await expect(binding.getByRole("button", { name: "연결", exact: true })).toBeDisabled();
  await binding.getByRole("button", { name: "번호 종류 다시 조회", exact: true }).click();
  await expect(binding.getByRole("alert")).toContainText("번호 종류 일시 조회 실패");
  await expect(binding.getByLabel("번호 출처", { exact: true })).toHaveValue("coupang");
  await binding.getByRole("button", { name: "번호 종류 다시 조회", exact: true }).click();
  await binding.getByLabel("번호 종류", { exact: true }).selectOption("33333333-3333-4333-8333-333333333333");
  await binding.getByRole("button", { name: "연결", exact: true }).click();
  await expect(field.getByLabel("항목 이름", { exact: true })).toHaveValue("유지할 고객 번호");
  await expect(field.getByLabel("기본 식별자 종류", { exact: true })).toHaveValue(productRule);
  await expect(field.getByRole("checkbox", { name: "쿠팡 · 판매자 번호", exact: true })).toBeChecked();
  expect(state.writes).toEqual([]);
});

test("번호 종류 재조회 중 출처를 바꾸면 이전 응답이 후보와 선택을 덮지 않는다", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!), field = await fieldEditor(page);
  await expect(field.getByRole("checkbox", { name: "네이버 · 상품 ID", exact: true })).toBeEnabled();
  let fail = true, release = () => {}, started = () => {};
  const held = new Promise<void>((resolve) => release = resolve),
    arrived = new Promise<void>((resolve) => started = resolve);
  await page.route("**/api/entity-issuers/coupang/rules", async (route) => {
    if (fail) {
      fail = false;
      return route.fulfill({ status: 503, json: { code: "internal", message: "출처 조회 실패" } });
    }
    started();
    await held;
    await route.fulfill({ json: { items: [] } }).catch(() => {});
  });
  try {
    await field.getByRole("button", { name: "식별자 종류 추가", exact: true }).click();
    const binding = page.getByRole("dialog", { name: "식별자 종류 추가", exact: true });
    await binding.getByLabel("번호 출처", { exact: true }).selectOption("coupang");
    await binding.getByRole("button", { name: "번호 종류 다시 조회", exact: true }).click();
    await arrived;
    await expect(binding.getByRole("button", { name: "번호 종류 다시 조회", exact: true })).toHaveCount(0);
    await expect(binding.getByRole("button", { name: "연결", exact: true })).toBeDisabled();
    await binding.getByLabel("번호 출처", { exact: true }).selectOption("naver");
    await expect(binding.getByRole("button", { name: "연결", exact: true })).toBeEnabled();
    release();
    await binding.getByRole("button", { name: "연결", exact: true }).click();
    await expect(field.getByRole("checkbox", { name: "네이버 · 상품 ID", exact: true })).toBeChecked();
    await expect(field.getByLabel("기본 식별자 종류", { exact: true })).toHaveValue(productRule);
    expect(state.writes).toEqual([]);
  } finally {
    release();
  }
});

test(
  "식별자 종류 재조회 320px·200%: 긴 오류와 조작은 넘치지 않고 키보드로 복구한다",
  async ({ page, baseURL }, info) => {
    const state = await fixture(page, baseURL!), field = await fieldEditor(page);
    await expect(field.getByRole("checkbox", { name: "네이버 · 상품 ID", exact: true })).toBeEnabled();
    await field.getByRole("button", { name: "식별자 종류 추가", exact: true }).click();
    const binding = page.getByRole("dialog", { name: "식별자 종류 추가", exact: true });
    let fail = true;
    await page.route("**/api/entity-issuers/coupang/rules", (route) => {
      if (!fail) return route.fallback();
      fail = false;
      return route.fulfill({
        status: 503,
        json: { code: "internal", message: "선택한 번호 종류를 불러오지 못했습니다. 다시 조회하세요." },
      });
    });
    await binding.getByLabel("번호 출처", { exact: true }).selectOption("coupang");
    await expect(binding.getByRole("alert")).toContainText("불러오지 못했습니다");
    await page.setViewportSize({ width: 320, height: 568 });
    await page.evaluate(() => document.documentElement.style.fontSize = "200%");
    const retry = binding.getByRole("button", { name: "번호 종류 다시 조회", exact: true });
    await retry.focus();
    await expect(retry).toBeInViewport({ ratio: 0.99 });
    await expect.poll(() => binding.evaluate((root) => root.scrollWidth <= root.clientWidth + 1)).toBe(true);
    await page.screenshot({ path: info.outputPath("identifier-retry-200.png"), fullPage: true });
    await page.keyboard.press("Enter");
    await expect(binding.getByLabel("번호 종류", { exact: true })).toHaveValue("33333333-3333-4333-8333-333333333333");
    await expect(binding.getByLabel("번호 출처", { exact: true })).toBeFocused();
    await expect(binding.getByRole("button", { name: "연결", exact: true })).toBeEnabled();
    expect(state.writes).toEqual([]);
  },
);

test("issuer retry retains its hidden stable code and request key; builtin app stays read only", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto(fixtureWorkspacePath("/settings/issuers"));
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

test("현재 자료 설정 범주를 눌러도 하위 화면과 초안을 유지한다", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto(fixtureWorkspacePath("/settings/issuers"));
  await expect(page.getByRole("heading", { name: "자료 설정", exact: true })).toBeVisible();
  const url = page.url();
  await openMainNavigation(page);
  const current = page.getByRole("navigation", { name: "주 메뉴", exact: true }).getByRole("link", { name: "자료 설정", exact: true });
  await expect(current).toHaveAttribute("aria-current", "page");
  await current.click();
  await expect(page).toHaveURL(url);
  expect(state.writes).toEqual([]);
});

test("자료 설정 안에서 종류·연결·번호와 전체 파일 교환을 찾고 폭에 맞게 표시한다", async ({ page, baseURL }, info) => {
  const state = await fixture(page, baseURL!);
  await page.goto(fixtureWorkspacePath("/settings/issuers"));
  const navigation = page.getByRole("tablist", { name: "자료 설정 항목", exact: true });
  await expect(navigation.getByRole("tab")).toHaveText(["자료 종류", "연결 설정", "번호 설정", "일괄 설정"]);
  await expect(navigation.getByRole("tab", { name: "번호 설정", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByText("번호 출처는 쿠팡·옥션처럼 구분하고, 번호 종류는 상품 번호·주문 번호처럼 용도를 나눕니다.", {
      exact: true,
    }),
  ).toBeVisible();
  await openMainNavigation(page);
  const menu = page.getByRole("navigation", { name: "주 메뉴", exact: true });
  for (const name of ["기본 설정", "자료 설정", "태그 설정", "기록 설정", "이 공간 관리", "공간 목록 · 새 공간"]) {
    await expect(menu.getByRole("link", { name, exact: true })).toHaveCount(1);
  }
  await expect(menu.getByRole("link", { name: "이 공간 관리", exact: true })).toHaveAttribute(
    "href",
    fixtureWorkspacePath("/manage"),
  );
  await expect(menu.getByRole("link", { name: "공간 목록 · 새 공간", exact: true })).toHaveAttribute(
    "href",
    "/workspaces",
  );
  await menu.getByRole("link", { name: "자료 설정", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/issuers$/);
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    await expect(navigation).toBeVisible();
    await expect(navigation.getByRole("tab", { name: "일괄 설정", exact: true })).toBeVisible();
    // Resize and menu-close reflow can move the whole group between protocol calls.
    await expect.poll(() =>
      navigation.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const tabs = [...element.querySelectorAll('[role="tab"]')];
        const problems: string[] = [];
        if (tabs.length !== 4) problems.push("Expected four settings tabs");
        for (const tab of tabs) {
          const target = tab.getBoundingClientRect();
          if (target.height < 44) problems.push(`${tab.textContent}: target below44px`);
          if (target.y < bounds.y || target.bottom > bounds.bottom + 1) {
            problems.push(`${tab.textContent}: outside its current group`);
          }
        }
        return problems;
      })
    ).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: info.project.name === "mobile" ? 320 : 1440, height: 1000 });
  await page.screenshot({ path: info.outputPath("number-settings.png"), fullPage: true });
  await navigation.getByRole("tab", { name: "자료 종류", exact: true }).click();
  await expect(navigation.getByRole("tab", { name: "자료 종류", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("상품·주문·재료·레시피처럼 관리할 자료를 구분합니다.", { exact: true })).toBeVisible();
  await chooseSetting(page, page.getByRole("combobox", { name: "자료 종류 선택", exact: true }), "상품");
  await expect(page.getByRole("region", { name: "입력 항목", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("material-types.png"), fullPage: true });
  await navigation.getByRole("tab", { name: "연결 설정", exact: true }).click();
  await expect(navigation.getByRole("tab", { name: "연결 설정", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("어떤 자료끼리 연결할 수 있는지와 연결할 개수를 정합니다.", { exact: true }))
    .toBeVisible();
  await navigation.getByRole("tab", { name: "일괄 설정", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/data-model$/);
  await expect(navigation.getByRole("tab", { name: "일괄 설정", exact: true })).toHaveAttribute("aria-current", "page");
  expect(state.writes).toEqual([]);
});

test("드로어 설정 링크는 Tab으로 이동하고 현재 범주를 강조한다", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto(fixtureWorkspacePath("/settings/issuers"));
  await openMainNavigation(page);
  const menu = page.getByRole("navigation", { name: "주 메뉴", exact: true });
  const first = menu.getByRole("link", { name: "기본 설정", exact: true });
  const current = menu.getByRole("link", { name: "자료 설정", exact: true });
  await first.focus(); await first.press("Tab");
  await expect(current).toBeFocused();
  await expect(current).toHaveAttribute("aria-current", "page");
  expect(await current.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(await first.evaluate(node => getComputedStyle(node).backgroundColor));
  await current.press("Tab");
  await expect(menu.getByRole("link", { name: "태그 설정", exact: true })).toBeFocused();
  expect(state.writes).toEqual([]);
});

test("first number failure and unknown result preserve the saved issuer and retry only the number", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto(fixtureWorkspacePath("/settings/issuers"));
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
  "issuer list keeps disclosures and actions usable at narrow widths and 200 percent display scale",
  async ({ page, baseURL }, info) => {
    const state = await fixture(page, baseURL!);
    const label = "쿠팡마켓상품번호 출처".repeat(6);
    state.renameIssuer("coupang", label);
    await page.goto(fixtureWorkspacePath("/settings/issuers"));
    await expect(page.getByRole("table", { name: "번호 출처 목록", exact: true })).toBeVisible();
    await page.getByRole("button", { name: label, exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: label, exact: true })).toHaveAttribute("aria-expanded", "true");
    await expect(page.getByRole("table", { name: "번호 종류 목록", exact: true })).toBeVisible();
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
    await page.goto(fixtureWorkspacePath("/settings/issuers"));
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

test("unused number kind and issuer can be removed, confirmation cancels and a lost response replays the same deletion", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto(fixtureWorkspacePath("/settings/issuers"));
  await page.getByRole("button", { name: "네이버", exact: true }).click();
  await page.getByRole("button", { name: "상품 ID 편집", exact: true }).click();
  let editor = page.getByRole("region", { name: "번호 종류 편집", exact: true });
  await editor.getByRole("button", { name: "번호 종류 삭제", exact: true }).click();
  let confirm = page.getByRole("alertdialog", { name: "번호 종류를 삭제할까요?" });
  await confirm.getByRole("button", { name: "취소", exact: true }).click();
  await expect(editor).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await editor.getByRole("button", { name: "번호 종류 삭제", exact: true }).click();
  state.fail("delete-lost");
  await page.getByRole("alertdialog", { name: "번호 종류를 삭제할까요?" }).getByRole("button", {
    name: "삭제",
    exact: true,
  })
    .click();
  await editor.getByRole("button", { name: "삭제 결과 다시 확인", exact: true }).click();
  await expect(editor).not.toBeVisible();
  expect(state.writes[0]).toEqual(state.writes[1]);
  await page.getByRole("button", { name: "네이버 편집", exact: true }).click();
  editor = page.getByRole("dialog", { name: "번호 출처 편집", exact: true });
  await editor.getByRole("button", { name: "번호 출처 삭제", exact: true }).click();
  await page.getByRole("alertdialog", { name: "번호 출처를 삭제할까요?" }).getByRole("button", {
    name: "삭제",
    exact: true,
  })
    .click();
  await expect(editor).not.toBeVisible();
  await expect(page.getByRole("button", { name: "네이버", exact: true })).toHaveCount(0);
});

test("linked number deletion refuses without losing the editor draft", async ({ page, baseURL }) => {
  await fixture(page, baseURL!);
  await page.goto(fixtureWorkspacePath("/settings/issuers"));
  await page.getByRole("button", { name: "쿠팡", exact: true }).click();
  await page.getByRole("button", { name: "상품 ID 편집", exact: true }).click();
  const editor = page.getByRole("region", { name: "번호 종류 편집", exact: true });
  await editor.getByLabel("이름").fill("내 상품 번호");
  await editor.getByRole("button", { name: "번호 종류 삭제", exact: true }).click();
  await page.getByRole("alertdialog", { name: "번호 종류를 삭제할까요?" }).getByRole("button", {
    name: "삭제",
    exact: true,
  })
    .click();
  await expect(editor.getByRole("alert")).toContainText("연결되거나 사용된");
  await expect(editor.getByLabel("이름")).toHaveValue("내 상품 번호");
  await expect(editor.getByRole("button", { name: "최신 저장값 확인" })).toHaveCount(0);
});

test(
  "inline number editing protects cancel, collapse, other numbers, sources and tabs",
  async ({ page, baseURL }, info) => {
    const state = await fixture(page, baseURL!);
    await page.goto(fixtureWorkspacePath("/settings/issuers"));
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
    const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
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
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      ).toBe(true);
      for (
        const control of await editor.locator(
          "button:not([role=checkbox]), input:not([type=checkbox])",
        ).all()
      ) {
        const bounds = (await control.boundingBox())!;
        expect(bounds.height).toBeGreaterThanOrEqual(44);
      }
      const checkbox = editor.getByRole("checkbox", { name: "사용", exact: true });
      const label = checkbox.locator("xpath=ancestor::label[1]");
      const target = (await label.boundingBox())!;
      expect(target.width).toBeGreaterThanOrEqual(44);
      expect(target.height).toBeGreaterThanOrEqual(44);
      await expect(checkbox).toBeChecked();
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
  await page.goto(fixtureWorkspacePath("/settings/issuers"));
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

test("inline discard switches to the requested number and allows confirmed tab navigation", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto(fixtureWorkspacePath("/settings/issuers"));
  await page.getByRole("button", { name: "쿠팡", exact: true }).click();
  await page.getByRole("button", { name: "상품 ID 편집", exact: true }).click();
  const editor = page.getByRole("region", { name: "번호 종류 편집" });
  await editor.getByLabel("번호 종류 이름").fill("버릴 변경");
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
  await page.getByRole("button", { name: "판매자 번호 편집", exact: true }).click();
  const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
  await discard.getByRole("button", { name: "변경 버리기" }).click();
  await expect(editor.getByLabel("번호 종류 이름")).toHaveValue("판매자 번호");
  await expect(editor.getByLabel("번호 종류 이름")).toBeFocused();
  await editor.getByLabel("번호 종류 이름").fill("이것도 버릴 변경");
  await page.getByRole("tab", { name: "자료 종류", exact: true }).click();
  await discard.getByRole("button", { name: "변경 버리기" }).click();
  await expect(page).toHaveURL(/settings\/materials$/);
  expect(state.writes).toHaveLength(0);
});

test(
  "identifier field annotations share the schema draft, allow same-source kinds and preserve complete raw defaults",
  async ({ page, baseURL }, info) => {
    const state = await fixture(page, baseURL!), field = await fieldEditor(page);
    await expect(field.getByLabel("기본 식별자 종류", { exact: true })).toHaveValue(productRule);
    await field.getByRole("checkbox", { name: "쿠팡 · 판매자 번호", exact: true }).check();
    await field.getByLabel("기본 식별자 종류", { exact: true }).selectOption("33333333-3333-4333-8333-333333333333");
    await expect(field.getByRole("checkbox", { name: "쿠팡 · 판매자 번호", exact: true })).toBeDisabled();
    await expect(field.getByRole("checkbox", { name: "쿠팡 · 상품 ID", exact: true })).toBeChecked();
    await field.getByLabel("식별자 생성 기본값", { exact: true }).selectOption("null");
    await expect(field.getByLabel("식별자 기본 원본 값", { exact: true })).toHaveCount(0);
    await field.getByLabel("식별자 생성 기본값", { exact: true }).selectOption("value");
    await field.getByLabel("식별자 기본 원본 값", { exact: true }).fill("000Ab:한글/😀");
    for (const width of [320, 390, 640, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      await expect(field.getByLabel("식별자 기본 원본 값", { exact: true })).toHaveValue("000Ab:한글/😀");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      if (width === 320) {
        await page.screenshot({
          path: info.outputPath("identifier-field-settings-320.png"),
          fullPage: true,
        });
      }
    }
    await page.screenshot({ path: info.outputPath("identifier-field-settings.png"), fullPage: true });
    expect(state.writes).toEqual([]);
    await page.getByRole("button", { name: "변경 취소", exact: true }).click();
    await expect(field.getByLabel("기본 식별자 종류", { exact: true })).toHaveValue(productRule);
    await expect(field.getByLabel("식별자 생성 기본값", { exact: true })).toHaveValue("unset");
  },
);

test("selected identity keeps its pointer and required type while labels and allowed kinds remain editable", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!), field = await fieldEditor(page, "prop_2", "식별자");
  await expect(field.getByText("자료 식별자", { exact: true })).toBeVisible();
  await expect(field.getByLabel("데이터 타입", { exact: true })).toBeDisabled();
  await expect(field.getByLabel("필수 입력", { exact: true })).toBeDisabled();
  await expect(field.getByLabel("식별자 생성 기본값", { exact: true })).toHaveCount(0);
  await field.getByLabel("항목 이름", { exact: true }).fill("상품 번호");
  await field.getByRole("checkbox", { name: "쿠팡 · 상품 ID", exact: true }).check();
  await field.getByLabel("기본 식별자 종류", { exact: true }).selectOption(productRule);
  expect(state.writes).toEqual([]);
});

test("nested source and kind creation preserve the owning field draft and attach only the chosen kind", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!), field = await fieldEditor(page);
  await field.getByLabel("항목 이름", { exact: true }).fill("유지할 번호");
  await field.getByRole("button", { name: "식별자 종류 추가", exact: true }).click();
  const binding = page.getByRole("dialog", { name: "식별자 종류 추가", exact: true });
  await binding.getByRole("button", { name: "번호 출처 추가", exact: true }).click();
  const issuer = page.getByRole("dialog", { name: "번호 출처 추가", exact: true });
  await issuer.getByLabel("번호 출처 이름").fill("새 마켓");
  state.fail("lost");
  await issuer.getByRole("button", { name: "저장하고 번호 추가", exact: true }).click();
  await expect(issuer.getByRole("alert")).toContainText("저장 여부를 알 수 없습니다");
  await issuer.getByRole("button", { name: "같은 요청 다시 확인", exact: true }).click();
  const rule = page.getByRole("dialog", { name: "번호 종류 추가", exact: true });
  await rule.getByLabel("번호 종류 이름").fill("상품 ID");
  await rule.getByRole("button", { name: "저장", exact: true }).click();
  await binding.getByRole("button", { name: "연결", exact: true }).click();
  await expect(field.getByLabel("항목 이름", { exact: true })).toHaveValue("유지할 번호");
  await expect(field.getByRole("checkbox", { name: "새 마켓 · 상품 ID", exact: true })).toBeChecked();
  await expect(field.getByLabel("기본 식별자 종류", { exact: true })).toHaveValue(productRule);
  expect(state.writes.map((w) => w.path)).toEqual([
    "/api/entity-issuers",
    "/api/entity-issuers",
    expect.stringMatching(/\/rules$/),
  ]);
  expect(state.writes[0].key).toBe(state.writes[1].key);
  expect(state.writes[0].body).toEqual(state.writes[1].body);
});

test("nested cancellation keeps field edits and protects source selection", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!), field = await fieldEditor(page);
  await field.getByLabel("항목 이름", { exact: true }).fill("유지할 번호");
  await field.getByRole("button", { name: "식별자 종류 추가", exact: true }).click();
  const binding = page.getByRole("dialog", { name: "식별자 종류 추가", exact: true });
  await binding.getByLabel("번호 출처", { exact: true }).selectOption("naver");
  await binding.getByRole("button", { name: "번호 출처 추가", exact: true }).click();
  const issuer = page.getByRole("dialog", { name: "번호 출처 추가", exact: true });
  await issuer.getByLabel("번호 출처 이름").fill("버릴 출처");
  await issuer.getByRole("button", { name: "취소", exact: true }).click();
  const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(issuer.getByLabel("번호 출처 이름")).toHaveValue("버릴 출처");
  await issuer.getByRole("button", { name: "취소", exact: true }).click();
  await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await expect(binding.getByLabel("번호 출처", { exact: true })).toHaveValue("naver");
  await binding.getByRole("button", { name: "취소", exact: true }).click();
  // A selected kind makes the connecting dialog dirty; discarding it leaves the schema draft intact.
  if (await discard.isVisible()) await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
  await expect(field.getByLabel("항목 이름", { exact: true })).toHaveValue("유지할 번호");
  expect(state.writes).toEqual([]);
});

test(
  "stopping a default kind keeps its draft and links each affected property to its schema editor",
  async ({ page, baseURL }, info) => {
    const state = await fixture(page, baseURL!);
    await page.goto(fixtureWorkspacePath("/settings/issuers"));
    await page.getByRole("button", { name: "쿠팡", exact: true }).click();
    await page.getByRole("button", { name: "상품 ID 편집", exact: true }).click();
    const editor = page.getByRole("region", { name: "번호 종류 편집", exact: true });
    await editor.getByLabel("번호 종류 이름").fill("중지할 번호");
    await editor.getByLabel("사용", { exact: true }).uncheck();
    await editor.getByRole("button", { name: "저장", exact: true }).click();
    const confirm = page.getByRole("alertdialog", { name: "사용을 중지할까요?" });
    await confirm.getByRole("button", { name: "취소", exact: true }).click();
    await expect(editor.getByLabel("번호 종류 이름")).toHaveValue("중지할 번호");
    expect(state.writes).toEqual([]);
    await editor.getByRole("button", { name: "저장", exact: true }).click();
    await confirm.getByRole("button", { name: "중지하고 저장", exact: true }).click();
    await expect(editor.getByRole("alert")).toContainText("기본 번호 출처를 먼저 변경하세요");
    const links = editor.getByRole("link");
    await expect(links).toHaveCount(2);
    await expect(links.nth(0)).toHaveAttribute("href", new RegExp("property=prop_3$"));
    await expect(links.nth(1)).toHaveAttribute("href", new RegExp("property=prop_4$"));
    await page.screenshot({ path: info.outputPath("identifier-default-stop.png"), fullPage: true });
    await links.nth(0).click();
    const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
    await discard.getByRole("button", { name: "취소", exact: true }).click();
    await expect(editor.getByLabel("번호 종류 이름")).toHaveValue("중지할 번호");
    await links.nth(0).click();
    await discard.getByRole("button", { name: "변경 버리기", exact: true }).click();
    await expect(page).toHaveURL(/property=prop_3$/);
    await expect(
      page.getByRole("region", { name: "고객 번호 입력 항목", exact: true }).last().getByLabel("기본 식별자 종류", {
        exact: true,
      }),
    ).toHaveValue(productRule);
    expect(state.writes).toHaveLength(1);
  },
);

test("schema field drafts protect settings tabs and restore originating menu focus", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!), field = await fieldEditor(page);
  await field.getByLabel("항목 이름", { exact: true }).fill("유지할 번호");
  expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(true);
  await page.getByRole("tab", { name: "번호 설정", exact: true }).click();
  const discard = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(field.getByLabel("항목 이름", { exact: true })).toHaveValue("유지할 번호");
  await openMainNavigation(page);
  const menu = page.getByRole("navigation", { name: "주 메뉴", exact: true });
  await menu.getByRole("link", { name: "태그 설정", exact: true }).click();
  await discard.getByRole("button", { name: "취소", exact: true }).click();
  await expect(menu.getByRole("link", { name: "태그 설정", exact: true })).toBeFocused();
  expect(state.writes).toEqual([]);
});

test("a pending ordinary kind stop blocks editing and navigation until the same save completes", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto(fixtureWorkspacePath("/settings/issuers"));
  await page.getByRole("button", { name: "쿠팡", exact: true }).click();
  await page.getByRole("button", { name: "판매자 번호 편집", exact: true }).click();
  const editor = page.getByRole("region", { name: "번호 종류 편집", exact: true });
  await editor.getByLabel("사용", { exact: true }).uncheck();
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/entity-identifier-rules/33333333-3333-4333-8333-333333333333", async (route) => {
    await pending;
    await route.fallback();
  });
  try {
    await editor.getByRole("button", { name: "저장", exact: true }).click();
    await page.getByRole("alertdialog", { name: "사용을 중지할까요?" }).getByRole("button", {
      name: "중지하고 저장",
      exact: true,
    }).click();
    await expect(editor.getByRole("button", { name: "저장 중…", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "네이버", exact: true })).toBeDisabled();
    await page.getByRole("tab", { name: "자료 종류", exact: true }).click();
    await expect(page).toHaveURL(/settings\/issuers$/);
    expect(await page.evaluate(() => !window.dispatchEvent(new Event("beforeunload", { cancelable: true })))).toBe(
      true,
    );
  } finally {
    release();
  }
  await expect(editor).not.toBeVisible();
  expect(state.writes).toHaveLength(1);
});

test("skipping a first kind while its slow catalog loads returns focus to the field connection selector", async ({ page, baseURL }) => {
  await fixture(page, baseURL!);
  let release!: () => void, started!: () => void;
  const pending = new Promise<void>((resolve) => {
      release = resolve;
    }),
    requested = new Promise<void>((resolve) => {
      started = resolve;
    });
  await page.route("**/api/entity-issuers/issuer_*/rules", async (route) => {
    started();
    await pending;
    await route.fulfill({ json: { items: [] } });
  });
  const field = await fieldEditor(page);
  await field.getByRole("button", { name: "식별자 종류 추가", exact: true }).click();
  const binding = page.getByRole("dialog", { name: "식별자 종류 추가", exact: true });
  await binding.getByRole("button", { name: "번호 출처 추가", exact: true }).click();
  const issuer = page.getByRole("dialog", { name: "번호 출처 추가", exact: true });
  await issuer.getByLabel("번호 출처 이름").fill("새 번호 출처");
  try {
    await issuer.getByRole("button", { name: "저장하고 번호 추가", exact: true }).click();
    await requested;
    await page.getByRole("dialog", { name: "번호 종류 추가", exact: true }).getByRole("button", {
      name: "나중에 추가",
      exact: true,
    }).click();
    await expect(binding.getByLabel("번호 출처", { exact: true })).toBeFocused();
    await expect(binding.getByLabel("번호 출처", { exact: true })).toBeEnabled();
  } finally {
    release();
  }
});

test(
  "an empty type selects a required identifier only through the schema review and keeps the choice after a stale refusal",
  async ({ page, baseURL }, info) => {
    const state = await fixture(page, baseURL!);
    state.allowIdentityChange();
    state.definition.schema.properties.prop_3.type = "string";
    state.definition.schema.required.push("prop_3");
    const field = await fieldEditor(page);
    const selected = page.getByLabel("자료 식별자 항목", { exact: true });
    await expect(selected).toHaveValue("prop_2");
    await selected.selectOption("prop_3");
    await expect(selected).toHaveValue("prop_3");
    await expect(field.getByText("자료 식별자", { exact: true })).toBeVisible();
    await expect(field.getByLabel("필수 입력", { exact: true })).toBeDisabled();
    await expect(page.getByText("변경 1개 · 검토 후 자료에 적용됩니다.", { exact: true })).toBeVisible();
    const requests: unknown[] = [];
    await page.route(`**/api/entity-types/${typeId}/schema-changes`, async (route) => {
      if (route.request().method() === "GET") return route.fallback();
      requests.push(route.request().postDataJSON());
      await route.fulfill({
        status: 409,
        json: { code: "schema_plan_stale", message: "자료가 추가되었습니다. 현재 자료 식별자를 유지하세요" },
      });
    });
    await page.getByRole("button", { name: "변경 검토", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("자료가 추가되었습니다");
    await expect(page.getByRole("alert")).toBeInViewport();
    await expect(page.getByRole("alert")).toBeFocused();
    await expect(selected).toHaveValue("prop_3");
    expect(requests).toEqual([
      expect.objectContaining({
        expected_schema_version: 1,
        edits: [{ op: "set_metadata", "x-identity-property": "prop_3" }],
      }),
    ]);
    expect(state.writes).toEqual([]);
    await page.screenshot({
      path: info.outputPath("selected-identifier-review-stale.png"),
      fullPage: true,
      animations: "disabled",
    });
  },
);

test("a populated type keeps the server selected identifier locked", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await fieldEditor(page, "prop_2");
  const selected = page.getByLabel("자료 식별자 항목", { exact: true });
  await expect(selected).toBeDisabled();
  await expect(selected).toHaveValue("prop_2");
  expect(state.writes).toEqual([]);
});
