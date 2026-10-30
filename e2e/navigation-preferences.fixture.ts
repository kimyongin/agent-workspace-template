import { closeMainNavigation } from "./ui-actions.ts";
import { openMainNavigation } from "./ui-actions.ts";
import { fulfillFixtureWorkspace } from "./support/workspace-scope.ts";
import { fixtureWorkspacePath } from "./support/workspace-scope.ts";
import { businessRows } from "./table-actions.ts";
import { chooseSetting } from "./settings-actions.ts";
import { initialEntityDefinition } from "../supabase/functions/_shared/contracts/entity-type.ts";
import { expect, type Page, test } from "@playwright/test";
import { fulfillPreparation } from "./support/preparation-api.ts";
const material = {
  id: "00000000-0000-4000-8000-000000000001",
  label: "재료",
  icon_id: "leaf",
  archived: false,
  schema_version: 1,
  next_property_number: 2,
  created_at: "2026-10-01T00:00:00Z",
  updated_at: "2026-10-01T00:00:00Z",
};
const product = {
  ...material,
  id: "00000000-0000-4000-8000-000000000002",
  label: "상품",
  created_at: "2026-10-02T00:00:00Z",
};
const account = {
  id: "00000000-0000-0000-0000-000000000001",
  aud: "authenticated",
  email: "fixture@example.test",
  app_metadata: {},
  user_metadata: { full_name: "Fixture", workspace_nickname: "보존할 이름", provider_value: "preserved" },
};
function schemaResult(type: typeof material) {
  const { schema } = initialEntityDefinition("이름", { id: type.id, title: type.label, icon: type.icon_id });
  return {
    type,
    type_id: type.id,
    schema_version: type.schema_version,
    schema: { ...schema, "x-version": type.schema_version, deprecated: type.archived },
  };
}
async function fixture(page: Page, baseURL: string, initial: unknown = null) {
  let metadata: Record<string, unknown> = { ...account.user_metadata, workspace_navigation: initial };
  let types = [material, product], fail = false;
  const writes: Record<string, unknown>[] = [];
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (await fulfillFixtureWorkspace(route, [{ target_kind: "settings", target_id: "*", access: "write" }, { target_kind: "tasks", target_id: "*", access: "write" }, ...[material, product].map(type => ({ target_kind: "entity_type" as const, target_id: type.id, access: "write" as const }))])) return;
    if (url.origin === new URL(baseURL).origin) return route.continue();
    if (url.pathname === "/auth/v1/user") {
      if (route.request().method() === "PUT") {
        const data = route.request().postDataJSON().data;
        writes.push(data);
        if (fail) return route.fulfill({ status: 500, json: { msg: "fixture failure" } });
        metadata = { ...metadata, ...data };
      }
      return route.fulfill({ json: { ...account, user_metadata: metadata } });
    }
    if (url.pathname === "/api/entity-types") {
      const offset = Number(url.searchParams.get("cursor") ?? 0);
      return route.fulfill({
        json: {
          items: types.slice(offset, offset + 6),
          next_cursor: offset + 6 < types.length ? String(offset + 6) : null,
        },
      });
    }
    const selected = types.find((type) => url.pathname.startsWith(`/api/entity-types/${type.id}`));
    if (selected) return route.fulfill({ json: url.pathname.endsWith("/schema") ? schemaResult(selected) : selected });
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
    { ...account, user_metadata: metadata },
  );
  return {
    writes,
    metadata: () => metadata,
    setMetadata: (next: unknown) => {
      metadata = { ...metadata, workspace_navigation: next };
    },
    setTypes: (next: typeof types) => {
      types = next;
    },
    fail: () => {
      fail = true;
    },
  };
}
const ref = (id: string) => ({ kind: "builtin", id });
const nav = (page: Page) => page.getByRole("navigation", { name: "주 메뉴", exact: true });
async function openNavigation(page: Page) {
  const trigger = page.getByRole("button", { name: "주 메뉴 열기", exact: true });
  if (await trigger.isVisible() && !await nav(page).isVisible()) await trigger.click();
  await expect(nav(page)).toBeVisible();
}
async function closeNavigation(page: Page) {
  const close = page.getByRole("button", { name: "메뉴 닫기", exact: true });
  if (await close.isVisible()) {
    await close.click();
    await expect(page.getByRole("dialog", { name: "주 메뉴", exact: true })).toHaveCount(0);
  }
}
const shortcuts = (page: Page) => nav(page).locator('[data-slot="sidebar-group"]').filter({ has: page.getByText("바로가기", { exact: true }) }).getByRole("link");
async function expectShortcuts(page: Page, expected: string[] | number) {
  await openNavigation(page);
  if (typeof expected === "number") await expect(shortcuts(page)).toHaveCount(expected);
  else await expect(shortcuts(page)).toHaveText(expected);
  await closeNavigation(page);
}
async function expectWorkLink(page: Page, label: string) {
  await openNavigation(page); await expect(nav(page).getByRole("link", { name: label, exact: true })).toBeVisible(); await closeNavigation(page);
}

