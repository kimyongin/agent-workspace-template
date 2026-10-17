import { chooseEntityType } from "./ui-actions.ts";
import { detailDialog, executionDialog } from "./ui-actions.ts";
import { fixtureIdentity } from "./support/workspace-data.ts";
import { expect, test } from "@playwright/test";
import { entityDetail } from "../supabase/functions/_shared/contracts/entity.ts";
import { type EntityType, initialEntityDefinition } from "../supabase/functions/_shared/contracts/entity-type.ts";
import { fulfillPreparation } from "./support/preparation-api.ts";
import { closeDetail } from "./ui-actions.ts";
const type = (n: number, label: string, archived = false): EntityType => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  label,
  archived,
  icon_id: "leaf",
  schema_version: 1,
  next_property_number: 2,
  created_at: `2026-10-${String(n).padStart(2, "0")}T00:00:00Z`,
  updated_at: "2026-10-12T00:00:00Z",
});
const materials = type(1, "재료"), products = type(2, "상품"), retired = type(3, "보관 자료", true);
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
      return route.fulfill({ json: { items: [materials, products, retired], next_cursor: null } });
    }
    const selected = [materials, products, retired].find((value) =>
      url.pathname.startsWith(`/api/entity-types/${value.id}`)
    );
    if (selected) {
      if (url.pathname.endsWith("/identity")) {
        return route.fulfill({ json: fixtureIdentity(selected.id) });
      }
      if (url.pathname.endsWith("/schemas") || url.pathname.endsWith("/schema-changes")) {
        return route.fulfill({ json: { items: [], next_before: null } });
      }
      return route.fulfill({
        json: url.pathname.endsWith("/schema")
          ? { type: selected, type_id: selected.id, schema_version: 1, ...initialEntityDefinition("이름") }
          : selected,
      });
    }
    if (await fulfillPreparation(route)) return;
    if (url.pathname.startsWith("/api/")) return route.fulfill({ json: { items: [], next_cursor: null } });
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

test("자료 종류 읽기는 로그인 전 조회하지 않고 계정별 갱신과 실패 재시도를 적용한다", async ({ page }) => {
  let requests = 0, fail = false, label = "처음 자료";
  await page.route("**/api/entity-types?**", (route) => {
    requests++;
    return route.fulfill(
      fail
        ? { status: 503, json: { code: "internal", message: "조회 실패" } }
        : { json: { items: [{ ...materials, label }], next_cursor: null } },
    );
  });
  await page.goto("/e2e/fixtures/entity-type-catalog.html");
  await page.getByRole("button", { name: "조회 다시 시도", exact: true }).click();
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "계정 A", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("처음 자료");
  label = "갱신된 자료";
  await page.getByRole("button", { name: "계정 B 갱신", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("처음 자료");
  await page.getByRole("button", { name: "계정 A 갱신", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("갱신된 자료");
  fail = true;
  await page.getByRole("button", { name: "계정 A 갱신", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("조회 실패");
  fail = false;
  label = "다시 읽은 자료";
  await page.getByRole("button", { name: "조회 다시 시도", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("다시 읽은 자료");
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("계정 전환과 화면 닫기는 늦은 자료 종류 응답을 복원하지 않는다", async ({ page }) => {
  let finish!: () => void;
  let started!: () => void;
  let completed!: () => void;
  const pending = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    started = resolve;
  });
  const delivered = new Promise<void>((resolve) => {
    completed = resolve;
  });
  let first = true;
  await page.route("**/api/entity-types?**", async (route) => {
    if (first) {
      first = false;
      started();
      await pending;
      await route.fulfill({ json: { items: [{ ...materials, label: "이전 계정 자료" }], next_cursor: null } }).catch(
        () => {},
      );
      completed();
    } else await route.fulfill({ json: { items: [{ ...products, label: "새 계정 자료" }], next_cursor: null } });
  });
  await page.goto("/e2e/fixtures/entity-type-catalog.html");
  await page.getByRole("button", { name: "계정 A", exact: true }).click();
  await reading;
  await page.getByRole("button", { name: "계정 B", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("새 계정 자료");
  finish();
  await delivered;
  await expect(page.getByRole("status")).toHaveText("새 계정 자료");
  await page.getByRole("button", { name: "읽기 화면 전환", exact: true }).click();
  await expect(page.getByRole("status")).toHaveCount(0);
  await page.getByRole("button", { name: "로그아웃", exact: true }).click();
  await page.getByRole("button", { name: "읽기 화면 전환", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("읽는 중");
  await expect(page.getByText("이전 계정 자료", { exact: true })).toHaveCount(0);
});

test("모든 페이지의 자료 종류가 목록과 생성 폼 및 종류 설정에 표시된다", async ({ page }) => {
  await page.route("**/api/entity-types?**", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    return route.fulfill({
      json: cursor
        ? { items: [products, retired], next_cursor: null }
        : { items: [materials], next_cursor: "second-page" },
    });
  });
  await page.goto("/entities");
  await expect(page.getByLabel("자료 종류", { exact: true }).locator("option")).toContainText([
    "전체 자료",
    "재료",
    "상품",
    "보관 자료",
  ]);
  await page.goto(`/entities?entity_type_id=${products.id}&create=1`);
  const form = detailDialog(page);
  await expect(form.getByLabel("자료 종류", { exact: true }).locator("option")).toContainText(["재료", "상품"]);
  await page.goto("/settings/entity-types");
  await expect(page.getByLabel("자료 종류 선택", { exact: true }).locator("option")).toContainText([
    "기존 종류 선택",
    "재료",
    "상품",
    "보관 자료 (보관)",
  ]);
});
test("typed shortcut and profile access preserve canonical list filters and Back", async ({ page }) => {
  await page.goto(`/entities?entity_type_id=${materials.id}&keyword=한글&tag_id=tag&sort=title&pages=2`);
  const nav = page.getByRole("navigation", { name: "주 메뉴" });
  await expect(nav.locator(".bottom-nav-inner > a")).toHaveText(["재료", "상품", "할 일", "기록"]);
  await expect(nav.locator(`a[href='/entities?entity_type_id=${materials.id}']`)).toHaveAttribute(
    "aria-current",
    "page",
  );
  await chooseEntityType(page, products.label);
  await expect(page).toHaveURL(new RegExp(`entity_type_id=${products.id}`));
  expect(new URL(page.url()).searchParams.get("keyword")).toBe("한글");
  expect(new URL(page.url()).searchParams.get("tag_id")).toBe("tag");
  expect(new URL(page.url()).searchParams.has("sort")).toBe(false);
  expect(new URL(page.url()).searchParams.has("pages")).toBe(false);
  await page.goBack();
  await expect(page.getByLabel("자료 종류", { exact: true })).toHaveValue(materials.label);
  await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true }).click();
  await expect(page.locator("#nav-profile-options").getByRole("link", { name: "원칙", exact: true })).toHaveCount(0);
  await page.locator("#nav-profile-options").getByRole("link", { name: "전체 자료", exact: true }).click();
  await expect(page.getByRole("heading", { name: "전체 자료", level: 1 })).toBeVisible();
});
test("invalid and archived type URLs never widen or offer creation", async ({ page }) => {
  const listRequests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/api/entities") listRequests.push(request.url());
  });
  await page.goto("/entities?entity_type_id=invalid");
  await expect(page.getByRole("alert")).toContainText("자료 종류를 찾을 수 없습니다");
  expect(listRequests).toHaveLength(0);
  await page.goto(`/entities?entity_type_id=${retired.id}`);
  await expect(page.getByText("보관된 자료 종류입니다.", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "보관 자료 추가", exact: true })).toHaveCount(0);
  expect(listRequests.every((url) => new URL(url).searchParams.get("entity_type_id") === retired.id)).toBe(true);
});
test("typed creation requires selection and protects drafts before changing kind", async ({ page }) => {
  await page.goto("/entities");
  await page.getByRole("button", { name: "자료 추가", exact: true }).click();
  let form = page.getByRole("dialog", { name: "자료 추가", exact: true });
  await form.getByRole("button", { name: "저장", exact: true }).click();
  await expect(form.getByText("자료 종류와 속성 정의를 확인하세요", { exact: true })).toBeVisible();
  await expect(form.getByLabel("자료 종류", { exact: true })).toBeFocused();
  await chooseEntityType(page, materials.label, form);
  form = page.getByRole("dialog", { name: "재료 추가", exact: true });
  await form.getByLabel("이름", { exact: false }).fill("보존할 초안");
  await chooseEntityType(page, products.label, form);
  const confirmation = page.getByRole("alertdialog", { name: "자료 종류를 바꿀까요?", exact: true });
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await expect(form.getByLabel("이름", { exact: false })).toHaveValue("보존할 초안");
  await chooseEntityType(page, products.label, form);
  await confirmation.getByRole("button", { name: "종류 변경", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "상품 추가", exact: true }).getByLabel("이름", { exact: false }))
    .toHaveValue("");
});
test("settings profile route keeps drafts and treats settings as account location", async ({ page }) => {
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/settings$/);
  await expect(page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true })).toHaveAttribute(
    "data-current",
    "true",
  );
  await page.getByLabel("닉네임", { exact: true }).fill("자료 번호 초안");
  await page.getByRole("link", { name: "할 일", exact: true }).click();
  await page.getByRole("alertdialog", { name: "변경을 버릴까요?" }).getByRole("button", { name: "취소", exact: true })
    .click();
  await expect(page.getByLabel("닉네임", { exact: true })).toHaveValue(
    "자료 번호 초안",
  );
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  await expect(page.getByLabel("닉네임", { exact: true })).toBeVisible();
});

test("0, 1, and many active types expose fixed account and all business paths", async ({ page }) => {
  let items: EntityType[] = [];
  await page.route("**/api/entity-types{,?**}", (route) => route.fulfill({ json: { items, next_cursor: null } }));
  await page.goto("/entities");
  const shortcuts = page.locator(".bottom-nav-inner > a");
  await expect(shortcuts.first()).toHaveAttribute("aria-label", "전체 자료");
  await expect(page.getByText("아직 자료 종류가 없습니다.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "자료 추가", exact: true })).toHaveCount(0);
  items = [materials];
  await page.reload();
  await expect(shortcuts.first()).toHaveAttribute("aria-label", "재료");
  await expect(shortcuts.last()).toHaveAttribute("aria-label", "기록");
  items = [
    materials,
    products,
    ...Array.from(
      { length: 10 },
      (_, index) => type(index + 4, index === 9 ? "긴한국어자료종류이름공백없는문구".repeat(3) : `추가 종류 ${index}`),
    ),
  ];
  await page.reload();
  await expect(shortcuts).toHaveCount(4);
  await expect(page.locator(".entity-type-picker").getByLabel("자료 종류 검색", { exact: true })).toHaveCount(0);
  await chooseEntityType(page, items[9].label);
  await expect(page.getByRole("heading", { name: "추가 종류 7", level: 1 })).toBeVisible();
  await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true }).click();
  const menu = page.locator("#nav-profile-options");
  await menu.getByRole("searchbox", { name: "자료 종류 검색", exact: true }).fill("긴한국어");
  await expect(menu.getByRole("link", { name: items[11].label, exact: true })).toHaveCount(1);
  await menu.getByRole("link", { name: "로그아웃", exact: true }).focus();
  const box = await menu.getByRole("link", { name: "로그아웃", exact: true }).boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true })).toBeFocused();
});

