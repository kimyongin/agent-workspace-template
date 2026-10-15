import { expect, test } from "@playwright/test";
import { entity, fixtureType, id } from "./support/workspace-data.ts";
import { installWorkspaceApi } from "./support/workspace-api.ts";

test.beforeEach(async ({ page }) => {
  const remote = "http://127.0.0.1:55587";
  const user = {
    id: id(100),
    aud: "authenticated",
    email: "fixture@example.test",
    app_metadata: {},
    user_metadata: {},
  };
  await installWorkspaceApi(page, remote, { entities: [entity()], tasks: [], records: [], principles: [], tags: [] });
  await page.addInitScript(
    (user) =>
      localStorage.setItem(
        "sb-127-auth-token",
        JSON.stringify({
          access_token: "fixture",
          refresh_token: "fixture",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          user,
        }),
      ),
    user,
  );
  await page.route("**/auth/v1/user", (route) => route.fulfill({ json: user }));
});

test("filter drafts survive search and disclosure and commit only with common apply", async ({ page }) => {
  await page.goto(`/entities?entity_type_id=${fixtureType.id}&filters=1`);
  await expect(page.getByLabel("정렬", { exact: true })).toBeVisible();
  await page.getByLabel("정렬", { exact: true }).selectOption("title");
  expect(new URL(page.url()).searchParams.has("sort")).toBe(false);
  await expect(page.getByText("변경사항 적용 대기", { exact: true })).toBeVisible();
  await page.getByLabel("자료 제목 검색", { exact: true }).fill("자료");
  await expect.poll(() => new URL(page.url()).searchParams.get("keyword")).toBe("자료");
  await expect(page.getByLabel("정렬", { exact: true })).toHaveValue("title");
  await page.getByRole("button", { name: /^필터 닫기/ }).click();
  await page.getByRole("button", { name: /^필터 열기/ }).click();
  await expect(page.getByLabel("정렬", { exact: true })).toHaveValue("title");
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("sort")).toBe("title");
  await page.getByRole("button", { name: "조건 초기화", exact: true }).click();
  expect(new URL(page.url()).searchParams.get("sort")).toBe("title");
  await expect(page.getByLabel("정렬", { exact: true })).toHaveValue("updated_at");
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has("sort")).toBe(false);
  expect(new URL(page.url()).searchParams.get("keyword")).toBe("자료");
});

test("invalid property draft and reset retain applied results until common apply", async ({ page }) => {
  await page.goto(`/entities?entity_type_id=${fixtureType.id}&filters=1&sort=title`);
  await page.getByRole("button", { name: "속성 조건 추가", exact: true }).click();
  await page.getByLabel("조건 1 속성", { exact: true }).selectOption("prop_2");
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("조건 값과 비교를 확인하세요");
  expect(new URL(page.url()).searchParams.get("sort")).toBe("title");
  expect(new URL(page.url()).searchParams.has("property_filters")).toBe(false);
  await expect(page.getByLabel("조건 1 값", { exact: true })).toHaveValue("");
  await page.getByLabel("조건 1 값", { exact: true }).fill("12");
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("property_filters")).toBe(
    '[{"key":"prop_2","operator":"eq","value":12}]',
  );
  await page.getByLabel("조건 1 비교", { exact: true }).selectOption("unset");
  await expect(page.getByLabel("조건 1 값", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("property_filters")).toBe(
    '[{"key":"prop_2","operator":"unset"}]',
  );
});

test("record dates and kind apply together and invalid dates preserve URL and edited fields", async ({ page }) => {
  await page.goto("/records?filters=1&from=2026-09-01&to=2026-10-01");
  await page.getByLabel("기록 시작일", { exact: true }).fill("2026-11-01");
  await page.getByLabel("기록 종류", { exact: true }).selectOption("user");
  expect(new URL(page.url()).searchParams.get("from")).toBe("2026-09-01");
  expect(new URL(page.url()).searchParams.has("record_kind")).toBe(false);
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("기록 시작일은 종료일보다 늦을 수 없습니다");
  expect(new URL(page.url()).searchParams.get("from")).toBe("2026-09-01");
  await expect(page.getByLabel("기록 시작일", { exact: true })).toHaveValue("2026-11-01");
  await page.getByLabel("기록 종료일", { exact: true }).fill("2026-12-01");
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect.poll(() => new URL(page.url()).searchParams.get("from")).toBe("2026-11-01");
  expect(new URL(page.url()).searchParams.get("record_kind")).toBe("user");
});

test("mixed search text submission preserves optional drafts and disclosure causes no read", async ({ page }) => {
  const reads: unknown[] = [];
  await page.route("**/api/search", async (route) => {
    reads.push(route.request().postDataJSON());
    await route.fulfill({
      json: { items: [], next_cursor: null, search_state: "keyword", semantic_coverage: { pending: 0, excluded: 0 } },
    });
  });
  await page.goto("/search?q=alpha&filters=1");
  await expect.poll(() => reads.length).toBe(1);
  await page.getByLabel("검색 대상", { exact: true }).selectOption("task");
  await page.getByRole("textbox", { name: "검색어", exact: false }).fill("beta");
  await page.getByRole("button", { name: "검색", exact: true }).click();
  await expect.poll(() => reads.length).toBe(2);
  expect(new URL(page.url()).searchParams.has("kind")).toBe(false);
  await expect(page.getByLabel("검색 대상", { exact: true })).toHaveValue("task");
  await page.getByRole("button", { name: /^필터 닫기/ }).click();
  await page.getByRole("button", { name: /^필터 열기/ }).click();
  expect(reads.length).toBe(2);
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect.poll(() => reads.length).toBe(3);
  expect(new URL(page.url()).searchParams.get("kind")).toBe("task");
  expect(new URL(page.url()).searchParams.get("q")).toBe("beta");
});

test("history synchronizes optional drafts and property rows keep their responsive list order", async ({ page }) => {
  await page.goto(`/entities?entity_type_id=${fixtureType.id}&filters=1&sort=title`);
  await page.goto(`/entities?entity_type_id=${fixtureType.id}&filters=1`);
  await page.getByLabel("정렬", { exact: true }).selectOption("title");
  await page.goBack();
  await expect(page.getByLabel("정렬", { exact: true })).toHaveValue("title");
  await page.goForward();
  await expect(page.getByLabel("정렬", { exact: true })).toHaveValue("updated_at");
  await page.getByRole("button", { name: "속성 조건 추가", exact: true }).click();
  await page.getByRole("button", { name: "속성 조건 추가", exact: true }).click();
  for (const width of [320, 360, 390, 639, 640, 768, 1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    const property = await page.getByLabel("조건 1 속성", { exact: true }).boundingBox();
    const comparison = await page.getByLabel("조건 1 비교", { exact: true }).boundingBox();
    const value = await page.getByLabel("조건 1 값", { exact: true }).boundingBox();
    const remove = await page.getByRole("button", { name: "조건 1 제거", exact: true }).boundingBox();
    expect(Math.abs(property!.y - comparison!.y)).toBeLessThan(2);
    expect(Math.abs(property!.y - remove!.y)).toBeLessThan(2);
    if (width < 768) expect(value!.y).toBeGreaterThan(property!.y + 30);
    else expect(Math.abs(property!.y - value!.y)).toBeLessThan(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (test.info().project.name === "desktop") {
      await page.screenshot({ path: `/tmp/filter-panels-review/${width}.png`, fullPage: true });
    }
  }
});