test("shortcut editing has its own section with compact rows, bounded selection and independent cancel", async ({ page, baseURL }, info) => {
  const state = await fixture(page, baseURL!);
  await page.goto(fixtureWorkspacePath("/settings/navigation"));
  await expect(page).toHaveURL(/\/settings#settings-navigation$/);
  const section = page.getByRole("region", { name: "메뉴 바로가기", exact: true });
  await expect(section.getByRole("table", { name: "선택한 바로가기", exact: true })).toBeVisible();
  const display = page.getByRole("region", { name: "화면 표시", exact: true });
  await expect(display.getByRole("form")).toHaveCount(1);
  await expect(display.getByRole("region", { name: "메뉴 바로가기" })).toHaveCount(0);
  await expect(section.getByRole("heading", { name: "메뉴 바로가기" })).toBeVisible();
  const select = section.getByRole("combobox", { name: "추가할 메뉴", exact: true });
  await expect(select).toBeDisabled();
  await expect(select.locator("..").getByRole("button")).toBeDisabled();
  await page.getByLabel("닉네임", { exact: true }).fill("보존할 초안");
  await section.getByRole("button", { name: "상품 숨기기", exact: true }).click();
  await expect(section.getByRole("button", { name: "할 일 숨기기", exact: true })).toBeFocused();
  await chooseSetting(page, select, "전체 자료");
  await expect(select).toHaveValue("");
  await expect(select).toBeDisabled();
  await expectShortcuts(page, ["재료", "할 일", "기록", "전체 자료"]);
  await section.getByRole("button", { name: "변경 취소", exact: true }).click();
  await expectShortcuts(page, ["재료", "상품", "할 일", "기록"]);
  await expect(page.getByLabel("닉네임", { exact: true })).toHaveValue("보존할 초안");
  expect(state.writes).toEqual([]);
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const button of await section.getByRole("button", { name: / (위로 이동|아래로 이동|숨기기)$/ }).all()) {
      const box = (await button.boundingBox())!;
      expect(box.width).toBeGreaterThanOrEqual(44);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
    expect((await select.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await expect(section.getByRole("button", { name: "메뉴 추가", exact: true })).toHaveCount(0);
  }
  await page.setViewportSize({ width: info.project.name === "mobile" ? 390 : 1440, height: 900 });
  await section.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("shortcut-settings.png") });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test("explicit empty configuration saves only navigation and survives reload; default can be restored", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!);
  await page.goto(fixtureWorkspacePath("/settings/navigation"));
  await expect(businessRows(page.getByRole("table", { name: "선택한 바로가기" }))).toHaveCount(4);
  for (const label of ["재료", "상품", "할 일", "기록"]) {
    await page.getByRole("button", { name: `${label} 숨기기`, exact: true }).click();
  }
  await expectShortcuts(page, 0);
  await page.getByRole("button", { name: "메뉴 바로가기 저장" }).click();
  await expect(page.getByRole("status")).toHaveText("메뉴 설정을 저장했습니다.");
  expect(state.writes).toEqual([{ workspace_navigation: { version: 1, refs: [] } }]);
  expect(state.metadata().workspace_nickname).toBe("보존할 이름");
  await page.reload();
  await expect(page.getByText("바로가기를 표시하지 않습니다.")).toBeVisible();
  await page.getByRole("button", { name: "기본 구성 사용", exact: true }).click();
  await expectShortcuts(page, 4);
  await page.getByRole("form", { name: "메뉴 바로가기 설정", exact: true }).getByRole("button", { name: "변경 취소", exact: true }).click();
  await expectShortcuts(page, 0);
  await page.getByRole("button", { name: "기본 구성 사용", exact: true }).click();
  await page.getByRole("button", { name: "메뉴 바로가기 저장" }).click();
  await expect(page.getByRole("status")).toHaveText("메뉴 설정을 저장했습니다.");
  expect(state.writes[1]).toEqual({ workspace_navigation: null });
});
test("keyboard reorder previews retained refs; failed save keeps draft and route guards work", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!, { version: 1, refs: [ref("tasks"), ref("records")] });
  await page.goto(fixtureWorkspacePath("/settings/navigation"));
  const move = page.getByRole("button", { name: "기록 위로 이동" });
  await move.focus();
  await page.keyboard.press("Enter");
  await expectShortcuts(page, ["기록", "할 일"]);
  state.fail();
  await page.getByRole("button", { name: "메뉴 바로가기 저장" }).click();
  await expect(page.getByRole("alert")).toContainText("선택한 메뉴를 유지");
  await openMainNavigation(page);
  await page.getByRole("navigation", { name: "주 메뉴", exact: true }).getByRole("link", { name: "자료 설정", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?" })).toBeVisible();
  await page.getByRole("button", { name: "취소", exact: true }).click();
  await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?" })).toHaveCount(0);
  await closeMainNavigation(page);
  await expect(page.getByRole("button", { name: "설정 메뉴", exact: true })).toHaveCount(0);
  await expectShortcuts(page, ["기록", "할 일"]);
  await page.getByRole("form", { name: "메뉴 바로가기 설정", exact: true }).getByRole("button", { name: "변경 취소", exact: true }).click();
  await expectShortcuts(page, ["할 일", "기록"]);
});
test("shortcut search retains its query while external metadata reports a draft conflict", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!, { version: 1, refs: [ref("tasks"), ref("records")] });
  await page.goto(fixtureWorkspacePath("/settings/navigation"));
  const section = page.getByRole("region", { name: "메뉴 바로가기", exact: true });
  await section.getByRole("button", { name: "기록 위로 이동", exact: true }).click();
  const control = section.getByRole("combobox", { name: "추가할 메뉴", exact: true });
  await chooseSetting(page, control, "재료");
  await control.fill("상품");
  await expect(page.getByRole("option", { name: "상품 · 초안에 추가", exact: true })).toBeVisible();
  state.setMetadata({ version: 1, refs: [ref("records")] });
  await page.evaluate(id => {
    const channel = new BroadcastChannel("workspace-decorative-profile");
    channel.postMessage(id);
    channel.close();
  }, account.id);
  await expect(section.getByRole("alert", { includeHidden: true })).toContainText("다른 탭");
  await expect(control).toHaveValue("상품");
  await page.getByRole("option", { name: "상품 · 초안에 추가", exact: true }).click();
  await expect(section.getByRole("table", { name: "선택한 바로가기" })).toContainText("상품");
  await expect(control).toHaveValue("");
  await expect(section.getByRole("alert")).toContainText("다른 탭");
  expect(state.writes).toEqual([]);
});