test("short layouts and enlarged long labels keep controls inside viewport", async ({ page }) => {
  const long = type(1, "아주긴자료종류이름공백없는문자열".repeat(4));
  await page.route(
    "**/api/entity-types{,?**}",
    (route) => route.fulfill({ json: { items: [long, products], next_cursor: null } }),
  );
  await page.setViewportSize({ width: 320, height: 300 });
  await page.goto("/settings");
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  await expect(page.locator(".bottom-nav-inner > a").first()).toHaveAttribute("aria-label", long.label);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (
    const size of await page.locator(".bottom-nav-inner > a, .nav-profile-trigger").evaluateAll((nodes) =>
      nodes.map((node) => {
        const r = node.getBoundingClientRect();
        return [r.width, r.height];
      })
    )
  ) {
    expect(size[0]).toBeGreaterThanOrEqual(44);
    expect(size[1]).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true }).click();
  await page.locator("#nav-profile-options").getByRole("link", { name: "로그아웃", exact: true }).focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: /^내 프로필(?: · .+)?$/, exact: true })).toBeFocused();
});

test("a late old type list cannot replace current rows", async ({ page }) => {
  let release!: () => void, started!: () => void;
  const hold = new Promise<void>((resolve) => {
      release = resolve;
    }),
    arrived = new Promise<void>((resolve) => {
      started = resolve;
    });
  await page.route("**/api/entities?**", async (route) => {
    const id = new URL(route.request().url()).searchParams.get("entity_type_id");
    if (id === materials.id) {
      started();
      await hold;
    }
    const kind = id === materials.id ? materials : products;
    return route.fulfill({
      json: {
        items: [{
          id: `app:${kind.id}:result`,
          title: kind.label + " 결과",
          type: kind,
          tag_ids: [],
        }],
        next_cursor: null,
      },
    });
  });
  await page.goto(`/entities?entity_type_id=${materials.id}`);
  await arrived;
  await chooseEntityType(page, products.label);
  await expect(page.getByRole("button", { name: "상품 결과", exact: true })).toBeVisible();
  release();
  await expect(page.getByRole("button", { name: "재료 결과", exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "상품", level: 1 })).toBeVisible();
});

