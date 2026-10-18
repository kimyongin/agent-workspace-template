import { expect, type Page, test } from "@playwright/test";
import { installWorkspaceApi } from "./support/workspace-api.ts";
import { fixtureSchema, fixtureType, id } from "./support/workspace-data.ts";
const space = id(981), actor = id(901);
async function setup(page: Page, initial: "none" | "read" | "write") {
  let access = initial;
  const reads: string[] = [], writes: string[] = [];
  const user = { id: actor, aud: "authenticated", email: "fixture@example.test", app_metadata: {}, user_metadata: {} };
  await page.addInitScript(
    (user) =>
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          user,
          access_token: "isolated-settings-fixture",
          refresh_token: "fixture-refresh",
          token_type: "bearer",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        }),
      ),
    user,
  );
  await page.route("**/auth/v1/user", (route) => route.fulfill({ json: user }));
  await installWorkspaceApi(page, "http://127.0.0.1:55633", { entities: [], tasks: [], records: [], tags: [] }, {
    workspaces: { [space]: { name: "공유 업무 공간", rows: { entities: [], tasks: [], records: [], tags: [] } } },
  });
  await page.route("http://127.0.0.1:55633/api/**", async (route) => {
    const request = route.request(), path = new URL(request.url()).pathname.replace(/^\/api/, "");
    if (request.method() !== "GET") {
      writes.push(path);
      return route.fulfill({ status: 403, json: { code: "forbidden", message: "읽기 전용" } });
    }
    reads.push(path);
    if (path === `/workspaces/${space}`) {
      return route.fulfill({
        json: {
          workspace: { id: space, name: "공유 업무 공간", deleted_at: null },
          membership_version: 1,
          can_manage: access === "write",
          grants: [{ target_kind: "settings", target_id: "*", access }],
        },
      });
    }
    if (path.endsWith("/schemas") || path.endsWith("/schema-changes") || path === "/entity-schema-migrations") {
      return route.fulfill({ json: { items: [], next_before: null, next_cursor: null } });
    }
    if (path === "/entity-issuers") {
      return route.fulfill({
        json: { items: [{ code: "store", label: "판매처", active: true, system: false, version: 1 }] },
      });
    }
    if (path === "/entity-issuers/store/rules") {
      return route.fulfill({
        json: {
          items: [{
            id: id(701),
            source: "store",
            label: "상품 번호",
            meaning: "판매처에 등록된 고유 상품 번호",
            active: true,
            generation: "direct",
            version: 1,
          }],
        },
      });
    }
    if (path === "/data-model/changes") {
      return route.fulfill({ json: { items: [], next_cursor: null } });
    }
    if (path === `/entity-types/${fixtureType.id}/schema`) return route.fulfill({ json: fixtureSchema });
    return route.fallback();
  });
  return {
    reads,
    writes,
    setAccess: (value: typeof access) => {
      access = value;
    },
  };
}

test(
  "settings read keeps definitions and model history readable while mutation controls are unavailable",
  async ({ page }, testInfo) => {
    const fixture = await setup(page, "read");
    await page.goto(`/w/${space}/settings/entity-types/${fixtureType.id}`);
    await expect(page.getByText("읽기 전용 설정", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "기본 정보", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "자료 종류 이름", exact: true })).toHaveValue("검사 자료");
    await expect(page.getByRole("textbox", { name: "자료 종류 이름", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "기본 정보 저장", exact: true })).toBeDisabled();
    await expect(page.getByRole("link", { name: "종류 추가", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "입력 항목", exact: true }).click();
    await expect(page.getByRole("region", { name: "입력 항목 정의", exact: true })).toBeVisible();
    await page.getByRole("main").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: testInfo.outputPath("settings-readonly-definition.png"), fullPage: true });
    await page.goto(`/w/${space}/settings/data-model`);
    await expect(page.getByText("저장한 설정 변경 내용이 없습니다.")).toBeVisible();
    await expect(page.getByRole("button", { name: "설정 내보내기", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "설정 파일 선택", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "변경 이력 새로 읽기", exact: true })).toBeEnabled();
    await page.getByRole("button", { name: "변경 이력 새로 읽기", exact: true }).click();
    await page.getByRole("main").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: testInfo.outputPath("settings-readonly-model.png"), fullPage: true });
    expect(fixture.writes).toEqual([]);
  },
);