test("external tab metadata preserves dirty preview until conflict is reviewed", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!, { version: 1, refs: [ref("tasks"), ref("records")] });
  await page.goto(fixtureWorkspacePath("/settings/navigation"));
  await page.getByRole("button", { name: "기록 위로 이동" }).click();
  state.setMetadata({ version: 1, refs: [ref("records")] });
  await page.evaluate((id) => {
    const channel = new BroadcastChannel("workspace-decorative-profile");
    channel.postMessage(id);
    channel.close();
  }, account.id);
  await expect(page.getByRole("alert")).toContainText("다른 탭");
  await expectShortcuts(page, ["기록", "할 일"]);
  await expect(page.getByRole("button", { name: "메뉴 바로가기 저장" })).toBeDisabled();
  await page.getByRole("button", { name: "최신 설정 사용" }).click();
  await expectShortcuts(page, ["기록"]);
  expect(state.writes).toEqual([]);
});
test("unknown refs remain explicit and live rename archive restore do not rewrite preferences", async ({ page, baseURL }) => {
  const unknown = "00000000-0000-4000-8000-000000000099";
  const preference = {
    version: 1,
    refs: [{ kind: "type", id: material.id }, { kind: "type", id: unknown }, ref("tasks")],
  };
  const state = await fixture(page, baseURL!, preference);
  await page.goto(fixtureWorkspacePath("/settings/navigation"));
  await expect(page.getByText("사용할 수 없는 자료 종류 · 참조 유지")).toBeVisible();
  state.setTypes([{ ...material, label: "새 재료 이름", archived: true }, product]);
  await page.reload();
  await expect(businessRows(page.getByRole("table", { name: "선택한 바로가기" })).first()).toContainText("새 재료 이름 · 보관");
  await openNavigation(page); await expect(shortcuts(page).filter({ hasText: "새 재료 이름" })).toHaveCount(0); await closeNavigation(page);
  expect(state.metadata().workspace_navigation).toEqual(preference);
  expect(state.writes).toEqual([]);
  await expectWorkLink(page, "기록");
});
test("invalid navigation reads fallback without hidden writes and all profile destinations stay reachable at short 200% layout", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!, { version: 1, refs: [ref("logout")] });
  await page.goto(fixtureWorkspacePath("/settings/navigation"));
  await expectShortcuts(page, 4);
  await page.setViewportSize({ width: 320, height: 300 });
  await page.evaluate(() => document.documentElement.style.fontSize = "200%");
  await openNavigation(page);
  for (const label of ["전체 자료", "기록"]) {
    const link = nav(page).getByRole("link", { name: label, exact: true }); await link.scrollIntoViewIfNeeded(); await expect(link).toBeVisible();
  }
  await openMainNavigation(page);
  for (const label of ["설정", "로그아웃"]) {
    const link = page.getByRole("link", { name: label === "설정" ? "기본 설정" : label, exact: true }); await link.scrollIntoViewIfNeeded(); await expect(link).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.writes).toEqual([]);
});