test("IME search preserves the selected type and current keyword after switching", async ({ page }) => {
  await page.goto(`/entities?entity_type_id=${materials.id}&keyword=기존`);
  const input = page.getByRole("textbox", { name: "자료 제목 검색", exact: true });
  await input.dispatchEvent("compositionstart");
  await input.fill("새 검색");
  expect(new URL(page.url()).searchParams.get("keyword")).toBe("기존");
  await chooseEntityType(page, products.label);
  await input.dispatchEvent("compositionend");
  await expect.poll(() => new URL(page.url()).searchParams.get("keyword")).toBe("새 검색");
  expect(new URL(page.url()).searchParams.get("entity_type_id")).toBe(products.id);
});

test("type catalog failure and all archived types have distinct recovery paths", async ({ page }) => {
  let failing = true;
  await page.route(
    "**/api/entity-types{,?**}",
    (route) => failing ? route.abort() : route.fulfill({ json: { items: [retired], next_cursor: null } }),
  );
  await page.goto("/entities");
  await expect(page.getByRole("alert")).toContainText("자료 종류를 불러오지 못했습니다");
  await expect(page.getByText("아직 자료 종류가 없습니다.", { exact: true })).toHaveCount(0);
  failing = false;
  await page.getByRole("button", { name: "종류 다시 시도", exact: true }).click();
  await expect(page.getByText("모든 자료 종류가 보관되어 있습니다.", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "보관된 종류 관리", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "자료 추가", exact: true })).toHaveCount(0);
});

test("save blocks duplicate submission and Back until typed detail is ready", async ({ page }) => {
  let release!: () => void, started!: () => void, writes = 0;
  const hold = new Promise<void>((resolve) => {
      release = resolve;
    }),
    arrived = new Promise<void>((resolve) => {
      started = resolve;
    });
  const entity = {
    id: `app:${materials.id}:created`,
    source: "app",
    external_id: "created",
    source_label: "앱",
    deleted_at: null,
    entity_type_id: materials.id,
    type: materials,
    schema_version: 1,
    current_schema_version: 1,
    properties: { prop_1: "새 재료" },
    display_properties: { prop_1: "새 재료" },
    title: "새 재료",
    tag_ids: [],
    version: 1,
    created_at: "2026-10-12T00:00:00Z",
    updated_at: "2026-10-12T00:00:00Z",
    tasks: { items: [], count: 0 },
    records: { items: [], count: 0 },
  };
  await page.route("**/api/entities{,?**}", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    writes++;
    expect(route.request().postDataJSON()).toMatchObject({
      entity_type_id: materials.id,
      properties: { prop_1: "새 재료" },
    });
    expect(route.request().headers()["idempotency-key"]).toBeTruthy();
    started();
    await hold;
    return route.fulfill({ json: entity });
  });
  await page.route(
    `**/api/entities/${encodeURIComponent(entity.id)}{,?**}`,
    (route) => route.fulfill({ json: entity }),
  );
  await page.goto(`/entities?entity_type_id=${materials.id}`);
  await page.getByRole("button", { name: "재료 추가", exact: true }).click();
  const form = page.getByRole("dialog", { name: "재료 추가", exact: true });
  await form.getByLabel("이름", { exact: false }).fill("새 재료");
  await form.getByRole("button", { name: "저장", exact: true }).click();
  const action = executionDialog(page);
  await action.getByRole("button", { name: "등록하고 저장", exact: true }).click();
  await arrived;
  await page.goBack();
  await expect(page).toHaveURL(/create=1/);
  await page.keyboard.press("Escape");
  await expect(action).toBeVisible();
  release();
  await expect(page).toHaveURL(
    new RegExp(`/entities/${encodeURIComponent(entity.id)}`),
  );
  await expect(page.getByText("새 재료", { exact: true }).first()).toBeVisible();
  expect(writes).toBe(1);
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const editing = page.getByRole("dialog", { name: "재료 편집", exact: true });
  await expect(editing.getByLabel("자료 종류", { exact: true })).toHaveCount(0);
  await expect(editing.getByRole("combobox", { name: "자료 종류", exact: true })).toHaveCount(0);
  await expect(editing.getByRole("heading", { name: "재료", exact: true }).first()).toBeVisible();
});

test("clean settings navigation proceeds while initial record templates are still reading", async ({ page }) => {
  let release!: () => void, started!: () => void;
  const hold = new Promise<void>((resolve) => {
      release = resolve;
    }),
    arrived = new Promise<void>((resolve) => {
      started = resolve;
    });
  await page.route("**/api/settings/business?**", async (route) => {
    if (new URL(route.request().url()).searchParams.get("id") !== "record_templates") return route.fallback();
    started();
    await hold;
    return route.fallback();
  });
  try {
    await page.goto("/settings/records");
    await arrived;
    await page.getByRole("button", { name: "설정 메뉴", exact: true }).click();
    await page.getByRole("navigation", { name: "설정 메뉴", exact: true }).getByRole("link", {
      name: "자료",
      exact: true,
    }).click();
    await expect(page).toHaveURL(/\/settings\/materials$/, { timeout: 1500 });
    await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true })).toHaveCount(0);
  } finally {
    release();
  }
});

test("type selection remains scoped while a returned list catalog is loading", async ({ page }) => {
  let reading = false, release!: () => void, started!: () => void;
  const hold = new Promise<void>((resolve) => {
      release = resolve;
    }),
    arrived = new Promise<void>((resolve) => {
      started = resolve;
    });
  const entity = {
    id: `app:${materials.id}:returned`,
    source: "app",
    external_id: "returned",
    source_label: "앱",
    deleted_at: null,
    entity_type_id: materials.id,
    type: materials,
    schema_version: 1,
    current_schema_version: 1,
    properties: { prop_1: "복귀 자료" },
    display_properties: { prop_1: "복귀 자료" },
    title: "복귀 자료",
    tag_ids: [],
    version: 1,
    created_at: "2026-10-12T00:00:00Z",
    updated_at: "2026-10-12T00:00:00Z",
    tasks: { items: [], count: 0 },
    records: { items: [], count: 0 },
  };
  await page.route(
    `**/api/entities/${encodeURIComponent(entity.id)}{,?**}`,
    (route) => route.fulfill({ json: entity }),
  );
  await page.route("**/api/entity-types{,?**}", async (route) => {
    if (reading) {
      started();
      await hold;
    }
    return route.fulfill({ json: { items: [materials, products], next_cursor: null } });
  });
  try {
    const list = `/entities?entity_type_id=${materials.id}&keyword=복귀`;
    await page.goto(
      `/entities/${encodeURIComponent(entity.id)}?list=${encodeURIComponent(list)}`,
    );
    await expect(page.getByRole("dialog", { name: "재료", exact: true })).toBeVisible();
    reading = true;
    await closeDetail(page, entity.title);
    await arrived;
    await expect(page).toHaveURL(new RegExp(`entity_type_id=${materials.id}`));
    await expect(page.getByLabel("자료 종류", { exact: true })).toHaveValue(materials.label);
    await expect(page.getByRole("link", { name: "자료 설정", exact: true })).toHaveCount(0);
  } finally {
    release();
  }
});