test("settings none blocks settings readers but preserves personal preferences", async ({ page }) => {
  const fixture = await setup(page, "none");
  await page.goto(`/w/${space}/settings/data-model`);
  await expect(page.getByText("설정 조회 권한이 필요합니다", { exact: true })).toBeVisible();
  expect(fixture.reads).not.toContain("/data-model/changes");
  await page.goto(`/w/${space}/settings`);
  await expect(page.getByRole("heading", { name: "기본 설정", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "닉네임", exact: true })).toBeEnabled();
  expect(fixture.writes).toEqual([]);
});

test("permission refresh preserves the current draft and disables writes when settings becomes read only", async ({ page }) => {
  const fixture = await setup(page, "write");
  await page.goto(`/w/${space}/settings/entity-types/${fixtureType.id}`);
  await page.getByRole("button", { name: "기본 정보", exact: true }).click();
  const label = page.getByRole("textbox", { name: "자료 종류 이름", exact: true });
  await label.fill("보존할 초안");
  await expect(page.getByRole("button", { name: "기본 정보 저장", exact: true })).toBeEnabled();
  fixture.setAccess("read");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("읽기 전용 설정", { exact: true })).toBeVisible();
  await expect(label).toHaveValue("보존할 초안");
  await expect(label).toBeDisabled();
  await expect(page.getByRole("button", { name: "기본 정보 저장", exact: true })).toBeDisabled();
  expect(fixture.writes).toEqual([]);
});

test(
  "read-only record templates allow browsing saved actions without an editable memo surface",
  async ({ page }, testInfo) => {
    const fixture = await setup(page, "read");
    await page.goto(`/w/${space}/settings/records`);
    const memo = page.getByRole("textbox", { name: "메모 템플릿", exact: true });
    await expect(memo).toHaveAttribute("contenteditable", "false");
    await expect(memo).toHaveAttribute("aria-readonly", "true");
    await expect(page.getByRole("combobox", { name: "액션", exact: true })).toBeEnabled();
    await page.getByRole("combobox", { name: "액션", exact: true }).click();
    await page.getByRole("option", { name: "수정", exact: true }).click();
    await expect(memo).toHaveAttribute("contenteditable", "false");
    await page.getByRole("main").evaluate((element) => {
      element.scrollTop = 0;
    });
    await page.screenshot({ path: testInfo.outputPath("settings-readonly-template.png"), fullPage: true });
    expect(fixture.writes).toEqual([]);
  },
);

test(
  "read-only settings expose saved identifier rule meaning without editable registry fields",
  async ({ page }, testInfo) => {
    const fixture = await setup(page, "read");
    await page.goto(`/w/${space}/settings/issuers`);
    await page.getByRole("button", { name: "판매처", exact: true }).click();
    await page.getByRole("button", { name: "상품 번호 보기", exact: true }).click();
    const definition = page.getByRole("region", { name: "번호 종류 보기", exact: true });
    await expect(definition.getByText("판매처에 등록된 고유 상품 번호", { exact: true })).toBeVisible();
    await expect(definition.getByRole("textbox", { name: "번호 종류 이름", exact: true })).toBeDisabled();
    await expect(definition.getByRole("button", { name: "저장", exact: true })).toBeDisabled();
    await definition.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath("settings-readonly-registry.png"), fullPage: true });
    expect(fixture.writes).toEqual([]);
  },
);

test("unknown write followed by permission demotion can leave with draft confirmation without replaying a mutation", async ({ page }) => {
  const fixture = await setup(page, "write");
  await page.route(`http://127.0.0.1:55633/api/entity-types/${fixtureType.id}`, async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    fixture.writes.push(new URL(route.request().url()).pathname);
    return route.abort("failed");
  });
  await page.goto(`/w/${space}/settings/entity-types/${fixtureType.id}`);
  await page.getByRole("button", { name: "기본 정보", exact: true }).click();
  await page.getByRole("textbox", { name: "자료 종류 이름", exact: true }).fill("불명 응답의 초안");
  await page.getByRole("button", { name: "기본 정보 저장", exact: true }).click();
  await expect(page.getByRole("button", { name: "같은 요청 다시 확인", exact: true })).toBeEnabled();
  fixture.setAccess("read");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("읽기 전용 설정", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "같은 요청 다시 확인", exact: true })).toBeDisabled();
  await expect(page.getByText(/이동해도 이미 전송한 요청이 취소되지는 않습니다/)).toBeVisible();
  await page.getByRole("tab", { name: "일괄 설정", exact: true }).click();
  const confirmation = page.getByRole("alertdialog", { name: "변경을 버릴까요?", exact: true });
  await expect(confirmation).toBeVisible();
  await confirmation.getByRole("button", { name: "이동", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/w/${space}/settings/data-model$`));
  expect(fixture.writes).toHaveLength(1);
});