test(
  "explicit priority survives temporary overflow, new catalog types, and IME search",
  async ({ page, baseURL }, info) => {
    const types = Array.from(
      { length: 12 },
      (_, index) => ({
        ...material,
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        label: index === 11 ? "아주긴자료종류이름".repeat(8) : `자료 ${index + 1}`,
      }),
    );
    const preference = {
      version: 1,
      refs: [{ kind: "type", id: types[11].id }, ref("tasks"), ref("records"), ref("entities")],
    };
    const state = await fixture(page, baseURL!, preference);
    state.setTypes(types);
    await page.goto(fixtureWorkspacePath("/settings/navigation"));
    await expect(businessRows(page.getByRole("table", { name: "선택한 바로가기" })).first()).toContainText(types[11].label);
    await page.setViewportSize({ width: 320, height: 300 });
    await page.evaluate(() => document.documentElement.style.fontSize = "200%");
    await expectShortcuts(page, [types[11].label, "할 일", "기록", "전체 자료"]);
    await expect(page.getByRole("combobox", { name: "추가할 메뉴", exact: true })).toBeDisabled();
    await page.getByRole("button", { name: "할 일 숨기기", exact: true }).click();
    await chooseSetting(page, page.getByRole("combobox", { name: "추가할 메뉴", exact: true }), "자료 10");
    await expect(page.getByRole("table", { name: "선택한 바로가기" })).toContainText("자료 10");
    await expect(page.getByRole("button", { name: "자료 10 숨기기", exact: true })).toBeFocused();
    await openNavigation(page);
    const search = page.getByLabel("자료 종류 검색", { exact: true });
    await search.dispatchEvent("compositionstart");
    await search.fill("자료 11");
    await search.dispatchEvent("compositionend");
    await expect(nav(page).getByRole("link", { name: "자료 11", exact: true }))
      .toBeVisible();
    expect(state.writes).toEqual([]);
    expect(state.metadata().workspace_navigation).toEqual(preference);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("navigation-preferences-short-200.png"), fullPage: true });
  },
);
test("navigation identifies current location when its shortcut is hidden", async ({ page, baseURL }) => {
  await fixture(page, baseURL!, { version: 1, refs: [ref("tasks")] }); await page.goto(fixtureWorkspacePath("/records"));
  await openNavigation(page); await expect(nav(page).getByRole("link", { name: "기록", exact: true })).toHaveAttribute("aria-current", "page");
});