test("definition history reads beyond the first hundred versions and opens the immutable oldest snapshot", async ({ page }) => {
  const cursors: (string | null)[] = [];
  const readVersions: number[] = [];
  await page.route(`**/api/entity-types/${materials.id}**`, (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/schema-changes") || url.pathname.endsWith("/identity")) return route.fallback();
    if (url.pathname.endsWith("/schemas")) {
      const before = url.searchParams.get("before");
      cursors.push(before);
      const versions = before ? [1] : Array.from({ length: 100 }, (_, n) => 101 - n);
      return route.fulfill({
        json: {
          items: versions.map((schema_version) => ({
            type_id: materials.id,
            schema_version,
            created_at: materials.created_at,
          })),
          next_before: before ? null : 2,
        },
      });
    }
    if (url.pathname.endsWith("/schema")) {
      const schema_version = Number(url.searchParams.get("schema_version") ?? 101);
      readVersions.push(schema_version);
      return route.fulfill({
        json: {
          type_id: materials.id,
          schema_version,
          created_at: materials.created_at,
          ...initialEntityDefinition(schema_version === 1 ? "최초 이름" : "현재 이름"),
        },
      });
    }
    return route.fulfill({ json: { ...materials, schema_version: 101 } });
  });
  await page.goto(`/settings/entity-types/${materials.id}/versions`);
  await expect(page.getByRole("button", { name: "이전 적용 버전 더 보기", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "이전 적용 버전 더 보기", exact: true }).click();
  const history = page.getByRole("region", { name: "변경 이력", exact: true });
  await expect(history.locator(".schema-history-row")).toHaveCount(101);
  const oldest = history.locator(".schema-history-row").filter({ hasText: "버전 1 · 적용됨" });
  await oldest.getByRole("button", { name: /^최초 생성/ }).click();
  await expect(page).toHaveURL(/schema_version=1/);
  const definition = oldest.getByRole("region", { name: "입력 항목 정의", exact: true });
  await expect(definition.getByRole("heading", { name: "최초 이름", exact: true })).toBeVisible();
  const field = definition.getByRole("region", { name: "최초 이름 정의", exact: true });
  await expect(field.locator("dl > div").filter({ has: page.getByText("자료 이름", { exact: true }) }).locator("dd"))
    .toHaveText("사용");
  await expect(definition.locator("input,select,textarea")).toHaveCount(0);
  await expect(oldest.getByRole("region", { name: "변경 결과", exact: true })).toContainText("버전 1 · 최초 생성");
  expect(readVersions).toContain(101);
  expect(readVersions).toContain(1);
  expect(readVersions).not.toContain(0);
  expect(cursors).toEqual([null, "2"]);
  await expect(page.getByRole("button", { name: "이전 적용 버전 더 보기", exact: true })).toHaveCount(0);
});

test("numeric schema bounds keep invalid raw decimals and reject before creating a change", async ({ page }) => {
  const definition = initialEntityDefinition("이름");
  definition.schema.properties.prop_2 = { "x-order": 20, type: "number", title: "정확한 수량" };

  let writes = 0;
  await page.route(
    `**/api/entity-types/${materials.id}/schema`,
    (route) =>
      route.fulfill({
        json: {
          ...definition,
          type: materials,
          type_id: materials.id,
          schema_version: 1,
          created_at: materials.created_at,
        },
      }),
  );
  await page.route(`**/api/entity-types/${materials.id}/schema-changes`, (route) => {
    if (route.request().method() !== "GET") writes++;
    return route.fulfill({ json: { items: [], next_before: null } });
  });
  await page.goto(`/settings/entity-types/${materials.id}`);
  await page.getByRole("button", { name: "입력 항목", exact: true }).click();
  await page.getByRole("button", { name: /^정확한 수량 항목 (?:펼치기|접기)$/, exact: true }).click();
  const section = page.getByRole("region", { name: "정확한 수량 입력 항목", exact: true });
  await section.getByText("추가 설정", { exact: true }).click();
  const input = section.getByLabel("최소값", { exact: true });
  await input.fill("1.0000000000000001");
  await page.getByRole("button", { name: "변경 검토", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("정밀도");
  await expect(input).toHaveValue("1.0000000000000001");
  expect(writes).toBe(0);
});

test("conversion literals preserve unsafe drafts and removed properties permit explicit removal", async ({ page }) => {
  const target = initialEntityDefinition("이름");
  target.schema.properties.prop_2 = { "x-order": 20, type: "number", title: "수량" };

  const changeId = "00000000-0000-4000-8000-000000000701";
  const plan = {
    id: changeId,
    type_id: materials.id,
    source_schema_version: 1,
    source_template_fingerprint: "fixture",
    version: 1,
    status: "draft",
    change_kind: "migration_required",
    edits: [],
    migration: { rules: [], overrides: [] },
    executable: false,
    reservations: {},
    target,
    fingerprint: "fixture",
    analysis: null,
    created_at: materials.created_at,
    updated_at: materials.updated_at,
    diff: [{
      path: "properties.prop_3",
      before: { "x-order": 40, type: "integer", title: "이전 수량" },
      after: null,
      before_present: true,
      after_present: false,
      kind: "migration_required",
      reason: "속성 제거",
      next_action: "명시 제거",
    }],
  };
  let writes = 0;
  await page.route(
    `**/api/entity-types/${materials.id}/schema-changes`,
    (route) => route.fulfill({ json: { items: [], next_before: null } }),
  );
  await page.route(`**/api/entity-types/${materials.id}/schema-changes/${changeId}`, (route) => {
    if (route.request().method() !== "GET") writes++;
    return route.fulfill({ json: plan });
  });
  await page.goto(`/settings/entity-types/${materials.id}?change_id=${changeId}`);
  const conversions = page.getByRole("region", { name: "변환 규칙과 영향 미리보기" });
  await conversions.getByLabel("이전 수량 변환 방식", { exact: true }).selectOption("remove");
  await expect(conversions.getByLabel("이전 수량 변환 방식", { exact: true })).toHaveValue("remove");
  const field = conversions.locator(".schema-field").filter({
    has: page.getByLabel("수량 변환 방식", { exact: true }),
  });
  await field.getByLabel("누락값 채우기", { exact: true }).check();
  const input = field.getByLabel("보완값", { exact: true });
  await input.fill("1.0000000000000001");
  await page.getByRole("button", { name: "보완 내용 검토", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("정밀도");
  await expect(input).toHaveValue("1.0000000000000001");
  expect(writes).toBe(0);
});

test("entity edit preserves draft and tags while identity settings are delayed before preparation", async ({ page }) => {
  let release!: () => void, arrived!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reading = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const entity = {
    id: `app:${materials.id}:ready`,
    source: "app",
    external_id: "ready",
    entity_type_id: materials.id,
    schema_version: 1,
    properties: { prop_1: "元の名前" },
    title: "元の名前",
    type: materials,
    source_label: "앱",
    current_schema_version: 1,
    display_properties: { prop_1: "元の名前" },
    tasks: { items: [], count: 0 },
    records: { items: [], count: 0 },
    version: 1,
    tag_ids: ["00000000-0000-4000-8000-000000000010"],
    deleted_at: null,
    created_at: materials.created_at,
    updated_at: materials.updated_at,
  };
  entityDetail.parse(entity);
  const preparations: Record<string, any>[] = [], writes: Record<string, any>[] = [];
  await page.route(
    `**/api/entities/${encodeURIComponent(`app:${materials.id}:ready`)}`,
    async (route) => {
      if (route.request().method() === "PATCH") {
        const input = route.request().postDataJSON();
        writes.push(input);
        return route.fulfill({
          json: { ...entity, properties: input.properties, title: input.properties.prop_1, version: 2 },
        });
      }
      return route.fulfill({ json: entity });
    },
  );
  await page.route("**/api/records/prepare", async (route) => {
    preparations.push(route.request().postDataJSON());
    await fulfillPreparation(route);
  });
  await page.route(
    "**/api/tags?**",
    (route) =>
      route.fulfill({
        json: {
          items: [{ id: "00000000-0000-4000-8000-000000000010", name: "保留タグ", scope: "entity", version: 1 }],
          next_cursor: null,
        },
      }),
  );
  await page.route(
    `**/api/entity-types/${materials.id}/identity`,
    async (route) => {
      arrived();
      await held;
      return route.fallback();
    },
  );
  try {
    await page.goto(`/entities/${encodeURIComponent(entity.id)}`);
    await page.getByRole("button", { name: "편집", exact: true }).click();
    const form = page.getByRole("dialog", { name: "재료 편집", exact: true });
    await reading;
    const name = form.getByRole("textbox", { name: "이름 (필수)", exact: true });
    await name.fill("保持する下書き");
    await expect(form.getByRole("button", { name: "保留タグ 선택 해제", exact: true })).toHaveCount(1);
    await expect(form.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    await expect(form.getByRole("status").filter({ hasText: "자료 종류·자료 번호 설정을 읽는 중…" })).toBeVisible();
    await name.press("Enter");
    expect(preparations).toEqual([]);
    expect(writes).toEqual([]);
    release();
    await expect(form.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
    await expect(name).toHaveValue("保持する下書き");
    await expect(form.getByRole("button", { name: "保留タグ 선택 해제", exact: true })).toHaveCount(1);
    await form.getByRole("button", { name: "저장", exact: true }).click();
    const confirmation = executionDialog(page);
    await expect(confirmation.getByRole("button", { name: "수정하고 저장", exact: true })).toBeEnabled();
    expect(preparations).toHaveLength(1);
    expect(preparations[0]).toMatchObject({
      model: "entity",
      action: "update",
      target_id: entity.id,
      expected_version: 1,
      input: {
        schema_version: 1,
        properties: { prop_1: "保持する下書き" },
        tag_ids: ["00000000-0000-4000-8000-000000000010"],
      },
    });
    await confirmation.getByRole("button", { name: "수정하고 저장", exact: true }).click();
    await expect(form).not.toBeVisible();
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      expected_version: 1,
      schema_version: 1,
      properties: { prop_1: "保持する下書き" },
      tag_ids: ["00000000-0000-4000-8000-000000000010"],
    });
  } finally {
    release();
  }
});

test("immutable entity edit exposes identity catalog read failure and preserves the draft", async ({ page }) => {
  const entity = {
    id: `app:${materials.id}:failed-read`,
    source: "app",
    external_id: "failed-read",
    entity_type_id: materials.id,
    schema_version: 1,
    properties: { prop_1: "元の名前" },
    title: "元の名前",
    type: materials,
    version: 1,
    tag_ids: [],
    deleted_at: null,
    source_label: "앱",
    current_schema_version: 1,
    display_properties: { prop_1: "元の名前" },
    tasks: { items: [], count: 0 },
    records: { items: [], count: 0 },
    created_at: materials.created_at,
    updated_at: materials.updated_at,
  };
  entityDetail.parse(entity);
  let editing = false, preparations = 0;
  await page.route(
    `**/api/entity-types/${materials.id}/identity`,
    (route) => route.fulfill({ json: fixtureIdentity(materials.id) }),
  );
  await page.route(
    `**/api/entities/${encodeURIComponent(`app:${materials.id}:failed-read`)}`,
    (route) => route.fulfill({ json: entity }),
  );
  await page.route("**/api/records/prepare", async (route) => {
    preparations++;
    await fulfillPreparation(route);
  });
  await page.route(
    "**/api/entity-types{,?**}",
    (route) =>
      editing
        ? route.fulfill({ status: 500, json: { code: "internal", message: "catalog unavailable", retryable: true } })
        : route.fallback(),
  );
  await page.goto(`/entities/${encodeURIComponent(entity.id)}`);
  editing = true;
  await page.getByRole("button", { name: "편집", exact: true }).click();
  const form = page.getByRole("dialog", { name: "재료 편집", exact: true });
  await form.getByLabel("이름", { exact: false }).fill("保留する名前");
  await expect(form.getByRole("alert").filter({ hasText: "자료 종류를 읽지 못했습니다." })).toBeVisible();
  await expect(form.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
  await expect(form.getByRole("status").filter({ hasText: "자료 종류·자료 번호 설정을 읽는 중…" })).toHaveCount(0);
  await expect(form.getByLabel("이름", { exact: false })).toHaveValue("保留する名前");
  await expect(form.getByRole("button", { name: "취소", exact: true })).toBeEnabled();
  expect(preparations).toBe(0);
  editing = false;
  await form.getByRole("button", { name: "자료 종류 다시 조회", exact: true }).click();
  await expect(form.getByRole("alert").filter({ hasText: "자료 종류를 읽지 못했습니다." })).toHaveCount(0);
  await expect(form.getByRole("button", { name: "저장", exact: true })).toBeEnabled();
  await expect(form.getByLabel("이름", { exact: false })).toHaveValue("保留する名前");
});

test("materials workspace keeps basic drafts while history opens and guards type selection", async ({ page }) => {
  await page.route(
    `**/api/entity-types/${materials.id}/schemas`,
    (route) => route.fulfill({ json: { items: [], next_before: null } }),
  );
  await page.goto(`/settings/entity-types/${materials.id}`);
  await expect(page.getByRole("heading", { name: "자료 설정", level: 1 })).toBeVisible();
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toBeHidden();
  await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
  await page.getByLabel("자료 종류 이름", { exact: true }).fill("편집 중 재료");
  await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
  await expect(page.getByRole("button", { name: /^기본 정보(?! 저장)/ })).toContainText("미저장");
  await page.getByRole("button", { name: /^변경 이력/ }).click();
  await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?" })).toHaveCount(0);
  await page.getByLabel("자료 종류 선택", { exact: true }).selectOption(products.id);
  const confirmation = page.getByRole("alertdialog", { name: "변경을 버릴까요?" });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByLabel("자료 종류 선택", { exact: true })).toHaveValue(materials.id);
  await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue("편집 중 재료");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("form", { name: "기본 정보", exact: true }).getByRole("button", {
    name: "변경 취소",
    exact: true,
  }).click();
  await page.getByLabel("자료 종류 선택", { exact: true }).selectOption(products.id);
  await expect(page.getByLabel("자료 종류 선택", { exact: true })).toHaveValue(products.id);
  await expect(page.getByLabel("자료 종류 선택", { exact: true })).toBeFocused();
});

test("history selection preserves basic drafts and survives reload", async ({ page }) => {
  await page.route(
    `**/api/entity-types/${materials.id}/schemas`,
    (route) =>
      route.fulfill({
        json: {
          items: [{ type_id: materials.id, schema_version: 1, created_at: materials.created_at }],
          next_before: null,
        },
      }),
  );
  await page.goto(`/settings/entity-types/${materials.id}/versions`);
  await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
  await page.getByLabel("자료 종류 이름", { exact: true }).fill("유지할 기본 정보");
  await page.getByRole("button", { name: /^최초 생성.*버전 1 · 적용됨$/ }).click();
  await expect(page).toHaveURL(/schema_version=1/);
  await expect(page.getByLabel("자료 종류 이름", { exact: true })).toHaveValue("유지할 기본 정보");
  page.on("dialog", (dialog) => dialog.accept());
  await page.reload();
  const first = page.locator(".schema-history-row").filter({ has: page.getByRole("button", { name: /^최초 생성/ }) });
  await expect(first.getByRole("region", { name: "입력 항목 정의", exact: true })).toBeVisible();
  await expect(first.getByRole("region", { name: "변경 결과", exact: true })).toContainText("버전 1 · 최초 생성");
});

test(
  "first type creation selects its workspace and independent basics save archives and restores",
  async ({ page }, info) => {
    let saved = type(4, "첫 자료");
    let exists = false;
    const writes: any[] = [];
    await page.route("**/api/entity-types{,?**}", (route) => {
      if (route.request().method() === "POST") {
        exists = true;
        writes.push(route.request().postDataJSON());
        return route.fulfill({ json: saved });
      }
      return route.fulfill({ json: { items: exists ? [saved] : [], next_cursor: null } });
    });
    await page.route(`**/api/entity-types/${saved.id}**`, (route) => {
      if (new URL(route.request().url()).pathname.endsWith("/identity")) {
        return route.fulfill({
          json: fixtureIdentity(
            decodeURIComponent(
              new URL(route.request().url()).pathname.split("/").at(-2)!,
            ),
          ),
        });
      }
      const url = new URL(route.request().url());
      if (route.request().method() === "PATCH") {
        const input = route.request().postDataJSON();
        writes.push(input);
        saved = { ...saved, ...input, schema_version: saved.schema_version + 1 };
        return route.fulfill({ json: saved });
      }
      if (url.pathname.endsWith("/schema")) {
        return route.fulfill({ json: { type_id: saved.id, schema_version: 1, ...initialEntityDefinition("제목") } });
      }
      if (url.pathname.endsWith("/schemas") || url.pathname.endsWith("/schema-changes")) {
        return route.fulfill({ json: { items: [], next_before: null } });
      }
      return route.fulfill({ json: saved });
    });
    await page.goto("/settings/materials");
    await expect(page.getByRole("form", { name: "자료 종류 만들기", exact: true })).toBeVisible();
    await expect(page.getByLabel("자료 종류 선택", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "종류 추가", exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("first-type.png"), fullPage: true });
    await page.getByLabel("자료 종류 이름", { exact: true }).fill("첫 자료");
    await page.getByLabel("대표 입력 항목 이름", { exact: true }).fill("제목");
    await page.getByRole("button", { name: "자료 종류 만들기", exact: true }).click();
    await expect(page.getByLabel("자료 종류 선택", { exact: true })).toHaveValue(saved.id);
    await expect(page.getByLabel("자료 종류 선택", { exact: true })).toBeFocused();
    await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?" })).toHaveCount(0);
    await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
    await page.getByLabel("자료 종류 보관 (기존 자료와 연결은 유지)").check();
    await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
    await expect(page.getByLabel("자료 종류 선택", { exact: true }).locator("option:checked")).toHaveText(
      "첫 자료 (보관)",
    );
    await page.getByLabel("자료 종류 보관 (기존 자료와 연결은 유지)").uncheck();
    await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
    await expect(page.getByLabel("자료 종류 선택", { exact: true }).locator("option:checked")).toHaveText("첫 자료");
    expect(writes).toMatchObject([{ label: "첫 자료", representative_label: "제목" }, {
      archived: true,
    }, { archived: false }]);
  },
);

for (const existing of [materials, retired]) {
  test(
    `type creation returns to ${existing.archived ? "archived" : "active"} kinds without duplicating add actions`,
    async ({ page }, info) => {
      await page.route(
        "**/api/entity-types{,?**}",
        (route) => route.fulfill({ json: { items: [existing], next_cursor: null } }),
      );
      await page.goto(`/settings/entity-types/${existing.id}`);
      const selector = page.getByLabel("자료 종류 선택", { exact: true });
      await expect(selector.locator("option")).toHaveText([`${existing.label}${existing.archived ? " (보관)" : ""}`]);
      await page.getByRole("link", { name: "종류 추가", exact: true }).click();
      const name = page.getByLabel("자료 종류 이름", { exact: true });
      await expect(name).toBeFocused();
      await expect(selector).toHaveValue("");
      await expect(selector.locator("option")).toHaveText([
        "기존 종류 선택",
        `${existing.label}${existing.archived ? " (보관)" : ""}`,
      ]);
      await expect(selector.locator('option[value=""]')).toBeDisabled();
      await expect(page.getByRole("link", { name: "종류 추가", exact: true })).toHaveCount(0);
      await name.fill("저장하지 않은 새 종류");
      await selector.selectOption(existing.id);
      const confirm = page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true });
      await confirm.getByRole("button", { name: "취소", exact: true }).click();
      await expect(name).toHaveValue("저장하지 않은 새 종류");
      await expect(selector).toHaveValue("");
      await page.screenshot({ path: info.outputPath("create-with-existing-type.png"), fullPage: true });
      await selector.selectOption(existing.id);
      await confirm.getByRole("button", { name: "변경 버리기", exact: true }).click();
      await expect(selector).toHaveValue(existing.id);
      await expect(selector).toBeFocused();
      await expect(page.getByRole("link", { name: "종류 추가", exact: true })).toBeVisible();
      await expect(page.getByRole("form", { name: "자료 종류 만들기", exact: true })).toHaveCount(0);
    },
  );
}

test("basic conflict and uncertain responses retain input and retry the exact request", async ({ page }) => {
  const attempts: { key: string; body: unknown }[] = [];
  await page.route(`**/api/entity-types/${materials.id}`, (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    attempts.push({ key: route.request().headers()["idempotency-key"], body: route.request().postDataJSON() });
    if (attempts.length === 1) {
      return route.fulfill({
        status: 409,
        json: { code: "schema_changed", message: "다른 변경이 저장되었습니다.", current: { schema_version: 1 } },
      });
    }
    if (attempts.length === 2) return route.abort();
    return route.fulfill({ json: { ...materials, label: "남길 입력", schema_version: 2 } });
  });
  await page.goto(`/settings/entity-types/${materials.id}`);
  await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
  const input = page.getByLabel("자료 종류 이름", { exact: true });
  await input.fill("남길 입력");
  await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("다른 변경이 저장되었습니다.");
  await expect(input).toHaveValue("남길 입력");
  await page.getByRole("button", { name: "최신 기본 정보 확인", exact: true }).click();
  await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("저장 여부를 알 수 없습니다.");
  await expect(input).toBeDisabled();
  await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
  await expect(page.getByRole("button", { name: /^기본 정보(?! 저장)/ })).toContainText("결과 확인 필요");
  await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
  await page.getByRole("button", { name: "같은 요청 다시 확인", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "자료 종류를 저장했습니다." })).toBeVisible();
  expect(attempts[1]).toEqual(attempts[2]);
  expect(attempts[0].key).not.toBe(attempts[1].key);
});

test("basic save preserves property edits and unfiltered archived selection at enlarged scale", async ({ page }) => {
  await page.route(
    `**/api/entity-types/${materials.id}`,
    (route) =>
      route.request().method() === "PATCH"
        ? route.fulfill({ json: { ...materials, label: "新しい基本情報", schema_version: 2 } })
        : route.fallback(),
  );
  await page.goto(`/settings/entity-types/${materials.id}`);
  await page.getByRole("button", { name: "입력 항목", exact: true }).click();
  await page.getByRole("button", { name: /^이름 항목 (?:펼치기|접기)$/, exact: true }).click();
  await page.getByLabel("항목 이름", { exact: true }).fill("保留する属性");
  await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
  await page.getByLabel("자료 종류 이름", { exact: true }).fill("新しい基本情報");
  await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "자료 종류를 저장했습니다." })).toBeVisible();
  await expect(page.getByLabel("항목 이름", { exact: true })).toHaveValue("保留する属性");
  await expect(page.getByLabel("자료 종류 검색", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("자료 종류 선택", { exact: true }).locator("option")).toContainText([
    "재료",
    "상품",
    "보관 자료 (보관)",
  ]);
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  const toggle = page.getByRole("button", { name: /^기본 정보(?! 저장)/ });
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("lost creation response replays one result and selects its workspace", async ({ page }) => {
  const saved = type(4, "응답 유실 자료");
  const attempts: { key: string; body: unknown }[] = [];
  const created = new Map<string, EntityType>();
  await page.route("**/api/entity-types{,?**}", (route) => {
    if (route.request().method() !== "POST") {
      return route.fulfill({ json: { items: [...created.values()], next_cursor: null } });
    }
    const key = route.request().headers()["idempotency-key"];
    attempts.push({ key, body: route.request().postDataJSON() });
    if (!created.has(key)) created.set(key, saved);
    if (attempts.length === 1) return route.abort();
    return route.fulfill({ json: created.get(key) });
  });
  await page.route(`**/api/entity-types/${saved.id}**`, (route) => {
    if (new URL(route.request().url()).pathname.endsWith("/identity")) {
      return route.fulfill({
        json: fixtureIdentity(
          decodeURIComponent(
            new URL(route.request().url()).pathname.split("/").at(-2)!,
          ),
        ),
      });
    }
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/schema")) {
      return route.fulfill({ json: { type_id: saved.id, schema_version: 1, ...initialEntityDefinition("제목") } });
    }
    if (url.pathname.endsWith("/schemas") || url.pathname.endsWith("/schema-changes")) {
      return route.fulfill({ json: { items: [], next_before: null } });
    }
    return route.fulfill({ json: saved });
  });
  await page.goto("/settings/entity-types");
  const name = page.getByLabel("자료 종류 이름", { exact: true });
  await name.fill("응답 유실 자료");
  await page.getByLabel("대표 입력 항목 이름", { exact: true }).fill("제목");
  await page.getByRole("button", { name: "자료 종류 만들기", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("저장 여부를 알 수 없습니다.");
  await expect(name).toHaveValue("응답 유실 자료");
  await expect(name).toBeDisabled();
  await page.getByRole("button", { name: "같은 요청 다시 확인", exact: true }).click();
  await expect(page.getByLabel("자료 종류 선택", { exact: true })).toHaveValue(saved.id);
  await expect(page).toHaveURL(new RegExp(`/settings/entity-types/${saved.id}$`));
  await expect(page.getByLabel("자료 종류 선택", { exact: true })).toBeFocused();
  await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
  await expect(page.getByRole("button", { name: "기본 정보 저장", exact: true })).toBeVisible();
  expect(attempts).toHaveLength(2);
  expect(attempts[0]).toEqual(attempts[1]);
  expect(created.size).toBe(1);
});

test("basic conflict refresh preserves section drafts and reapplies against the latest version", async ({ page }) => {
  let latest = { ...materials };
  const writes: { key: string; body: any }[] = [];
  await page.route(
    "**/api/settings/business**",
    (route) =>
      route.fulfill({
        json: {
          settings: { record_templates: {} },
          versions: { record_templates: 1 },
        },
      }),
  );
  await page.route(`**/api/entity-types/${materials.id}/schema`, (route) => {
    return route.fulfill({ json: { type_id: materials.id, schema_version: 1, ...initialEntityDefinition("이름") } });
  });
  await page.route(`**/api/entity-types/${materials.id}`, (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: latest });
    const body = route.request().postDataJSON();
    writes.push({ key: route.request().headers()["idempotency-key"], body });
    if (writes.length === 1) {
      latest = { ...materials, label: "다른 화면 저장값", icon_id: "book", archived: true, schema_version: 2 };
      return route.fulfill({
        status: 409,
        json: { code: "schema_changed", message: "다른 변경이 저장되었습니다.", current: { schema_version: 1 } },
      });
    }
    latest = { ...latest, ...body, schema_version: 3 };
    return route.fulfill({ json: latest });
  });
  await page.goto(`/settings/entity-types/${materials.id}`);
  await page.getByRole("button", { name: "입력 항목", exact: true }).click();
  await page.getByRole("button", { name: /^이름 항목 (?:펼치기|접기)$/, exact: true }).click();
  await page.getByLabel("항목 이름", { exact: true }).fill("남길 속성 초안");
  await page.getByRole("button", { name: /^자료 번호/ }).click();
  const record = page.getByRole("form", { name: "자료 번호 설정", exact: true });
  await record.getByLabel("이름", { exact: false }).fill("남길 자료 번호 초안");
  await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
  const name = page.getByLabel("자료 종류 이름", { exact: true });
  await name.fill("내 기본 정보 초안");
  await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "다른 변경이 저장되었습니다." })).toBeVisible();
  await page.getByRole("button", { name: "최신 기본 정보 확인", exact: true }).click();
  await expect(page.getByText(/최신 저장값: 다른 화면 저장값/)).toBeVisible();
  await expect(name).toHaveValue("내 기본 정보 초안");
  await expect(page.getByRole("radio", { name: "책", exact: true })).toBeChecked();
  await expect(page.getByLabel("자료 종류 보관 (기존 자료와 연결은 유지)")).toBeChecked();
  await expect(page.getByLabel("항목 이름", { exact: true })).toHaveValue("남길 속성 초안");
  await expect(record.getByLabel("이름", { exact: false })).toHaveValue(
    "남길 자료 번호 초안",
  );
  await page.getByRole("form", { name: "기본 정보", exact: true }).getByRole("button", {
    name: "변경 취소",
    exact: true,
  }).click();
  await expect(name).toHaveValue("다른 화면 저장값");
  await expect(page.getByLabel("항목 이름", { exact: true })).toHaveValue("남길 속성 초안");
  await expect(record.getByLabel("이름", { exact: false })).toHaveValue(
    "남길 자료 번호 초안",
  );
  await name.fill("내 기본 정보 초안");
  await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "자료 종류를 저장했습니다." })).toBeVisible();
  expect(writes[1].body).toMatchObject({ label: "내 기본 정보 초안", icon_id: "book", archived: true });
  expect(writes[1].key).not.toBe(writes[0].key);
  await name.fill("취소할 입력");
  await page.getByRole("form", { name: "기본 정보", exact: true }).getByRole("button", {
    name: "변경 취소",
    exact: true,
  }).click();
  await expect(name).toHaveValue("내 기본 정보 초안");
  await expect(page.getByLabel("항목 이름", { exact: true })).toHaveValue("남길 속성 초안");
  await expect(record.getByLabel("이름", { exact: false })).toHaveValue(
    "남길 자료 번호 초안",
  );
});

