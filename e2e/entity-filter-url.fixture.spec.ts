import { fixtureWorkspacePath } from "./support/workspace-scope.ts";
import { chooseEntityType } from "./ui-actions.ts";
import { detailDialog } from "./ui-actions.ts";
import { closeDetail, openDetailEditor, openListDetail } from "./ui-actions.ts";
import { expect, test } from "@playwright/test";
import { entity, fixtureSchema, fixtureType, id, task } from "./support/workspace-data.ts";
import { installWorkspaceApi } from "./support/workspace-api.ts";

test("long property filter copied URL/reload/history/reset/type scope and entity anchor use fragments", async ({ page }) => {
  const remote = "http://127.0.0.1:55587",
    user = {
      id: id(100),
      aud: "authenticated",
      email: "fixture@example.test",
      app_metadata: {},
      user_metadata: { workspace_timezone: "Asia/Seoul" },
    };
  const value = "한".repeat(4096),
    row = entity(1, { prop_1: "필터 검사", prop_2: value }),
    schema = structuredClone(fixtureSchema);
  schema.schema.properties.prop_2 = { "x-order": 20, type: "string", title: "긴 값" };
  await installWorkspaceApi(page, remote, { entities: [row], tasks: [], records: [], tags: [] });
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
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === remote && url.pathname.startsWith("/api/")) return route.fallback();
    if (url.origin === remote && url.pathname === "/auth/v1/user") return route.fulfill({ json: user });
    if (url.origin === new URL(test.info().project.use.baseURL as string).origin) return route.continue();
    return route.abort();
  });
  await page.route("**/api/entity-types/*/schema", async (route) => route.fulfill({ json: schema }));
  const reads: Array<{ method: string; filters?: Array<{ value?: unknown }> }> = [];
  await page.route("**/api/entities**", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname !== "/api/entities" && url.pathname !== "/api/entities/query") return route.fallback();
    const query = request.method() === "POST" ? request.postDataJSON() : Object.fromEntries(url.searchParams);
    const filters = typeof query.filters === "string" ? JSON.parse(query.filters) : query.filters;
    reads.push({ method: request.method(), filters });
    return route.fulfill({ json: { items: [row], next_cursor: null } });
  });
  await page.goto(fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}&filters=1&keyword=保留`));
  await expect(page.getByRole("button", { name: "필터 검사", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "속성 조건 추가", exact: true }).click();
  await page.getByLabel("조건 1 속성", { exact: true }).selectOption("prop_2");
  await page.getByLabel("조건 1 값", { exact: true }).fill(value);
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect.poll(() => reads.at(-1)?.filters?.[0].value).toBe(value);
  expect(reads.at(-1)?.method).toBe("POST");
  const copied = page.url(), longUrl = new URL(copied);
  // RED on the old emitter: Vite receives ~37KiB query and reload returns431 before JavaScript.
  expect((await page.reload())?.status()).toBe(200);
  expect(longUrl.search.length).toBeLessThan(2048);
  expect(longUrl.searchParams.has("property_filters")).toBe(false);
  expect(new URLSearchParams(longUrl.hash.slice(1)).get("property_filters")).toBe(
    JSON.stringify([{ key: "prop_2", operator: "eq", value }]),
  );
  await expect(page.getByLabel("조건 1 값", { exact: true })).toHaveValue(value);
  await page.goto(fixtureWorkspacePath("/tasks"));
  expect((await page.goto(copied))?.status()).toBe(200);
  await expect(page.getByLabel("조건 1 값", { exact: true })).toHaveValue(value);
  await chooseEntityType(page, "전체 자료");
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await page.goBack();
  await expect(page.getByLabel("조건 1 값", { exact: true })).toHaveValue(value);
  await page.goForward();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  await page.goBack();
  await expect(page.getByLabel("조건 1 값", { exact: true })).toHaveValue(value);
  const anchored = new URL(copied), fragment = new URLSearchParams(anchored.hash.slice(1));
  fragment.set("anchor", `entity-${row.id}`);
  anchored.hash = fragment.toString();
  await page.goto(fixtureWorkspacePath("/tasks"));
  expect((await page.goto(anchored.href))?.status()).toBe(200);
  await expect(page.getByRole("link", { name: "필터 검사 상세", exact: true })).toBeFocused();
  const ambiguous = new URL(copied);
  ambiguous.searchParams.set("property_filters", "[]");
  await page.goto(ambiguous.href);
  await expect(
    page.getByText("속성 조건 주소가 잘못되었거나 중복되었습니다. 조건을 확인하거나 초기화하세요.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "조건 초기화", exact: true }).click();
  await page.getByRole("button", { name: "필터 적용", exact: true }).click();
  await expect.poll(() => new URL(page.url()).hash).toBe("");
  expect(new URL(page.url()).searchParams.get("entity_type_id")).toBe(fixtureType.id);
  expect(new URL(page.url()).searchParams.get("keyword")).toBe("保留");
  await expect(page.getByRole("button", { name: "필터 검사", exact: true })).toBeVisible();
});

test("long filter survives detail edit/task modes and rejected record intent and copied desktop owner-list reload", async ({ page }) => {
  const remote = "http://127.0.0.1:55587",
    user = {
      id: id(101),
      aud: "authenticated",
      email: "fixture@example.test",
      app_metadata: {},
      user_metadata: { workspace_timezone: "Asia/Seoul" },
    };
  const value = "한".repeat(4096),
    row = entity(1, { prop_1: "모드 검사", prop_2: value }),
    schema = structuredClone(fixtureSchema);
  schema.schema.properties.prop_2 = { "x-order": 20, type: "string", title: "긴 값" };
  const relatedTask = { ...task(2), title: "관련 할 일 모드 검사" };
  await installWorkspaceApi(page, remote, {
    entities: [row],
    tasks: [relatedTask],
    records: [],
    tags: [],
  });
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
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin === remote && url.pathname.startsWith("/api/")) return route.fallback();
    if (url.origin === remote && url.pathname === "/auth/v1/user") return route.fulfill({ json: user });
    if (url.origin === new URL(test.info().project.use.baseURL as string).origin) return route.continue();
    return route.abort();
  });
  await page.route("**/api/entity-types/*/schema", async (route) => route.fulfill({ json: schema }));
  const reads: Array<{ type: string; valueLength: number; matches: boolean }> = [];
  await page.route("**/api/entities**", async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname !== "/api/entities" && url.pathname !== "/api/entities/query") return route.fallback();
    const query = request.method() === "POST" ? request.postDataJSON() : Object.fromEntries(url.searchParams);
    const filters = typeof query.filters === "string" ? JSON.parse(query.filters) : query.filters;
    reads.push({
      type: query.entity_type_id,
      valueLength: String(filters?.[0]?.value ?? "").length,
      matches: filters?.[0]?.value === value,
    });
    return route.fulfill({ json: { items: [row], next_cursor: null } });
  });
  const filters = JSON.stringify([{ key: "prop_2", operator: "eq", value }]);
  const fragment = new URLSearchParams({
    property_filters: filters,
    entity_type_id: fixtureType.id,
    anchor: `entity-${row.id}`,
  });
  const list = fixtureWorkspacePath(`/entities?entity_type_id=${fixtureType.id}&keyword=保留#${fragment}`);
  await page.goto(list);
  await expect.poll(() => reads.at(-1)?.matches).toBe(true);
  await openListDetail(page, "모드 검사");
  for (const mode of ["edit", "task"] as const) {
    if (mode === "edit") await openDetailEditor(page);
    else await page.getByRole("button", { name: "할 일 작성", exact: true }).click();
    await expect.poll(() => new URLSearchParams(new URL(page.url()).hash.slice(1)).get("anchor")).toBe(
      `entity-${row.id}`,
    );
    const detail = new URL(page.url()), parsed = new URLSearchParams(detail.hash.slice(1));
    expect(parsed.get("entity_type_id")).toBe(fixtureType.id);
    expect(JSON.parse(parsed.get("property_filters")!)[0].value.length).toBe(4096);
    expect(detail.search.length).toBeLessThan(2048);
    const before = reads.length;
    expect((await page.reload())?.status()).toBe(200);
    if (test.info().project.name.includes("desktop")) {
      await expect.poll(() => reads.length).toBeGreaterThan(before);
      expect(reads.at(-1)).toEqual({ type: fixtureType.id, valueLength: 4096, matches: true });
    }
    const form = detailDialog(page);
    await form.getByRole("button", { name: "취소", exact: true }).click();
    await expect.poll(() => new URL(page.url()).searchParams.has(mode === "edit" ? "edit" : "create")).toBe(false);
    expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("anchor")).toBe(`entity-${row.id}`);
  }
  const rejected = new URL(page.url());
  rejected.searchParams.set("create", "record");
  await page.goto(rejected.href);
  await expect(page.getByRole("dialog", { name: "기록 작성", exact: true })).toHaveCount(0);
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("anchor")).toBe(`entity-${row.id}`);
  await closeDetail(page, "모드 검사");
  await expect.poll(() => new URL(page.url()).pathname).toBe(fixtureWorkspacePath("/entities"));
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("entity_type_id")).toBe(fixtureType.id);
  await expect(page.getByRole("link", { name: "모드 검사 상세", exact: true })).toBeFocused();
  // Copied cross-kind visits can still disclose an entity list; editor modes must not append a second query marker.
  const taskVisit = new URL(fixtureWorkspacePath(`/tasks/${relatedTask.id}`), new URL(page.url()).origin);
  taskVisit.searchParams.set("list", `/entities?entity_type_id=${fixtureType.id}&keyword=보관`);
  taskVisit.hash = fragment.toString();
  await page.goto(taskVisit.href);
  await openDetailEditor(page);
  const taskEditor = new URL(page.url());
  expect(taskEditor.searchParams.get("edit")).toBe("1");
  expect(taskEditor.search.length).toBeLessThan(2048);
  expect(new URLSearchParams(taskEditor.hash.slice(1)).get("property_filters")).toBe(filters);
  await detailDialog(page).getByRole("button", {
    name: "취소",
    exact: true,
  }).click();
  await expect.poll(() => new URL(page.url()).searchParams.has("edit")).toBe(false);
  expect(new URLSearchParams(new URL(page.url()).hash.slice(1)).get("anchor")).toBe(`entity-${row.id}`);
});