test("pending save prevents duplicate submission and departure until authoritative GET", async ({ page, baseURL }) => {
  const state = await fixture(page, baseURL!, { version: 1, refs: [ref("tasks")] });
  await page.goto(fixtureWorkspacePath("/settings/navigation"));
  await chooseSetting(page, page.getByRole("combobox", { name: "추가할 메뉴", exact: true }), "기록");
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/auth/v1/user", async (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const data = route.request().postDataJSON().data;
    await held;
    state.setMetadata(data.workspace_navigation);
    return route.fulfill({ json: { ...account, user_metadata: state.metadata() } });
  });
  await page.getByRole("button", { name: "메뉴 바로가기 저장" }).click();
  await expect(page.getByRole("button", { name: "메뉴 바로가기 저장" })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "추가할 메뉴", exact: true })).toBeDisabled();
  await openMainNavigation(page);
  await page.getByRole("navigation", { name: "주 메뉴", exact: true }).getByRole("link", { name: "자료 설정", exact: true }).click();
  await expect(page).toHaveURL(/\/settings#settings-navigation$/);
  await expect(page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true })).toHaveCount(0);
  await closeMainNavigation(page);
  release();
  await expect(page.getByRole("status")).toHaveText("메뉴 설정을 저장했습니다.");
  await expect(page.getByRole("form", { name: "메뉴 바로가기 설정", exact: true }).getByRole("button", { name: "변경 취소", exact: true })).toBeDisabled();
});
test("late old account metadata cannot overwrite the new account navigation", async ({ page, baseURL }) => {
  await fixture(page, baseURL!, { version: 1, refs: [ref("tasks")] });
  const otherId = "00000000-0000-0000-0000-000000000002";
  const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const otherToken = `${encode({ alg: "HS256", typ: "JWT" })}.${
    encode({ exp: Math.floor(Date.now() / 1000) + 3600, sub: otherId })
  }.fixture`;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let first = true;
  await page.route("**/auth/v1/user", async (route) => {
    if (first) {
      first = false;
      await held;
      return route.fulfill({
        json: { ...account, user_metadata: { workspace_navigation: { version: 1, refs: [ref("records")] } } },
      });
    }
    return route.fulfill({
      json: {
        ...account,
        id: otherId,
        user_metadata: { workspace_navigation: { version: 1, refs: [ref("records")] } },
      },
    });
  });
  await page.goto(fixtureWorkspacePath("/tasks"));
  await openNavigation(page); await expect(nav(page).getByRole("group", { name: /^내 프로필(?: · .+)?$/, exact: true })).toBeVisible();
  await page.evaluate(async (access_token) => {
    const path = "/src/lib/supabase.ts";
    const { supabase } = await import(path);
    const { error } = await supabase.auth.setSession({ access_token, refresh_token: "other-refresh" });
    if (error) throw error;
  }, otherToken);
  await expectShortcuts(page, ["기록"]);
  release();
  await expectShortcuts(page, ["기록"]);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem("sb-127-auth-token")!).user.id)).toBe(otherId);
});

test("canonical type rename icon archive restore immediately refresh pinned navigation on the same route", async ({ page, baseURL }) => {
  const preference = { version: 1, refs: [{ kind: "type", id: material.id }, ref("tasks")] };
  const state = await fixture(page, baseURL!, preference);
  let current = { ...material };
  await page.route("**/api/entity-types/**", async (route) => {
    const url = new URL(route.request().url());
    if (route.request().method() === "PATCH") {
      const { label, icon_id, archived } = route.request().postDataJSON();
      expect(route.request().postDataJSON().expected_schema_version).toBe(current.schema_version);
      current = { ...current, label, icon_id, archived, schema_version: current.schema_version + 1 };
      state.setTypes([current, product]);
      return route.fulfill({ json: current });
    }
    return route.fulfill({
      json: url.pathname.endsWith("/schema")
        ? schemaResult(current)
        : (url.pathname.endsWith("/schemas") || url.pathname.endsWith("/schema-changes"))
        ? { items: [] }
        : current,
    });
  });
  await page.goto(fixtureWorkspacePath(`/settings/entity-types/${material.id}`));
  await page.getByRole("button", { name: /^기본 정보(?! 저장)/ }).click();
  const picker = page.getByRole("radiogroup", { name: "자료 종류 아이콘", exact: true });
  await expect(picker.getByRole("radio")).toHaveCount(6);
  await expect(picker.getByRole("radio", { name: "잎", exact: true })).toBeChecked();
  await expect(picker.locator("svg")).toHaveCount(6);
  await picker.getByRole("radio", { name: "잎", exact: true }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(picker.getByRole("radio", { name: "포장", exact: true })).toBeFocused();
  await page.keyboard.press("Space");
  await expect(picker.getByRole("radio", { name: "포장", exact: true })).toBeChecked();
  expect(await picker.getByRole("radio").evaluateAll((controls) => controls.every((control) => {
    const rect = control.getBoundingClientRect();
    return rect.width >= 44 && rect.height >= 44;
  }))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  await page.getByLabel("자료 종류 이름", { exact: true }).fill("새 재료");
  await page.getByRole("radio", { name: "별", exact: true }).check();
  await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
  await openNavigation(page); await expect(nav(page).getByRole("link", { name: "새 재료", exact: true }).locator("svg")).toHaveAttribute("data-icon", "star"); await closeNavigation(page);
  await page.getByLabel("자료 종류 보관 (기존 자료와 연결은 유지)", { exact: true }).check();
  await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
  await expectWorkLink(page, "새 재료 · 보관");
  await page.getByLabel("자료 종류 보관 (기존 자료와 연결은 유지)", { exact: true }).uncheck();
  await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
  await expectWorkLink(page, "새 재료");
  expect(state.writes).toEqual([]);
  expect(state.metadata().workspace_navigation).toEqual(preference);
});
test("owner catalog refresh cancels obsolete reads and ignores another account invalidation", async ({ page, baseURL }) => {
  const preference = { version: 1, refs: [{ kind: "type", id: material.id }] };
  const state = await fixture(page, baseURL!, preference);
  let reads = 0, release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/entity-types?*", async (route) => {
    reads++;
    if (reads === 1) {
      await held;
      return route.fulfill({ json: { items: [material], next_cursor: null } }).catch(() => {});
    }
    return route.fulfill({ json: { items: [{ ...material, label: "최신 재료" }], next_cursor: null } });
  });
  await page.goto(fixtureWorkspacePath("/tasks"));
  await expect.poll(() => reads).toBe(1);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("workspace-entity-type-catalog", { detail: "other-account" }))
  );
  expect(reads).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expectWorkLink(page, "최신 재료");
  release();
  await expectWorkLink(page, "최신 재료");
  expect(state.writes).toEqual([]);
  expect(state.metadata().workspace_navigation).toEqual(preference);
});