for (const width of [320, 390]) {
  test(`mobile-header ${width}px: page titles use the available width across application routes`, async ({ page }) => {
    await page.route(
      "**/api/status",
      (route) => route.fulfill({ status: 503, json: { error: { code: "unavailable", message: "헤더 검사용 응답" } } }),
    );
    await page.setViewportSize({ width, height: 900 });
    for (
      const path of [
        "/entities",
        "/tasks",
        "/records",
        "/settings",
        "/settings/entity-types",
        "/settings/tags",
        "/settings/records",
        "/settings/issuers",
        "/status",
        "/search",
        "/guide",
      ]
    ) {
      await page.goto(path);
      const title = page.locator(".page-title").first();
      await expect(title, path).toBeVisible();
      const description = page.locator(".page-heading > .page-description");
      await expect(description, path).toHaveCount(1);
      await expect(description, path).toBeVisible();
      await expect(description, path).toHaveCSS("font-size", "13px");
      expect((await description.innerText()).trim().length, path).toBeGreaterThan(10);
      expect((await description.boundingBox())!.y, path).toBeGreaterThanOrEqual(
        (await title.boundingBox())!.y + (await title.boundingBox())!.height,
      );
      expect((await title.boundingBox())!.height, path).toBeLessThanOrEqual(44);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), path).toBe(true);
    }
  });
}

for (const width of [320, 1440]) {
  test(`status design ${width}px: errors, disclosure and pagination use shared controls`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let failStatus = true, failIssues = true;
    const data = {
      timezone: "Asia/Seoul",
      queried_at: "2026-10-15T00:00:00Z",
      period: { from: "2026-10-15", to: "2026-10-15", days: 1 },
      entities: { total: 0, active: 0, deleted: 0 },
      tasks: { total: 0, open: 0, done: 0, active: 0, stopped: 0 },
      records: { total: 1, user: 1, result: 0, change: 0 },
      indexing: {
        total: 1,
        indexed: 0,
        preparing: 0,
        attention: 1,
        excluded: 0,
        waiting: { long_waiting: 0, oldest_waiting_since: null, threshold_minutes: 5 },
      },
      daily: [],
    };
    await page.route(
      "**/api/status",
      (route) =>
        route.fulfill(
          failStatus ? { status: 503, json: { error: { code: "unavailable", message: "조회 실패" } } } : { json: data },
        ),
    );
    await page.route(
      "**/api/status/indexing/issues**",
      (route) =>
        route.fulfill(
          failIssues ? { status: 503, json: { error: { code: "unavailable", message: "조회 실패" } } } : {
            json: {
              items: [{
                id: "issue",
                created_at: "2026-10-15T00:00:00Z",
                title: "긴 제목 ".repeat(15),
                reason: "provider_unknown",
                attempts: 1,
                chunks: { total: 1, succeeded: 0, preparing: 0, unknown: 1, failed: 0 },
              }],
              next_cursor: null,
            },
          },
        ),
    );
    await page.goto("/status");
    await expect(page.getByRole("alert")).toHaveClass(/notice-error/);
    failStatus = false;
    await page.getByRole("button", { name: "새로고침", exact: true }).click();
    await page.getByRole("button", { name: /^색인 문제/ }).click();
    await expect(page.getByRole("alert")).toHaveClass(/notice-error/);
    failIssues = false;
    await page.getByRole("button", { name: "다시 시도", exact: true }).click();
    const summary = page.locator(".status-issue-list summary");
    await expect(summary).toBeVisible();
    await summary.press("Enter");
    await expect(page.getByText("현재 구간 전송 시도 1회", { exact: false })).toBeVisible();
    const marker = await summary.evaluate((el) => ({
      column: getComputedStyle(el, "::after").gridColumnStart,
      list: getComputedStyle(el).listStyleType,
    }));
    expect(marker).toEqual({ column: "2", list: "none" });
    const next = page.getByRole("button", { name: "다음", exact: true });
    await expect(next).toBeDisabled();
    expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(next.locator(".body-action-face")).toHaveCSS("font-size", "13px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