test(
  "기본 설정의 라벨과 값은 좁은 패널과 확대에서도 읽기 순서와 독립 초안을 유지한다",
  async ({ page, baseURL }, info) => {
    const state = await fixture(page, baseURL!);
    await page.goto("/settings");
    const nickname = page.getByLabel("닉네임", { exact: true });
    await nickname.fill("보존할 긴 프로필 이름");
    for (const width of [320, 640, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      for (const name of ["닉네임", "표시 시간대", "모바일 화면 배율", "데스크톱 화면 배율"]) {
        const input = page.getByLabel(name, { exact: true });
        const geometry = await input.evaluate((control) => {
          const labelledBy = control.getAttribute("aria-labelledby")?.split(/\s+/).filter(Boolean) ?? [];
          const label = labelledBy.length
            ? document.getElementById(labelledBy[0])
            : control instanceof HTMLInputElement || control instanceof HTMLSelectElement
              ? control.labels?.[0]
              : null;
          const field = control.closest('[data-slot="field"]');
          if (!label || !field) throw new Error("The setting must have an associated visible label inside its Field");
          if (!field.contains(label)) throw new Error("The setting label must belong to the same Field as its control");
          const key = label.getBoundingClientRect(), value = control.getBoundingClientRect(), bounds = field.getBoundingClientRect();
          return { keyBottom: key.bottom, valueTop: value.top, keyLeft: key.left, keyRight: key.right, valueLeft: value.left, valueRight: value.right, fieldLeft: bounds.left, fieldRight: bounds.right };
        });
        expect(geometry.keyBottom).toBeLessThanOrEqual(geometry.valueTop);
        for (const [left, right] of [[geometry.keyLeft, geometry.keyRight], [geometry.valueLeft, geometry.valueRight]]) {
          expect(left).toBeGreaterThanOrEqual(geometry.fieldLeft - 1);
          expect(right).toBeLessThanOrEqual(geometry.fieldRight + 1);
        }
      }
      await expect(nickname).toHaveValue("보존할 긴 프로필 이름");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: info.outputPath(`settings-pairs-${width}.png`), fullPage: true });
    }
    await page.getByRole("region", { name: "프로필", exact: true }).evaluate((panel) => {
      (panel as HTMLElement).style.maxWidth = "360px";
    });
    await page.screenshot({ path: info.outputPath("settings-pairs-narrow-parent.png"), fullPage: true });
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.evaluate(() => document.documentElement.style.fontSize = "200%");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(nickname).toHaveValue("보존할 긴 프로필 이름");
    await page.screenshot({ path: info.outputPath("settings-pairs-200.png"), fullPage: true });
    expect(state.writes).toEqual([]);
  },
);
